import { useEffect, useState } from "react";
import { fetchMemoryStats } from "../api";
import { useChatStore } from "../stores/chatStore";

type MemoryStats = {
  workspace_count: number;
  session_count: number;
  memory_chunk_count: number;
};

export function SettingsPanel() {
  const currentWorkspace = useChatStore((state) => state.currentWorkspace());
  const [stats, setStats] = useState<MemoryStats | null>(null);

  useEffect(() => {
    fetchMemoryStats()
      .then(setStats)
      .catch(() => {});
  }, [currentWorkspace?.id]);

  return (
    <div className="settings-stack">
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">システム</p>
            <h2>実行環境</h2>
          </div>
        </div>
        <div className="stat-list">
          <div className="stat-row">
            <span>推論サーバー</span>
            <code>llama-server</code>
          </div>
          <div className="stat-row">
            <span>埋め込みモデル</span>
            <code>ruri-v3-310m</code>
          </div>
          <div className="stat-row">
            <span>記憶検索</span>
            <strong>FTS5 + ベクトル</strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">記憶</p>
            <h2>統計</h2>
          </div>
        </div>
        {stats ? (
          <div className="stat-list">
            <div className="stat-row">
              <span>ワークスペース数</span>
              <strong>{stats.workspace_count}</strong>
            </div>
            <div className="stat-row">
              <span>セッション数</span>
              <strong>{stats.session_count}</strong>
            </div>
            <div className="stat-row">
              <span>記憶チャンク数</span>
              <strong>{stats.memory_chunk_count}</strong>
            </div>
          </div>
        ) : (
          <p className="muted">読み込み中…</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">ワークスペース</p>
            <h2>記憶ポリシー</h2>
          </div>
        </div>
        <ul className="simple-list">
          <li>チャット・履歴・記憶は同一ワークスペース内に保持</li>
          <li>他ワークスペースの記憶は参照しない</li>
          <li>新規チャットは現在のワークスペースに作成</li>
        </ul>
      </section>
    </div>
  );
}
