import { create } from "zustand";
import {
  ApiMessage,
  ApiSession,
  ApiWorkspace,
  LocalModel,
  branchSession as branchSessionRequest,
  createSession as createSessionRequest,
  createWorkspace as createWorkspaceRequest,
  deleteMessage as deleteMessageRequest,
  deleteSession as deleteSessionRequest,
  deleteWorkspace as deleteWorkspaceRequest,
  ejectLlamaModel,
  getLlamaStatus,
  getSession,
  listLocalModels,
  listSessions,
  listWorkspaces,
  streamChatMessage,
  switchLlamaModel,
  updateMessage as updateMessageRequest,
  updateSession as updateSessionRequest,
  updateWorkspace as updateWorkspaceRequest
} from "../api";

type ChatState = {
  workspaces: ApiWorkspace[];
  sessions: ApiSession[];
  currentWorkspaceId: string | null;
  currentSessionId: string | null;
  isBootstrapping: boolean;
  isSubmitting: boolean;
  error: string | null;
  streamingText: string;
  availableModels: LocalModel[];
  selectedModel: string | null;
  activeModelPath: string | null;
  isSwitchingModel: boolean;
  memoryEnabled: boolean;
  thinkingEnabled: boolean;
  bootstrap: () => Promise<void>;
  setSelectedModel: (modelId: string) => void;
  applyModelSwitch: () => Promise<void>;
  ejectModel: () => Promise<void>;
  toggleMemory: () => void;
  toggleThinking: () => void;
  createWorkspace: (name: string, description: string) => Promise<ApiWorkspace>;
  renameWorkspace: (workspaceId: string, name: string, description: string) => Promise<void>;
  removeWorkspace: (workspaceId: string) => Promise<void>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  createSession: (workspaceId: string, title: string) => Promise<ApiSession>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  removeSession: (sessionId: string) => Promise<void>;
  selectSession: (sessionId: string) => Promise<void>;
  deleteMessage: (sessionId: string, messageId: string) => Promise<void>;
  editMessage: (sessionId: string, messageId: string, content: string) => Promise<void>;
  branchSession: (sessionId: string, messageId: string) => Promise<void>;
  sendMessage: (sessionId: string, content: string, imageData?: string | null) => Promise<void>;
  currentWorkspace: () => ApiWorkspace | undefined;
  currentSession: () => ApiSession | undefined;
  sessionsForCurrentWorkspace: () => ApiSession[];
};

const optimisticMessage = (role: ApiMessage["role"], content: string, imageData?: string | null): ApiMessage => ({
  id: `tmp-${crypto.randomUUID()}`,
  role,
  content,
  image_data: imageData ?? null,
  created_at: new Date().toISOString()
});

