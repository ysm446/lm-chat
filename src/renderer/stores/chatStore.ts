import { create } from "zustand";
import {
  ApiMessage,
  ApiSession,
  ApiWorkspace,
  LocalModel,
  appendSessionMessage as appendSessionMessageRequest,
  branchSession as branchSessionRequest,
  createSession as createSessionRequest,
  createWorkspace as createWorkspaceRequest,
  deleteMessage as deleteMessageRequest,
  deleteSession as deleteSessionRequest,
  deleteWorkspace as deleteWorkspaceRequest,
  reorderWorkspaces as reorderWorkspacesRequest,
  ejectLlamaModel,
  getLlamaStatus,
  getSession,
  listLocalModels,
  listSessions,
  listWorkspaces,
  listSystemPrompts,
  saveActiveSystemPrompt,
  streamChatMessage,
  streamContinueMessage,
  streamTempChatMessage,
  switchLlamaModel,
  updateMessage as updateMessageRequest,
  generateSessionTitle as generateSessionTitleRequest,
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
  abortController: AbortController | null;
  error: string | null;
  streamingText: string;
  availableModels: LocalModel[];
  selectedModel: string | null;
  activeModelPath: string | null;
  isSwitchingModel: boolean;
  memoryEnabled: boolean;
  thinkingEnabled: boolean;
  autocompleteEnabled: boolean;
  systemPromptText: string;
  setSystemPromptText: (text: string) => void;
  tempChatMode: boolean;
  tempMessages: ApiMessage[];
  toggleTempChat: () => void;
  sendTempMessage: (content: string) => Promise<void>;
  bootstrap: () => Promise<void>;
  setSelectedModel: (modelId: string) => void;
  applyModelSwitch: () => Promise<void>;
  ejectModel: () => Promise<void>;
  toggleMemory: () => void;
  toggleThinking: () => void;
  toggleAutocomplete: () => void;
  reorderWorkspaces: (orderedIds: string[]) => Promise<void>;
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
  stopGeneration: () => void;
  continueGeneration: (sessionId: string) => Promise<void>;
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
  created_at: new Date().toISOString(),
  completion_tokens: null,
  tokens_per_second: null,
  elapsed_seconds: null,
  finish_reason: null,
  model_name: null,
});

