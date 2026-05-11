import type {
  ApiDocument,
  ApiMessage,
  ApiSession,
  ApiWorkspace,
  ImageAttachmentInput,
  LocalModel,
} from "../api";

export type { ApiDocument, ApiMessage, ApiSession, ApiWorkspace, ImageAttachmentInput, LocalModel };

export type ChatState = {
  workspaces: ApiWorkspace[];
  sessions: ApiSession[];
  documents: ApiDocument[];
  currentWorkspaceId: string | null;
  currentSessionId: string | null;
  currentDocumentId: string | null;
  isBootstrapping: boolean;
  isSubmitting: boolean;
  submissionMode: "send" | "continue" | "regenerate" | "insert" | "temp" | null;
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
  insertMessage: (sessionId: string, afterMessageId: string | null, content: string, image?: ImageAttachmentInput | null) => Promise<void>;
  currentWorkspace: () => ApiWorkspace | undefined;
  currentSession: () => ApiSession | undefined;
  sessionsForCurrentWorkspace: () => ApiSession[];
};

export function makeOptimisticMessage(
  role: ApiMessage["role"],
  content: string,
  image?: ImageAttachmentInput | null,
  position = 0,
): ApiMessage {
  return {
    id: `tmp-${crypto.randomUUID()}`,
    role,
    content,
    image_data: image?.imageData ?? null,
    image_preview_data: image?.imagePreviewData ?? null,
    image_summary: null,
    has_prompt_log: false,
    created_at: new Date().toISOString(),
    position,
    prompt_tokens: null,
    completion_tokens: null,
    tokens_per_second: null,
    elapsed_seconds: null,
    finish_reason: null,
    model_name: null,
  };
}
