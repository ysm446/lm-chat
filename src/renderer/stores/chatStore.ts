import { create } from "zustand";
import {
  ApiDocument,
  ImageAttachmentInput,
  ApiMessage,
  ApiSession,
  ApiWorkspace,
  LocalModel,
  appendSessionMessage as appendSessionMessageRequest,
  branchSession as branchSessionRequest,
  createDocument as createDocumentRequest,
  createSession as createSessionRequest,
  createWorkspace as createWorkspaceRequest,
  deleteDocument as deleteDocumentRequest,
  deleteMessage as deleteMessageRequest,
  deleteSession as deleteSessionRequest,
  deleteWorkspace as deleteWorkspaceRequest,
  duplicateSession as duplicateSessionRequest,
  listDocuments as listDocumentsRequest,
  moveDocument as moveDocumentRequest,
  reorderWorkspaces as reorderWorkspacesRequest,
  reorderDocuments as reorderDocumentsRequest,
  reorderSessions as reorderSessionsRequest,
  ejectLlamaModel,
  getLlamaStatus,
  getSettings,
  getSession,
  listLocalModels,
  listSessions,
  listWorkspaces,
  listSystemPrompts,
  saveActiveSystemPrompt,
  streamChatMessage,
  streamContinueMessage,
  streamRegenerateMessage,
  streamTempChatMessage,
  switchLlamaModel,
  updateDocument as updateDocumentRequest,
  updateMessage as updateMessageRequest,
  generateSessionTitle as generateSessionTitleRequest,
  updateSession as updateSessionRequest,
  updateWorkspace as updateWorkspaceRequest,
  moveSession as moveSessionRequest
} from "../api";

const DOCUMENT_INDEX_POLL_INTERVAL_MS = 1500;
const DOCUMENT_INDEX_POLL_MAX_ATTEMPTS = 40;
const documentIndexPollAttempts = new Map<string, number>();
const documentIndexPollTimers = new Map<string, number>();

function scheduleDocumentIndexPolling(workspaceId: string, setDocuments: (docs: ApiDocument[]) => void) {
  if (documentIndexPollTimers.has(workspaceId)) return;

  const poll = async () => {
    const attempts = (documentIndexPollAttempts.get(workspaceId) ?? 0) + 1;
    documentIndexPollAttempts.set(workspaceId, attempts);

    try {
      const docs = await listDocumentsRequest(workspaceId);
      setDocuments(docs);

      const hasPending = docs.some((doc) => doc.indexed_at == null);
      if (hasPending && attempts < DOCUMENT_INDEX_POLL_MAX_ATTEMPTS) {
        const timer = window.setTimeout(poll, DOCUMENT_INDEX_POLL_INTERVAL_MS);
        documentIndexPollTimers.set(workspaceId, timer);
        return;
      }
    } catch {
      if (attempts < DOCUMENT_INDEX_POLL_MAX_ATTEMPTS) {
        const timer = window.setTimeout(poll, DOCUMENT_INDEX_POLL_INTERVAL_MS);
        documentIndexPollTimers.set(workspaceId, timer);
        return;
      }
    }

    documentIndexPollAttempts.delete(workspaceId);
    documentIndexPollTimers.delete(workspaceId);
  };

  const timer = window.setTimeout(poll, DOCUMENT_INDEX_POLL_INTERVAL_MS);
  documentIndexPollTimers.set(workspaceId, timer);
}

