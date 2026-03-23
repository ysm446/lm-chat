import { useChatStore } from "../stores/chatStore";

export function ChatView() {
  const session = useChatStore((state) => state.currentSession());
  const isSubmitting = useChatStore((state) => state.isSubmitting);

  return (
    <section className="chat-view">
      <div className="message-stream">
        {session?.messages.map((message) => (
          <article key={message.id} className={`message-card ${message.role}`}>
            <div className="message-meta">
              <span>{message.role === "assistant" ? "アシスタント" : message.role === "user" ? "ユーザー" : "システム"}</span>
              <time>{new Date(message.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</time>
            </div>
            <p>{message.content || (isSubmitting && message.role === "assistant" ? "▍" : "")}</p>
          </article>
        ))}
      </div>
    </section>
  );
}