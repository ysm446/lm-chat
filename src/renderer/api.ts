export type MessageRole = "user" | "assistant" | "system";

export type ApiMessage = {
  id: string;
  role: MessageRole;
  content: string;
  image_data: string | null;
  image_preview_data: string | null;
  image_summary: string | null;
  has_prompt_log: boolean;
  created_at: string;
  position: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  tokens_per_second: number | null;
  elapsed_seconds: number | null;
  finish_reason: string | null;
  model_name: string | null;
};

export type ImageAttachmentInput = {
  imageData?: string | null;
  imagePreviewData?: string | null;
};

export type ApiSession = {
  id: string;
  workspace_id: string;
  title: string;
  updated_at: string;
  created_at: string;
  model_name: string;
  messages: ApiMessage[];
};

export type ApiWorkspace = {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
};

export type ChatStreamEvent =
  | { type: "token"; content: string }
  | { type: "done"; session: ApiSession }
  | { type: "error"; detail: string };

type StreamHandlers<TDone> = {
  onToken: (chunk: string) => void;
  onDone: (payload: TDone) => void;
  onError: (detail: string) => void;
};

type StreamDoneEvent = Extract<ChatStreamEvent, { type: "done" }>;

export type LocalModel = {
  id: string;
  path: string;
  size_bytes: number;
  params_label?: string | null;
  quantization?: string | null;
  architecture?: string | null;
  name?: string | null;
  context_length?: number | null;
  parameter_count?: number | null;
  multimodal?: boolean;
  /** 最近使った順位（0 が最新）。未使用なら null */
  recent_rank?: number | null;
};

export type PromptLogContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } | string }
  | Record<string, unknown>;

export type PromptLogMessage = {
  role: MessageRole;
  content: string | PromptLogContentPart[];
};

export type MessagePromptLog = {
  assistant_message_id: string;
  session_id: string;
  messages: PromptLogMessage[];
  created_at: string;
  updated_at: string;
};

export type DataExportResult = {
  path: string;
  file_name: string;
  size_bytes: number;
  items: string[];
  workspace_id?: string;
};

export type DataImportResult = {
  imported: boolean;
  restart_required: boolean;
  source_path: string;
  file_name: string;
  workspace_id?: string;
};

export type LlamaRuntimeAsset = {
  name: string;
  size_bytes: number;
  download_url: string;
};

export type LlamaRuntimeVariant = {
  id: string;
  label: string;
  description: string;
  available: boolean;
  installed: boolean;
  binary_asset: LlamaRuntimeAsset | null;
  runtime_asset: LlamaRuntimeAsset | null;
};

export type LlamaRuntimeInfo = {
  tag: string;
  name: string;
  html_url: string;
  installed_tag: string;
  installed_variant: string;
  llama_exe: string;
  variants: LlamaRuntimeVariant[];
};

export type LlamaRuntimeInstallResult = {
  status: string;
  tag: string;
  variant: string;
  label: string;
  llama_exe: string;
};

export type AppConfig = {
  ctx_size: number;
  n_gpu_layers: number;
  /** GGUF の探索先。空文字なら既定の models/ を使う */
  models_dir: string;
  temperature: number;
  completion_length: number;
  memory_scope: "workspace" | "above_current" | "below_current";
  memory_context_top_k: number;
  document_context_top_k: number;
  memory_context_chars: number;
  document_context_chars: number;
  memory_decay_half_life_days: number;
  document_chunk_target_chars: number;
  document_chunk_max_chars: number;
  document_chunk_overlap_chars: number;
};

export type AppConfigPatch = Partial<AppConfig>;

export type SettingsSectionKey =
  | "settings_context_open"
  | "settings_memory_open"
  | "settings_documents_open"
  | "settings_advanced_open"
  | "settings_model_open"
  | "settings_system_prompt_open"
  | "settings_interface_open"
  | "settings_completion_open"
  | "settings_data_open"
  | "settings_debug_open";

export type AppSettings = {
  show_left: boolean;
  show_right: boolean;
  sidebar_expanded_workspace_ids: string[];
  sidebar_expanded_document_workspace_ids: string[];
  ui_font: string;
  ui_font_size: number;
  window_resolution: string;
  correction_enabled: boolean;
  correction_prompt_mode: string;
  correction_custom_prompt: string;
  include_all_prompt_images: boolean;
  debug_prompt_log: boolean;
  show_system_resources: boolean;
  chat_scroll_position: string;
} & Record<SettingsSectionKey, boolean>;

