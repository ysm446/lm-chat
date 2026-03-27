import { useEffect, useRef, useState } from "react";
import { SavedSystemPrompt, countTokens, createSystemPrompt, deleteSystemPrompt, fetchMemoryStats, getConfig, getLlamaProps, listSystemPrompts, updateConfig } from "../api";
import { useChatStore } from "../stores/chatStore";

type MemoryStats = {
  workspace_count: number;
  session_count: number;
  memory_chunk_count: number;
};

export function SettingsPanel() {
  const currentWorkspace = useChatStore((state) => state.currentWorkspace());
  const activeModelPath = useChatStore((state) => state.activeModelPath);
  const systemPromptText = useChatStore((state) => state.systemPromptText);
  const setSystemPromptText = useChatStore((state) => state.setSystemPromptText);

  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [ctxSize, setCtxSize] = useState(32768);
  const [nGpuLayers, setNGpuLayers] = useState(-1);
  const [modelMaxCtx, setModelMaxCtx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [systemPromptOpen, setSystemPromptOpen] = useState(false);

  // System prompt state
  const [savedPrompts, setSavedPrompts] = useState<SavedSystemPrompt[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string>("");
  const [tokenCount, setTokenCount] = useState<number | null>(null);
  const tokenDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [namingMode, setNamingMode] = useState(false);
  const [pendingName, setPendingName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getConfig()
      .then((cfg) => {
        setCtxSize(cfg.ctx_size);
        setNGpuLayers(cfg.n_gpu_layers);
      })
      .catch(() => {});
    listSystemPrompts()
      .then((data) => setSavedPrompts(data.prompts))
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

  // トークンカウントをデバウンス更新
  useEffect(() => {
    if (tokenDebounceRef.current) clearTimeout(tokenDebounceRef.current);
    if (!systemPromptText) {
      setTokenCount(null);
      return;
    }
    tokenDebounceRef.current = setTimeout(() => {
      countTokens(systemPromptText)
        .then((r) => setTokenCount(r.token_count))
        .catch(() => setTokenCount(Math.round(systemPromptText.length / 2)));
    }, 500);
    return () => {
      if (tokenDebounceRef.current) clearTimeout(tokenDebounceRef.current);
    };
  }, [systemPromptText]);

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

  const handleSelectPrompt = (id: string) => {
    setSelectedPromptId(id);
    if (!id) {
      setSystemPromptText("");
    } else {
      const prompt = savedPrompts.find((p) => p.id === id);
      if (prompt) setSystemPromptText(prompt.content);
    }
  };

  const handleStartNaming = () => {
    setPendingName("");
    setNamingMode(true);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  };

  const handleConfirmName = async () => {
    if (!pendingName.trim()) { setNamingMode(false); return; }
    try {
      const newPrompt = await createSystemPrompt(pendingName.trim(), systemPromptText);
      setSavedPrompts((prev) => [...prev, newPrompt]);
      setSelectedPromptId(newPrompt.id);
    } catch { /* ignore */ }
    setNamingMode(false);
    setPendingName("");
  };

  const handleDeletePrompt = async () => {
    if (!selectedPromptId) return;
    try {
      await deleteSystemPrompt(selectedPromptId);
      setSavedPrompts((prev) => prev.filter((p) => p.id !== selectedPromptId));
      setSelectedPromptId("");
    } catch { /* ignore */ }
  };

  const handleTextareaChange = (value: string) => {
    setSystemPromptText(value);
    // テキストが保存済みプロンプトと一致しなければ選択解除
    const match = savedPrompts.find((p) => p.content === value);
    setSelectedPromptId(match?.id ?? "");
  };

  const ctxMax = modelMaxCtx ?? 131072;
  const gpuMax = 100;

  return (
    <div className="settings-stack">
      {/* System Prompt */}
      <section className="settings-section">
        <button className="settings-section-header" onClick={() => setSystemPromptOpen((v) => !v)}>
          <span className="settings-section-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </span>
          <span>System Prompt</span>
          {systemPromptText && (
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", marginLeft: 4, flexShrink: 0 }} />
          )}
          <svg className={`settings-chevron${systemPromptOpen ? " open" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {systemPromptOpen && (
          <div className="settings-section-body">
            {namingMode ? (
              <div className="sys-prompt-toolbar">
                <input
                  ref={nameInputRef}
                  className="sys-prompt-name-input"
                  type="text"
                  placeholder="プロンプト名"
                  value={pendingName}
                  onChange={(e) => setPendingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleConfirmName();
                    if (e.key === "Escape") { setNamingMode(false); setPendingName(""); }
                  }}
                />
                <button className="sys-prompt-icon-btn" title="保存" onClick={() => void handleConfirmName()}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </button>
                <button className="sys-prompt-icon-btn" title="キャンセル" onClick={() => { setNamingMode(false); setPendingName(""); }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            ) : (
              <div className="sys-prompt-toolbar">
                <select
                  className="sys-prompt-select"
                  value={selectedPromptId}
                  onChange={(e) => handleSelectPrompt(e.target.value)}
                >
                  <option value="">-- プロンプトを選択 --</option>
                  {savedPrompts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button
                  className="sys-prompt-icon-btn"
                  title="現在のテキストを保存"
                  onClick={handleStartNaming}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                </button>
                <button
                  className="sys-prompt-icon-btn danger"
                  title="選択中のプロンプトを削除"
                  onClick={() => void handleDeletePrompt()}
                  disabled={!selectedPromptId}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              </div>
            )}
            <textarea
              className="sys-prompt-textarea"
              value={systemPromptText}
              onChange={(e) => handleTextareaChange(e.target.value)}
              placeholder="システムプロンプトを入力してください…"
              spellCheck={false}
            />
            <div className="sys-prompt-footer">
              <span className="sys-prompt-token-count">
                {tokenCount !== null ? `Token count: ${tokenCount}` : ""}
              </span>
            </div>
          </div>
        )}
      </section>

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
