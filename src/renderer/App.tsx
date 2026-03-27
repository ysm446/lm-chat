import { useEffect, useState } from "react";
import { getSettings, updateSettings } from "./api";
import { ChatView } from "./components/ChatView";
import { MessageInput } from "./components/MessageInput";
import { ModelBar } from "./components/ModelBar";
import { SettingsPanel } from "./components/SettingsPanel";
import { Sidebar } from "./components/Sidebar";
import { WorkspaceEmptyState } from "./components/WorkspaceEmptyState";
import { useChatStore } from "./stores/chatStore";

export function App() {
  const bootstrap = useChatStore((state) => state.bootstrap);
  const workspaces = useChatStore((state) => state.workspaces);
  const currentWorkspace = useChatStore((state) => state.currentWorkspace());
  const currentSession = useChatStore((state) => state.currentSession());
  const tempChatMode = useChatStore((state) => state.tempChatMode);
  const toggleTempChat = useChatStore((state) => state.toggleTempChat);
  const isBootstrapping = useChatStore((state) => state.isBootstrapping);
  const isSubmitting = useChatStore((state) => state.isSubmitting);
  const isSwitchingModel = useChatStore((state) => state.isSwitchingModel);
  const error = useChatStore((state) => state.error);
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [rightWidth, setRightWidth] = useState(280);
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(false);

  const makeResizeHandler = (
    getCurrent: () => number,
    setter: (w: number) => void,
    min: number,
    max: number,
    direction: "left" | "right" = "left"
  ) => (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = getCurrent();
    const onMove = (ev: MouseEvent) => {
      const delta = direction === "left" ? ev.clientX - startX : startX - ev.clientX;
      setter(Math.max(min, Math.min(max, startWidth + delta)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  useEffect(() => {
    getSettings().then((s) => {
      setShowLeft(s.show_left);
      setShowRight(s.show_right);
    }).catch(() => {});
  }, []);

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

  const gridCols = [
    showLeft ? `${sidebarWidth}px` : "0px",
    showLeft ? "1px" : "0px",
    "1fr",
    showRight ? "1px" : "0px",
    showRight ? `${rightWidth}px` : "0px",
  ].join(" ");

  return (
    <div className="app-frame">
      <ModelBar
        showLeft={showLeft}
        showRight={showRight}
        onToggleLeft={() => { const n = !showLeft; setShowLeft(n); void updateSettings({ show_left: n }); }}
        onToggleRight={() => { const n = !showRight; setShowRight(n); void updateSettings({ show_right: n }); }}
      />
      <div className="app-shell" style={{ gridTemplateColumns: gridCols }}>
        <aside className="left-pane" style={{ overflow: "hidden" }}>
          <Sidebar />
        </aside>

        <div className="resize-handle" style={{ pointerEvents: showLeft ? undefined : "none" }} onMouseDown={makeResizeHandler(() => sidebarWidth, setSidebarWidth, 180, 480, "left")} />

        <main className="center-pane">
          <div className={`submit-progress-bar ${isSubmitting ? "active" : ""}`} />
          <header className="center-header">
            <h1 className="center-header-title">
              {tempChatMode ? "一時チャット" : (currentSession?.title ?? "New chat")}
            </h1>
            <div style={{ flex: 1 }} />
            {error ? <p className="error-text" style={{ margin: 0 }}>{error}</p> : null}
            <button
              className={`center-header-btn${tempChatMode ? " active" : ""}`}
              onClick={toggleTempChat}
              title={tempChatMode ? "一時チャットを終了（履歴に戻る）" : "一時チャット（保存されません）"}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="3 2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
          </header>
          <ChatView />
          <MessageInput />
        </main>

        <div className="resize-handle" style={{ pointerEvents: showRight ? undefined : "none" }} onMouseDown={makeResizeHandler(() => rightWidth, setRightWidth, 200, 480, "right")} />

        <aside className="right-pane" style={{ overflow: "hidden" }}>
          <SettingsPanel />
        </aside>

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
    </div>
  );
}