export type AppSettingsPatch = Partial<{
  show_left: boolean;
  show_right: boolean;
  sidebar_expanded_workspace_ids: string[];
  sidebar_expanded_document_workspace_ids: string[];
  ui_font: string;
  ui_font_size: number;
  window_resolution: string;
  correction_enabled: boolean;
  correction_prompt_mode: string;
  correction_custom_prompt: string;
  include_all_prompt_images: boolean;
  debug_prompt_log: boolean;
  show_system_resources: boolean;
  chat_scroll_position: string;
} & Record<SettingsSectionKey, boolean>>;

const API_BASE = window.lmChat?.apiBase ?? import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
const API_ROOT = API_BASE.replace(/\/$/, "");

export function resolveApiUrl(path: string | null | undefined) {
  if (!path) return "";
  if (/^(data:|https?:\/\/)/i.test(path)) return path;
  return path.startsWith("/") ? `${API_ROOT}${path}` : `${API_ROOT}/${path.replace(/^\/+/, "")}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function streamEvents<TDone>(
  path: string,
  body: unknown,
  handlers: StreamHandlers<TDone>,
  getDonePayload: (payload: StreamDoneEvent) => TDone,
  signal?: AbortSignal
) {
  const response = await fetch(`${API_ROOT}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      const line = event.split("\n").find((entry) => entry.startsWith("data: "));
      if (!line) continue;
      const payload = JSON.parse(line.slice(6)) as ChatStreamEvent;

      if (payload.type === "token") {
        handlers.onToken(payload.content ?? "");
      } else if (payload.type === "done") {
        handlers.onDone(getDonePayload(payload));
      } else if (payload.type === "error") {
        handlers.onError(payload.detail ?? "Unknown error");
      }
    }
  }
}

export function listWorkspaces() {
  return request<ApiWorkspace[]>("/workspaces");
}

export function createWorkspace(name: string, description: string) {
  return request<ApiWorkspace>("/workspaces", {
    method: "POST",
    body: JSON.stringify({ name, description })
  });
}

export function updateWorkspace(workspaceId: string, payload: { name?: string; description?: string }) {
  return request<ApiWorkspace>(`/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function deleteWorkspace(workspaceId: string) {
  return request<{ deleted: boolean; workspace_count: number }>(`/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: "DELETE"
  });
}

export function reorderWorkspaces(ids: string[]) {
  return request<{ ok: boolean }>("/workspaces/reorder", {
    method: "POST",
    body: JSON.stringify({ ids })
  });
}

export function reorderSessions(ids: string[]) {
  return request<{ ok: boolean }>("/history/sessions/reorder", {
    method: "POST",
    body: JSON.stringify({ ids })
  });
}

export function listSessions(workspaceId: string, includeMessages = true) {
  return request<ApiSession[]>(
    `/history/sessions?workspace_id=${encodeURIComponent(workspaceId)}&include_messages=${includeMessages ? "true" : "false"}`
  );
}

export function listLocalModels() {
  return request<LocalModel[]>("/models/local");
}

export type ModelsDirInfo = {
  /** 実際に探索するフォルダ（設定値、なければ既定） */
  path: string;
  /** 設定値。空文字なら未指定 */
  configured: string;
  default_path: string;
  is_default: boolean;
  exists: boolean;
};

export function getModelsDir() {
  return request<ModelsDirInfo>("/models/dir");
}

export function fetchMemoryStats() {
  return request<{ workspace_count: number; session_count: number; memory_chunk_count: number }>("/memory/stats");
}

export function cleanupMemory() {
  return request<{ deleted_chunks: number; deleted_fts: number; deleted_vec: number }>("/memory/cleanup", {
    method: "POST",
  });
}

export function cleanupDocuments() {
  return request<{ deleted_chunks: number; deleted_fts: number; deleted_vec: number; deleted_files: number; deleted_dirs: number }>("/documents/cleanup", {
    method: "POST",
  });
}

export function reindexDocuments() {
  return request<{ total: number; succeeded: number; failed: number }>("/documents/reindex", {
    method: "POST",
  });
}

