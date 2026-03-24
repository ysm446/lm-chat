import { useEffect, useState } from "react";
import { fetchMemoryStats, getConfig, getLlamaProps, updateConfig } from "../api";
import { useChatStore } from "../stores/chatStore";

type MemoryStats = {
  workspace_count: number;
  session_count: number;
  memory_chunk_count: number;
};

export function SettingsPanel() {
  const currentWorkspace = useChatStore((state) => state.currentWorkspace());
  const activeModelPath = useChatStore((state) => state.activeModelPath);

  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [ctxSize, setCtxSize] = useState(32768);
  const [nGpuLayers, setNGpuLayers] = useState(-1);
  const [modelMaxCtx, setModelMaxCtx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    getConfig()
      .then((cfg) => {
        setCtxSize(cfg.ctx_size);
        setNGpuLayers(cfg.n_gpu_layers);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    getLlamaProps()
      .then((props) => { if (props.n_ctx) setModelMaxCtx(props.n_ctx); })
      .catch(() => {});
  }, [activeModelPath]);

  useEffect(() => {
    fetchMemoryStats().then(setStats).catch(() => {});
  }, [currentWorkspace?.id]);

  const handleSave = async (patch: { ctx_size?: number; n_gpu_layers?: number }) => {
    setSaving(true);
    try {
      const cfg = await updateConfig(patch);
      setCtxSize(cfg.ctx_size);
      setNGpuLayers(cfg.n_gpu_layers);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  };

  const ctxMax = modelMaxCtx ?? 131072;
  const gpuMax = 100;

  return (
    <div className="settings-stack">
      {/* Context and Offload */}
      <section className="settings-section">
        <button className="settings-section-header" onClick={() => setContextOpen((v) => !v)}>
          <span className="settings-section-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07M8.46 8.46a5 5 0 0 0 0 7.07"/>
            </svg>
          </span>
          <span>Context and Offload</span>
          <svg className={`settings-chevron${contextOpen ? " open" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {contextOpen && (
          <div className="settings-section-body">
            {/* Context Length */}
            <div className="settings-field">
              <div className="settings-field-header">
                <span className="settings-field-label">Context Length</span>
                <input
                  className="settings-number-input"
                  type="number"
                  min={512}
                  max={ctxMax}
                  step={1024}
                  value={ctxSize}
                  onChange={(e) => setCtxSize(Number(e.target.value))}
                  onBlur={() => void handleSave({ ctx_size: ctxSize })}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleSave({ ctx_size: ctxSize }); }}
                />
              </div>
              {modelMaxCtx && (
                <p className="settings-field-hint">
                  Model supports up to <code>{modelMaxCtx.toLocaleString()}</code> tokens
                </p>
              )}
              <input
                className="settings-slider"
                type="range"
                min={512}
                max={ctxMax}
                step={1024}
                value={ctxSize}
                onChange={(e) => setCtxSize(Number(e.target.value))}
                onMouseUp={() => void handleSave({ ctx_size: ctxSize })}
              />
            </div>

            {/* GPU Offload */}
            <div className="settings-field">
              <div className="settings-field-header">
                <span className="settings-field-label">GPU Offload</span>
                <input
                  className="settings-number-input"
                  type="number"
                  min={-1}
                  max={gpuMax}
                  value={nGpuLayers}
                  onChange={(e) => setNGpuLayers(Number(e.target.value))}
                  onBlur={() => void handleSave({ n_gpu_layers: nGpuLayers })}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleSave({ n_gpu_layers: nGpuLayers }); }}
                />
              </div>
              <p className="settings-field-hint">-1 = 全レイヤーをGPUへ。次回モデルロード時に反映</p>
              <input
                className="settings-slider"
                type="range"
                min={-1}
                max={gpuMax}
                value={nGpuLayers}
                onChange={(e) => setNGpuLayers(Number(e.target.value))}
                onMouseUp={() => void handleSave({ n_gpu_layers: nGpuLayers })}
              />
            </div>

            {saved && <p className="settings-saved-msg">保存しました</p>}
            {saving && <p className="settings-saved-msg">保存中…</p>}
          </div>
        )}
      </section>

      {/* Advanced */}
      <section className="settings-section">
        <button className="settings-section-header" onClick={() => setAdvancedOpen((v) => !v)}>
          <span className="settings-section-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 6 20 6"/><polyline points="4 12 20 12"/><polyline points="4 18 14 18"/>
            </svg>
          </span>
          <span>Advanced</span>
          <svg className={`settings-chevron${advancedOpen ? " open" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {advancedOpen && (
          <div className="settings-section-body">
            <div className="stat-list">
              <div className="stat-row"><span>推論サーバー</span><code>llama-server</code></div>
              <div className="stat-row"><span>埋め込みモデル</span><code>ruri-v3-310m</code></div>
              <div className="stat-row"><span>記憶検索</span><strong>FTS5 + ベクトル</strong></div>
            </div>
            {stats && (
              <div className="stat-list" style={{ marginTop: 8 }}>
                <div className="stat-row"><span>ワークスペース</span><strong>{stats.workspace_count}</strong></div>
                <div className="stat-row"><span>セッション</span><strong>{stats.session_count}</strong></div>
                <div className="stat-row"><span>記憶チャンク</span><strong>{stats.memory_chunk_count}</strong></div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
