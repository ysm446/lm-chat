import { useChatStore } from "../stores/chatStore";

export function HistorySidebar() {
  const currentWorkspaceId = useChatStore((state) => state.currentWorkspaceId);
  const sessions = useChatStore((state) => state.sessionsForCurrentWorkspace());
  const currentSessionId = useChatStore((state) => state.currentSessionId);
  const selectSession = useChatStore((state) => state.selectSession);
  const createSession = useChatStore((state) => state.createSession);

  return (
    <section className="panel history-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">History</p>
          <h2>Chats in this workspace</h2>
        </div>
        <button
          className="ghost-button"
          onClick={() => {
            if (currentWorkspaceId) {
              void createSession(currentWorkspaceId, "New chat");
            }
          }}
        >
          + New Chat
        </button>
      </div>

      <div className="session-list">
        {sessions.map((session) => (
          <button
            key={session.id}
            className={session.id === currentSessionId ? "session-item active" : "session-item"}
            onClick={() => void selectSession(session.id)}
          >
            <span>{session.title}</span>
            <small>{session.updated_at}</small>
          </button>
        ))}
      </div>
    </section>
  );
}