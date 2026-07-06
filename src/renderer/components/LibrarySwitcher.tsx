import { useEffect, useRef, useState } from "react";
import { createLibrary, getLibraryState, LibraryState, switchLibrary } from "../api";
import { useChatStore } from "../stores/chatStore";

export function LibrarySwitcher() {
  const [state, setState] = useState<LibraryState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getLibraryState().then(setState).catch(() => setState(null));
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const active = state?.libraries.find((l) => l.active);
  const activeName = active?.name ?? "ライブラリ";

  // 切り替え後は全状態をフルリロードする（ワークスペース・セッション・
  // システムプロンプト・UI 設定はライブラリ側に属するため）。
  const applyState = async (next: LibraryState) => {
    const store = useChatStore.getState();
    // 進行中の生成は中断し、未保存の一時チャットは破棄してから切り替える
    // （bootstrap は tempChatMode/tempMessages を触らないため明示的にリセットする）。
    store.stopGeneration();
    useChatStore.setState({ tempChatMode: false, tempMessages: [], streamingText: "" });
    setState(next);
    await store.bootstrap();
  };

  const handleSwitch = async (path: string) => {
    setMenuOpen(false);
    setBusy(true);
    setError(null);
    try {
      await applyState(await switchLibrary(path));
    } catch (e) {
      setError(e instanceof Error ? e.message : "切り替えに失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const handleOpen = async () => {
    setMenuOpen(false);
    const bridge = window.lmChat;
    if (!bridge?.chooseLibraryFolder) {
      setError("フォルダ選択はデスクトップアプリでのみ利用できます");
      return;
    }
    const path = await bridge.chooseLibraryFolder("open");
    if (!path) return;
    await handleSwitch(path);
  };

  const handleCreate = async () => {
    setMenuOpen(false);
    const bridge = window.lmChat;
    if (!bridge?.chooseLibraryFolder) {
      setError("フォルダ選択はデスクトップアプリでのみ利用できます");
      return;
    }
    const path = await bridge.chooseLibraryFolder("create");
    if (!path) return;
    setBusy(true);
    setError(null);
    try {
      await applyState(await createLibrary(path));
    } catch (e) {
      setError(e instanceof Error ? e.message : "作成に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="library-switcher" ref={rootRef}>
      <button
        className="library-switcher-btn"
        onClick={() => setMenuOpen((v) => !v)}
        disabled={busy}
        title={active?.path ?? activeName}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        <span className="library-switcher-name">{busy ? "切り替え中…" : activeName}</span>
        <svg className="library-switcher-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {error && <div className="library-switcher-error">{error}</div>}

      {menuOpen && (
        <div className="context-menu library-switcher-menu" ref={menuRef} role="menu">
          <div className="context-menu-label">ライブラリ</div>
          {state?.libraries.map((lib) => (
            <button
              key={lib.path}
              className={`context-menu-item${lib.active ? " active" : ""}`}
              onClick={() => !lib.active && lib.exists && void handleSwitch(lib.path)}
              disabled={!lib.exists && !lib.active}
              title={lib.path}
            >
              <span className="library-menu-name">
                {lib.active ? "● " : ""}{lib.name}
                {!lib.exists && <span className="library-menu-missing">（見つかりません）</span>}
              </span>
            </button>
          ))}
          <div className="context-menu-sep" />
          <button className="context-menu-item" onClick={() => void handleOpen()}>フォルダを開く…</button>
          <button className="context-menu-item" onClick={() => void handleCreate()}>新規作成…</button>
        </div>
      )}
    </div>
  );
}