type ChatState = {
  workspaces: ApiWorkspace[];
  sessions: ApiSession[];
  documents: ApiDocument[];
  currentWorkspaceId: string | null;
  currentSessionId: string | null;
  currentDocumentId: string | null;
  isBootstrapping: boolean;
  isSubmitting: boolean;
  submissionMode: "send" | "continue" | "regenerate" | "temp" | null;
  abortController: AbortController | null;
  error: string | null;
  streamingText: string;
  availableModels: LocalModel[];
  selectedModel: string | null;
  activeModelPath: string | null;
  isSwitchingModel: boolean;
  memoryEnabled: boolean;
  docRagEnabled: boolean;
  thinkingEnabled: boolean;
  autocompleteEnabled: boolean;
  correctionEnabled: boolean;
  chatScrollPosition: "bottom" | "top";
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
  toggleDocRag: () => void;
  toggleThinking: () => void;
  toggleAutocomplete: () => void;
  setCorrectionEnabled: (enabled: boolean) => void;
  setChatScrollPosition: (value: "bottom" | "top") => void;
  reorderWorkspaces: (orderedIds: string[]) => Promise<void>;
  reorderSessions: (orderedIds: string[]) => Promise<void>;
  createWorkspace: (name: string, description: string) => Promise<ApiWorkspace>;
  renameWorkspace: (workspaceId: string, name: string, description: string) => Promise<void>;
  removeWorkspace: (workspaceId: string) => Promise<void>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  createSession: (workspaceId: string, title: string) => Promise<ApiSession>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  duplicateSession: (sessionId: string) => Promise<void>;
  removeSession: (sessionId: string) => Promise<void>;
  moveSession: (sessionId: string, targetWorkspaceId: string) => Promise<void>;
  selectSession: (sessionId: string) => Promise<void>;
  loadDocuments: (workspaceId: string) => Promise<void>;
  addDocument: (workspaceId: string, fileName: string, content: string) => Promise<ApiDocument>;
  moveDocument: (docId: string, targetWorkspaceId: string) => Promise<void>;
  reorderDocuments: (workspaceId: string, orderedIds: string[]) => Promise<void>;
  removeDocument: (docId: string) => Promise<void>;
  updateDocument: (docId: string, content: string) => Promise<void>;
  renameDocument: (docId: string, fileName: string) => Promise<void>;
  selectDocument: (docId: string | null) => void;
  documentsForWorkspace: (workspaceId: string) => ApiDocument[];
  deleteMessage: (sessionId: string, messageId: string) => Promise<void>;
  editMessage: (sessionId: string, messageId: string, content: string, image?: ImageAttachmentInput | null) => Promise<void>;
  branchSession: (sessionId: string, messageId: string) => Promise<void>;
  regenerateMessage: (sessionId: string, userMessageId: string) => Promise<void>;
  stopGeneration: () => void;
  continueGeneration: (sessionId: string) => Promise<void>;
  sendMessage: (sessionId: string, content: string, image?: ImageAttachmentInput | null) => Promise<void>;
  currentWorkspace: () => ApiWorkspace | undefined;
  currentSession: () => ApiSession | undefined;
  sessionsForCurrentWorkspace: () => ApiSession[];
};

const optimisticMessage = (role: ApiMessage["role"], content: string, image?: ImageAttachmentInput | null): ApiMessage => ({
  id: `tmp-${crypto.randomUUID()}`,
  role,
  content,
  image_data: image?.imageData ?? null,
  image_preview_data: image?.imagePreviewData ?? null,
  has_prompt_log: false,
  created_at: new Date().toISOString(),
  prompt_tokens: null,
  completion_tokens: null,
  tokens_per_second: null,
  elapsed_seconds: null,
  finish_reason: null,
  model_name: null,
});

async function persistStoppedMessage(
  sessionId: string,
  content: string,
  tokenCount: number,
  streamStartTime: number
) {
  const elapsedSeconds = (Date.now() - streamStartTime) / 1000;
  const tokensPerSecond = elapsedSeconds > 0 ? tokenCount / elapsedSeconds : 0;

  await appendSessionMessageRequest(sessionId, {
    role: "assistant",
    content,
    finish_reason: "user_stopped",
    completion_tokens: tokenCount,
    tokens_per_second: tokensPerSecond,
    elapsed_seconds: elapsedSeconds
  });
}

