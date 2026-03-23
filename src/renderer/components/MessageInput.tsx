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
        <textarea
          placeholder="メッセージを入力..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          rows={2}
          disabled={isSubmitting}
        />
        <button className="primary-button" onClick={() => void handleSend()} disabled={isSubmitting}>
          {isSubmitting ? "受信中" : "送信"}
        </button>
      </div>

      <div className="status-row">
        <span className="pill">Web検索: オフ</span>
        <span className="pill">記憶: オン</span>
        <span className="pill">思考モード: オフ</span>
      </div>
    </section>
  );
}