export const useChatStore = create<ChatState>((set, get) => ({
  workspaces: [],
  sessions: [],
  currentWorkspaceId: null,
  currentSessionId: null,
  isBootstrapping: false,
  isSubmitting: false,
  error: null,
  streamingText: "",
  availableModels: [],
  selectedModel: null,
  activeModelPath: null,
  isSwitchingModel: false,
  memoryEnabled: true,
  thinkingEnabled: false,

  bootstrap: async () => {
    set({ isBootstrapping: true, error: null });
    try {
      const workspaces = await listWorkspaces();
      const sessionsArrays = await Promise.all(workspaces.map((w) => listSessions(w.id)));
      const allSessions = sessionsArrays.flat();
      const firstWorkspace = workspaces[0];
      const firstSessions = sessionsArrays[0] ?? [];
      set({
        workspaces,
        sessions: allSessions,
        currentWorkspaceId: firstWorkspace?.id ?? null,
        currentSessionId: firstSessions[0]?.id ?? null,
        isBootstrapping: false
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to load data",
        isBootstrapping: false
      });
    }
    // モデル一覧とアクティブモデルはワークスペース読み込みと独立して取得
    try {
      const [models, status] = await Promise.all([listLocalModels(), getLlamaStatus()]);
      const activeModel = models.find((m) => status.active_model_path.includes(m.id));
      set({
        availableModels: models,
        selectedModel: activeModel?.id ?? models[0]?.id ?? null,
        activeModelPath: status.active_model_path,
      });
    } catch {
      try {
        const models = await listLocalModels();
        set({ availableModels: models, selectedModel: models[0]?.id ?? null });
      } catch { /* ignore */ }
    }
  },

  setSelectedModel: (modelId) => set({ selectedModel: modelId }),

  applyModelSwitch: async () => {
    const { selectedModel, availableModels } = get();
    const model = availableModels.find((m) => m.id === selectedModel);
    if (!model) return;
    set({ isSwitchingModel: true, error: null });
    try {
      await switchLlamaModel(model.path);

      // ① まず古いサーバーが停止するのを待つ (最大15秒)
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const status = await getLlamaStatus().catch(() => ({ ready: false, active_model_path: "" }));
        if (!status.ready) break;
      }

      // ② 新しいサーバーが起動するのを待つ (最大180秒: 大型モデルは時間がかかる)
      for (let i = 0; i < 180; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const status = await getLlamaStatus().catch(() => ({ ready: false, active_model_path: "" }));
        if (status.ready) {
          set({ isSwitchingModel: false, activeModelPath: status.active_model_path });
          // 現在のセッションのモデル名を更新
          const sessionId = get().currentSessionId;
          const newModel = get().selectedModel;
          if (sessionId && newModel) {
            updateSessionRequest(sessionId, { model_name: newModel })
              .then((updated) => {
                set((state) => ({
                  sessions: state.sessions.map((s) => (s.id === updated.id ? updated : s)),
                }));
              })
              .catch(() => {});
          }
          return;
        }
      }
      set({ isSwitchingModel: false, error: "モデルの起動がタイムアウトしました" });
    } catch (e) {
      set({ isSwitchingModel: false, error: e instanceof Error ? e.message : "モデル切り替えに失敗しました" });
    }
  },

  ejectModel: async () => {
    set({ isSwitchingModel: true, error: null });
    try {
      await ejectLlamaModel();
      set({ isSwitchingModel: false, activeModelPath: "", selectedModel: null });
    } catch (e) {
      set({ isSwitchingModel: false, error: e instanceof Error ? e.message : "モデルのアンロードに失敗しました" });
    }
  },

  toggleMemory: () => set((state) => ({ memoryEnabled: !state.memoryEnabled })),
  toggleThinking: () => set((state) => ({ thinkingEnabled: !state.thinkingEnabled })),

  createWorkspace: async (name, description) => {
    const workspace = await createWorkspaceRequest(name, description);
    set((state) => ({
      workspaces: [...state.workspaces, workspace],
      currentWorkspaceId: workspace.id,
      sessions: [],
      currentSessionId: null,
      error: null
    }));
    return workspace;
  },

  renameWorkspace: async (workspaceId, name, description) => {
    const workspace = await updateWorkspaceRequest(workspaceId, { name, description });
    set((state) => ({
      workspaces: state.workspaces.map((item) => (item.id === workspace.id ? workspace : item)),
      error: null
    }));
  },

  removeWorkspace: async (workspaceId) => {
    await deleteWorkspaceRequest(workspaceId);
    const workspaces = get().workspaces.filter((item) => item.id !== workspaceId);
    const sessions = get().sessions.filter((s) => s.workspace_id !== workspaceId);
    const nextWorkspace = workspaces[0];
    const nextSessions = sessions.filter((s) => s.workspace_id === nextWorkspace?.id);
    set({
      workspaces,
      sessions,
      currentWorkspaceId: nextWorkspace?.id ?? null,
      currentSessionId: nextSessions[0]?.id ?? null,
      error: null,
      streamingText: ""
    });
  },

  selectWorkspace: async (workspaceId) => {
    const sessions = get().sessions.filter((s) => s.workspace_id === workspaceId);
    set({
      currentWorkspaceId: workspaceId,
      currentSessionId: sessions[0]?.id ?? null,
      error: null,
      streamingText: ""
    });
  },

  createSession: async (workspaceId, title) => {
    const session = await createSessionRequest(workspaceId, title, get().selectedModel ?? undefined);
    set((state) => ({
      sessions: [session, ...state.sessions],
      currentWorkspaceId: workspaceId,
      currentSessionId: session.id,
      error: null,
      streamingText: ""
    }));
    return session;
  },

  renameSession: async (sessionId, title) => {
    const session = await updateSessionRequest(sessionId, { title });
    set((state) => ({
      sessions: state.sessions.map((item) => (item.id === session.id ? session : item)),
      error: null
    }));
  },

  removeSession: async (sessionId) => {
    await deleteSessionRequest(sessionId, true);
    const remaining = get().sessions.filter((item) => item.id !== sessionId);
    const nextSessionId = get().currentSessionId === sessionId ? remaining[0]?.id ?? null : get().currentSessionId;
    set({
      sessions: remaining,
      currentSessionId: nextSessionId,
      error: null,
      streamingText: ""
    });
    if (nextSessionId) {
      await get().selectSession(nextSessionId);
    }
  },

  selectSession: async (sessionId) => {
    set({ currentSessionId: sessionId, error: null, streamingText: "" });
    try {
      const session = await getSession(sessionId);
      set((state) => ({
        sessions: state.sessions.map((item) => (item.id === session.id ? session : item))
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to load session" });
    }
  },

  deleteMessage: async (sessionId, messageId) => {
    await deleteMessageRequest(messageId);
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId
          ? { ...s, messages: s.messages.filter((m) => m.id !== messageId) }
          : s
      )
    }));
  },

  editMessage: async (sessionId, messageId, content) => {
    const updated = await updateMessageRequest(messageId, content);
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId
          ? { ...s, messages: s.messages.map((m) => (m.id === messageId ? { ...m, content: updated.content } : m)) }
          : s
      )
    }));
  },

  branchSession: async (sessionId, messageId) => {
    const newSession = await branchSessionRequest(sessionId, messageId);
    set((state) => ({
      sessions: [newSession, ...state.sessions],
      currentWorkspaceId: newSession.workspace_id,
      currentSessionId: newSession.id
    }));
  },

  sendMessage: async (sessionId, content, imageData) => {
    const current = get().sessions.find((session) => session.id === sessionId);
    if (!current) return;

    const user = optimisticMessage("user", content, imageData);
    const assistant = optimisticMessage("assistant", "");

    set((state) => ({
      isSubmitting: true,
      error: null,
      streamingText: "",
      sessions: state.sessions.map((session) =>
        session.id === sessionId
          ? { ...session, messages: [...session.messages, user, assistant] }
          : session
      )
    }));

    try {
      await streamChatMessage(sessionId, content, imageData ?? null, get().memoryEnabled, get().thinkingEnabled, {
        onToken: (chunk) => {
          set((state) => ({
            streamingText: state.streamingText + chunk,
            sessions: state.sessions.map((session) =>
              session.id === sessionId
                ? {
                    ...session,
                    messages: session.messages.map((message) =>
                      message.id === assistant.id
                        ? { ...message, content: message.content + chunk }
                        : message
                    )
                  }
                : session
            )
          }));
        },
        onDone: (session) => {
          set((state) => ({
            sessions: state.sessions.map((item) => (item.id === session.id ? session : item)),
            currentSessionId: session.id,
            isSubmitting: false,
            streamingText: ""
          }));
          // 初回メッセージ（user+assistant の2件）のときタイトルを自動生成
          const currentTitle = get().sessions.find((s) => s.id === session.id)?.title ?? "";
          if (session.messages.length === 2 && (currentTitle === "New chat" || currentTitle === "新規チャット")) {
            const firstUser = session.messages.find((m) => m.role === "user");
            if (firstUser) {
              const autoTitle = firstUser.content.slice(0, 40).replace(/\n/g, " ");
              void updateSessionRequest(session.id, { title: autoTitle }).then((updated) => {
                set((state) => ({
                  sessions: state.sessions.map((item) => (item.id === updated.id ? updated : item))
                }));
              });
            }
          }
        },
        onError: (detail) => {
          set((state) => ({
            error: detail,
            isSubmitting: false,
            streamingText: "",
            sessions: state.sessions.map((session) =>
              session.id === sessionId
                ? {
                    ...session,
                    messages: session.messages.filter((message) => message.id !== assistant.id)
                  }
                : session
            )
          }));
        }
      });
    } catch (error) {
      set((state) => ({
        error: error instanceof Error ? error.message : "Failed to send message",
        isSubmitting: false,
        streamingText: "",
        sessions: state.sessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                messages: session.messages.filter(
                  (message) => message.id !== user.id && message.id !== assistant.id
                )
              }
            : session
        )
      }));
    }
  },

  currentWorkspace: () => get().workspaces.find((workspace) => workspace.id === get().currentWorkspaceId),

  currentSession: () => get().sessions.find((session) => session.id === get().currentSessionId),

  sessionsForCurrentWorkspace: () =>
    get().sessions.filter((session) => session.workspace_id === get().currentWorkspaceId)
}));

export type { ApiMessage, ApiSession, ApiWorkspace, LocalModel };