export const useChatStore = create<ChatState>((set, get) => ({
  workspaces: [],
  sessions: [],
  documents: [],
  currentWorkspaceId: null,
  currentSessionId: null,
  currentDocumentId: null,
  isBootstrapping: false,
  isSubmitting: false,
  submissionMode: null,
  abortController: null,
  error: null,
  streamingText: "",
  availableModels: [],
  selectedModel: null,
  activeModelPath: null,
  isSwitchingModel: false,
  memoryEnabled: true,
  docRagEnabled: true,
  thinkingEnabled: false,
  autocompleteEnabled: false,
  correctionEnabled: true,
  chatScrollPosition: "bottom" as "bottom" | "top",
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
      const activeModelPath = status.ready ? status.active_model_path : "";
      const activeModel = models.find((m) => activeModelPath.includes(m.id));
      set({
        availableModels: models,
        selectedModel: activeModel?.id ?? null,
        activeModelPath,
      });
    } catch {
      try {
        const models = await listLocalModels();
        set({ availableModels: models, selectedModel: null });
      } catch { /* ignore */ }
    }
    // ???????????????????
    try {
      const [sp, settings] = await Promise.all([listSystemPrompts(), getSettings()]);
      set({
        systemPromptText: sp.active_text,
        correctionEnabled: settings.correction_enabled ?? true,
        chatScrollPosition: (settings.chat_scroll_position as "bottom" | "top") ?? "bottom",
      });
    } catch {
      try {
        const sp = await listSystemPrompts();
        set({ systemPromptText: sp.active_text });
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
    const userMsg = optimisticMessage("user", content);
    const assistantMsg = optimisticMessage("assistant", "");
    const controller = new AbortController();

    set((state) => ({
      isSubmitting: true,
      submissionMode: "temp",
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
            set({ isSubmitting: false, submissionMode: null, abortController: null, streamingText: "" });
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
        set({ isSubmitting: false, submissionMode: null, abortController: null, streamingText: "" });
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
  toggleDocRag: () => set((state) => ({ docRagEnabled: !state.docRagEnabled })),
  toggleThinking: () => set((state) => ({ thinkingEnabled: !state.thinkingEnabled })),
  toggleAutocomplete: () => set((state) => ({ autocompleteEnabled: !state.autocompleteEnabled })),
  setCorrectionEnabled: (enabled) => set({ correctionEnabled: enabled }),
  setChatScrollPosition: (value) => set({ chatScrollPosition: value }),

  reorderWorkspaces: async (orderedIds) => {
    set((state) => ({
      workspaces: orderedIds
        .map((id) => state.workspaces.find((w) => w.id === id))
        .filter((w): w is ApiWorkspace => w != null)
    }));
    await reorderWorkspacesRequest(orderedIds);
  },

  reorderSessions: async (orderedIds) => {
    set((state) => ({
      sessions: [
        ...orderedIds
          .map((id) => state.sessions.find((s) => s.id === id))
          .filter((s): s is ApiSession => s != null),
        ...state.sessions.filter((s) => !orderedIds.includes(s.id)),
      ]
    }));
    await reorderSessionsRequest(orderedIds);
  },

  createWorkspace: async (name, description) => {
    const workspace = await createWorkspaceRequest(name, description);
    set((state) => ({
      workspaces: [...state.workspaces, workspace],
      currentWorkspaceId: workspace.id,
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

  duplicateSession: async (sessionId) => {
    const session = await duplicateSessionRequest(sessionId);
    set((state) => ({
      sessions: [session, ...state.sessions],
      currentWorkspaceId: session.workspace_id,
      currentSessionId: session.id,
      currentDocumentId: null,
      error: null,
      streamingText: "",
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

  moveSession: async (sessionId, targetWorkspaceId) => {
    const movedSession = await moveSessionRequest(sessionId, targetWorkspaceId);
    // セッションの workspace_id を更新し、移動先ワークスペースのセッション一覧を再取得
    const targetSessions = await listSessions(targetWorkspaceId);
    set((state) => {
      const otherSessions = state.sessions.filter((s) => s.workspace_id !== targetWorkspaceId && s.id !== sessionId);
      return {
        sessions: [...otherSessions, ...targetSessions],
        currentWorkspaceId: movedSession.workspace_id,
        currentSessionId: movedSession.id,
        error: null,
      };
    });
  },

  loadDocuments: async (workspaceId) => {
    try {
      const docs = await listDocumentsRequest(workspaceId);
      set((state) => ({
        documents: [
          ...state.documents.filter((d) => d.workspace_id !== workspaceId),
          ...docs,
        ],
      }));
      if (docs.some((doc) => doc.indexed_at == null)) {
        scheduleDocumentIndexPolling(workspaceId, (latestDocs) =>
          set((state) => ({
            documents: [
              ...state.documents.filter((d) => d.workspace_id !== workspaceId),
              ...latestDocs,
            ],
          }))
        );
      }
    } catch { /* ignore */ }
  },

  addDocument: async (workspaceId, fileName, content) => {
    const doc = await createDocumentRequest({ workspace_id: workspaceId, file_name: fileName, content });
    set((state) => ({ documents: [...state.documents, doc] }));
    if (doc.indexed_at == null) {
      scheduleDocumentIndexPolling(workspaceId, (latestDocs) =>
        set((state) => ({
          documents: [
            ...state.documents.filter((d) => d.workspace_id !== workspaceId),
            ...latestDocs,
          ],
        }))
      );
    }
    return doc;
  },

  moveDocument: async (docId, targetWorkspaceId) => {
    const sourceWorkspaceId = get().documents.find((d) => d.id === docId)?.workspace_id ?? null;
    const movedDoc = await moveDocumentRequest(docId, targetWorkspaceId);
    const targetDocs = await listDocumentsRequest(targetWorkspaceId);
    set((state) => ({
      documents: [
        ...state.documents.filter((d) =>
          d.id !== docId &&
          d.workspace_id !== targetWorkspaceId
        ),
        ...targetDocs,
      ],
      currentWorkspaceId: state.currentDocumentId === docId ? movedDoc.workspace_id : state.currentWorkspaceId,
      currentSessionId: state.currentDocumentId === docId ? null : state.currentSessionId,
    }));
    if (sourceWorkspaceId && sourceWorkspaceId !== targetWorkspaceId) {
      void get().loadDocuments(sourceWorkspaceId);
    }
  },

  reorderDocuments: async (workspaceId, orderedIds) => {
    await reorderDocumentsRequest(orderedIds);
    set((state) => {
      const docsById = new Map(
        state.documents
          .filter((d) => d.workspace_id === workspaceId)
          .map((d) => [d.id, d] as const)
      );
      const reordered = orderedIds
        .map((id, index) => {
          const doc = docsById.get(id);
          return doc ? { ...doc, sort_order: index } : null;
        })
        .filter((doc): doc is ApiDocument => doc !== null);
      return {
        documents: [
          ...state.documents.filter((d) => d.workspace_id !== workspaceId),
          ...reordered,
        ],
      };
    });
  },

  removeDocument: async (docId) => {
    await deleteDocumentRequest(docId);
    set((state) => ({
      documents: state.documents.filter((d) => d.id !== docId),
      currentDocumentId: state.currentDocumentId === docId ? null : state.currentDocumentId,
    }));
  },

  updateDocument: async (docId, content) => {
    const updated = await updateDocumentRequest(docId, { content });
    set((state) => ({
      documents: state.documents.map((d) => (d.id === docId ? updated : d)),
    }));
    if (updated.indexed_at == null) {
      scheduleDocumentIndexPolling(updated.workspace_id, (latestDocs) =>
        set((state) => ({
          documents: [
            ...state.documents.filter((d) => d.workspace_id !== updated.workspace_id),
            ...latestDocs,
          ],
        }))
      );
    }
  },

  renameDocument: async (docId, fileName) => {
    const updated = await updateDocumentRequest(docId, { file_name: fileName });
    set((state) => ({
      documents: state.documents.map((d) => (d.id === docId ? updated : d)),
    }));
  },

  selectDocument: (docId) => {
    set({ currentDocumentId: docId });
  },

  documentsForWorkspace: (workspaceId) =>
    get().documents.filter((d) => d.workspace_id === workspaceId),

  selectSession: async (sessionId) => {
    set({ currentSessionId: sessionId, currentDocumentId: null, error: null, streamingText: "" });
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

  editMessage: async (sessionId, messageId, content, image) => {
    const updated = await updateMessageRequest(messageId, content, image);
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              messages: s.messages.map((m) => (
                m.id === messageId
                  ? {
                      ...m,
                      content: updated.content,
                      image_data: updated.image_data,
                      image_preview_data: updated.image_preview_data,
                    }
                  : m
              )),
            }
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

  regenerateMessage: async (sessionId, userMessageId) => {
    const current = get().sessions.find((session) => session.id === sessionId);
    if (!current) return;

    const userIndex = current.messages.findIndex((message) => message.id === userMessageId && message.role === "user");
    if (userIndex < 0) return;

    const assistantIndex = userIndex + 1;
    if (assistantIndex >= current.messages.length || current.messages[assistantIndex].role !== "assistant") return;

    const targetAssistant = current.messages[assistantIndex];
    const controller = new AbortController();

    set((state) => ({
      isSubmitting: true,
      submissionMode: "regenerate",
      abortController: controller,
      error: null,
      streamingText: "",
      sessions: state.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              messages: session.messages.map((message) =>
                message.id === targetAssistant.id
                  ? {
                      ...message,
                      content: "",
                      prompt_tokens: null,
                      completion_tokens: null,
                      tokens_per_second: null,
                      elapsed_seconds: null,
                      finish_reason: null,
                    }
                  : message
              )
            }
          : session
      )
    }));

    try {
      await streamRegenerateMessage(
        sessionId,
        userMessageId,
        get().thinkingEnabled,
        get().memoryEnabled,
        get().docRagEnabled,
        {
          onToken: (chunk) => {
            set((state) => ({
              streamingText: state.streamingText + chunk,
              sessions: state.sessions.map((session) =>
                session.id === sessionId
                  ? {
                      ...session,
                      messages: session.messages.map((message) =>
                        message.id === targetAssistant.id
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
              isSubmitting: false,
              submissionMode: null,
              abortController: null,
              streamingText: ""
            }));
          },
          onError: (detail) => {
            set((state) => ({
              error: detail,
              isSubmitting: false,
              submissionMode: null,
              abortController: null,
              streamingText: "",
              sessions: state.sessions.map((session) =>
                session.id === sessionId ? { ...session, messages: current.messages } : session
              )
            }));
          }
        },
        controller.signal,
        get().systemPromptText || null
      );
    } catch (error) {
      set((state) => ({
        error: error instanceof Error ? error.message : "Failed to regenerate response",
        isSubmitting: false,
        submissionMode: null,
        abortController: null,
        streamingText: "",
        sessions: state.sessions.map((session) =>
          session.id === sessionId ? { ...session, messages: current.messages } : session
        )
      }));
    }
  },

  sendMessage: async (sessionId, content, image) => {
    const current = get().sessions.find((session) => session.id === sessionId);
    if (!current) return;

    const user = optimisticMessage("user", content, image);
    const assistant = optimisticMessage("assistant", "");

    const controller = new AbortController();
    const streamStartTime = Date.now();
    let tokenCount = 0;
    set((state) => ({
      isSubmitting: true,
      submissionMode: "continue",
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
      await streamChatMessage(sessionId, content, image ?? null, get().memoryEnabled, get().docRagEnabled, get().thinkingEnabled, {
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
            submissionMode: null,
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
            submissionMode: null,
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
        set({ isSubmitting: false, submissionMode: null, abortController: null, streamingText: "" });
        try {
          await persistStoppedMessage(sessionId, partialText, tokenCount, streamStartTime);
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
        submissionMode: null,
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
      await streamContinueMessage(sessionId, get().thinkingEnabled, get().memoryEnabled, get().docRagEnabled, {
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
            submissionMode: null,
            streamingText: ""
          }));
        },
        onError: (detail) => {
          set((state) => ({
            error: detail,
            isSubmitting: false,
            submissionMode: null,
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
        set({ isSubmitting: false, submissionMode: null, abortController: null, streamingText: "" });
        try {
          await persistStoppedMessage(sessionId, partialText, tokenCount, streamStartTime);
          const refreshed = await getSession(sessionId);
          set((state) => ({ sessions: state.sessions.map((s) => (s.id === sessionId ? refreshed : s)) }));
        } catch { /* ignore */ }
        return;
      }
      set((state) => ({
        error: error instanceof Error ? error.message : "Failed to generate response",
        isSubmitting: false,
        submissionMode: null,
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

export type { ApiDocument, ApiMessage, ApiSession, ApiWorkspace, LocalModel };
