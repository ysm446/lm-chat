import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fetchCorrect, resolveApiUrl } from "../api";
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

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightText({ text, query, current }: { text: string; query: string; current: boolean }) {
  if (!query.trim()) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegex(query)})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className={`search-highlight${current ? " current" : ""}`}>{part}</mark>
          : part
      )}
    </>
  );
}

// rehype プラグイン: HAST のテキストノードを走査してマッチ部分を <mark> に置き換える
function hastHighlight(node: any, query: string, className: string[]) {
  if (!node.children) return;
  const newChildren: any[] = [];
  for (const child of node.children) {
    if (child.type === "text") {
      const parts = child.value.split(new RegExp(`(${escapeRegex(query)})`, "gi"));
      if (parts.length === 1) {
        newChildren.push(child);
      } else {
        for (const part of parts) {
          if (!part) continue;
          if (part.toLowerCase() === query.toLowerCase()) {
            newChildren.push({
              type: "element", tagName: "mark",
              properties: { className },
              children: [{ type: "text", value: part }],
            });
          } else {
            newChildren.push({ type: "text", value: part });
          }
        }
      }
    } else {
      hastHighlight(child, query, className);
      newChildren.push(child);
    }
  }
  node.children = newChildren;
}

function makeHighlightPlugin(query: string, isCurrent: boolean) {
  const className = isCurrent ? ["search-highlight", "current"] : ["search-highlight"];
  return () => (tree: any) => {
    if (!query.trim()) return;
    hastHighlight(tree, query, className);
  };
}

function resizeTextareaToContent(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}
function parseThinking(content: string): { thinking: string | null; response: string; streaming: boolean } {
  const complete = content.match(/^<think>([\s\S]*?)<\/think>\n?/);
  if (complete) {
    return { thinking: complete[1].trim(), response: content.slice(complete[0].length), streaming: false };
  }
  if (content.startsWith("<think>")) {
    return { thinking: content.slice(7), response: "", streaming: true };
  }
  return { thinking: null, response: content, streaming: false };
}

