import { useEffect } from "react";
import { ChatView } from "./components/ChatView";
import { MessageInput } from "./components/MessageInput";
import { ModelSelector } from "./components/ModelSelector";
import { SettingsPanel } from "./components/SettingsPanel";
import { Sidebar } from "./components/Sidebar";
import { WorkspaceEmptyState } from "./components/WorkspaceEmptyState";
import { useChatStore } from "./stores/chatStore";

export function App() {
  const bootstrap = useChatStore((state) => state.bootstrap);
  const workspaces = useChatStore((state) => state.workspaces);
  const currentWorkspace = useChatStore((state) => state.currentWorkspace());
  const isBootstrapping = useChatStore((state) => state.isBootstrapping);
  const isSubmitting = useChatStore((state) => state.isSubmitting);
  const isSwitchingModel = useChatStore((state) => state.isSwitchingModel);
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
        <Sidebar />
      </aside>

      <main className="center-pane">
        {/* チャット送信中プログレスバー */}
        <div className={`submit-progress-bar ${isSubmitting ? "active" : ""}`} />

        <header className="center-header">
          <div>
            <p className="eyebrow">ワークスペース</p>
            <h1>{currentWorkspace.name}</h1>
            <p className="muted">{currentWorkspace.description || "記憶とチャット履歴をワークスペース単位で管理"}</p>
            {error ? <p className="error-text">{error}</p> : null}
          </div>
          <div className="header-actions">
            <ModelSelector />
          </div>
        </header>

        <ChatView />
        <MessageInput />
      </main>

      <aside className="right-pane">
        <SettingsPanel />
      </aside>

      {/* モデル切り替え中オーバーレイ */}
      {isSwitchingModel ? (
        <div className="model-switch-overlay">
          <div className="model-switch-card">
            <div className="model-switch-spinner" />
            <p className="eyebrow">モデル切り替え中</p>
            <h2>llama-server を再起動しています</h2>
            <p className="muted">新しいモデルの読み込みが完了するまでしばらくお待ちください…</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
