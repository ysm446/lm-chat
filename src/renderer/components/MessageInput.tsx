import { useEffect, useRef, useState } from "react";
import { getConfig, getSessionTokenCount } from "../api";
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

export function MessageInput() {
  const [value, setValue] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageFileName, setImageFileName] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sendMessage = useChatStore((state) => state.sendMessage);
  const currentSessionId = useChatStore((state) => state.currentSessionId);
  const isSubmitting = useChatStore((state) => state.isSubmitting);
  const memoryEnabled = useChatStore((state) => state.memoryEnabled);
  const toggleMemory = useChatStore((state) => state.toggleMemory);
  const thinkingEnabled = useChatStore((state) => state.thinkingEnabled);
  const toggleThinking = useChatStore((state) => state.toggleThinking);

  const [tokenCount, setTokenCount] = useState<number | null>(null);
  const [ctxSize, setCtxSize] = useState(32768);

  useEffect(() => {
    getConfig().then((c) => setCtxSize(c.ctx_size)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!currentSessionId || isSubmitting) return;
    getSessionTokenCount(currentSessionId)
      .then((r) => { setTokenCount(r.token_count); setCtxSize(r.ctx_size); })
      .catch(() => {});
  }, [currentSessionId, isSubmitting]);

  const usagePct = tokenCount !== null ? Math.min((tokenCount / ctxSize) * 100, 100) : null;
  const ringColor =
    usagePct === null ? "var(--border-strong)"
    : usagePct >= 90  ? "#ef4444"
    : usagePct >= 70  ? "#f59e0b"
    : "var(--accent)";
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = usagePct !== null ? circumference * (1 - usagePct / 100) : circumference;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setImageData(dataUrl);
      setImageFileName(file.name);
    } catch {
      // ignore
    }
  };

  const handleSend = async () => {
    if (!currentSessionId) return;
    if (!value.trim() && !imageData) return;
    const text = value.trim();
    const img = imageData;
    setValue("");
    setImageData(null);
    setImageFileName("");
    await sendMessage(currentSessionId, text, img);
  };

  return (
    <section className="input-shell">
      {imageData && (
        <div className="image-preview-row">
          <img src={imageData} alt={imageFileName} className="image-preview-thumb" />
          <span className="image-preview-name">{imageFileName}</span>
          <button
            className="image-preview-remove"
            onClick={() => { setImageData(null); setImageFileName(""); }}
            title="画像を削除"
          >
            ✕
          </button>
        </div>
      )}
      <div className="composer">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => void handleFileChange(e)}
        />
        <button
          className="ghost-button attach-button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isSubmitting}
          title="画像を添付"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </button>
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
        <button className="primary-button" onClick={() => void handleSend()} disabled={isSubmitting || (!value.trim() && !imageData)}>
          {isSubmitting ? "受信中" : "送信"}
        </button>
      </div>

      <div className="status-row">
        <span className="pill">Web検索: オフ</span>
        <button
          className={`pill pill-toggle ${memoryEnabled ? "active" : ""}`}
          onClick={toggleMemory}
          title={memoryEnabled ? "記憶をオフにする" : "記憶をオンにする"}
        >
          記憶: {memoryEnabled ? "オン" : "オフ"}
        </button>
        <button
          className={`pill pill-toggle ${thinkingEnabled ? "active" : ""}`}
          onClick={toggleThinking}
          title={thinkingEnabled ? "思考モードをオフにする" : "思考モードをオンにする"}
        >
          思考モード: {thinkingEnabled ? "オン" : "オフ"}
        </button>

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
      </div>
    </section>
  );
}