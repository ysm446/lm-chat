import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SavedSystemPrompt, countTokens, fetchCorrect, updateSystemPrompt } from "../api";
import { useChatStore } from "../stores/chatStore";

type Props = {
  prompts: SavedSystemPrompt[];
  selectedId: string;
  onSelect: (id: string) => void;
  onPromptsChange: (prompts: SavedSystemPrompt[]) => void;
};

// textarea 内のカーソル位置（ピクセル）を、styles をコピーしたミラー div で計測する。
// .sp-editor-textarea は border が無いので border 幅の補正は不要。
const MIRROR_PROPS = [
  "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize",
  "lineHeight", "fontFamily", "textAlign", "textTransform", "textIndent",
  "letterSpacing", "wordSpacing", "tabSize",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
] as const;

function getCaretCoordinates(el: HTMLTextAreaElement, position: number) {
  const computed = window.getComputedStyle(el);
  const div = document.createElement("div");
  const style = div.style;
  style.position = "absolute";
  style.visibility = "hidden";
  style.whiteSpace = "pre-wrap";
  style.wordWrap = "break-word";
  style.boxSizing = "border-box";
  style.width = `${el.clientWidth}px`;
  style.height = "auto";
  style.overflow = "hidden";
  for (const prop of MIRROR_PROPS) {
    (style as unknown as Record<string, string>)[prop] = computed.getPropertyValue(prop);
  }
  div.textContent = el.value.slice(0, position);
  const span = document.createElement("span");
  // 残りテキストを入れることで折り返し後の正しい行頭/行末位置を得る
  span.textContent = el.value.slice(position) || ".";
  div.appendChild(span);
  document.body.appendChild(div);
  const coords = { top: span.offsetTop, left: span.offsetLeft };
  document.body.removeChild(div);
  return coords;
}

export function SystemPromptEditor({ prompts, selectedId, onSelect, onPromptsChange }: Props) {
  const systemPromptText = useChatStore((s) => s.systemPromptText);
  const activeModelPath = useChatStore((s) => s.activeModelPath);
  const correctionEnabled = useChatStore((s) => s.correctionEnabled);

  const [content, setContent] = useState("");
  const [mode, setMode] = useState<"preview" | "edit">("edit");
  const [tokenCount, setTokenCount] = useState<number | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [renamingMode, setRenamingMode] = useState(false);
  const [renamePending, setRenamePending] = useState("");
  const [selStart, setSelStart] = useState(0);
  const [selEnd, setSelEnd] = useState(0);
  const [correction, setCorrection] = useState("");
  const [isCorrectionLoading, setIsCorrectionLoading] = useState(false);
  const [correctionPos, setCorrectionPos] = useState<{ top: number; left: number; width: number; caretLeft: number; areaTop: number } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tokenDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const correctionRequestIdRef = useRef(0);

  const selectedPrompt = prompts.find((p) => p.id === selectedId) ?? null;

  // Sync content when selection changes. 既存プロンプト（本文あり）は読みやすさ優先でプレビュー起動、
  // 新規・空のものはすぐ書けるよう編集起動。
  useEffect(() => {
    if (selectedPrompt) {
      setContent(selectedPrompt.content);
      setMode(selectedPrompt.content.trim() ? "preview" : "edit");
    } else if (!selectedId) {
      setContent(systemPromptText);
      setMode("edit");
    }
    setRenamingMode(false);
    setRenamePending("");
  }, [selectedId]);

  // 選択範囲のスクリーン座標を計算してポップアップ位置を更新する
  const computeCorrectionPos = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const rect = ta.getBoundingClientRect();
    const caret = getCaretCoordinates(ta, selStart);
    const top = rect.top + caret.top - ta.scrollTop;
    const caretLeft = rect.left + caret.left - ta.scrollLeft;
    setCorrectionPos({ top, left: rect.left, width: rect.width, caretLeft, areaTop: rect.top });
  };

  useEffect(() => {
    setCorrection("");
    setCorrectionPos(null);
    setIsCorrectionLoading(false);
    correctionRequestIdRef.current += 1;
    if (mode !== "edit" || !correctionEnabled || selStart === selEnd || !activeModelPath) return;
    const selected = content.slice(selStart, selEnd);
    if (!selected.trim()) return;
    computeCorrectionPos();
  }, [selStart, selEnd, content, activeModelPath, correctionEnabled, mode]);

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

    computeCorrectionPos();

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
      {mode === "edit" && !correction && correctionPos && hasSelectedText && (
        <button
          type="button"
          className="composer-correction-trigger"
          style={{ top: correctionPos.areaTop, left: correctionPos.left + correctionPos.width - 80 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void handleCorrectionRequest()}
          disabled={isCorrectionLoading}
        >
          {isCorrectionLoading ? "校正中..." : "校正"}
        </button>
      )}
      {mode === "edit" && correction && correctionPos && (
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
            {selectedPrompt && (
              <div className="sp-editor-mode-toggle">
                <button
                  className={mode === "preview" ? "active" : ""}
                  onClick={() => setMode("preview")}
                >
                  プレビュー
                </button>
                <button
                  className={mode === "edit" ? "active" : ""}
                  onClick={() => setMode("edit")}
                >
                  編集
                </button>
              </div>
            )}
            {tokenCount !== null && (
              <span className="sp-editor-token-count">{tokenCount.toLocaleString()} トークン</span>
            )}
          </div>
        )}
      </div>

      {mode === "preview" ? (
        <div className="sp-editor-preview message-body">
          {content.trim()
            ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            : <p className="sp-editor-preview-empty">内容がありません。「編集」から入力してください。</p>}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          className="sp-editor-textarea"
          placeholder={selectedId
            ? "システムプロンプトを入力…"
            : "左のリストからプロンプトを選択するか、「＋」で新規作成してください。"
          }
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          onScroll={() => { if (correctionPos) computeCorrectionPos(); }}
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
      )}

      {selectedId && mode === "edit" && (
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
