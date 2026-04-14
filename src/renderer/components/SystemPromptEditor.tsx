import { useEffect, useRef, useState } from "react";
import { SavedSystemPrompt, countTokens, fetchCorrect, updateSystemPrompt } from "../api";
import { useChatStore } from "../stores/chatStore";

type Props = {
  prompts: SavedSystemPrompt[];
  selectedId: string;
  onSelect: (id: string) => void;
  onPromptsChange: (prompts: SavedSystemPrompt[]) => void;
};

export function SystemPromptEditor({ prompts, selectedId, onSelect, onPromptsChange }: Props) {
  const systemPromptText = useChatStore((s) => s.systemPromptText);
  const activeModelPath = useChatStore((s) => s.activeModelPath);
  const correctionEnabled = useChatStore((s) => s.correctionEnabled);

  const [content, setContent] = useState("");
  const [tokenCount, setTokenCount] = useState<number | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [renamingMode, setRenamingMode] = useState(false);
  const [renamePending, setRenamePending] = useState("");
  const [selStart, setSelStart] = useState(0);
  const [selEnd, setSelEnd] = useState(0);
  const [correction, setCorrection] = useState("");
  const [isCorrectionLoading, setIsCorrectionLoading] = useState(false);
  const [correctionPos, setCorrectionPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tokenDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const correctionRequestIdRef = useRef(0);

  const selectedPrompt = prompts.find((p) => p.id === selectedId) ?? null;

  // Sync content when selection changes
  useEffect(() => {
    if (selectedPrompt) {
      setContent(selectedPrompt.content);
    } else if (!selectedId) {
      setContent(systemPromptText);
    }
    setRenamingMode(false);
    setRenamePending("");
  }, [selectedId]);

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

  // Token count debounce
  useEffect(() => {
    if (tokenDebounceRef.current) clearTimeout(tokenDebounceRef.current);
    if (!content) { setTokenCount(null); return; }
    tokenDebounceRef.current = setTimeout(() => {
      countTokens(content)
        .then((r) => setTokenCount(r.token_count))
        .catch(() => setTokenCount(Math.round(content.length / 2)));
    }, 500);
    return () => { if (tokenDebounceRef.current) clearTimeout(tokenDebounceRef.current); };
  }, [content]);

  const handleContentChange = (value: string) => {
    setContent(value);
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
    }
    const newCursor = selStart + correction.length;
    setSelStart(newCursor);
    setSelEnd(newCursor);
    setCorrection("");
  };

  const cancelCorrection = () => {
    setCorrection("");
  };

  const handleOverwrite = async () => {
    if (!selectedId) return;
    try {
      const updated = await updateSystemPrompt(selectedId, content);
      onPromptsChange(prompts.map((p) => (p.id === updated.id ? updated : p)));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch { /* ignore */ }
  };


  const handleRenameStart = () => {
    setRenamePending(selectedPrompt?.name ?? "");
    setRenamingMode(true);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  };

  const handleRenameCommit = async () => {
    const name = renamePending.trim();
    if (!name || !selectedId) { setRenamingMode(false); return; }
    try {
      // updateSystemPrompt updates content; for name-only rename, keep existing content
      const updated = await updateSystemPrompt(selectedId, content, name);
      onPromptsChange(prompts.map((p) => (p.id === updated.id ? updated : p)));
    } catch { /* ignore */ }
    setRenamingMode(false);
  };

  const isModified = selectedPrompt ? selectedPrompt.content !== content : false;
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
      <div className="sp-editor">
      <div className="sp-editor-header">
        {renamingMode ? (
          <div className="sp-editor-rename-row">
            <input
              ref={renameInputRef}
              className="sp-editor-rename-input"
              value={renamePending}
              onChange={(e) => setRenamePending(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleRenameCommit();
                if (e.key === "Escape") setRenamingMode(false);
              }}
            />
            <button className="sp-editor-inline-btn" onClick={() => void handleRenameCommit()} title="確定">✓</button>
            <button className="sp-editor-inline-btn" onClick={() => setRenamingMode(false)} title="キャンセル">✕</button>
          </div>
        ) : (
          <div className="sp-editor-title-row">
            <h2 className="sp-editor-title">
              {selectedPrompt ? selectedPrompt.name : "プロンプトを選択または新規作成"}
            </h2>
            {selectedPrompt && (
              <button className="sp-editor-rename-btn" onClick={handleRenameStart} title="名前を変更">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
            )}
            {tokenCount !== null && (
              <span className="sp-editor-token-count">{tokenCount.toLocaleString()} トークン</span>
            )}
          </div>
        )}
      </div>

      <textarea
        ref={textareaRef}
        className="sp-editor-textarea"
        placeholder={selectedId
          ? "システムプロンプトを入力…"
          : "左のリストからプロンプトを選択するか、「＋」で新規作成してください。"
        }
        value={content}
        onChange={(e) => handleContentChange(e.target.value)}
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
          }
        }}
        disabled={!selectedId && prompts.length > 0}
        spellCheck={false}
      />

      {selectedId && (
        <div className="sp-editor-footer">
          {isModified && (
            <span className="sp-editor-unsaved-badge">未保存の変更</span>
          )}
          <div style={{ flex: 1 }} />
          <button
            className={`sp-editor-btn primary${savedFlash ? " saved" : ""}`}
            onClick={() => void handleOverwrite()}
            disabled={!isModified && !savedFlash}
          >
            {savedFlash ? "保存しました" : "上書き保存"}
          </button>
        </div>
      )}
      </div>
    </>
  );
}
