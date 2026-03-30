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

export type LocalModel = {
  id: string;
  path: string;
  size_bytes: number;
};

const API_BASE = "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
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

export function listSessions(workspaceId: string) {
  return request<ApiSession[]>(`/history/sessions?workspace_id=${encodeURIComponent(workspaceId)}`);
}

export function listLocalModels() {
  return request<LocalModel[]>("/models/local");
}

export function fetchMemoryStats() {
  return request<{ workspace_count: number; session_count: number; memory_chunk_count: number }>("/memory/stats");
}

export function fetchAutocomplete(text: string) {
  return request<{ completion: string }>("/autocomplete", {
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
  return request<{ show_left: boolean; show_right: boolean }>("/settings");
}

export function updateSettings(patch: { show_left?: boolean; show_right?: boolean }) {
  return request<{ show_left: boolean; show_right: boolean }>("/settings", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
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
  return request<{ ready: boolean; active_model_path: string }>("/llama/status");
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

export function updateSystemPrompt(id: string, content: string) {
  return request<SavedSystemPrompt>(`/system-prompts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ content }),
  });
}

export function deleteSystemPrompt(id: string) {
  return request<{ deleted: boolean }>(`/system-prompts/${encodeURIComponent(id)}`, {
    method: "DELETE",
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
  handlers: {
    onToken: (chunk: string) => void;
    onDone: () => void;
    onError: (detail: string) => void;
  },
  signal?: AbortSignal
) {
  const response = await fetch(`${API_BASE}/chat/temp/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, thinking_enabled: thinkingEnabled, system_prompt: systemPrompt }),
    signal,
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
      const line = event.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const payload = JSON.parse(line.slice(6)) as { type: string; content?: string; detail?: string };
      if (payload.type === "token") handlers.onToken(payload.content ?? "");
      else if (payload.type === "done") handlers.onDone();
      else if (payload.type === "error") handlers.onError(payload.detail ?? "Unknown error");
    }
  }
}

export async function streamContinueMessage(
  sessionId: string,
  thinkingEnabled: boolean,
  handlers: {
    onToken: (chunk: string) => void;
    onDone: (session: ApiSession) => void;
    onError: (detail: string) => void;
  },
  signal?: AbortSignal,
  systemPrompt?: string | null
) {
  const response = await fetch(`${API_BASE}/chat/continue/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, thinking_enabled: thinkingEnabled, system_prompt: systemPrompt ?? null }),
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
        handlers.onToken(payload.content);
      } else if (payload.type === "done") {
        handlers.onDone(payload.session);
      } else if (payload.type === "error") {
        handlers.onError(payload.detail);
      }
    }
  }
}

export async function streamChatMessage(
  sessionId: string,
  content: string,
  imageData: string | null,
  memoryEnabled: boolean,
  thinkingEnabled: boolean,
  handlers: {
    onToken: (chunk: string) => void;
    onDone: (session: ApiSession) => void;
    onError: (detail: string) => void;
  },
  signal?: AbortSignal,
  systemPrompt?: string | null
) {
  const response = await fetch(`${API_BASE}/chat/send/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ session_id: sessionId, content, image_data: imageData ?? null, memory_enabled: memoryEnabled, thinking_enabled: thinkingEnabled, system_prompt: systemPrompt ?? null }),
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
      const line = event
        .split("\n")
        .find((entry) => entry.startsWith("data: "));
      if (!line) continue;
      const payload = JSON.parse(line.slice(6)) as ChatStreamEvent;
      if (payload.type === "token") {
        handlers.onToken(payload.content);
      } else if (payload.type === "done") {
        handlers.onDone(payload.session);
      } else if (payload.type === "error") {
        handlers.onError(payload.detail);
      }
    }
  }
}