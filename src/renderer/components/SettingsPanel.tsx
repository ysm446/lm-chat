import { useEffect, useState } from "react";
import { fetchMemoryStats, getConfig, updateConfig } from "../api";
import { useChatStore } from "../stores/chatStore";

type MemoryStats = {
  workspace_count: number;
  session_count: number;
  memory_chunk_count: number;
};

export function SettingsPanel() {
  const currentWorkspace = useChatStore((state) => state.currentWorkspace());

  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [ctxSize, setCtxSize] = useState<number>(32768);
  const [ctxInput, setCtxInput] = useState<string>("32768");
  const [ctxSaving, setCtxSaving] = useState(false);
  const [ctxSaved, setCtxSaved] = useState(false);

  // Load config on mount
  useEffect(() => {
    getConfig()
      .then((cfg) => {
        setCtxSize(cfg.ctx_size);
        setCtxInput(String(cfg.ctx_size));
      })
      .catch(() => {});
  }, []);

  // Load memory stats when workspace changes
  useEffect(() => {
    fetchMemoryStats()
      .then(setStats)
      .catch(() => {});
  }, [currentWorkspace?.id]);

  const handleSaveCtx = async () => {
    const val = parseInt(ctxInput, 10);
    if (isNaN(val) || val < 512) return;
    setCtxSaving(true);
    try {
      const cfg = await updateConfig({ ctx_size: val });
      setCtxSize(cfg.ctx_size);
      setCtxSaved(true);
      setTimeout(() => setCtxSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setCtxSaving(false);
    }
  };

  return (
    <div className="settings-stack">
      {/* Context size setting */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">モデル設定</p>
            <h2>コンテキスト長</h2>
          </div>
        </div>
        <div className="field">
          <span>最大トークン数 (--ctx-size)</span>
          <div className="ctx-input-row">
            <input
              type="number"
              min={512}
              max={131072}
              step={1024}
              value={ctxInput}
              onChange={(e) => setCtxInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleSaveCtx(); }}
            />
            <button
              className="primary-button small"
              onClick={() => void handleSaveCtx()}
              disabled={ctxSaving || parseInt(ctxInput, 10) === ctxSize}
            >
              {ctxSaved ? "保存済" : ctxSaving ? "…" : "保存"}
            </button>
          </div>
          <p className="muted" style={{ fontSize: "11px" }}>
            変更はアプリ再起動後に反映されます
          </p>
        </div>
        <div className="stat-list" style={{ marginTop: 4 }}>
          <div className="stat-row">
            <span>現在の設定</span>
            <code>{ctxSize.toLocaleString()} トークン</code>
          </div>
        </div>
      </section>

      {/* System info */}
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

      {/* Memory stats */}
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
    </div>
  );
}
