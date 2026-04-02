import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChatStore } from "../stores/chatStore";

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
  const selectedModel = useChatStore((state) => state.selectedModel);
  const deleteMessage = useChatStore((state) => state.deleteMessage);
  const editMessage = useChatStore((state) => state.editMessage);
  const branchSession = useChatStore((state) => state.branchSession);
  const tempChatMode = useChatStore((state) => state.tempChatMode);
  const tempMessages = useChatStore((state) => state.tempMessages);
  const continueGeneration = useChatStore((state) => state.continueGeneration);
  const modelName = selectedModel ?? session?.model_name ?? "";
  const messages = tempChatMode ? tempMessages : (session?.messages ?? []);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages.length, isSubmitting]);

  useEffect(() => {
    if (!editingId) return;
    resizeTextareaToContent(editTextareaRef.current);
    editTextareaRef.current?.focus();
  }, [editingContent, editingId]);

  const startEdit = (messageId: string, content: string) => {
    setEditingId(messageId);
    setEditingContent(content);
  };

  const commitEdit = async (sessionId: string, messageId: string) => {
    const content = editingContent.trim();
    if (content) await editMessage(sessionId, messageId, content);
    setEditingId(null);
  };

  const handleCopy = (content: string) => {
    void navigator.clipboard.writeText(content);
  };

  return (
    <section className="chat-view">
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
        {messages.map((message) => {
          const isMatch = matchedIds.includes(message.id);
          const isCurrent = matchedIds[matchIndex] === message.id;
          return (
          <article
            key={message.id}
            className={`message-card ${message.role}${editingId === message.id ? " editing" : ""}${isMatch ? " search-match" : ""}${isCurrent ? " search-current" : ""}`}
            ref={(el) => {
              if (el && isMatch) matchCardRefs.current.set(message.id, el);
              else matchCardRefs.current.delete(message.id);
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
              {message.image_data && (
                <img src={message.image_data} alt="添付画像" className="message-image" />
              )}
              {editingId === message.id ? (
                <textarea
                  ref={editTextareaRef}
                  className="message-edit-textarea"
                  value={editingContent}
                  onChange={(e) => {
                    setEditingContent(e.target.value);
                    resizeTextareaToContent(e.currentTarget);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); void commitEdit(session.id, message.id); }
                    if (e.key === "Escape") setEditingId(null);
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
                <button className="message-edit-discard" onClick={() => setEditingId(null)}>Discard (Esc)</button>
                <button className="message-edit-save" onClick={() => void commitEdit(session.id, message.id)}>Save (Ctrl + Enter)</button>
              </div>
            )}

            {editingId !== message.id && !tempChatMode && (
              <div className="message-actions">
                {/* Branch */}
                <button
                  className="msg-action-btn"
                  title="ここで分岐"
                  onClick={() => void branchSession(session.id, message.id)}
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
                    onClick={() => startEdit(message.id, message.content)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                )}
                {/* Delete */}
                <button
                  className="msg-action-btn danger"
                  title="削除"
                  onClick={() => void deleteMessage(session.id, message.id)}
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
      </div>
    </section>
  );
}
