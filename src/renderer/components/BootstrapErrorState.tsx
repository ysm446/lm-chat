import { useEffect, useState } from "react";
import { getLibraryState } from "../api";
import { useChatStore } from "../stores/chatStore";

/**
 * 起動時のデータ取得に失敗したときの画面。
 *
 * 失敗を「データが空」と混同すると、既存ライブラリがあるのに新規ワークスペース
 * 作成画面が出てしまうため、明確にエラーとして見せて再試行させる。
 */
export function BootstrapErrorState() {
  const bootstrap = useChatStore((state) => state.bootstrap);
  const error = useChatStore((state) => state.error);
  const [activePath, setActivePath] = useState<string>("");
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    getLibraryState().then((s) => setActivePath(s.active)).catch(() => setActivePath(""));
  }, []);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await bootstrap();
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div className="empty-shell">
      <div className="empty-card">
        <p className="eyebrow">LM Chat</p>
        <h1>データを読み込めませんでした</h1>
        <p className="muted">
          バックエンドからワークスペースを取得できませんでした。データが消えたわけではありません。
          バックエンド（LM Chat Backend ウィンドウ）が起動しているか確認してから再試行してください。
        </p>

        {activePath && (
          <p className="muted">
            現在のライブラリ: <code>{activePath}</code>
          </p>
        )}

        {error && <p className="error-text">{error}</p>}

        <button className="primary-button" onClick={() => void handleRetry()} disabled={isRetrying}>
          {isRetrying ? "再試行中…" : "再試行"}
        </button>
      </div>
    </div>
  );
}
