import { useEffect, useRef, useState } from "react";
import { SavedSystemPrompt, getSettings, listSystemPrompts, updateSettings } from "./api";
import { ActivityBar, AppMode } from "./components/ActivityBar";
import { BootstrapErrorState } from "./components/BootstrapErrorState";
import { ChatView } from "./components/ChatView";
import { DocumentEditor } from "./components/DocumentEditor";
import { MessageInput } from "./components/MessageInput";
import { ModelBar } from "./components/ModelBar";
import { SettingsModal } from "./components/SettingsModal";
import { SettingsPanel } from "./components/SettingsPanel";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { SystemPromptEditor } from "./components/SystemPromptEditor";
import { SystemPromptSidebar } from "./components/SystemPromptSidebar";
import { applyFontSize, applyUIFont } from "./fontOptions";
import { WorkspaceEmptyState } from "./components/WorkspaceEmptyState";
import { useChatStore } from "./stores/chatStore";

export function App() {
  const bootstrap = useChatStore((state) => state.bootstrap);
  const workspaces = useChatStore((state) => state.workspaces);
  const currentWorkspace = useChatStore((state) => state.currentWorkspace());
  const currentSession = useChatStore((state) => state.currentSession());
  const currentDocumentId = useChatStore((state) => state.currentDocumentId);
  const selectDocument = useChatStore((state) => state.selectDocument);
  const tempChatMode = useChatStore((state) => state.tempChatMode);
  const toggleTempChat = useChatStore((state) => state.toggleTempChat);
  const isBootstrapping = useChatStore((state) => state.isBootstrapping);
  const bootstrapFailed = useChatStore((state) => state.bootstrapFailed);
  const isSubmitting = useChatStore((state) => state.isSubmitting);
  const error = useChatStore((state) => state.error);
  const [sidebarWidth, setSidebarWidth] = useState(264);
  const [rightWidth, setRightWidth] = useState(280);
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(false);
  const [isImageDragOver, setIsImageDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const [appMode, setAppMode] = useState<AppMode>("chat");
  const [spPrompts, setSpPrompts] = useState<SavedSystemPrompt[]>([]);
  const [spSelectedId, setSpSelectedId] = useState<string>("");
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

  const hasImageFile = (dataTransfer: DataTransfer | null) =>
    !!dataTransfer && Array.from(dataTransfer.items).some((item) => item.kind === "file" && item.type.startsWith("image/"));

  const dispatchDroppedImage = (file: File) => {
    window.dispatchEvent(new CustomEvent("lm-chat:attach-image", { detail: file }));
  };

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
      applyUIFont(s.ui_font);
      applyFontSize(s.ui_font_size);
    }).catch(() => {});
  }, []);

  const handlePromptsChange = (prompts: SavedSystemPrompt[]) => {
    setSpPrompts(prompts);
    window.dispatchEvent(new CustomEvent("lm-chat:prompts-updated", { detail: prompts }));
  };

  const handleSetAppMode = async (mode: AppMode) => {
    setAppMode(mode);
    if (mode === "system-prompt") {
      if (!showLeft) {
        setShowLeft(true);
        void updateSettings({ show_left: true });
      }
      try {
        const data = await listSystemPrompts();
        setSpPrompts(data.prompts);
        setSpSelectedId(data.active_id || "");
      } catch { /* ignore */ }
    }
  };

  const handleEditSystemPrompt = async (promptId: string) => {
    setAppMode("system-prompt");
    if (!showLeft) {
      setShowLeft(true);
      void updateSettings({ show_left: true });
    }
    try {
      const data = await listSystemPrompts();
      setSpPrompts(data.prompts);
      setSpSelectedId(promptId || data.active_id || "");
    } catch {
      setSpSelectedId(promptId);
    }
  };

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

  if (bootstrapFailed) {
    return <BootstrapErrorState />;
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
      <div className="app-body">
        <ActivityBar mode={appMode} onSetMode={(m) => void handleSetAppMode(m)} onOpenSettings={() => setSettingsModalOpen(true)} />
      <div className="app-shell" style={{ gridTemplateColumns: gridCols }}>
        <aside className="left-pane" style={{ overflow: "hidden" }}>
          {appMode === "system-prompt" ? (
            <SystemPromptSidebar
              prompts={spPrompts}
              selectedId={spSelectedId}
              onSelect={setSpSelectedId}
              onPromptsChange={handlePromptsChange}
            />
          ) : (
            <Sidebar onSelectDocument={(docId) => selectDocument(docId)} />
          )}
        </aside>

        <div className="resize-handle" style={{ pointerEvents: showLeft ? undefined : "none" }} onMouseDown={makeResizeHandler(() => sidebarWidth, setSidebarWidth, 180, 480, "left")} />

        {appMode === "system-prompt" ? (
          <main className="center-pane sp-editor-pane">
            <SystemPromptEditor
              prompts={spPrompts}
              selectedId={spSelectedId}
              onSelect={setSpSelectedId}
              onPromptsChange={handlePromptsChange}
            />
          </main>
        ) : currentDocumentId ? (
          <main className="center-pane doc-editor-pane">
            <DocumentEditor
              docId={currentDocumentId}
              onClose={() => selectDocument(null)}
            />
          </main>
        ) : (
          <main
            className={`center-pane${isImageDragOver ? " drag-over" : ""}`}
            onDragEnter={(e) => {
              if (!hasImageFile(e.dataTransfer)) return;
              e.preventDefault();
              dragDepthRef.current += 1;
              setIsImageDragOver(true);
            }}
            onDragOver={(e) => {
              if (!hasImageFile(e.dataTransfer)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              if (!isImageDragOver) setIsImageDragOver(true);
            }}
            onDragLeave={(e) => {
              if (!hasImageFile(e.dataTransfer)) return;
              e.preventDefault();
              dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
              if (dragDepthRef.current === 0) setIsImageDragOver(false);
            }}
            onDrop={(e) => {
              if (!hasImageFile(e.dataTransfer)) return;
              e.preventDefault();
              dragDepthRef.current = 0;
              setIsImageDragOver(false);
              const file = Array.from(e.dataTransfer.files).find((entry) => entry.type.startsWith("image/"));
              if (file) dispatchDroppedImage(file);
            }}
          >
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
            <>
              <ChatView />
              <MessageInput />
            </>
            {isImageDragOver && (
              <div className="chat-drop-overlay" aria-hidden="true">
                <div className="chat-drop-card">
                  <strong>画像をドロップして添付</strong>
                  <span>会話に送る画像をここへ追加できます</span>
                </div>
              </div>
            )}
          </main>
        )}

        <div className="resize-handle" style={{ pointerEvents: showRight ? undefined : "none" }} onMouseDown={makeResizeHandler(() => rightWidth, setRightWidth, 200, 480, "right")} />

        <aside className="right-pane" style={{ overflow: "hidden" }}>
          <SettingsPanel onEditSystemPrompt={(promptId) => void handleEditSystemPrompt(promptId)} />
        </aside>

      </div>
      </div>
      <StatusBar />
      {settingsModalOpen && <SettingsModal onClose={() => setSettingsModalOpen(false)} />}
    </div>
  );
}