export const useChatStore = create<ChatState>((set, get) => ({
  workspaces: [],
  sessions: [],
  currentWorkspaceId: null,
  currentSessionId: null,
  isBootstrapping: false,
  isSubmitting: false,
  abortController: null,
  error: null,
  streamingText: "",
  availableModels: [],
  selectedModel: null,
  activeModelPath: null,
  isSwitchingModel: false,
  memoryEnabled: true,
  thinkingEnabled: false,
  autocompleteEnabled: false,
  systemPromptText: "",
  tempChatMode: false,
  tempMessages: [],

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
        selectedModel: activeModel?.id ?? null,
        activeModelPath: status.active_model_path,
      });
    } catch {
      try {
        const models = await listLocalModels();
        set({ availableModels: models, selectedModel: null });
      } catch { /* ignore */ }
    }
    // システムプロンプトの active_text を読み込む
    try {
      const sp = await listSystemPrompts();
      set({ systemPromptText: sp.active_text });
    } catch { /* ignore */ }
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

  setSystemPromptText: (text) => {
    set({ systemPromptText: text });
    saveActiveSystemPrompt(text).catch(() => {});
  },

  toggleTempChat: () => set((state) => ({
    tempChatMode: !state.tempChatMode,
    tempMessages: [],
    streamingText: "",
  })),

  sendTempMessage: async (content) => {
    const { tempMessages, systemPromptText, thinkingEnabled } = get();

    const makeMsg = (role: ApiMessage["role"], text: string): ApiMessage => ({
      id: `tmp-${crypto.randomUUID()}`,
      role,
      content: text,
      image_data: null,
      created_at: new Date().toISOString(),
      completion_tokens: null,
      tokens_per_second: null,
      elapsed_seconds: null,
      finish_reason: null,
      model_name: null,
    });

    const userMsg = makeMsg("user", content);
    const assistantMsg = makeMsg("assistant", "");
    const controller = new AbortController();

    set((state) => ({
      isSubmitting: true,
      abortController: controller,
      error: null,
      streamingText: "",
      tempMessages: [...state.tempMessages, userMsg, assistantMsg],
    }));

    const apiMessages = [...tempMessages, userMsg].map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    try {
      await streamTempChatMessage(
        apiMessages,
        thinkingEnabled,
        systemPromptText || null,
        {
          onToken: (chunk) => {
            set((state) => ({
              streamingText: state.streamingText + chunk,
              tempMessages: state.tempMessages.map((m) =>
                m.id === assistantMsg.id ? { ...m, content: m.content + chunk } : m
              ),
            }));
          },
          onDone: () => {
            set({ isSubmitting: false, abortController: null, streamingText: "" });
          },
          onError: (detail) => {
            set((state) => ({
              error: detail,
              isSubmitting: false,
              abortController: null,
              streamingText: "",
              tempMessages: state.tempMessages.filter((m) => m.id !== assistantMsg.id),
            }));
          },
        },
        controller.signal
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        set({ isSubmitting: false, abortController: null, streamingText: "" });
        return;
      }
      set((state) => ({
        error: error instanceof Error ? error.message : "Failed to send message",
        isSubmitting: false,
        abortController: null,
        streamingText: "",
        tempMessages: state.tempMessages.filter((m) => m.id !== userMsg.id && m.id !== assistantMsg.id),
      }));
    }
  },

  toggleMemory: () => set((state) => ({ memoryEnabled: !state.memoryEnabled })),
  toggleThinking: () => set((state) => ({ thinkingEnabled: !state.thinkingEnabled })),
  toggleAutocomplete: () => set((state) => ({ autocompleteEnabled: !state.autocompleteEnabled })),

  reorderWorkspaces: async (orderedIds) => {
    set((state) => ({
      workspaces: orderedIds
        .map((id) => state.workspaces.find((w) => w.id === id))
        .filter((w): w is ApiWorkspace => w != null)
    }));
    await reorderWorkspacesRequest(orderedIds);
  },

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

    const controller = new AbortController();
    const streamStartTime = Date.now();
    let tokenCount = 0;
    set((state) => ({
      isSubmitting: true,
      abortController: controller,
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
          tokenCount++;
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
            void generateSessionTitleRequest(session.id).then((updated) => {
              set((state) => ({
                sessions: state.sessions.map((item) => (item.id === updated.id ? updated : item))
              }));
            }).catch(() => {});
          }
        },
        onError: (detail) => {
          set((state) => ({
            error: detail,
            isSubmitting: false,
            abortController: null,
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
      }, controller.signal, get().systemPromptText || null);
    } catch (error) {
      // ユーザーによる中断 — 途中テキストをDBに保存して finish_reason を記録
      if (error instanceof Error && error.name === "AbortError") {
        const partialText = get().sessions.find((s) => s.id === sessionId)
          ?.messages.find((m) => m.id === assistant.id)?.content ?? "";
        const elapsedSeconds = (Date.now() - streamStartTime) / 1000;
        const tokensPerSecond = elapsedSeconds > 0 ? tokenCount / elapsedSeconds : 0;
        set({ isSubmitting: false, abortController: null, streamingText: "" });
        try {
          await appendSessionMessageRequest(sessionId, {
            role: "assistant",
            content: partialText,
            finish_reason: "user_stopped",
            completion_tokens: tokenCount,
            tokens_per_second: tokensPerSecond,
            elapsed_seconds: elapsedSeconds
          });
          // セッション全体を再取得してユーザー・アシスタント両メッセージのIDを本物に差し替える
          const refreshed = await getSession(sessionId);
          set((state) => ({
            sessions: state.sessions.map((s) => (s.id === sessionId ? refreshed : s))
          }));
        } catch {
          // 保存失敗時はオプティミスティックメッセージをそのまま残す
        }
        return;
      }
      set((state) => ({
        error: error instanceof Error ? error.message : "Failed to send message",
        isSubmitting: false,
        abortController: null,
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

  stopGeneration: () => {
    get().abortController?.abort();
  },

  continueGeneration: async (sessionId) => {
    const current = get().sessions.find((s) => s.id === sessionId);
    if (!current) return;

    const assistant = optimisticMessage("assistant", "");
    const controller = new AbortController();
    const streamStartTime = Date.now();
    let tokenCount = 0;

    set((state) => ({
      isSubmitting: true,
      abortController: controller,
      error: null,
      streamingText: "",
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, messages: [...s.messages, assistant] } : s
      )
    }));

    try {
      await streamContinueMessage(sessionId, get().thinkingEnabled, {
        onToken: (chunk) => {
          tokenCount++;
          set((state) => ({
            streamingText: state.streamingText + chunk,
            sessions: state.sessions.map((s) =>
              s.id === sessionId
                ? { ...s, messages: s.messages.map((m) => m.id === assistant.id ? { ...m, content: m.content + chunk } : m) }
                : s
            )
          }));
        },
        onDone: (session) => {
          set((state) => ({
            sessions: state.sessions.map((item) => (item.id === session.id ? session : item)),
            isSubmitting: false,
            streamingText: ""
          }));
        },
        onError: (detail) => {
          set((state) => ({
            error: detail,
            isSubmitting: false,
            abortController: null,
            streamingText: "",
            sessions: state.sessions.map((s) =>
              s.id === sessionId ? { ...s, messages: s.messages.filter((m) => m.id !== assistant.id) } : s
            )
          }));
        }
      }, controller.signal, get().systemPromptText || null);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        const partialText = get().sessions.find((s) => s.id === sessionId)?.messages.find((m) => m.id === assistant.id)?.content ?? "";
        const elapsedSeconds = (Date.now() - streamStartTime) / 1000;
        const tokensPerSecond = elapsedSeconds > 0 ? tokenCount / elapsedSeconds : 0;
        set({ isSubmitting: false, abortController: null, streamingText: "" });
        try {
          await appendSessionMessageRequest(sessionId, {
            role: "assistant",
            content: partialText,
            finish_reason: "user_stopped",
            completion_tokens: tokenCount,
            tokens_per_second: tokensPerSecond,
            elapsed_seconds: elapsedSeconds
          });
          const refreshed = await getSession(sessionId);
          set((state) => ({ sessions: state.sessions.map((s) => (s.id === sessionId ? refreshed : s)) }));
        } catch { /* ignore */ }
        return;
      }
      set((state) => ({
        error: error instanceof Error ? error.message : "Failed to generate response",
        isSubmitting: false,
        abortController: null,
        streamingText: "",
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, messages: s.messages.filter((m) => m.id !== assistant.id) } : s
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