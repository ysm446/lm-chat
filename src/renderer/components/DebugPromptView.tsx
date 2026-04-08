import { useEffect, useState } from "react";
import { clearDebugPromptLogs, DebugPromptLogEntry, getDebugPromptLogs } from "../api";

type Props = {
  enabled: boolean;
  active: boolean;
};

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function DebugPromptView({ enabled, active }: Props) {
  const [items, setItems] = useState<DebugPromptLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !enabled) {
      setLoading(false);
      setClearing(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      if (!cancelled) setLoading(true);
      try {
        const data = await getDebugPromptLogs(120);
        if (cancelled) return;
        setItems(data.items);
        setError(null);
      } catch (fetchError) {
        if (cancelled) return;
        setError(fetchError instanceof Error ? fetchError.message : "ログを取得できませんでした");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(() => { void load(); }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active, enabled]);

  const handleClear = async () => {
    if (clearing || items.length === 0) return;
    setClearing(true);
    try {
      await clearDebugPromptLogs();
      setItems([]);
      setError(null);
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "ログをクリアできませんでした");
    } finally {
      setClearing(false);
    }
  };

  if (!enabled) {
    return (
      <section className="debug-view">
        <div className="debug-view-empty">
          <h2>デバッグビュー</h2>
          <p>右メニューの `Debug` で `プロンプトログ出力` をオンにすると、ここに llama-server 送信前のプロンプトが表示されます。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="debug-view">
      <div className="debug-view-header">
        <div>
          <h2>デバッグビュー</h2>
          <p>llama-server に送る直前のプロンプトログを表示しています。</p>
        </div>
        <div className="debug-view-actions">
          <span className={`debug-view-status${loading ? " loading" : ""}`}>
            {`${items.length}件`}
          </span>
          <button
            type="button"
            className="debug-clear-btn"
            onClick={() => void handleClear()}
            disabled={clearing || items.length === 0}
          >
            {clearing ? "クリア中..." : "クリア"}
          </button>
        </div>
      </div>
      {error ? <p className="error-text" style={{ margin: "0 0 12px" }}>{error}</p> : null}
      {items.length === 0 ? (
        <div className="debug-view-empty">
          <h2>まだログはありません</h2>
          <p>メッセージ送信後に、ここへ最新のプロンプトログが追加されます。</p>
        </div>
      ) : (
        <div className="debug-log-list">
          {items.slice().reverse().map((item) => (
            <article key={item.id} className="debug-log-card">
              <div className="debug-log-meta">
                <strong>{item.label}</strong>
                <time>{formatTimestamp(item.created_at)}</time>
              </div>
              <pre className="debug-log-pre">{item.content}</pre>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}