export function fetchAutocomplete(text: string) {
  return request<{ completion: string }>("/autocomplete", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function fetchCorrect(text: string) {
  return request<{ corrected: string }>("/correct", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function getConfig() {
  return request<AppConfig>("/config");
}

export function updateConfig(patch: AppConfigPatch) {
  return request<AppConfig>("/config", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function getSettings() {
  return request<AppSettings>("/settings");
}

export function updateSettings(patch: AppSettingsPatch) {
  return request<AppSettings>("/settings", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function getMessagePromptLog(messageId: string) {
  return request<MessagePromptLog>(`/history/messages/${encodeURIComponent(messageId)}/prompt-log`);
}

export function clearAllPromptLogs() {
  return request<{ cleared: number }>("/debug/prompt-logs", { method: "DELETE" });
}

export function exportDataArchive(path: string) {
  return request<DataExportResult>("/data/export", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export function importDataArchive(path: string) {
  return request<DataImportResult>("/data/import", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export function exportWorkspaceArchive(workspaceId: string, path: string) {
  return request<DataExportResult>(`/data/workspaces/${encodeURIComponent(workspaceId)}/export`, {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export function importWorkspaceArchive(path: string) {
  return request<DataImportResult>("/data/workspaces/import", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export type LibraryEntry = {
  path: string;
  name: string;
  exists: boolean;
  active: boolean;
};

export type LibraryState = {
  active: string;
  libraries: LibraryEntry[];
};

export function getLibraryState() {
  return request<LibraryState>("/library");
}

export function switchLibrary(path: string) {
  return request<LibraryState>("/library/switch", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export function createLibrary(path: string) {
  return request<LibraryState>("/library/create", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export type MessageSearchHit = {
  session_id: string;
  session_title: string;
  workspace_id: string;
  message_id: string | null;
  snippet: string;
  score: number;
  sources: string[];
};

export type MessageSearchResponse = {
  query: string;
  hits: MessageSearchHit[];
};

export function searchMessages(query: string, workspaceId?: string, topK = 30) {
  const params = new URLSearchParams({ query, top_k: String(topK) });
  if (workspaceId) params.set("workspace_id", workspaceId);
  return request<MessageSearchResponse>(`/search/messages?${params.toString()}`);
}

export function getLlamaProps() {
  return request<{ n_ctx?: number; total_slots?: number }>("/llama/props");
}

export function getSessionTokenCount(sessionId: string) {
  return request<{ token_count: number; ctx_size: number }>(
    `/history/sessions/${encodeURIComponent(sessionId)}/token_count`
  );
}

export function getLlamaStatus() {
  return request<{ ready: boolean; active_model_path: string; version?: string }>("/llama/status");
}

export function getLlamaRuntimeInfo() {
  return request<LlamaRuntimeInfo>("/llama/runtime-info");
}

export function installLlamaRuntime(variant: string, includeRuntime = false) {
  return request<LlamaRuntimeInstallResult>("/llama/install-runtime", {
    method: "POST",
    body: JSON.stringify({ variant, include_runtime: includeRuntime }),
  });
}

export function ejectLlamaModel() {
  return request<{ status: string }>("/llama/eject", { method: "POST" });
}

export function switchLlamaModel(modelPath: string) {
  return request<{ status: string; model_path: string }>("/llama/switch-model", {
    method: "POST",
    body: JSON.stringify({ model_path: modelPath }),
  });
}

export function createSession(workspaceId: string, title: string, modelName?: string) {
  return request<ApiSession>("/history/sessions", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceId, title, model_name: modelName })
  });
}

export function getSession(sessionId: string) {
  return request<ApiSession>(`/history/sessions/${encodeURIComponent(sessionId)}`);
}

export function generateSessionTitle(sessionId: string) {
  return request<ApiSession>(`/history/sessions/${encodeURIComponent(sessionId)}/generate-title`, {
    method: "POST"
  });
}

export function updateSession(sessionId: string, payload: { title?: string; model_name?: string }) {
  return request<ApiSession>(`/history/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function deleteMessage(messageId: string) {
  return request<{ deleted: boolean }>(`/history/messages/${encodeURIComponent(messageId)}`, {
    method: "DELETE"
  });
}

export function updateMessage(messageId: string, content: string, image?: ImageAttachmentInput | null) {
  return request<ApiMessage>(`/history/messages/${encodeURIComponent(messageId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      content,
      image_data: image?.imageData ?? null,
      image_preview_data: image?.imagePreviewData ?? null,
    })
  });
}

export function appendSessionMessage(
  sessionId: string,
  payload: {
    role: MessageRole;
    content: string;
    finish_reason?: string | null;
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    tokens_per_second?: number | null;
    elapsed_seconds?: number | null;
  }
) {
  return request<ApiMessage>(`/history/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function branchSession(sessionId: string, upToMessageId: string) {
  return request<ApiSession>(`/history/sessions/${encodeURIComponent(sessionId)}/branch`, {
    method: "POST",
    body: JSON.stringify({ up_to_message_id: upToMessageId })
  });
}

export function duplicateSession(sessionId: string) {
  return request<ApiSession>(`/history/sessions/${encodeURIComponent(sessionId)}/duplicate`, {
    method: "POST",
  });
}

export function moveSession(sessionId: string, targetWorkspaceId: string) {
  return request<ApiSession>(`/history/sessions/${encodeURIComponent(sessionId)}/move`, {
    method: "POST",
    body: JSON.stringify({ workspace_id: targetWorkspaceId }),
  });
}

export function deleteSession(sessionId: string, deleteMemory = true) {
  return request<{ deleted: boolean; session_count: number }>(
    `/history/sessions/${encodeURIComponent(sessionId)}?delete_memory=${deleteMemory ? "true" : "false"}`,
    {
      method: "DELETE"
    }
  );
}

export function countTokens(text: string) {
  return request<{ token_count: number }>("/tokenize", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export type SavedSystemPrompt = { id: string; name: string; content: string };

export function listSystemPrompts() {
  return request<{ prompts: SavedSystemPrompt[]; active_text: string; active_id: string }>("/system-prompts");
}

export function createSystemPrompt(name: string, content: string) {
  return request<SavedSystemPrompt>("/system-prompts", {
    method: "POST",
    body: JSON.stringify({ name, content }),
  });
}

export function updateSystemPrompt(id: string, content?: string, name?: string) {
  return request<SavedSystemPrompt>(`/system-prompts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ ...(content !== undefined ? { content } : {}), ...(name !== undefined ? { name } : {}) }),
  });
}

export function deleteSystemPrompt(id: string) {
  return request<{ deleted: boolean }>(`/system-prompts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function reorderSystemPrompts(ids: string[]) {
  return request<{ ok: boolean }>("/system-prompts/reorder", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export function saveActiveSystemPrompt(text: string, activeId?: string) {
  return request<{ active_text: string; active_id: string }>("/system-prompts/active", {
    method: "PATCH",
    body: JSON.stringify({ text, active_id: activeId ?? "" }),
  });
}

export type TempMessage = { role: "user" | "assistant"; content: string };

export async function streamTempChatMessage(
  messages: TempMessage[],
  thinkingEnabled: boolean,
  systemPrompt: string | null,
  handlers: StreamHandlers<void>,
  signal?: AbortSignal
) {
  await streamEvents(
    "/chat/temp/stream",
    { messages, thinking_enabled: thinkingEnabled, system_prompt: systemPrompt },
    handlers,
    () => undefined,
    signal
  );
}

export async function streamContinueMessage(
  sessionId: string,
  thinkingEnabled: boolean,
  memoryEnabled: boolean,
  docRagEnabled: boolean,
  handlers: StreamHandlers<ApiSession>,
  signal?: AbortSignal,
  systemPrompt?: string | null
) {
  await streamEvents(
    "/chat/continue/stream",
    {
      session_id: sessionId,
      thinking_enabled: thinkingEnabled,
      memory_enabled: memoryEnabled,
      doc_rag_enabled: docRagEnabled,
      system_prompt: systemPrompt ?? null,
    },
    handlers,
    (payload) => payload.session,
    signal
  );
}

export async function streamRegenerateMessage(
  sessionId: string,
  userMessageId: string,
  thinkingEnabled: boolean,
  memoryEnabled: boolean,
  docRagEnabled: boolean,
  handlers: StreamHandlers<ApiSession>,
  signal?: AbortSignal,
  systemPrompt?: string | null
) {
  await streamEvents(
    "/chat/regenerate/stream",
    {
      session_id: sessionId,
      user_message_id: userMessageId,
      thinking_enabled: thinkingEnabled,
      memory_enabled: memoryEnabled,
      doc_rag_enabled: docRagEnabled,
      system_prompt: systemPrompt ?? null,
    },
    handlers,
    (payload) => payload.session,
    signal
  );
}

export async function streamChatMessage(
  sessionId: string,
  content: string,
  image: ImageAttachmentInput | null,
  memoryEnabled: boolean,
  docRagEnabled: boolean,
  thinkingEnabled: boolean,
  handlers: StreamHandlers<ApiSession>,
  signal?: AbortSignal,
  systemPrompt?: string | null
) {
  await streamEvents(
    "/chat/send/stream",
    {
      session_id: sessionId,
      content,
      image_data: image?.imageData ?? null,
      image_preview_data: image?.imagePreviewData ?? null,
      memory_enabled: memoryEnabled,
      doc_rag_enabled: docRagEnabled,
      thinking_enabled: thinkingEnabled,
      system_prompt: systemPrompt ?? null
    },
    handlers,
    (payload) => payload.session,
    signal
  );
}

export async function streamInsertMessage(
  sessionId: string,
  afterMessageId: string | null,
  content: string,
  image: ImageAttachmentInput | null,
  memoryEnabled: boolean,
  docRagEnabled: boolean,
  thinkingEnabled: boolean,
  handlers: StreamHandlers<ApiSession>,
  signal?: AbortSignal,
  systemPrompt?: string | null
) {
  await streamEvents(
    "/chat/insert/stream",
    {
      session_id: sessionId,
      after_message_id: afterMessageId,
      content,
      image_data: image?.imageData ?? null,
      image_preview_data: image?.imagePreviewData ?? null,
      memory_enabled: memoryEnabled,
      doc_rag_enabled: docRagEnabled,
      thinking_enabled: thinkingEnabled,
      system_prompt: systemPrompt ?? null
    },
    handlers,
    (payload) => payload.session,
    signal
  );
}

export type ApiDocument = {
  id: string;
  workspace_id: string;
  session_id: string | null;
  scope: "workspace" | "session";
  sort_order: number;
  file_name: string;
  mime_type: string;
  file_path: string;
  file_size: number;
  file_hash: string;
  embed_model: string;
  created_at: string;
  indexed_at: string | null;
};

export type ApiDocumentWithContent = ApiDocument & { content: string };

export function listDocuments(workspaceId: string) {
  return request<ApiDocument[]>(`/documents?workspace_id=${encodeURIComponent(workspaceId)}`);
}

export function reorderDocuments(orderedIds: string[]) {
  return request<{ ok: boolean }>("/documents/reorder", {
    method: "POST",
    body: JSON.stringify({ ids: orderedIds }),
  });
}

export function moveDocument(docId: string, targetWorkspaceId: string) {
  return request<ApiDocument>(`/documents/${encodeURIComponent(docId)}/move`, {
    method: "POST",
    body: JSON.stringify({ workspace_id: targetWorkspaceId }),
  });
}

export function createDocument(payload: {
  workspace_id: string;
  session_id?: string | null;
  scope?: "workspace" | "session";
  file_name: string;
  content: string;
}) {
  return request<ApiDocument>("/documents", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getDocument(docId: string) {
  return request<ApiDocumentWithContent>(`/documents/${encodeURIComponent(docId)}`);
}

export function updateDocument(docId: string, payload: { content?: string; file_name?: string }) {
  return request<ApiDocument>(`/documents/${encodeURIComponent(docId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteDocument(docId: string) {
  return request<{ deleted: boolean }>(`/documents/${encodeURIComponent(docId)}`, {
    method: "DELETE",
  });
}

export type GpuInfo = {
  name: string;
  gpu_percent: number;
  vram_used_gb: number;
  vram_total_gb: number;
  vram_percent: number;
};

export type SystemResources = {
  cpu_percent: number;
  ram_used_gb: number;
  ram_total_gb: number;
  ram_percent: number;
  gpus: GpuInfo[];
};

export async function fetchSystemResources(): Promise<SystemResources> {
  return request<SystemResources>("/system/resources");
}
