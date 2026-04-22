import { useEffect, useRef, useState } from "react";
import { ApiDocumentWithContent, fetchCorrect, getDocument } from "../api";
import { useChatStore } from "../stores/chatStore";

type Props = {
  docId: string;
  onClose: () => void;
};

export function DocumentEditor({ docId, onClose }: Props) {
  const updateDocument = useChatStore((s) => s.updateDocument);
  const renameDocument = useChatStore((s) => s.renameDocument);
  const removeDocument = useChatStore((s) => s.removeDocument);
  const activeModelPath = useChatStore((s) => s.activeModelPath);
  const correctionEnabled = useChatStore((s) => s.correctionEnabled);

  const [doc, setDoc] = useState<ApiDocumentWithContent | null>(null);
  const [content, setContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [selStart, setSelStart] = useState(0);
  const [selEnd, setSelEnd] = useState(0);
  const [correction, setCorrection] = useState("");
  const [isCorrectionLoading, setIsCorrectionLoading] = useState(false);
  const [correctionPos, setCorrectionPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const correctionRequestIdRef = useRef(0);

  useEffect(() => {
    setDoc(null);
    setContent("");
    setIsDirty(false);
    setSaveError(null);
    setEditingName(false);
    setSelStart(0);
    setSelEnd(0);
    setCorrection("");
    setIsCorrectionLoading(false);
    setCorrectionPos(null);
    getDocument(docId)
      .then((d) => {
        setDoc(d);
        setContent(d.content);
        setNameValue(d.file_name);
      })
      .catch(() => setSaveError("資料の読み込みに失敗しました"));
  }, [docId]);

  useEffect(() => {
    if (!doc || doc.indexed_at != null) return undefined;

    let cancelled = false;
    let attempts = 0;
    let timer: number | null = null;
    const maxAttempts = 40;

    const scheduleNext = () => {
      timer = window.setTimeout(() => {
        void poll();
      }, 1500);
    };

    const poll = async () => {
      attempts += 1;
      try {
        const latest = await getDocument(docId);
        if (cancelled) return;
        setDoc(latest);
        if (latest.indexed_at != null || attempts >= maxAttempts) return;
      } catch {
        if (cancelled || attempts >= maxAttempts) return;
      }
      scheduleNext();
    };

    scheduleNext();

    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [docId, doc?.indexed_at]);

  useEffect(() => {
    if (editingName) nameInputRef.current?.select();
  }, [editingName]);

  useEffect(() => {
    setCorrection("");
    setCorrectionPos(null);
    setIsCorrectionLoading(false);
    correctionRequestIdRef.current += 1;
    if (!correctionEnabled || selStart === selEnd || !activeModelPath) return;
    const selected = content.slice(selStart, selEnd);
    if (!selected.trim()) return;
    if (textareaRef.current) {
      const rect = textareaRef.current.getBoundingClientRect();
      setCorrectionPos({ top: rect.top - 8, left: rect.left, width: rect.width });
    }
  }, [selStart, selEnd, content, activeModelPath, correctionEnabled]);

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

  const handleCorrectionRequest = async () => {
    if (!correctionEnabled || !activeModelPath) return;
    const selected = content.slice(selStart, selEnd);
    if (!selected.trim()) return;

    if (textareaRef.current) {
      const rect = textareaRef.current.getBoundingClientRect();
      setCorrectionPos({ top: rect.top - 8, left: rect.left, width: rect.width });
    }

    const requestId = correctionRequestIdRef.current + 1;
    correctionRequestIdRef.current = requestId;
    setIsCorrectionLoading(true);
    setCorrection("");

    try {
      const r = await fetchCorrect(selected);
      if (requestId !== correctionRequestIdRef.current) return;
      if (r.corrected && r.corrected !== selected) {
        setCorrection(r.corrected);
      }
    } catch {
      // ignore
    } finally {
      if (requestId === correctionRequestIdRef.current) {
        setIsCorrectionLoading(false);
      }
    }
  };

  const applyCorrection = () => {
    const ta = textareaRef.current;
    if (!ta || !correction) return;

    ta.focus();
    ta.setSelectionRange(selStart, selEnd);
    const ok = document.execCommand("insertText", false, correction);
    if (!ok) {
      const nextContent = content.slice(0, selStart) + correction + content.slice(selEnd);
      setContent(nextContent);
      setIsDirty(true);
    }
    const newCursor = selStart + correction.length;
    setSelStart(newCursor);
    setSelEnd(newCursor);
    setCorrection("");
  };

  const cancelCorrection = () => {
    setCorrection("");
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

  const hasSelectedText = correctionEnabled && selStart !== selEnd && !!content.slice(selStart, selEnd).trim();

  return (
    <>
      {!correction && correctionPos && hasSelectedText && (
        <button
          type="button"
          className="composer-correction-trigger"
          style={{ top: correctionPos.top, left: correctionPos.left + correctionPos.width - 76 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void handleCorrectionRequest()}
          disabled={isCorrectionLoading}
        >
          {isCorrectionLoading ? "校正中..." : "校正"}
        </button>
      )}
      {correction && correctionPos && (
        <div
          className="composer-correction-popup"
          style={{ top: correctionPos.top, left: correctionPos.left, width: correctionPos.width }}
          aria-live="polite"
        >
          <span className="composer-correction-text">{correction}</span>
          <div className="composer-correction-actions">
            <button
              type="button"
              className="composer-correction-action primary"
              onMouseDown={(e) => e.preventDefault()}
              onClick={applyCorrection}
            >
              置換
            </button>
            <button
              type="button"
              className="composer-correction-action"
              onMouseDown={(e) => e.preventDefault()}
              onClick={cancelCorrection}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
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
            <button className="doc-editor-btn danger" onClick={() => void handleDelete()}>
              <span className="doc-editor-btn-icon" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
              </span>
              削除
            </button>
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
            onSelect={(e) => {
              const t = e.target as HTMLTextAreaElement;
              setSelStart(t.selectionStart);
              setSelEnd(t.selectionEnd);
            }}
            onClick={(e) => {
              const t = e.target as HTMLTextAreaElement;
              setSelStart(t.selectionStart);
              setSelEnd(t.selectionEnd);
            }}
            onKeyUp={(e) => {
              const t = e.target as HTMLTextAreaElement;
              setSelStart(t.selectionStart);
              setSelEnd(t.selectionEnd);
            }}
            onKeyDown={(e) => {
              if (e.key === "Tab" && correction) {
                e.preventDefault();
                applyCorrection();
                return;
              }
              if (e.key === "Escape" && correction) {
                e.preventDefault();
                cancelCorrection();
                return;
              }
              const t = e.target as HTMLTextAreaElement;
              setSelStart(t.selectionStart);
              setSelEnd(t.selectionEnd);
            }}
            spellCheck={false}
          />
        </div>
      </div>
    </>
  );
}
