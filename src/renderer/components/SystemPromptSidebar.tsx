import { useEffect, useRef, useState } from "react";
import { SavedSystemPrompt, createSystemPrompt, deleteSystemPrompt, reorderSystemPrompts, updateSystemPrompt } from "../api";

type ItemMenu = { id: string; name: string; x: number; y: number };

type Props = {
  prompts: SavedSystemPrompt[];
  selectedId: string;
  onSelect: (id: string) => void;
  onPromptsChange: (prompts: SavedSystemPrompt[]) => void;
};

export function SystemPromptSidebar({ prompts, selectedId, onSelect, onPromptsChange }: Props) {
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const newInputRef = useRef<HTMLInputElement>(null);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const [menu, setMenu] = useState<ItemMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // コンテキストメニューの外側クリック / Esc で閉じる
  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [menu]);

  useEffect(() => { if (editingId) { editInputRef.current?.focus(); editInputRef.current?.select(); } }, [editingId]);

  const handleNewClick = () => {
    setShowNew(true);
    setNewName("");
    setTimeout(() => newInputRef.current?.focus(), 0);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await createSystemPrompt(name, "");
      onPromptsChange([...prompts, created]);
      onSelect(created.id);
    } catch { /* ignore */ }
    setShowNew(false);
    setNewName("");
  };

  const handleSelectPrompt = (p: SavedSystemPrompt) => {
    onSelect(p.id);
  };

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const from = prompts.findIndex((p) => p.id === dragId);
    const to = prompts.findIndex((p) => p.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...prompts];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onPromptsChange(next);
    void reorderSystemPrompts(next.map((p) => p.id));
    setDragId(null);
    setDragOverId(null);
  };

  const startRename = (item: ItemMenu) => {
    setMenu(null);
    setEditingId(item.id);
    setEditingName(item.name);
  };

  const handleDelete = async (item: ItemMenu) => {
    setMenu(null);
    if (!window.confirm(`「${item.name}」を削除しますか？`)) return;
    try {
      await deleteSystemPrompt(item.id);
      const next = prompts.filter((p) => p.id !== item.id);
      onPromptsChange(next);
      // エディタ側の選択だけ更新（active の変更は SettingsPanel が担う）
      if (selectedId === item.id) {
        onSelect(next[0]?.id ?? "");
      }
    } catch { /* ignore */ }
  };

  const commitRename = async (id: string) => {
    const name = editingName.trim();
    if (name) {
      try {
        const updated = await updateSystemPrompt(id, undefined, name);
        onPromptsChange(prompts.map((p) => (p.id === id ? updated : p)));
      } catch { /* ignore */ }
    }
    setEditingId(null);
  };

  return (
    <div className={`sp-sidebar${dragId ? " sp-dragging" : ""}`}>
      <div className="sp-sidebar-header">
        <span className="sp-sidebar-title">システムプロンプト</span>
        {!showNew && (
          <button className="sp-sidebar-new-btn" onClick={handleNewClick} title="新規作成">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        )}
      </div>

      {showNew && (
        <div className="sp-sidebar-new-row">
          <input
            ref={newInputRef}
            className="sp-sidebar-new-input"
            placeholder="プロンプト名"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
              if (e.key === "Escape") { setShowNew(false); setNewName(""); }
            }}
          />
          <button className="sp-sidebar-new-confirm" onClick={() => void handleCreate()} title="作成">✓</button>
          <button className="sp-sidebar-new-cancel" onClick={() => { setShowNew(false); setNewName(""); }} title="キャンセル">✕</button>
        </div>
      )}

      <div className="sp-sidebar-list">
        {prompts.length === 0 && !showNew && (
          <p className="sp-sidebar-empty">保存済みのプロンプトはありません<br />「＋」から新規作成できます</p>
        )}
        {prompts.map((p) => (
          <div
            key={p.id}
            className={`sp-sidebar-item-wrap${dragOverId === p.id && dragId !== p.id ? " drag-over" : ""}${dragId === p.id ? " dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dragId && dragId !== p.id) setDragOverId(p.id);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverId(null);
            }}
            onDrop={(e) => { e.preventDefault(); handleDrop(p.id); }}
            onDragEnd={() => { setDragId(null); setDragOverId(null); }}
          >
            {editingId === p.id ? (
              <div className="inline-edit-row" style={{ flex: 1, padding: "3px 4px" }}>
                <input
                  ref={editInputRef}
                  className="inline-edit-input"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRename(p.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
                <button className="inline-edit-confirm" onClick={() => void commitRename(p.id)}>✓</button>
                <button className="inline-edit-cancel" onClick={() => setEditingId(null)}>✕</button>
              </div>
            ) : (
              <>
                <span
                  className="sp-sidebar-drag-handle"
                  title="ドラッグして並べ替え"
                  draggable
                  onDragStart={(e) => {
                    setDragId(p.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", p.id);
                  }}
                >
                  <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
                    <circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/>
                    <circle cx="2" cy="6" r="1.2"/><circle cx="6" cy="6" r="1.2"/>
                    <circle cx="2" cy="10" r="1.2"/><circle cx="6" cy="10" r="1.2"/>
                  </svg>
                </span>
                <button
                  className={`sp-sidebar-item${p.id === selectedId ? " active" : ""}`}
                  onClick={() => handleSelectPrompt(p)}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.6 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <span className="sp-sidebar-item-name">{p.name}</span>
                </button>
                <div className="sp-sidebar-item-actions">
                  <button
                    className="sidebar-icon-btn"
                    title="メニュー"
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      setMenu({ id: p.id, name: p.name, x: rect.right - 8, y: rect.bottom + 6 });
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

      {menu && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
          role="menu"
        >
          <button className="context-menu-item" onClick={() => startRename(menu)}>名前を変更</button>
          <button className="context-menu-item danger" onClick={() => void handleDelete(menu)}>削除</button>
        </div>
      )}
    </div>
  );
}
