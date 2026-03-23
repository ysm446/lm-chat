import { useEffect } from "react";
import { ChatView } from "./components/ChatView";
import { HistorySidebar } from "./components/HistorySidebar";
import { MessageInput } from "./components/MessageInput";
import { ModelSelector } from "./components/ModelSelector";
import { SettingsPanel } from "./components/SettingsPanel";
import { WorkspaceEmptyState } from "./components/WorkspaceEmptyState";
import { WorkspaceSwitcher } from "./components/WorkspaceSwitcher";
import { useChatStore } from "./stores/chatStore";

export function App() {
  const bootstrap = useChatStore((state) => state.bootstrap);
  const workspaces = useChatStore((state) => state.workspaces);
  const currentWorkspace = useChatStore((state) => state.currentWorkspace());
  const isBootstrapping = useChatStore((state) => state.isBootstrapping);
  const error = useChatStore((state) => state.error);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (isBootstrapping) {
    return (
      <div className="empty-shell">
        <div className="empty-card">
          <p className="eyebrow">LM Chat</p>
          <h1>読み込み中</h1>
          <p className="muted">バックエンドからデータを取得しています。</p>
        </div>
      </div>
    );
  }

  if (workspaces.length === 0 || !currentWorkspace) {
    return <WorkspaceEmptyState />;
  }

  return (
    <div className="app-shell">
      <aside className="left-pane">
        <WorkspaceSwitcher />
        <HistorySidebar />
      </aside>

      <main className="center-pane">
        <header className="center-header">
          <div>
            <p className="eyebrow">ワークスペース</p>
            <h1>{currentWorkspace.name}</h1>
            <p className="muted">{currentWorkspace.description || "記憶とチャット履歴をワークスペース単位で管理"}</p>
            {error ? <p className="error-text">{error}</p> : null}
          </div>
          <div className="header-actions">
            <ModelSelector />
            <button className="ghost-button">設定</button>
          </div>
        </header>

        <ChatView />
        <MessageInput />
      </main>

      <aside className="right-pane">
        <SettingsPanel />
      </aside>
    </div>
  );
}