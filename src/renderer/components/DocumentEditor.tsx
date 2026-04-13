import { useEffect, useRef, useState } from "react";
import { ApiDocumentWithContent, getDocument } from "../api";
import { useChatStore } from "../stores/chatStore";

type Props = {
  docId: string;
  onClose: () => void;
};

export function DocumentEditor({ docId, onClose }: Props) {
  const updateDocument = useChatStore((s) => s.updateDocument);
  const renameDocument = useChatStore((s) => s.renameDocument);
  const removeDocument = useChatStore((s) => s.removeDocument);

  const [doc, setDoc] = useState<ApiDocumentWithContent | null>(null);
  const [content, setContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDoc(null);
    setContent("");
    setIsDirty(false);
    setSaveError(null);
    setEditingName(false);
    getDocument(docId)
      .then((d) => {
        setDoc(d);
        setContent(d.content);
        setNameValue(d.file_name);
      })
      .catch(() => setSaveError("資料の読み込みに失敗しました"));
  }, [docId]);

  useEffect(() => {
    if (editingName) nameInputRef.current?.select();
  }, [editingName]);

  const handleRename = async () => {
    if (!doc) return;
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === doc.file_name) { setEditingName(false); return; }
    try {
      await renameDocument(docId, trimmed);
      setDoc((prev) => prev ? { ...prev, file_name: trimmed } : prev);
    } catch {
      setSaveError("名前の変更に失敗しました");
      setNameValue(doc.file_name);
    } finally {
      setEditingName(false);
    }
  };

  const handleSave = async () => {
    if (!doc || !isDirty) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateDocument(docId, content);
      setIsDirty(false);
    } catch {
      setSaveError("保存に失敗しました");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!doc) return;
    const ok = window.confirm(`資料「${doc.file_name}」を削除しますか？`);
    if (!ok) return;
    await removeDocument(docId);
    onClose();
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("ja-JP", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  if (!doc) {
    return (
      <div className="doc-editor-loading">
        {saveError ? (
          <p className="error-text">{saveError}</p>
        ) : (
          <p className="muted">読み込み中…</p>
        )}
      </div>
    );
  }

  return (
    <div className="doc-editor">
      <div className="doc-editor-header">
        <div className="doc-editor-title-row">
          {editingName ? (
            <input
              ref={nameInputRef}
              className="doc-editor-filename-input"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleRename();
                if (e.key === "Escape") { setNameValue(doc.file_name); setEditingName(false); }
              }}
              onBlur={() => void handleRename()}
            />
          ) : (
            <span
              className="doc-editor-filename"
              title="クリックして名前を変更"
              onClick={() => setEditingName(true)}
            >
              {doc.file_name}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {saveError && <span className="error-text" style={{ fontSize: "0.8em" }}>{saveError}</span>}
          {isDirty && (
            <button
              className="doc-editor-btn primary"
              onClick={() => void handleSave()}
              disabled={isSaving}
            >
              {isSaving ? "保存中…" : "保存して再インデックス"}
            </button>
          )}
          <button className="doc-editor-btn danger" onClick={() => void handleDelete()}>削除</button>
          <button className="doc-editor-btn" onClick={onClose} title="チャットに戻る">✕</button>
        </div>
        <div className="doc-editor-meta">
          <span>取り込み日時: {formatDate(doc.created_at)}</span>
          <span>サイズ: {formatSize(doc.file_size)}</span>
          <span>インデックス: {doc.indexed_at ? formatDate(doc.indexed_at) : "処理中…"}</span>
          <span>Embedding: {doc.embed_model}</span>
        </div>
      </div>
      <div className="doc-editor-body">
        <textarea
          ref={textareaRef}
          className="doc-editor-textarea"
          value={content}
          onChange={(e) => { setContent(e.target.value); setIsDirty(true); }}
          spellCheck={false}
        />
      </div>
    </div>
  );
}
