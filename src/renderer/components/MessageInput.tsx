import { useEffect, useRef, useState } from "react";
import { fetchAutocomplete, fetchCorrect, getConfig, getSessionTokenCount } from "../api";
import { useChatStore } from "../stores/chatStore";

function resizeImageToDataUrl(file: File, maxPx = 1024, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image load failed")); };
    img.src = url;
  });
}

function normalizeAutocompleteSuggestion(prefix: string, completion: string) {
  const normalizedPrefix = prefix.replace(/\r\n/g, "\n");
  const normalizedCompletion = completion.replace(/\r\n/g, "\n").trimEnd();

  if (!normalizedCompletion) return "";
  if (normalizedCompletion === normalizedPrefix) return "";
  if (normalizedCompletion.startsWith(normalizedPrefix)) {
    return normalizedCompletion.slice(normalizedPrefix.length).replace(/^\s+/, "");
  }

  const maxOverlap = Math.min(normalizedPrefix.length, normalizedCompletion.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (normalizedPrefix.slice(-overlap) === normalizedCompletion.slice(0, overlap)) {
      return normalizedCompletion.slice(overlap);
    }
  }

  return normalizedCompletion;
}

export function MessageInput() {
  const [value, setValue] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageFileName, setImageFileName] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ghostLayerRef = useRef<HTMLDivElement>(null);

  const sendMessage = useChatStore((state) => state.sendMessage);
  const sendTempMessage = useChatStore((state) => state.sendTempMessage);
  const stopGeneration = useChatStore((state) => state.stopGeneration);
  const currentSessionId = useChatStore((state) => state.currentSessionId);
  const isSubmitting = useChatStore((state) => state.isSubmitting);
  const activeModelPath = useChatStore((state) => state.activeModelPath);
  const tempChatMode = useChatStore((state) => state.tempChatMode);
  const memoryEnabled = useChatStore((state) => state.memoryEnabled);
  const toggleMemory = useChatStore((state) => state.toggleMemory);
  const docRagEnabled = useChatStore((state) => state.docRagEnabled);
  const toggleDocRag = useChatStore((state) => state.toggleDocRag);
  const thinkingEnabled = useChatStore((state) => state.thinkingEnabled);
  const toggleThinking = useChatStore((state) => state.toggleThinking);
  const autocompleteEnabled = useChatStore((state) => state.autocompleteEnabled);
  const correctionEnabled = useChatStore((state) => state.correctionEnabled);
  const toggleAutocomplete = useChatStore((state) => state.toggleAutocomplete);

  const [tokenCount, setTokenCount] = useState<number | null>(null);
  const [ctxSize, setCtxSize] = useState(32768);
  const [suggestion, setSuggestion] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [selStart, setSelStart] = useState(0);
  const [selEnd, setSelEnd] = useState(0);
  const [correction, setCorrection] = useState("");
  const [isCorrectionLoading, setIsCorrectionLoading] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [correctionPos, setCorrectionPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [hasUserMessages, setHasUserMessages] = useState(false);
  const [canScrollToTop, setCanScrollToTop] = useState(false);
  const [canScrollToBottom, setCanScrollToBottom] = useState(false);
  const [canJumpPrevUserMessage, setCanJumpPrevUserMessage] = useState(false);
  const [canJumpNextUserMessage, setCanJumpNextUserMessage] = useState(false);
  const autocompleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autocompleteRequestIdRef = useRef(0);
  const correctionRequestIdRef = useRef(0);
  const prevUserClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextUserClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getConfig().then((c) => setCtxSize(c.ctx_size)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!currentSessionId || isSubmitting) return;
    getSessionTokenCount(currentSessionId)
      .then((r) => { setTokenCount(r.token_count); setCtxSize(r.ctx_size); })
      .catch(() => {});
  }, [currentSessionId, isSubmitting]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 400)}px`;
    if (ghostLayerRef.current) {
      ghostLayerRef.current.style.transform = `translateY(-${textarea.scrollTop}px)`;
    }
  }, [value]);

  useEffect(() => {
    autocompleteRequestIdRef.current += 1;

    if (selStart !== selEnd || isComposing) {
      setSuggestion("");
      if (autocompleteTimerRef.current) clearTimeout(autocompleteTimerRef.current);
      return;
    }

    setSuggestion("");
    setCorrection("");
    if (autocompleteTimerRef.current) clearTimeout(autocompleteTimerRef.current);
    const textBeforeCursor = value.slice(0, cursorPos);
    if (!autocompleteEnabled || !textBeforeCursor.trim() || textBeforeCursor.length < 4 || !activeModelPath) return;

    const requestId = autocompleteRequestIdRef.current;
    const expectedValue = value;
    const expectedCursor = cursorPos;

    autocompleteTimerRef.current = setTimeout(() => {
      fetchAutocomplete(textBeforeCursor)
        .then((r) => {
          const textarea = textareaRef.current;
          if (!textarea) return;
          if (requestId !== autocompleteRequestIdRef.current) return;
          if (isComposing) return;
          if (textarea.value !== expectedValue) return;
          if ((textarea.selectionStart ?? expectedCursor) !== expectedCursor) return;

          const nextSuggestion = normalizeAutocompleteSuggestion(textBeforeCursor, r.completion);
          if (!nextSuggestion || textarea.value.slice(expectedCursor).startsWith(nextSuggestion)) {
            setSuggestion("");
            return;
          }
          setSuggestion(nextSuggestion);
        })
        .catch(() => {});
    }, 700);
    return () => { if (autocompleteTimerRef.current) clearTimeout(autocompleteTimerRef.current); };
  }, [value, cursorPos, selStart, selEnd, autocompleteEnabled, activeModelPath, isComposing]);

  useEffect(() => {
    setCorrection("");
    setCorrectionPos(null);
    setIsCorrectionLoading(false);
    correctionRequestIdRef.current += 1;
    if (!correctionEnabled || selStart === selEnd || !activeModelPath || isComposing) return;
    const selected = value.slice(selStart, selEnd);
    if (!selected.trim()) return;
    if (textareaRef.current) {
      const rect = textareaRef.current.getBoundingClientRect();
      setCorrectionPos({ top: rect.top - 8, left: rect.left, width: rect.width });
    }
  }, [selStart, selEnd, value, activeModelPath, correctionEnabled, isComposing]);

  const handleCorrectionRequest = async () => {
    if (!correctionEnabled || !activeModelPath || isComposing) return;
    const selected = value.slice(selStart, selEnd);
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

  const usagePct = tokenCount !== null ? Math.min((tokenCount / ctxSize) * 100, 100) : null;
  const ringColor =
    usagePct === null ? "var(--border-strong)"
    : usagePct >= 90  ? "#ef4444"
    : usagePct >= 70  ? "#f59e0b"
    : "var(--accent)";
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = usagePct !== null ? circumference * (1 - usagePct / 100) : circumference;

  const handleAttachFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setImageData(dataUrl);
      setImageFileName(file.name);
    } catch {
      // ignore
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    await handleAttachFile(file);
  };

  useEffect(() => {
    const handleDroppedImage = (event: Event) => {
      const customEvent = event as CustomEvent<File>;
      if (!customEvent.detail) return;
      void handleAttachFile(customEvent.detail);
    };

    window.addEventListener("lm-chat:attach-image", handleDroppedImage as EventListener);
    return () => window.removeEventListener("lm-chat:attach-image", handleDroppedImage as EventListener);
  }, []);

  useEffect(() => {
    const handleScrollState = (event: Event) => {
      const customEvent = event as CustomEvent<{
        can_scroll_to_top?: boolean;
        can_scroll_to_bottom?: boolean;
        has_user_messages?: boolean;
        can_jump_prev_user?: boolean;
        can_jump_next_user?: boolean;
      }>;
      setCanScrollToTop(!!customEvent.detail?.can_scroll_to_top);
      setCanScrollToBottom(!!customEvent.detail?.can_scroll_to_bottom);
      setHasUserMessages(!!customEvent.detail?.has_user_messages);
      setCanJumpPrevUserMessage(!!customEvent.detail?.can_jump_prev_user);
      setCanJumpNextUserMessage(!!customEvent.detail?.can_jump_next_user);
    };
    window.addEventListener("lm-chat:chat-scroll-state", handleScrollState as EventListener);
    return () => window.removeEventListener("lm-chat:chat-scroll-state", handleScrollState as EventListener);
  }, []);

  useEffect(() => () => {
    if (prevUserClickTimerRef.current) clearTimeout(prevUserClickTimerRef.current);
    if (nextUserClickTimerRef.current) clearTimeout(nextUserClickTimerRef.current);
  }, []);

  const handlePrevUserClick = () => {
    if (prevUserClickTimerRef.current) clearTimeout(prevUserClickTimerRef.current);
    prevUserClickTimerRef.current = setTimeout(() => {
      window.dispatchEvent(new CustomEvent(canJumpPrevUserMessage ? "lm-chat:jump-to-prev-user-message" : "lm-chat:scroll-to-top"));
      prevUserClickTimerRef.current = null;
    }, 220);
  };

  const handlePrevUserDoubleClick = () => {
    if (prevUserClickTimerRef.current) {
      clearTimeout(prevUserClickTimerRef.current);
      prevUserClickTimerRef.current = null;
    }
    window.dispatchEvent(new CustomEvent("lm-chat:scroll-to-top"));
  };

  const handleNextUserClick = () => {
    if (nextUserClickTimerRef.current) clearTimeout(nextUserClickTimerRef.current);
    nextUserClickTimerRef.current = setTimeout(() => {
      window.dispatchEvent(new CustomEvent(canJumpNextUserMessage ? "lm-chat:jump-to-next-user-message" : "lm-chat:scroll-to-bottom"));
      nextUserClickTimerRef.current = null;
    }, 220);
  };

  const handleNextUserDoubleClick = () => {
    if (nextUserClickTimerRef.current) {
      clearTimeout(nextUserClickTimerRef.current);
      nextUserClickTimerRef.current = null;
    }
    window.dispatchEvent(new CustomEvent("lm-chat:scroll-to-bottom"));
  };

  const applyCorrection = () => {
    const ta = textareaRef.current;
    if (!ta || !correction) return;

    ta.focus();
    ta.setSelectionRange(selStart, selEnd);
    const ok = document.execCommand("insertText", false, correction);
    if (!ok) {
      const newValue = value.slice(0, selStart) + correction + value.slice(selEnd);
      setValue(newValue);
    }
    const newCursor = selStart + correction.length;
    setCursorPos(newCursor);
    setSelStart(newCursor);
    setSelEnd(newCursor);
    setCorrection("");
  };

  const cancelCorrection = () => {
    setCorrection("");
  };

  const handleSend = async () => {
    if (!value.trim() && !imageData) return;
    const text = value.trim();
    const img = imageData;
    setValue("");
    setImageData(null);
    setImageFileName("");
    setSuggestion("");
    setCorrection("");
    if (tempChatMode) {
      await sendTempMessage(text);
    } else {
      if (!currentSessionId) return;
      await sendMessage(currentSessionId, text, img);
    }
  };

  const modelReady = !!activeModelPath;
  const hasSelectedText = correctionEnabled && selStart !== selEnd && !!value.slice(selStart, selEnd).trim();
  const showGhost = !!suggestion && !correction && !isComposing;
  const canSend = modelReady && !isSubmitting && (!!value.trim() || (!!imageData && !tempChatMode));

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
    <section className="input-shell">
      <div className="input-shell-inner">
      <div className="composer-wrap">
      {hasUserMessages && (
        <div className="composer-floating-actions composer-floating-actions-right">
          <button
            type="button"
            className="composer-scroll-jump-btn"
            onClick={handlePrevUserClick}
            onDoubleClick={handlePrevUserDoubleClick}
            title="クリックで前の自分の発言、ダブルクリックで一番上へ移動"
            aria-label="前の自分の発言へ移動"
            disabled={!canJumpPrevUserMessage && !canScrollToTop}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5" />
              <polyline points="6 11 12 5 18 11" />
            </svg>
          </button>
        </div>
      )}
      {hasUserMessages && (
        <button
          type="button"
          className="composer-scroll-jump-btn composer-scroll-jump-btn-center"
          onClick={handleNextUserClick}
          onDoubleClick={handleNextUserDoubleClick}
          title="クリックで次の自分の発言、ダブルクリックで一番下へ移動"
          aria-label="次の自分の発言へ移動"
          disabled={!canJumpNextUserMessage && !canScrollToBottom}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14" />
            <polyline points="6 13 12 19 18 13" />
          </svg>
        </button>
      )}
      <div className="composer">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => void handleFileChange(e)}
        />

        {imageData && (
          <div className="image-preview-row">
            <img src={imageData} alt={imageFileName} className="image-preview-thumb" />
            <span className="image-preview-name">{imageFileName}</span>
            <button
              className="image-preview-remove"
              onClick={() => { setImageData(null); setImageFileName(""); }}
              title="画像を削除"
            >✕</button>
          </div>
        )}

        <div className="composer-autocomplete-wrap">
          {showGhost && (
            <div ref={ghostLayerRef} className="composer-ghost-layer" aria-hidden="true">
              <span className="composer-ghost-existing">{value.slice(0, cursorPos)}</span><span className="composer-ghost-suggest">{suggestion}</span><span className="composer-ghost-existing">{value.slice(cursorPos)}</span>
            </div>
          )}
          <textarea
            ref={textareaRef}
            className={`composer-textarea${showGhost ? " ghost-active" : ""}`}
            placeholder={modelReady ? "ここにメッセージを入力..." : "モデルを選択してください..."}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setCursorPos(e.target.selectionStart ?? e.target.value.length);
            }}
            onCompositionStart={() => {
              autocompleteRequestIdRef.current += 1;
              setIsComposing(true);
              setSuggestion("");
            }}
            onCompositionEnd={(e) => {
              setIsComposing(false);
              setCursorPos(e.currentTarget.selectionStart ?? e.currentTarget.value.length);
              setSelStart(e.currentTarget.selectionStart ?? 0);
              setSelEnd(e.currentTarget.selectionEnd ?? 0);
            }}
            onScroll={(e) => {
              if (ghostLayerRef.current) {
                ghostLayerRef.current.style.transform = `translateY(-${e.currentTarget.scrollTop}px)`;
              }
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
              if (e.key === "Tab" && suggestion) {
                e.preventDefault();
                const before = value.slice(0, cursorPos);
                const after = value.slice(cursorPos);
                const newValue = before + suggestion + after;
                const newCursor = cursorPos + suggestion.length;
                setValue(newValue);
                setCursorPos(newCursor);
                setSuggestion("");
                setTimeout(() => {
                  textareaRef.current?.setSelectionRange(newCursor, newCursor);
                }, 0);
                return;
              }
              if (e.key === "Escape" && suggestion) {
                e.preventDefault();
                setSuggestion("");
                return;
              }
              if (e.key === "Enter" && !e.shiftKey && !isComposing) {
                e.preventDefault();
                void handleSend();
              }
            }}
            onSelect={(e) => {
              const t = e.target as HTMLTextAreaElement;
              setSelStart(t.selectionStart);
              setSelEnd(t.selectionEnd);
              setCursorPos(t.selectionStart);
            }}
            onClick={(e) => {
              const t = e.target as HTMLTextAreaElement;
              setCursorPos(t.selectionStart);
              setSelStart(t.selectionStart);
              setSelEnd(t.selectionEnd);
            }}
            onKeyUp={(e) => {
              const t = e.target as HTMLTextAreaElement;
              setCursorPos(t.selectionStart);
              setSelStart(t.selectionStart);
              setSelEnd(t.selectionEnd);
            }}
            rows={2}
            disabled={!modelReady || isSubmitting}
          />
        </div>

        <div className="composer-bottom">
          <div className="composer-bottom-left">
            <button
              className="composer-icon-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={!modelReady || isSubmitting}
              title="画像を添付"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </button>

            <button
              className={`composer-chip${memoryEnabled ? " active" : ""}`}
              onClick={toggleMemory}
              title={memoryEnabled ? "記憶をオフにする" : "記憶をオンにする"}
            >
              記憶
            </button>

            <button
              className={`composer-chip${docRagEnabled ? " active" : ""}`}
              onClick={toggleDocRag}
              title={docRagEnabled ? "資料参照をオフにする" : "資料参照をオンにする"}
            >
              資料
            </button>

            <button
              className={`composer-chip${thinkingEnabled ? " active" : ""}`}
              onClick={toggleThinking}
              title={thinkingEnabled ? "思考モードをオフにする" : "思考モードをオンにする"}
            >
              思考
            </button>

            <button
              className={`composer-chip${autocompleteEnabled ? " active" : ""}`}
              onClick={toggleAutocomplete}
              title={autocompleteEnabled ? "自動補完をオフにする" : "自動補完をオンにする（Tab で確定）"}
            >
              補完
            </button>
          </div>

          <div className="composer-bottom-right">
            <div className="token-ring-wrapper">
              <svg width="26" height="26" viewBox="0 0 26 26" className="token-ring-svg">
                <circle cx="13" cy="13" r={radius} fill="none" stroke="var(--border-strong)" strokeWidth="2.2" />
                <circle
                  cx="13" cy="13" r={radius}
                  fill="none"
                  stroke={ringColor}
                  strokeWidth="2.2"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="round"
                  transform="rotate(-90 13 13)"
                  style={{ transition: "stroke-dashoffset 0.4s ease, stroke 0.3s" }}
                />
              </svg>
              <span className="token-ring-pct" style={{ color: ringColor }}>
                {usagePct !== null ? `${Math.round(usagePct)}%` : "—"}
              </span>
              {tokenCount !== null && (
                <div className="token-ring-tooltip">
                  <p>会話トークン: <strong>{tokenCount.toLocaleString()}</strong></p>
                  <p>コンテキスト上限: <strong>{ctxSize.toLocaleString()}</strong></p>
                  <p>{usagePct!.toFixed(1)}% 使用中（{(100 - usagePct!).toFixed(1)}% 残り）</p>
                </div>
              )}
            </div>

            <div className="composer-divider" />

            {isSubmitting ? (
              <button
                className="composer-stop-btn"
                onClick={stopGeneration}
                title="生成を停止"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="4" y="4" width="16" height="16" rx="2"/>
                </svg>
              </button>
            ) : (
              <button
                className="composer-send-btn"
                onClick={() => void handleSend()}
                disabled={!canSend}
                title="送信 (Enter)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5"/>
                  <polyline points="5 12 12 5 19 12"/>
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
      </div>
      </div>
    </section>
    </>
  );
}
