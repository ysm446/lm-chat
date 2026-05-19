import { useEffect, useState } from "react";
import type { ApiMessage as Message, MessagePromptLog, PromptLogContentPart } from "../../api";
import { getMessagePromptLog } from "../../api";

function formatPromptRole(role: string) {
  if (role === "system" || role === "user" || role === "assistant") return role;
  return role;
}

function formatPromptContent(content: string | PromptLogContentPart[]) {
  if (typeof content === "string") return content;
  return content.map((item) => {
    if ("type" in item && item.type === "text") return `[text]\n${item.text ?? ""}`;
    if ("type" in item && item.type === "image_url") {
      const image = item.image_url;
      const url = typeof image === "string"
        ? image
        : (image && typeof image === "object" && "url" in image && typeof image.url === "string" ? image.url : "");
      return `[image_url]\n${url}`;
    }
    return JSON.stringify(item, null, 2);
  }).join("\n");
}

interface Props {
  messageId: string;
  targetMessage: Message | null;
  onClose: () => void;
}

export function PromptLogModal({ messageId, targetMessage, onClose }: Props) {
  const [promptLog, setPromptLog] = useState<MessagePromptLog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getMessagePromptLog(messageId)
      .then((data) => { if (!cancelled) setPromptLog(data); })
      .catch((err) => { if (!cancelled) { setPromptLog(null); setError(err instanceof Error ? err.message : "プロンプト全文を取得できませんでした"); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [messageId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="プロンプト全文">
      <div className="prompt-log-modal" onClick={(e) => e.stopPropagation()}>
        <div className="prompt-log-header">
          <div>
            <h2>送信直前の messages</h2>
            <p>この assistant 生成時に LLM へ渡した入力一式です。</p>
            {targetMessage?.prompt_tokens != null && (
              <p>Prompt tokens: {targetMessage.prompt_tokens.toLocaleString()}</p>
            )}
          </div>
          <button type="button" className="model-picker-close" onClick={onClose} aria-label="閉じる">✕</button>
        </div>
        <div className="prompt-log-body">
          {loading ? (
            <p className="prompt-log-status">読み込み中...</p>
          ) : error ? (
            <p className="error-text" style={{ margin: 0 }}>{error}</p>
          ) : promptLog ? (
            <div className="prompt-log-list">
              {promptLog.messages.map((entry, index) => (
                <article key={`${entry.role}-${index}`} className="prompt-log-card">
                  <div className="prompt-log-meta">
                    <strong>{formatPromptRole(entry.role)}</strong>
                    <span>#{index}</span>
                  </div>
                  <pre className="prompt-log-pre">{formatPromptContent(entry.content)}</pre>
                </article>
              ))}
            </div>
          ) : (
            <p className="prompt-log-status">保存済みプロンプトはありません。</p>
          )}
        </div>
      </div>
    </div>
  );
}
