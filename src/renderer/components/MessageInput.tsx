import { useState } from "react";
import { useChatStore } from "../stores/chatStore";

export function MessageInput() {
  const [value, setValue] = useState("");
  const sendMessage = useChatStore((state) => state.sendMessage);
  const currentSessionId = useChatStore((state) => state.currentSessionId);
  const isSubmitting = useChatStore((state) => state.isSubmitting);

  const handleSend = async () => {
    if (!currentSessionId || !value.trim()) return;
    const text = value.trim();
    setValue("");
    await sendMessage(currentSessionId, text);
  };

  return (
    <section className="input-shell">
      <div className="composer">
        <button className="ghost-button">Attach</button>
        <textarea
          placeholder="Type your message..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={3}
          disabled={isSubmitting}
        />
        <button className="primary-button" onClick={() => void handleSend()} disabled={isSubmitting}>
          {isSubmitting ? "Streaming" : "Send"}
        </button>
      </div>

      <div className="status-row">
        <span className="pill">Web Search: Off</span>
        <span className="pill">Memory: On</span>
        <span className="pill">Reasoning: Off</span>
      </div>
    </section>
  );
}