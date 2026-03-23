import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChatStore } from "../stores/chatStore";

export function ChatView() {
  const session = useChatStore((state) => state.currentSession());
  const isSubmitting = useChatStore((state) => state.isSubmitting);
  const selectedModel = useChatStore((state) => state.selectedModel);
  const modelName = selectedModel ?? session?.model_name ?? "";
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages.length, isSubmitting]);

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
              {message.content ? (
                message.role === "user" ? (
                  <p>{message.content}</p>
                ) : (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                )
              ) : isSubmitting && message.role === "assistant" ? (
                <p className="typing-cursor">▍</p>
              ) : null}
            </div>
          </article>
        ))}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
