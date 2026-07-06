import { useEffect, useRef, useState } from "react";
import { ApiDocument, exportWorkspaceArchive, getDocument, getSettings, importWorkspaceArchive, updateSettings } from "../api";
import { useChatStore } from "../stores/chatStore";
import { LibrarySwitcher } from "./LibrarySwitcher";

type WsMenu = { id: string; name: string; description: string; x: number; y: number };
type SessionMenu = { id: string; title: string; x: number; y: number };
type DocMenu = { id: string; file_name: string; x: number; y: number };
type NewWorkspaceMenu = { x: number; y: number };

type SidebarProps = {
  onSelectDocument?: (docId: string) => void;
};

export function Sidebar({ onSelectDocument }: SidebarProps) {
  const workspaces = useChatStore((s) => s.workspaces);
  const sessions = useChatStore((s) => s.sessions);
  const documents = useChatStore((s) => s.documents);
  const currentWorkspaceId = useChatStore((s) => s.currentWorkspaceId);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const currentDocumentId = useChatStore((s) => s.currentDocumentId);
  const bootstrap = useChatStore((s) => s.bootstrap);
  const selectWorkspace = useChatStore((s) => s.selectWorkspace);
  const selectSession = useChatStore((s) => s.selectSession);
  const selectDocument = useChatStore((s) => s.selectDocument);
  const createWorkspace = useChatStore((s) => s.createWorkspace);
  const createSession = useChatStore((s) => s.createSession);
  const renameWorkspace = useChatStore((s) => s.renameWorkspace);
  const renameSession = useChatStore((s) => s.renameSession);
  const duplicateSession = useChatStore((s) => s.duplicateSession);
  const removeWorkspace = useChatStore((s) => s.removeWorkspace);
  const removeSession = useChatStore((s) => s.removeSession);
  const removeDocument = useChatStore((s) => s.removeDocument);
  const loadDocuments = useChatStore((s) => s.loadDocuments);
  const addDocument = useChatStore((s) => s.addDocument);
  const moveDocument = useChatStore((s) => s.moveDocument);
  const reorderDocuments = useChatStore((s) => s.reorderDocuments);
  const reorderWorkspaces = useChatStore((s) => s.reorderWorkspaces);
  const reorderSessions = useChatStore((s) => s.reorderSessions);
  const moveSession = useChatStore((s) => s.moveSession);

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(currentWorkspaceId ? [currentWorkspaceId] : [])
  );
  const [showNewWs, setShowNewWs] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const newWsInputRef = useRef<HTMLInputElement>(null);

  const [editingWsId, setEditingWsId] = useState<string | null>(null);
  const [editingWsName, setEditingWsName] = useState("");
  const [editingWsDesc, setEditingWsDesc] = useState("");
  const editWsNameRef = useRef<HTMLInputElement>(null);
  const editWsDescRef = useRef<HTMLInputElement>(null);

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionTitle, setEditingSessionTitle] = useState("");
  const editSessionRef = useRef<HTMLInputElement>(null);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [sessionDragId, setSessionDragId] = useState<string | null>(null);
  const [sessionDragOverId, setSessionDragOverId] = useState<string | null>(null);
  const [sessionDragOverWsId, setSessionDragOverWsId] = useState<string | null>(null);
  const [docDragId, setDocDragId] = useState<string | null>(null);
  const [docDragOverId, setDocDragOverId] = useState<string | null>(null);
  const [docDragOverWsId, setDocDragOverWsId] = useState<string | null>(null);

  const [wsMenu, setWsMenu] = useState<WsMenu | null>(null);
  const [sessionMenu, setSessionMenu] = useState<SessionMenu | null>(null);
  const [docMenu, setDocMenu] = useState<DocMenu | null>(null);
  const [newWsMenu, setNewWsMenu] = useState<NewWorkspaceMenu | null>(null);
  const wsMenuRef = useRef<HTMLDivElement>(null);
  const sessionMenuRef = useRef<HTMLDivElement>(null);
  const docMenuRef = useRef<HTMLDivElement>(null);
  const newWsMenuRef = useRef<HTMLDivElement>(null);
  const [docsExpanded, setDocsExpanded] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingDocWsId, setPendingDocWsId] = useState<string | null>(null);
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const isSearching = normalizedSearchQuery.length > 0;
  const isRenaming = editingWsId !== null || editingSessionId !== null;
  const sidebarStateLoadedRef = useRef(false);

  // 現在のワークスペースが切り替わったら自動展開
  useEffect(() => {
    getSettings()
      .then((settings) => {
        setExpanded(new Set(settings.sidebar_expanded_workspace_ids ?? []));
        setDocsExpanded(new Set(settings.sidebar_expanded_document_workspace_ids ?? []));
        sidebarStateLoadedRef.current = true;
      })
      .catch(() => {
        sidebarStateLoadedRef.current = true;
      });
  }, []);

  useEffect(() => {
    if (currentWorkspaceId) {
      setExpanded((prev) => new Set([...prev, currentWorkspaceId]));
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    if (!sidebarStateLoadedRef.current) return;
    void updateSettings({ sidebar_expanded_workspace_ids: Array.from(expanded) });
  }, [expanded]);

  useEffect(() => {
    if (!sidebarStateLoadedRef.current) return;
    void updateSettings({ sidebar_expanded_document_workspace_ids: Array.from(docsExpanded) });
  }, [docsExpanded]);

  useEffect(() => { if (showNewWs) newWsInputRef.current?.focus(); }, [showNewWs]);
  useEffect(() => { if (editingWsId) { editWsNameRef.current?.focus(); editWsNameRef.current?.select(); } }, [editingWsId]);
  useEffect(() => { if (editingSessionId) { editSessionRef.current?.focus(); editSessionRef.current?.select(); } }, [editingSessionId]);

  useEffect(() => {
    if (!wsMenu && !sessionMenu && !docMenu && !newWsMenu) return undefined;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wsMenuRef.current && !wsMenuRef.current.contains(t)) setWsMenu(null);
      if (sessionMenuRef.current && !sessionMenuRef.current.contains(t)) setSessionMenu(null);
      if (docMenuRef.current && !docMenuRef.current.contains(t)) setDocMenu(null);
      if (newWsMenuRef.current && !newWsMenuRef.current.contains(t)) setNewWsMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setWsMenu(null); setSessionMenu(null); setDocMenu(null); setNewWsMenu(null); }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [wsMenu, sessionMenu, docMenu, newWsMenu]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (showNewWs || editingWsId || editingSessionId) return;

      const active = document.activeElement as HTMLElement | null;
      if (active) {
        const tag = active.tagName;
        const isTextInput =
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          active.isContentEditable;
        if (isTextInput) return;
      }

      if (currentDocumentId) {
        const doc = documents.find((item) => item.id === currentDocumentId);
        if (!doc) return;
        e.preventDefault();
        void handleDeleteDoc(doc.id, doc.file_name);
        return;
      }

      if (currentSessionId) {
        const session = sessions.find((item) => item.id === currentSessionId);
        if (!session) return;
        e.preventDefault();
        void handleDeleteSession(session.id, session.title);
        return;
      }

      if (currentWorkspaceId) {
        const ws = workspaces.find((item) => item.id === currentWorkspaceId);
        if (!ws) return;
        e.preventDefault();
        void handleDeleteWs(ws.id, ws.name);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    currentDocumentId,
    currentSessionId,
    currentWorkspaceId,
    documents,
    sessions,
    workspaces,
    showNewWs,
    editingWsId,
    editingSessionId,
  ]);

  const toggleExpand = (wsId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(wsId)) next.delete(wsId);
      else next.add(wsId);
      return next;
    });
  };

  const handleSelectWs = async (wsId: string) => {
    setExpanded((prev) => new Set([...prev, wsId]));
    await selectWorkspace(wsId);
  };

  const handleWorkspaceRowClick = async (wsId: string) => {
    if (wsId === currentWorkspaceId) {
      toggleExpand(wsId);
      return;
    }
    setExpanded((prev) => new Set([...prev, wsId]));
    await selectWorkspace(wsId);
  };

  const handleAddChat = async (wsId: string) => {
    setExpanded((prev) => new Set([...prev, wsId]));
    await createSession(wsId, "新規チャット");
  };

  const handleAddWorkspace = async () => {
    const name = newWsName.trim();
    if (!name) return;
    const ws = await createWorkspace(name, "");
    await createSession(ws.id, "新規チャット");
    setNewWsName("");
    setShowNewWs(false);
    setExpanded((prev) => new Set([...prev, ws.id]));
  };

  const handleStartCreateWorkspace = () => {
    setNewWsMenu(null);
    setShowNewWs(true);
  };

  const handleImportWorkspace = async () => {
    setNewWsMenu(null);
    const bridge = window.lmChat;
    if (!bridge?.chooseImportArchivePath) {
      window.alert("Electron 版でのみ利用できます");
      return;
    }
    const importPath = await bridge.chooseImportArchivePath();
    if (!importPath) return;
    try {
      const result = await importWorkspaceArchive(importPath);
      await bootstrap();
      if (result.workspace_id) {
        setExpanded((prev) => new Set([...prev, result.workspace_id!]));
        await selectWorkspace(result.workspace_id);
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "ワークスペースのインポートに失敗しました");
    }
  };

  const startEditWs = (ws: WsMenu) => {
    setWsMenu(null);
    setEditingWsId(ws.id);
    setEditingWsName(ws.name);
    setEditingWsDesc(ws.description);
  };

  const commitEditWs = async (wsId: string) => {
    const name = editingWsName.trim();
    if (name) await renameWorkspace(wsId, name, editingWsDesc.trim());
    setEditingWsId(null);
  };

  const startEditSession = (sessionId: string, title: string) => {
    setSessionMenu(null);
    setEditingSessionId(sessionId);
    setEditingSessionTitle(title);
  };

  const openSessionMenu = (session: { id: string; title: string }, x: number, y: number) => {
    setWsMenu(null);
    setDocMenu(null);
    setSessionMenu({ id: session.id, title: session.title, x, y });
  };

  const handleDuplicateSession = async (sessionId: string) => {
    await duplicateSession(sessionId);
    setSessionMenu(null);
  };

  const commitEditSession = async (sessionId: string) => {
    const title = editingSessionTitle.trim();
    if (title) await renameSession(sessionId, title);
    setEditingSessionId(null);
  };

  const handleDeleteWs = async (wsId: string, name: string) => {
    const ok = window.confirm(`ワークスペース「${name}」を削除しますか？\nチャット履歴と記憶もすべて削除されます。`);
    if (!ok) return;
    await removeWorkspace(wsId);
    setWsMenu(null);
  };

  const handleExportWs = async (ws: WsMenu) => {
    const bridge = window.lmChat;
    if (!bridge?.chooseExportArchivePath) {
      window.alert("Electron 版でのみ利用できます");
      return;
    }
    const exportPath = await bridge.chooseExportArchivePath(ws.name);
    if (!exportPath) return;
    try {
      const result = await exportWorkspaceArchive(ws.id, exportPath);
      const sizeMb = (result.size_bytes / (1024 * 1024)).toFixed(1);
      window.alert(`ワークスペースを書き出しました: ${result.file_name} (${sizeMb} MB)`);
      setWsMenu(null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "ワークスペースのエクスポートに失敗しました");
    }
  };

  const handleDeleteSession = async (sessionId: string, title: string) => {
    const ok = window.confirm(`チャット「${title}」を削除しますか？`);
    if (!ok) return;
    await removeSession(sessionId);
    setSessionMenu(null);
  };

  const toggleDocsExpanded = (wsId: string) => {
    setDocsExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(wsId)) {
        next.delete(wsId);
      } else {
        next.add(wsId);
        void loadDocuments(wsId);
      }
      return next;
    });
  };

  const handleCreateTextDocument = async (wsId: string) => {
    setDocsExpanded((prev) => new Set([...prev, wsId]));
    const doc = await addDocument(wsId, "新規テキスト.txt", "");
    handleSelectDoc(doc);
  };

  const handleImportDocument = (wsId: string) => {
    setPendingDocWsId(wsId);
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pendingDocWsId) return;
    e.target.value = "";
    const content = await file.text();
    await addDocument(pendingDocWsId, file.name, content);
    // ドキュメントセクションが閉じていたら開く
    setDocsExpanded((prev) => new Set([...prev, pendingDocWsId]));
    setPendingDocWsId(null);
  };

  const handleSelectDoc = (doc: ApiDocument) => {
    selectDocument(doc.id);
    onSelectDocument?.(doc.id);
  };

  const openDocMenu = (doc: ApiDocument, x: number, y: number) => {
    setWsMenu(null);
    setSessionMenu(null);
    setDocMenu({ id: doc.id, file_name: doc.file_name, x, y });
  };

  const handleDuplicateDoc = async (docId: string) => {
    const source = await getDocument(docId);
    const doc = await addDocument(source.workspace_id, source.file_name, source.content);
    setDocsExpanded((prev) => new Set([...prev, source.workspace_id]));
    handleSelectDoc(doc);
    setDocMenu(null);
  };

  const handleDeleteDoc = async (docId: string, fileName: string) => {
    const ok = window.confirm(`資料「${fileName}」を削除しますか？`);
    if (!ok) return;
    await removeDocument(docId);
    setDocMenu(null);
  };

  const visibleWorkspaces = workspaces.filter((ws) => {
    if (!isSearching) return true;
    return sessions.some(
      (session) =>
        session.workspace_id === ws.id &&
        session.title.toLocaleLowerCase().includes(normalizedSearchQuery)
    );
  });

  return (
    <div className={`sidebar${dragId ? " workspace-dragging" : ""}${sessionDragId ? " session-dragging" : ""}${docDragId ? " doc-dragging" : ""}`}>
      {/* 隠しファイル入力（資料追加用） */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,.json"
        style={{ display: "none" }}
        onChange={(e) => void handleFileSelected(e)}
      />
      <LibrarySwitcher />

      <div className="sidebar-header">
        {showNewWs ? (
          <div className="inline-edit-row" style={{ flex: 1 }}>
            <input
              ref={newWsInputRef}
              className="inline-edit-input"
              placeholder="ワークスペース名"
              value={newWsName}
              onChange={(e) => setNewWsName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAddWorkspace();
                if (e.key === "Escape") { setShowNewWs(false); setNewWsName(""); }
              }}
            />
            <button className="inline-edit-confirm" onClick={() => void handleAddWorkspace()}>✓</button>
            <button className="inline-edit-cancel" onClick={() => { setShowNewWs(false); setNewWsName(""); }}>✕</button>
          </div>
        ) : (
          <button
            className="sidebar-new-ws-btn"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setWsMenu(null);
              setSessionMenu(null);
              setDocMenu(null);
              setNewWsMenu({ x: rect.left, y: rect.bottom + 6 });
            }}
            title="ワークスペース"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              <line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
            </svg>
            ワークスペース
          </button>
        )}
      </div>

      <div className="sidebar-search-wrap">
        <label className="sidebar-search" aria-label="チャット検索">
          <svg
            className="sidebar-search-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            className="sidebar-search-input"
            type="search"
            placeholder="Search chats..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </label>
      </div>

      <div className="sidebar-tree">
        {visibleWorkspaces.length === 0 ? (
          <div className="sidebar-search-empty">
            <strong>一致するチャットはありません</strong>
            <span>別のキーワードで検索してください。</span>
          </div>
        ) : visibleWorkspaces.map((ws) => {
          const wsSessions = sessions.filter((s) =>
            s.workspace_id === ws.id &&
            (!isSearching || s.title.toLocaleLowerCase().includes(normalizedSearchQuery))
          );
          const isExpanded = isSearching ? wsSessions.length > 0 : expanded.has(ws.id);
          const isActiveWs = ws.id === currentWorkspaceId;

          return (
            <div
            key={ws.id}
            className={`sidebar-ws-group${dragOverId === ws.id && dragId !== ws.id ? " drag-over" : ""}${dragId === ws.id ? " dragging" : ""}${sessionDragOverWsId === ws.id ? " session-drop-target" : ""}${docDragOverWsId === ws.id ? " document-drop-target" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dragId && dragId !== ws.id) { setDragOverId(ws.id); return; }
              if (sessionDragId) {
                const draggedSession = sessions.find((s) => s.id === sessionDragId);
                if (draggedSession && draggedSession.workspace_id !== ws.id) {
                  setSessionDragOverWsId(ws.id);
                  setSessionDragOverId(null);
                }
              }
              if (docDragId) {
                const draggedDoc = documents.find((d) => d.id === docDragId);
                if (draggedDoc && draggedDoc.workspace_id !== ws.id) {
                  setDocDragOverWsId(ws.id);
                  setDocDragOverId(null);
                }
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDragOverId(null);
                setSessionDragOverWsId(null);
                setDocDragOverWsId(null);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (sessionDragId) {
                const draggedSession = sessions.find((s) => s.id === sessionDragId);
                if (draggedSession && draggedSession.workspace_id !== ws.id) {
                  void moveSession(sessionDragId, ws.id);
                }
                setSessionDragId(null); setSessionDragOverId(null); setSessionDragOverWsId(null); return;
              }
              if (docDragId) {
                const draggedDoc = documents.find((d) => d.id === docDragId);
                if (draggedDoc && draggedDoc.workspace_id !== ws.id) {
                  void moveDocument(docDragId, ws.id);
                }
                setDocDragId(null); setDocDragOverId(null); setDocDragOverWsId(null); return;
              }
              if (!dragId || dragId === ws.id) { setDragId(null); setDragOverId(null); return; }
              const from = workspaces.findIndex((w) => w.id === dragId);
              const to = workspaces.findIndex((w) => w.id === ws.id);
              if (from < 0 || to < 0) return;
              const next = [...workspaces];
              const [moved] = next.splice(from, 1);
              next.splice(to, 0, moved);
              void reorderWorkspaces(next.map((w) => w.id));
              setDragId(null);
              setDragOverId(null);
            }}
            onDragEnd={() => { setDragId(null); setDragOverId(null); setSessionDragOverWsId(null); setDocDragOverWsId(null); }}
          >
              {editingWsId === ws.id ? (
                <div className="sidebar-ws-edit">
                  <input
                    ref={editWsNameRef}
                    className="inline-edit-input"
                    placeholder="名前"
                    value={editingWsName}
                    onChange={(e) => setEditingWsName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") editWsDescRef.current?.focus();
                      if (e.key === "Escape") setEditingWsId(null);
                    }}
                  />
                  <div className="inline-edit-row">
                    <input
                      ref={editWsDescRef}
                      className="inline-edit-input"
                      placeholder="副題（任意）"
                      value={editingWsDesc}
                      onChange={(e) => setEditingWsDesc(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void commitEditWs(ws.id);
                        if (e.key === "Escape") setEditingWsId(null);
                      }}
                    />
                    <button className="inline-edit-confirm" onClick={() => void commitEditWs(ws.id)}>✓</button>
                    <button className="inline-edit-cancel" onClick={() => setEditingWsId(null)}>✕</button>
                  </div>
                </div>
              ) : (
                <div
                  className={`sidebar-ws-row${isActiveWs ? " active" : ""}`}
                  draggable={!isSearching && !isRenaming}
                  onDragStart={(e) => {
                    if (isSearching || isRenaming) return;
                    setDragId(ws.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", ws.id);
                  }}
                >
                  <button
                    className="sidebar-ws-label"
                    onClick={() => void handleWorkspaceRowClick(ws.id)}
                    title={isExpanded ? "クリックで折りたたむ" : "クリックで展開する"}
                  >
                    <span className="sidebar-ws-name">{ws.name}</span>
                    {ws.description && <span className="sidebar-ws-desc">{ws.description}</span>}
                  </button>
                  <div className="sidebar-ws-actions">
                    <button
                      className="sidebar-icon-btn sidebar-add-btn"
                      title="新規チャット"
                      onClick={() => void handleAddChat(ws.id)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="M12 5v14"/>
                        <path d="M5 12h14"/>
                      </svg>
                    </button>
                    <button
                      className="sidebar-icon-btn"
                      title="メニュー"
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setWsMenu({ id: ws.id, name: ws.name, description: ws.description, x: rect.right - 8, y: rect.bottom + 6 });
                      }}
                    >
                      •••
                    </button>
                  </div>
                </div>
              )}

              {isExpanded && (
                <div className="sidebar-sessions">
                  {/* Documents セクション */}
                  {!isSearching && (() => {
                    const wsDocs = documents.filter((d) => d.workspace_id === ws.id);
                    const isDocsExpanded = docsExpanded.has(ws.id);
                    return (
                      <div className="sidebar-docs-section">
                        <div className="sidebar-docs-header">
                          <button
                            className="sidebar-docs-label"
                            onClick={() => toggleDocsExpanded(ws.id)}
                            title={isDocsExpanded ? "クリックで折りたたむ" : "クリックで展開"}
                          >
                            Documents
                          </button>
                          <div className="sidebar-docs-actions">
                            <button
                              className="sidebar-icon-btn sidebar-add-btn"
                              title="空のテキストを作成"
                              onClick={() => void handleCreateTextDocument(ws.id)}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                                <path d="M12 5v14"/>
                                <path d="M5 12h14"/>
                              </svg>
                            </button>
                            <button
                              className="sidebar-icon-btn"
                              title="ファイルを読み込む"
                              onClick={() => handleImportDocument(ws.id)}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M9 3.75h4.9L19 8.85V19a1.25 1.25 0 0 1-1.25 1.25h-8.5A1.25 1.25 0 0 1 8 19V5A1.25 1.25 0 0 1 9.25 3.75Z"/>
                                <path d="M13.75 3.75V9h5.25"/>
                              </svg>
                            </button>
                          </div>
                        </div>
                        {isDocsExpanded && (
                          <div className="sidebar-docs-list">
                            {wsDocs.length === 0 ? (
                              <div className="sidebar-docs-empty">資料なし</div>
                            ) : (
                              wsDocs.map((doc) => (
                                <div
                                  key={doc.id}
                                  className={`sidebar-doc-row${doc.id === currentDocumentId ? " active" : ""}${docDragOverId === doc.id && docDragId !== doc.id ? " drag-over" : ""}${docDragId === doc.id ? " dragging" : ""}`}
                                  draggable={!isSearching && !isRenaming}
                                  onDragStart={(e) => {
                                    if (isSearching || isRenaming) return;
                                    setDocDragId(doc.id);
                                    setDocDragOverWsId(null);
                                    e.dataTransfer.effectAllowed = "move";
                                    e.dataTransfer.setData("text/plain", doc.id);
                                  }}
                                  onDragOver={(e) => {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = "move";
                                    if (!docDragId || docDragId === doc.id) return;
                                    const draggedDoc = documents.find((item) => item.id === docDragId);
                                    if (draggedDoc && draggedDoc.workspace_id !== ws.id) {
                                      setDocDragOverWsId(ws.id);
                                      setDocDragOverId(null);
                                      return;
                                    }
                                    setDocDragOverId(doc.id);
                                  }}
                                  onDragLeave={(e) => {
                                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                      setDocDragOverId(null);
                                    }
                                  }}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    if (!docDragId || docDragId === doc.id) {
                                      setDocDragId(null);
                                      setDocDragOverId(null);
                                      setDocDragOverWsId(null);
                                      return;
                                    }
                                    const draggedDoc = documents.find((item) => item.id === docDragId);
                                    if (draggedDoc && draggedDoc.workspace_id !== ws.id) {
                                      void moveDocument(docDragId, ws.id);
                                      setDocDragId(null);
                                      setDocDragOverId(null);
                                      setDocDragOverWsId(null);
                                      return;
                                    }
                                    const from = wsDocs.findIndex((item) => item.id === docDragId);
                                    const to = wsDocs.findIndex((item) => item.id === doc.id);
                                    if (from < 0 || to < 0) {
                                      setDocDragId(null);
                                      setDocDragOverId(null);
                                      setDocDragOverWsId(null);
                                      return;
                                    }
                                    const next = [...wsDocs];
                                    const [moved] = next.splice(from, 1);
                                    next.splice(to, 0, moved);
                                    void reorderDocuments(ws.id, next.map((item) => item.id));
                                    setDocDragId(null);
                                    setDocDragOverId(null);
                                    setDocDragOverWsId(null);
                                  }}
                                  onDragEnd={() => {
                                    setDocDragId(null);
                                    setDocDragOverId(null);
                                    setDocDragOverWsId(null);
                                  }}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    openDocMenu(doc, e.clientX, e.clientY);
                                  }}
                                >
                                  <button
                                    className="sidebar-doc-btn"
                                    onClick={() => handleSelectDoc(doc)}
                                    title={doc.file_name}
                                  >
                                    <span className="sidebar-doc-name">{doc.file_name}</span>
                                    {doc.indexed_at == null && (
                                      <span className="sidebar-doc-indexing" title="インデックス中">⟳</span>
                                    )}
                                  </button>
                                  <button
                                    className="sidebar-icon-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const rect = e.currentTarget.getBoundingClientRect();
                                      openDocMenu(doc, rect.right - 8, rect.bottom + 6);
                                    }}
                                  >
                                    •••
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {wsSessions.map((session) => (
                    <div
                      key={session.id}
                      className={`sidebar-session-row${session.id === currentSessionId ? " active" : ""}${sessionDragOverId === session.id && sessionDragId !== session.id ? " drag-over" : ""}${sessionDragId === session.id ? " dragging" : ""}`}
                      draggable={!isSearching && !isRenaming}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        openSessionMenu(session, e.clientX, e.clientY);
                      }}
                      onDragStart={(e) => {
                        if (isSearching || isRenaming) return;
                        setSessionDragId(session.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", session.id);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (!sessionDragId || sessionDragId === session.id) return;
                        const draggedSession = sessions.find((s) => s.id === sessionDragId);
                        if (draggedSession && draggedSession.workspace_id !== ws.id) {
                          // 別ワークスペースからのドラッグ → ワークスペース全体をハイライト
                          setSessionDragOverWsId(ws.id);
                          setSessionDragOverId(null);
                        } else {
                          setSessionDragOverId(session.id);
                        }
                      }}
                      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSessionDragOverId(null); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (!sessionDragId || sessionDragId === session.id) { setSessionDragId(null); setSessionDragOverId(null); setSessionDragOverWsId(null); return; }
                        const draggedSession = sessions.find((s) => s.id === sessionDragId);
                        if (draggedSession && draggedSession.workspace_id !== ws.id) {
                          void moveSession(sessionDragId, ws.id);
                          setSessionDragId(null); setSessionDragOverId(null); setSessionDragOverWsId(null); return;
                        }
                        const from = wsSessions.findIndex((s) => s.id === sessionDragId);
                        const to = wsSessions.findIndex((s) => s.id === session.id);
                        if (from < 0 || to < 0) return;
                        const next = [...wsSessions];
                        const [moved] = next.splice(from, 1);
                        next.splice(to, 0, moved);
                        void reorderSessions(next.map((s) => s.id));
                        setSessionDragId(null);
                        setSessionDragOverId(null);
                        setSessionDragOverWsId(null);
                      }}
                      onDragEnd={() => { setSessionDragId(null); setSessionDragOverId(null); setSessionDragOverWsId(null); }}
                    >
                      {editingSessionId === session.id ? (
                        <div className="inline-edit-row" style={{ flex: 1, padding: "2px 0" }}>
                          <input
                            ref={editSessionRef}
                            className="inline-edit-input"
                            value={editingSessionTitle}
                            onChange={(e) => setEditingSessionTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void commitEditSession(session.id);
                              if (e.key === "Escape") setEditingSessionId(null);
                            }}
                          />
                          <button className="inline-edit-confirm" onClick={() => void commitEditSession(session.id)}>✓</button>
                          <button className="inline-edit-cancel" onClick={() => setEditingSessionId(null)}>✕</button>
                        </div>
                      ) : (
                        <>
                          <button
                            className="sidebar-session-btn"
                            onClick={() => void selectSession(session.id)}
                          >
                            <span>{session.title}</span>
                          </button>
                          <div className="sidebar-session-actions">
                            <button
                              className="sidebar-icon-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                const rect = e.currentTarget.getBoundingClientRect();
                                openSessionMenu(session, rect.right - 8, rect.bottom + 6);
                              }}
                            >
                              •••
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {newWsMenu && (
        <div
          ref={newWsMenuRef}
          className="context-menu"
          style={{ left: `${newWsMenu.x}px`, top: `${newWsMenu.y}px` }}
          role="menu"
        >
          <button className="context-menu-item" onClick={handleStartCreateWorkspace}>新しく作成</button>
          <button className="context-menu-item" onClick={() => void handleImportWorkspace()}>インポートする</button>
        </div>
      )}

      {wsMenu && (
        <div
          ref={wsMenuRef}
          className="context-menu"
          style={{ left: `${wsMenu.x}px`, top: `${wsMenu.y}px` }}
          role="menu"
        >
          <button className="context-menu-item" onClick={() => void handleExportWs(wsMenu)}>ワークスペースをエクスポート</button>
          <button className="context-menu-item" onClick={() => startEditWs(wsMenu)}>名前を変更</button>
          <button className="context-menu-item danger" onClick={() => void handleDeleteWs(wsMenu.id, wsMenu.name)}>削除</button>
        </div>
      )}

      {sessionMenu && (
        <div
          ref={sessionMenuRef}
          className="context-menu"
          style={{ left: `${sessionMenu.x}px`, top: `${sessionMenu.y}px` }}
          role="menu"
        >
          <button className="context-menu-item" onClick={() => startEditSession(sessionMenu.id, sessionMenu.title)}>名前を変更</button>
          <button className="context-menu-item" onClick={() => void handleDuplicateSession(sessionMenu.id)}>複製</button>
          <button className="context-menu-item danger" onClick={() => void handleDeleteSession(sessionMenu.id, sessionMenu.title)}>削除</button>
        </div>
      )}

      {docMenu && (
        <div
          ref={docMenuRef}
          className="context-menu"
          style={{ left: `${docMenu.x}px`, top: `${docMenu.y}px` }}
          role="menu"
        >
          <button className="context-menu-item" onClick={() => void handleDuplicateDoc(docMenu.id)}>複製</button>
          <button className="context-menu-item danger" onClick={() => void handleDeleteDoc(docMenu.id, docMenu.file_name)}>削除</button>
        </div>
      )}
    </div>
  );
}
