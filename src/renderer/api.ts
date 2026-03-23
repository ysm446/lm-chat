export type MessageRole = "user" | "assistant" | "system";

export type ApiMessage = {
  id: string;
  role: MessageRole;
  content: string;
  created_at: string;
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

export type ChatSendResponse = {
  session: ApiSession;
  assistant_message: ApiMessage;
};

export type ChatStreamEvent =
  | { type: "token"; content: string }
  | { type: "done"; session: ApiSession }
  | { type: "error"; detail: string };

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

export function listSessions(workspaceId: string) {
  return request<ApiSession[]>(`/history/sessions?workspace_id=${encodeURIComponent(workspaceId)}`);
}

export function createSession(workspaceId: string, title: string) {
  return request<ApiSession>("/history/sessions", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceId, title })
  });
}

export function getSession(sessionId: string) {
  return request<ApiSession>(`/history/sessions/${encodeURIComponent(sessionId)}`);
}

export async function streamChatMessage(
  sessionId: string,
  content: string,
  handlers: {
    onToken: (chunk: string) => void;
    onDone: (session: ApiSession) => void;
    onError: (detail: string) => void;
  }
) {
  const response = await fetch(`${API_BASE}/chat/send/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ session_id: sessionId, content })
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