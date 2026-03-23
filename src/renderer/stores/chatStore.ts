import { create } from "zustand";
import {
  ApiMessage,
  ApiSession,
  ApiWorkspace,
  LocalModel,
  createSession as createSessionRequest,
  createWorkspace as createWorkspaceRequest,
  deleteSession as deleteSessionRequest,
  deleteWorkspace as deleteWorkspaceRequest,
  getSession,
  listLocalModels,
  listSessions,
  listWorkspaces,
  streamChatMessage,
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
  bootstrap: () => Promise<void>;
  setSelectedModel: (modelId: string) => void;
  createWorkspace: (name: string, description: string) => Promise<ApiWorkspace>;
  renameWorkspace: (workspaceId: string, name: string, description: string) => Promise<void>;
  removeWorkspace: (workspaceId: string) => Promise<void>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  createSession: (workspaceId: string, title: string) => Promise<ApiSession>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  removeSession: (sessionId: string) => Promise<void>;
  selectSession: (sessionId: string) => Promise<void>;
  sendMessage: (sessionId: string, content: string) => Promise<void>;
  currentWorkspace: () => ApiWorkspace | undefined;
  currentSession: () => ApiSession | undefined;
  sessionsForCurrentWorkspace: () => ApiSession[];
};

const optimisticMessage = (role: ApiMessage["role"], content: string): ApiMessage => ({
  id: `tmp-${crypto.randomUUID()}`,
  role,
  content,
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

  bootstrap: async () => {
    set({ isBootstrapping: true, error: null });
    try {
      const workspaces = await listWorkspaces();
      const firstWorkspace = workspaces[0];
      const sessions = firstWorkspace ? await listSessions(firstWorkspace.id) : [];
      set({
        workspaces,
        sessions,
        currentWorkspaceId: firstWorkspace?.id ?? null,
        currentSessionId: sessions[0]?.id ?? null,
        isBootstrapping: false
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to load data",
        isBootstrapping: false
      });
    }
    // モデル一覧はワークスペース読み込みと独立して取得（失敗しても影響しない）
    try {
      const models = await listLocalModels();
      set({ availableModels: models, selectedModel: models[0]?.id ?? null });
    } catch {
      // モデル一覧が取れなくてもアプリは動作する
    }
  },

  setSelectedModel: (modelId) => set({ selectedModel: modelId }),

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
    const nextWorkspace = workspaces[0];
    const nextSessions = nextWorkspace ? await listSessions(nextWorkspace.id) : [];
    set({
      workspaces,
      sessions: nextSessions,
      currentWorkspaceId: nextWorkspace?.id ?? null,
      currentSessionId: nextSessions[0]?.id ?? null,
      error: null,
      streamingText: ""
    });
  },

  selectWorkspace: async (workspaceId) => {
    set({ currentWorkspaceId: workspaceId, currentSessionId: null, error: null, streamingText: "" });
    try {
      const sessions = await listSessions(workspaceId);
      set({
        sessions,
        currentSessionId: sessions[0]?.id ?? null
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to load sessions" });
    }
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

  sendMessage: async (sessionId, content) => {
    const current = get().sessions.find((session) => session.id === sessionId);
    if (!current) return;

    const user = optimisticMessage("user", content);
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
      await streamChatMessage(sessionId, content, {
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