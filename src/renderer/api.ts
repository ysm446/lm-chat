export type MessageRole = "user" | "assistant" | "system";

export type ApiMessage = {
  id: string;
  role: MessageRole;
  content: string;
  image_data: string | null;
  created_at: string;
  completion_tokens: number | null;
  tokens_per_second: number | null;
  elapsed_seconds: number | null;
  finish_reason: string | null;
  model_name: string | null;
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
};

export type DebugPromptLogEntry = {
  id: number;
  label: string;
  content: string;
  created_at: string;
};

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

export function listSessions(workspaceId: string) {
  return request<ApiSession[]>(`/history/sessions?workspace_id=${encodeURIComponent(workspaceId)}`);
}

export function listLocalModels() {
  return request<LocalModel[]>("/models/local");
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
  return request<{ ctx_size: number; n_gpu_layers: number; temperature: number; completion_length: number }>("/config");
}

export function updateConfig(patch: { ctx_size?: number; n_gpu_layers?: number; temperature?: number; completion_length?: number }) {
  return request<{ ctx_size: number; n_gpu_layers: number; temperature: number; completion_length: number }>("/config", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function getSettings() {
  return request<{ show_left: boolean; show_right: boolean; ui_font: string; ui_font_size: number; correction_enabled: boolean; correction_prompt_mode: string; correction_custom_prompt: string; debug_prompt_log: boolean }>("/settings");
}

export function updateSettings(patch: { show_left?: boolean; show_right?: boolean; ui_font?: string; ui_font_size?: number; correction_enabled?: boolean; correction_prompt_mode?: string; correction_custom_prompt?: string; debug_prompt_log?: boolean }) {
  return request<{ show_left: boolean; show_right: boolean; ui_font: string; ui_font_size: number; correction_enabled: boolean; correction_prompt_mode: string; correction_custom_prompt: string; debug_prompt_log: boolean }>("/settings", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function getDebugPromptLogs(limit = 100) {
  return request<{ items: DebugPromptLogEntry[] }>(`/debug/prompt-logs?limit=${limit}`);
}

export function clearDebugPromptLogs() {
  return request<{ cleared: number }>("/debug/prompt-logs", { method: "DELETE" });
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

export function updateMessage(messageId: string, content: string) {
  return request<ApiMessage>(`/history/messages/${encodeURIComponent(messageId)}`, {
    method: "PATCH",
    body: JSON.stringify({ content })
  });
}

export function appendSessionMessage(
  sessionId: string,
  payload: {
    role: MessageRole;
    content: string;
    finish_reason?: string | null;
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
  imageData: string | null,
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
      image_data: imageData ?? null,
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
