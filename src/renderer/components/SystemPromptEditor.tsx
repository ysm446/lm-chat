import { useEffect, useRef, useState } from "react";
import { SavedSystemPrompt, countTokens, updateSystemPrompt } from "../api";
import { useChatStore } from "../stores/chatStore";

type Props = {
  prompts: SavedSystemPrompt[];
  selectedId: string;
  onSelect: (id: string) => void;
  onPromptsChange: (prompts: SavedSystemPrompt[]) => void;
};

export function SystemPromptEditor({ prompts, selectedId, onSelect, onPromptsChange }: Props) {
  const systemPromptText = useChatStore((s) => s.systemPromptText);

  const [content, setContent] = useState("");
  const [tokenCount, setTokenCount] = useState<number | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [renamingMode, setRenamingMode] = useState(false);
  const [renamePending, setRenamePending] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const tokenDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  return (
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
        className="sp-editor-textarea"
        placeholder={selectedId
          ? "システムプロンプトを入力…"
          : "左のリストからプロンプトを選択するか、「＋」で新規作成してください。"
        }
        value={content}
        onChange={(e) => handleContentChange(e.target.value)}
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
  );
}
