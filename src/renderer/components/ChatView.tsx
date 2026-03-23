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
              <span>{message.role === "assistant" ? "Assistant" : message.role === "user" ? "User" : "System"}</span>
              <small>{message.created_at}</small>
            </div>
            <p>{message.content || (isSubmitting && message.role === "assistant" ? "..." : "")}</p>
          </article>
        ))}
      </div>
    </section>
  );
}