export function ChatView() {
  const session = useChatStore((state) => state.currentSession());
  const isSubmitting = useChatStore((state) => state.isSubmitting);
  const submissionMode = useChatStore((state) => state.submissionMode);
  const selectedModel = useChatStore((state) => state.selectedModel);
  const deleteMessage = useChatStore((state) => state.deleteMessage);
  const editMessage = useChatStore((state) => state.editMessage);
  const branchSession = useChatStore((state) => state.branchSession);
  const regenerateMessage = useChatStore((state) => state.regenerateMessage);
  const tempChatMode = useChatStore((state) => state.tempChatMode);
  const tempMessages = useChatStore((state) => state.tempMessages);
  const continueGeneration = useChatStore((state) => state.continueGeneration);
  const activeModelPath = useChatStore((state) => state.activeModelPath);
  const correctionEnabled = useChatStore((state) => state.correctionEnabled);
  const modelName = selectedModel ?? session?.model_name ?? "";
  const messages = tempChatMode ? tempMessages : (session?.messages ?? []);
  const chatViewRef = useRef<HTMLElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const previousSubmissionModeRef = useRef<typeof submissionMode>(null);
  const userMessageRefs = useRef<Map<string, HTMLElement>>(new Map());

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [editingImageData, setEditingImageData] = useState<string | null>(null);
  const [editSelStart, setEditSelStart] = useState(0);
  const [editSelEnd, setEditSelEnd] = useState(0);
  const editImageInputRef = useRef<HTMLInputElement>(null);
  const [editCorrection, setEditCorrection] = useState("");
  const [isEditCorrectionLoading, setIsEditCorrectionLoading] = useState(false);
  const [editCorrectionPos, setEditCorrectionPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const editCorrectionRequestIdRef = useRef(0);

  // ── Search ───────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const matchCardRefs = useRef<Map<string, HTMLElement>>(new Map());

  const matchedIds = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return messages.filter((m) => m.content?.toLowerCase().includes(q)).map((m) => m.id);
  }, [messages, searchQuery]);
  const userMessageIds = useMemo(
    () => messages.filter((message) => message.role === "user").map((message) => message.id),
    [messages]
  );

  const getFocusedUserMessageIndex = useCallback(() => {
    const el = chatViewRef.current;
    if (!el || userMessageIds.length === 0) return -1;
    const viewportCenter = el.scrollTop + el.clientHeight / 2;
    let closestIndex = -1;
    let closestDistance = Number.POSITIVE_INFINITY;
    userMessageIds.forEach((id, index) => {
      const card = userMessageRefs.current.get(id);
      if (!card) return;
      const cardCenter = card.offsetTop + card.offsetHeight / 2;
      const distance = Math.abs(cardCenter - viewportCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    return closestIndex;
  }, [userMessageIds]);

  const scrollToUserMessage = useCallback((index: number) => {
    if (index < 0 || index >= userMessageIds.length) return;
    userMessageRefs.current.get(userMessageIds[index])?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [userMessageIds]);

  useEffect(() => { setMatchIndex(0); }, [searchQuery]);

  useEffect(() => {
    if (matchedIds.length === 0) return;
    const id = matchedIds[matchIndex];
    matchCardRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [matchIndex, matchedIds]);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
  }, []);

  const goNext = useCallback(() => {
    if (matchedIds.length === 0) return;
    setMatchIndex((i) => (i + 1) % matchedIds.length);
  }, [matchedIds.length]);

  const goPrev = useCallback(() => {
    if (matchedIds.length === 0) return;
    setMatchIndex((i) => (i - 1 + matchedIds.length) % matchedIds.length);
  }, [matchedIds.length]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openSearch]);

  useEffect(() => {
    const previousMode = previousSubmissionModeRef.current;
    previousSubmissionModeRef.current = submissionMode;
    if (submissionMode === "regenerate" || previousMode === "regenerate") return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages.length, isSubmitting, submissionMode]);

  const emitScrollState = useCallback(() => {
    const el = chatViewRef.current;
    if (!el) return;
    const canScrollToBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) > 48;
    const currentUserIndex = getFocusedUserMessageIndex();
    window.dispatchEvent(new CustomEvent("lm-chat:chat-scroll-state", {
      detail: {
        can_scroll_to_bottom: canScrollToBottom,
        can_jump_prev_user: currentUserIndex > 0,
        can_jump_next_user: currentUserIndex >= 0 && currentUserIndex < userMessageIds.length - 1,
      }
    }));
  }, [getFocusedUserMessageIndex, userMessageIds.length]);

  useEffect(() => {
    emitScrollState();
  }, [messages.length, searchOpen, emitScrollState]);

  useEffect(() => {
    const handleScrollToBottom = () => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    };
    const handleJumpToPrevUserMessage = () => {
      const currentUserIndex = getFocusedUserMessageIndex();
      if (currentUserIndex > 0) scrollToUserMessage(currentUserIndex - 1);
    };
    const handleJumpToNextUserMessage = () => {
      const currentUserIndex = getFocusedUserMessageIndex();
      if (currentUserIndex >= 0 && currentUserIndex < userMessageIds.length - 1) {
        scrollToUserMessage(currentUserIndex + 1);
      }
    };
    window.addEventListener("lm-chat:scroll-to-bottom", handleScrollToBottom as EventListener);
    window.addEventListener("lm-chat:jump-to-prev-user-message", handleJumpToPrevUserMessage as EventListener);
    window.addEventListener("lm-chat:jump-to-next-user-message", handleJumpToNextUserMessage as EventListener);
    return () => {
      window.removeEventListener("lm-chat:scroll-to-bottom", handleScrollToBottom as EventListener);
      window.removeEventListener("lm-chat:jump-to-prev-user-message", handleJumpToPrevUserMessage as EventListener);
      window.removeEventListener("lm-chat:jump-to-next-user-message", handleJumpToNextUserMessage as EventListener);
    };
  }, [getFocusedUserMessageIndex, scrollToUserMessage, userMessageIds.length]);

  useEffect(() => {
    if (!expandedImage) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedImage(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [expandedImage]);

  useEffect(() => {
    if (!editingId) return;
    resizeTextareaToContent(editTextareaRef.current);
    editTextareaRef.current?.focus();
  }, [editingContent, editingId]);

  useEffect(() => {
    setEditCorrection("");
    setEditCorrectionPos(null);
    setIsEditCorrectionLoading(false);
    editCorrectionRequestIdRef.current += 1;
    if (!editingId || !correctionEnabled || editSelStart === editSelEnd || !activeModelPath) return;
    const selected = editingContent.slice(editSelStart, editSelEnd);
    if (!selected.trim()) return;
    if (editTextareaRef.current) {
      const rect = editTextareaRef.current.getBoundingClientRect();
      setEditCorrectionPos({ top: rect.top - 8, left: rect.left, width: rect.width });
    }
  }, [editingId, editSelStart, editSelEnd, editingContent, activeModelPath, correctionEnabled]);

  const startEdit = (messageId: string, content: string, imageData: string | null) => {
    setEditingId(messageId);
    setEditingContent(content);
    setEditingImageData(imageData);
    setEditSelStart(0);
    setEditSelEnd(0);
    setEditCorrection("");
    setEditCorrectionPos(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingImageData(null);
  };

  const commitEdit = async (sessionId: string, messageId: string) => {
    const content = editingContent.trim();
    if (content || editingImageData) await editMessage(sessionId, messageId, content, editingImageData);
    cancelEdit();
  };

  const handleEditImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const dataUrl = await resizeImageToDataUrl(file);
    setEditingImageData(dataUrl);
    e.target.value = "";
  };

  const handleEditCorrectionRequest = async () => {
    if (!correctionEnabled || !activeModelPath) return;
    const selected = editingContent.slice(editSelStart, editSelEnd);
    if (!selected.trim()) return;

    if (editTextareaRef.current) {
      const rect = editTextareaRef.current.getBoundingClientRect();
      setEditCorrectionPos({ top: rect.top - 8, left: rect.left, width: rect.width });
    }

    const requestId = editCorrectionRequestIdRef.current + 1;
    editCorrectionRequestIdRef.current = requestId;
    setIsEditCorrectionLoading(true);
    setEditCorrection("");

    try {
      const r = await fetchCorrect(selected);
      if (requestId !== editCorrectionRequestIdRef.current) return;
      if (r.corrected && r.corrected !== selected) {
        setEditCorrection(r.corrected);
      }
    } catch {
      // ignore
    } finally {
      if (requestId === editCorrectionRequestIdRef.current) {
        setIsEditCorrectionLoading(false);
      }
    }
  };

  const applyEditCorrection = () => {
    const ta = editTextareaRef.current;
    if (!ta || !editCorrection) return;

    ta.focus();
    ta.setSelectionRange(editSelStart, editSelEnd);
    const ok = document.execCommand("insertText", false, editCorrection);
    if (!ok) {
      const nextContent = editingContent.slice(0, editSelStart) + editCorrection + editingContent.slice(editSelEnd);
      setEditingContent(nextContent);
    }
    const newCursor = editSelStart + editCorrection.length;
    setEditSelStart(newCursor);
    setEditSelEnd(newCursor);
    setEditCorrection("");
  };

  const cancelEditCorrection = () => {
    setEditCorrection("");
  };

  const handleCopy = (content: string) => {
    void navigator.clipboard.writeText(content);
  };

  const hasSelectedEditText = correctionEnabled && editSelStart !== editSelEnd && !!editingContent.slice(editSelStart, editSelEnd).trim();

  return (
    <section
      ref={chatViewRef}
      className="chat-view"
      onScroll={() => emitScrollState()}
    >
      {!editCorrection && editCorrectionPos && hasSelectedEditText && (
        <button
          type="button"
          className="composer-correction-trigger"
          style={{ top: editCorrectionPos.top, left: editCorrectionPos.left + editCorrectionPos.width - 76 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void handleEditCorrectionRequest()}
          disabled={isEditCorrectionLoading}
        >
          {isEditCorrectionLoading ? "校正中..." : "校正"}
        </button>
      )}
      {editCorrection && editCorrectionPos && (
        <div
          className="composer-correction-popup"
          style={{ top: editCorrectionPos.top, left: editCorrectionPos.left, width: editCorrectionPos.width }}
          aria-live="polite"
        >
          <span className="composer-correction-text">{editCorrection}</span>
          <div className="composer-correction-actions">
            <button
              type="button"
              className="composer-correction-action primary"
              onMouseDown={(e) => e.preventDefault()}
              onClick={applyEditCorrection}
            >
              置換
            </button>
            <button
              type="button"
              className="composer-correction-action"
              onMouseDown={(e) => e.preventDefault()}
              onClick={cancelEditCorrection}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
      {searchOpen && (
        <div className="chat-search-bar">
          <div className="chat-search-box">
            <input
              ref={searchInputRef}
              className="chat-search-input"
              type="text"
              placeholder="検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeSearch();
                if (e.key === "Enter") { e.shiftKey ? goPrev() : goNext(); }
              }}
            />
            <span className="chat-search-count">
              {matchedIds.length === 0
                ? (searchQuery ? "0件" : "")
                : `${matchIndex + 1}/${matchedIds.length}`}
            </span>
            <button className="chat-search-nav" onClick={goPrev} title="前へ (Shift+Enter)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
            <button className="chat-search-nav" onClick={goNext} title="次へ (Enter)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <button className="chat-search-close" onClick={closeSearch} title="閉じる (Esc)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
      )}
      <div className="message-stream">
        {messages.map((message, messageIndex) => {
          const isMatch = matchedIds.includes(message.id);
          const isCurrent = matchedIds[matchIndex] === message.id;
          const imageSrc = resolveApiUrl(message.image_data);
          const hasFollowingAssistant = message.role === "user" && messages[messageIndex + 1]?.role === "assistant";
          return (
          <article
            key={message.id}
            className={`message-card ${message.role}${editingId === message.id ? " editing" : ""}${isMatch ? " search-match" : ""}${isCurrent ? " search-current" : ""}`}
            ref={(el) => {
              if (el && isMatch) matchCardRefs.current.set(message.id, el);
              else matchCardRefs.current.delete(message.id);
              if (el && message.role === "user") userMessageRefs.current.set(message.id, el);
              else userMessageRefs.current.delete(message.id);
            }}
          >
            <div className="message-meta">
              <span>
                {message.role === "assistant"
                  ? (() => { const n = message.model_name ?? (isSubmitting ? modelName : null) ?? ""; return n ? `アシスタント (${n})` : "アシスタント"; })()
                  : message.role === "user" ? "ユーザー" : "システム"}
              </span>
              <time>
                {(() => {
                  const d = new Date(message.created_at);
                  const today = new Date();
                  const isToday = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
                  const isSameYear = d.getFullYear() === today.getFullYear();
                  return isToday
                    ? d.toLocaleTimeString("ja-JP", { hour: "numeric", minute: "2-digit" })
                    : isSameYear
                      ? d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })
                      : d.toLocaleString("ja-JP", { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
                })()}
              </time>
            </div>

            <div className="message-body">
              {editingId === message.id ? (
                <>
                  <input
                    ref={editImageInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => void handleEditImageChange(e)}
                  />
                  {editingImageData && (
                    <div className="edit-image-preview-row">
                      <img src={resolveApiUrl(editingImageData)} alt="添付画像" className="edit-image-preview-thumb" />
                      <button
                        type="button"
                        className="edit-image-preview-remove"
                        onClick={() => setEditingImageData(null)}
                        title="画像を削除"
                      >✕</button>
                    </div>
                  )}
                </>
              ) : message.image_data ? (
                <button
                  type="button"
                  className="message-image-button"
                  onClick={() => setExpandedImage(imageSrc)}
                  title="クリックで拡大"
                >
                  <img src={imageSrc} alt="添付画像" className="message-image" />
                </button>
              ) : null}
              {editingId === message.id ? (
                <textarea
                  ref={editTextareaRef}
                  className="message-edit-textarea"
                  value={editingContent}
                  onChange={(e) => {
                    setEditingContent(e.target.value);
                    resizeTextareaToContent(e.currentTarget);
                  }}
                  onSelect={(e) => {
                    const t = e.target as HTMLTextAreaElement;
                    setEditSelStart(t.selectionStart);
                    setEditSelEnd(t.selectionEnd);
                  }}
                  onClick={(e) => {
                    const t = e.target as HTMLTextAreaElement;
                    setEditSelStart(t.selectionStart);
                    setEditSelEnd(t.selectionEnd);
                  }}
                  onKeyUp={(e) => {
                    const t = e.target as HTMLTextAreaElement;
                    setEditSelStart(t.selectionStart);
                    setEditSelEnd(t.selectionEnd);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Tab" && editCorrection) {
                      e.preventDefault();
                      applyEditCorrection();
                      return;
                    }
                    if (e.key === "Escape" && editCorrection) {
                      e.preventDefault();
                      cancelEditCorrection();
                      return;
                    }
                    if (e.key === "Enter" && e.ctrlKey && session?.id) { e.preventDefault(); void commitEdit(session.id, message.id); }
                    if (e.key === "Escape") cancelEdit();
                  }}
                  rows={1}
                />
              ) : message.role === "user" ? (
                message.content
                  ? <p><HighlightText text={message.content} query={searchOpen ? searchQuery : ""} current={isCurrent} /></p>
                  : null
              ) : (() => {
                if (!message.content) {
                  return isSubmitting ? <p className="typing-cursor">▍</p> : null;
                }
                const { thinking, response, streaming } = parseThinking(message.content);
                return (
                  <>
                    {thinking != null && (
                      <details className="thinking-block" open={streaming || undefined}>
                        <summary className="thinking-summary">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="thinking-chevron">
                            <polyline points="9 18 15 12 9 6"/>
                          </svg>
                          {streaming ? "思考中..." : "思考の過程"}
                        </summary>
                        <div className="thinking-content">{thinking}</div>
                      </details>
                    )}
                    {response
                      ? <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={searchOpen && searchQuery.trim() ? [makeHighlightPlugin(searchQuery, isCurrent)] : []}>{response}</ReactMarkdown>
                      : streaming && isSubmitting ? <p className="typing-cursor">▍</p> : null}
                  </>
                );
              })()}
            </div>

            {message.role === "assistant" && message.elapsed_seconds != null && (
              <div className="message-stats">
                {/* tok/sec */}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
                <span>{message.tokens_per_second?.toFixed(1)} tok/sec</span>
                <span className="message-stats-sep">·</span>
                {/* tokens */}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <span>{(message.completion_tokens ?? 0).toLocaleString()} tokens</span>
                <span className="message-stats-sep">·</span>
                {/* elapsed */}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <span>{message.elapsed_seconds.toFixed(2)}s</span>
                {message.finish_reason && (
                  <>
                    <span className="message-stats-sep">·</span>
                    <span>Finish reason: {message.finish_reason}</span>
                  </>
                )}
              </div>
            )}

            {editingId === message.id && (
              <div className="message-edit-buttons">
                <button className="message-edit-discard" onClick={cancelEdit}>Discard (Esc)</button>
                <button
                  type="button"
                  className="message-edit-attach-image"
                  title="画像を添付"
                  onClick={() => editImageInputRef.current?.click()}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                  </svg>
                </button>
                <button className="message-edit-save" onClick={() => { if (session?.id) void commitEdit(session.id, message.id); }}>Save (Ctrl + Enter)</button>
              </div>
            )}

            {editingId !== message.id && !tempChatMode && (
              <div className="message-actions">
                {/* Branch */}
                <button
                  className="msg-action-btn"
                  title="ここで分岐"
                  onClick={() => { if (session?.id) void branchSession(session.id, message.id); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
                    <path d="M18 9a9 9 0 0 1-9 9"/>
                  </svg>
                </button>
                {/* Copy */}
                <button
                  className="msg-action-btn"
                  title="コピー"
                  onClick={() => handleCopy(message.content)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </button>
                {/* Edit (user only) */}
                {message.role === "user" && (
                  <button
                    className="msg-action-btn"
                    title="編集"
                    onClick={() => startEdit(message.id, message.content, message.image_data ?? null)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                )}
                {hasFollowingAssistant && (
                  <button
                    className="msg-action-btn"
                    title="再生成"
                    onClick={() => { if (session?.id) void regenerateMessage(session.id, message.id); }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"/>
                    </svg>
                  </button>
                )}
                {/* Delete */}
                <button
                  className="msg-action-btn danger"
                  title="削除"
                  onClick={() => { if (session?.id) void deleteMessage(session.id, message.id); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                  </svg>
                </button>
              </div>
            )}
          </article>
          );
        })}
        {!tempChatMode && !isSubmitting && messages.length > 0 && messages[messages.length - 1].role === "user" && session && (
          <div className="generate-response-wrap">
            <button
              className="generate-response-btn"
              onClick={() => void continueGeneration(session.id)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              Generate AI Response
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      {expandedImage && (
        <div className="image-lightbox" onClick={() => setExpandedImage(null)} role="dialog" aria-modal="true" aria-label="画像の拡大表示">
          <button
            type="button"
            className="image-lightbox-close"
            onClick={() => setExpandedImage(null)}
            aria-label="閉じる"
          >
            ×
          </button>
          <img
            src={expandedImage}
            alt="拡大画像"
            className="image-lightbox-content"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      </div>
    </section>
  );
}
