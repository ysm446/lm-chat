import { useEffect, useRef, useState } from "react";

import { useChatStore } from "../stores/chatStore";

type SessionMenuState = {
  sessionId: string;
  title: string;
  x: number;
  y: number;
};

export function HistorySidebar() {
  const currentWorkspaceId = useChatStore((state) => state.currentWorkspaceId);
  const sessions = useChatStore((state) => state.sessionsForCurrentWorkspace());
  const currentSessionId = useChatStore((state) => state.currentSessionId);
  const selectSession = useChatStore((state) => state.selectSession);
  const createSession = useChatStore((state) => state.createSession);
  const renameSession = useChatStore((state) => state.renameSession);
  const removeSession = useChatStore((state) => state.removeSession);
  const [menu, setMenu] = useState<SessionMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menu) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && event.target instanceof Node && !menuRef.current.contains(event.target)) {
        setMenu(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [menu]);

  const handleRename = async (sessionId: string, currentTitle: string) => {
    const title = window.prompt("チャット名を変更", currentTitle);
    if (!title) return;
    await renameSession(sessionId, title.trim());
    setMenu(null);
  };

  const handleDelete = async (sessionId: string, currentTitle: string) => {
    const ok = window.confirm(`チャット「${currentTitle}」を削除しますか？`);
    if (!ok) return;
    await removeSession(sessionId);
    setMenu(null);
  };

  const openMenu = (sessionId: string, title: string, x: number, y: number) => {
    setMenu({ sessionId, title, x, y });
  };

  return (
    <section className="panel history-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">履歴</p>
          <h2>このワークスペースのチャット</h2>
        </div>
        <button
          className="ghost-button"
          onClick={() => {
            if (currentWorkspaceId) {
              void createSession(currentWorkspaceId, "新規チャット");
            }
          }}
        >
          + 新規チャット
        </button>
      </div>

      <div className="session-list">
        {sessions.map((session) => (
          <div key={session.id} className={session.id === currentSessionId ? "session-row active" : "session-row"}>
            <button className="session-item" onClick={() => void selectSession(session.id)}>
              <span>{session.title}</span>
              <small>{session.updated_at}</small>
            </button>
            <div className="row-actions">
              <button
                className="row-menu-button"
                aria-label={`${session.title} menu`}
                onClick={(event) => {
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  openMenu(session.id, session.title, rect.right - 8, rect.bottom + 6);
                }}
              >
                ...
              </button>
            </div>
          </div>
        ))}
      </div>

      {menu ? (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
          role="menu"
        >
          <button className="context-menu-item" onClick={() => void handleRename(menu.sessionId, menu.title)}>
            名前を変更
          </button>
          <button className="context-menu-item danger" onClick={() => void handleDelete(menu.sessionId, menu.title)}>
            削除
          </button>
        </div>
      ) : null}
    </section>
  );
}
