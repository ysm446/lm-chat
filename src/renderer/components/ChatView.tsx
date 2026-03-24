import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChatStore } from "../stores/chatStore";

export function ChatView() {
  const session = useChatStore((state) => state.currentSession());
  const isSubmitting = useChatStore((state) => state.isSubmitting);
  const selectedModel = useChatStore((state) => state.selectedModel);
  const deleteMessage = useChatStore((state) => state.deleteMessage);
  const editMessage = useChatStore((state) => state.editMessage);
  const branchSession = useChatStore((state) => state.branchSession);
  const modelName = selectedModel ?? session?.model_name ?? "";
  const bottomRef = useRef<HTMLDivElement>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages.length, isSubmitting]);

  useEffect(() => {
    if (editingId) editTextareaRef.current?.focus();
  }, [editingId]);

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
      <div className="message-stream">
        {session?.messages.map((message) => (
          <article key={message.id} className={`message-card ${message.role}`}>
            <div className="message-meta">
              <span>
                {message.role === "assistant"
                  ? modelName ? `アシスタント (${modelName})` : "アシスタント"
                  : message.role === "user" ? "ユーザー" : "システム"}
              </span>
              <time>
                {new Date(message.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
              </time>
            </div>

            <div className="message-body">
              {message.image_data && (
                <img src={message.image_data} alt="添付画像" className="message-image" />
              )}
              {editingId === message.id ? (
                <div className="message-edit-area">
                  <textarea
                    ref={editTextareaRef}
                    className="message-edit-textarea"
                    value={editingContent}
                    onChange={(e) => setEditingContent(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void commitEdit(session.id, message.id); }
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    rows={3}
                  />
                  <div className="message-edit-buttons">
                    <button className="primary-button small" onClick={() => void commitEdit(session.id, message.id)}>保存</button>
                    <button className="ghost-button" onClick={() => setEditingId(null)}>キャンセル</button>
                  </div>
                </div>
              ) : (
                message.content ? (
                  message.role === "user" ? (
                    <p>{message.content}</p>
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                  )
                ) : isSubmitting && message.role === "assistant" ? (
                  <p className="typing-cursor">▍</p>
                ) : null
              )}
            </div>

            {editingId !== message.id && (
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
        ))}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
