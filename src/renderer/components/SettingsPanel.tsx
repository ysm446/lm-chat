import { useEffect, useRef, useState, useCallback } from "react";
import { SavedSystemPrompt, countTokens, createSystemPrompt, deleteSystemPrompt, fetchMemoryStats, getConfig, getSettings, getLlamaProps, listSystemPrompts, saveActiveSystemPrompt, updateConfig, updateSettings, updateSystemPrompt } from "../api";
import { useChatStore } from "../stores/chatStore";

type MemoryStats = {
  workspace_count: number;
  session_count: number;
  memory_chunk_count: number;
};

const DEFAULTS = { temperature: 0.8, ctx_size: 32768, n_gpu_layers: -1, completion_length: 80 } as const;

export function SettingsPanel() {
  const currentWorkspace = useChatStore((state) => state.currentWorkspace());
  const activeModelPath = useChatStore((state) => state.activeModelPath);
  const systemPromptText = useChatStore((state) => state.systemPromptText);
  const setSystemPromptText = useChatStore((state) => state.setSystemPromptText);

  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [ctxSize, setCtxSize] = useState(32768);
  const [nGpuLayers, setNGpuLayers] = useState(-1);
  const [temperature, setTemperature] = useState(0.8);
  const [completionLength, setCompletionLength] = useState(80);
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
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [namingMode, setNamingMode] = useState(false);
  const [pendingName, setPendingName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [correctionPromptId, setCorrectionPromptId] = useState("");

  useEffect(() => {
    getConfig()
      .then((cfg) => {
        setCtxSize(cfg.ctx_size);
        setNGpuLayers(cfg.n_gpu_layers);
        setTemperature(cfg.temperature ?? 0.8);
        setCompletionLength(cfg.completion_length ?? 80);
      })
      .catch(() => {});
    listSystemPrompts()
      .then((data) => {
        setSavedPrompts(data.prompts);
        if (data.active_id) setSelectedPromptId(data.active_id);
      })
      .catch(() => {});
    getSettings()
      .then((s) => { if (s.correction_prompt_id) setCorrectionPromptId(s.correction_prompt_id); })
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

  const handleSave = async (patch: { ctx_size?: number; n_gpu_layers?: number; temperature?: number; completion_length?: number }) => {
    setSaving(true);
    try {
      const cfg = await updateConfig(patch);
      setCtxSize(cfg.ctx_size);
      setNGpuLayers(cfg.n_gpu_layers);
      setTemperature(cfg.temperature ?? 0.8);
      setCompletionLength(cfg.completion_length ?? 80);
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
      saveActiveSystemPrompt("", "").catch(() => {});
    } else {
      const prompt = savedPrompts.find((p) => p.id === id);
      if (prompt) {
        setSystemPromptText(prompt.content);
        saveActiveSystemPrompt(prompt.content, id).catch(() => {});
      }
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
      saveActiveSystemPrompt(systemPromptText, newPrompt.id).catch(() => {});
    } catch { /* ignore */ }
    setNamingMode(false);
    setPendingName("");
  };

  const handleOverwritePrompt = async () => {
    if (!selectedPromptId) return;
    try {
      const updated = await updateSystemPrompt(selectedPromptId, systemPromptText);
      setSavedPrompts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      saveActiveSystemPrompt(systemPromptText, selectedPromptId).catch(() => {});
    } catch { /* ignore */ }
  };

  const handleDeletePrompt = async () => {
    if (!selectedPromptId) return;
    try {
      await deleteSystemPrompt(selectedPromptId);
      setSavedPrompts((prev) => prev.filter((p) => p.id !== selectedPromptId));
      setSelectedPromptId("");
      saveActiveSystemPrompt(systemPromptText, "").catch(() => {});
    } catch { /* ignore */ }
  };

  const handleTextareaChange = (value: string) => {
    setSystemPromptText(value);
    // テキストが別の保存済みプロンプトと一致すれば選択を切り替え、どれとも一致しなければ現在の選択を維持
    const match = savedPrompts.find((p) => p.content === value);
    if (match && match.id !== selectedPromptId) {
      setSelectedPromptId(match.id);
      saveActiveSystemPrompt(value, match.id).catch(() => {});
    }
  };

  const onTipEnter = useCallback((text: string) => (e: React.MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = setTimeout(() => {
      const rect = el.getBoundingClientRect();
      setTooltip({ text, x: rect.left - 10, y: rect.top + rect.height / 2 });
    }, 400);
  }, []);

  const onTipLeave = useCallback(() => {
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    setTooltip(null);
  }, []);

  const ctxMax = modelMaxCtx ?? 131072;
  const gpuMax = 100;

  return (
    <>
    <div className="settings-stack">
      {/* System Prompt */}
      <section className="settings-section">
        <button className="settings-section-header" onClick={() => setSystemPromptOpen((v) => !v)} onMouseEnter={onTipEnter("AIの振る舞いを定義するテキスト。会話の最初にシステムメッセージとして挿入されます。保存・呼び出しも可能です。")} onMouseLeave={onTipLeave}>
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
                  className="sys-prompt-icon-btn"
                  title="選択中のプロンプトに上書き保存"
                  onClick={() => void handleOverwritePrompt()}
                  disabled={!selectedPromptId || savedPrompts.find((p) => p.id === selectedPromptId)?.content === systemPromptText}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                    <polyline points="17 21 17 13 7 13 7 21"/>
                    <polyline points="7 3 7 8 15 8"/>
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
            <div className="sys-prompt-correction-row">
              <span className="sys-prompt-correction-label" onMouseEnter={onTipEnter("テキスト選択時の校正に使うシステムプロンプト。未選択時はデフォルトの校正プロンプトを使用します。")} onMouseLeave={onTipLeave}>
                校正プロンプト
              </span>
              <select
                className="sys-prompt-select sys-prompt-correction-select"
                value={correctionPromptId}
                onChange={(e) => {
                  const id = e.target.value;
                  setCorrectionPromptId(id);
                  updateSettings({ correction_prompt_id: id }).catch(() => {});
                }}
              >
                <option value="">-- デフォルト --</option>
                {savedPrompts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </section>

      {/* Context and Offload */}
      <section className="settings-section">
        <button className="settings-section-header" onClick={() => setContextOpen((v) => !v)} onMouseEnter={onTipEnter("推論パラメータの設定。Temperatureはすぐに反映。Context Length と GPU Offload は次回モデルロード時に反映されます。")} onMouseLeave={onTipLeave}>
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
            {/* Temperature */}
            <div className="settings-field">
              <div className="settings-field-header">
                <span className="settings-field-label" onMouseEnter={onTipEnter("生成のランダム性。低いほど一貫した回答、高いほど多様・創造的な表現になります。（範囲: 0〜2、デフォルト: 0.8）")} onMouseLeave={onTipLeave}>Temperature</span>
                <div className="settings-field-controls">
                  {temperature !== DEFAULTS.temperature && (
                    <button className="settings-reset-btn" title="デフォルトに戻す" onClick={() => { setTemperature(DEFAULTS.temperature); void handleSave({ temperature: DEFAULTS.temperature }); }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                      </svg>
                    </button>
                  )}
                  <input
                    className="settings-number-input"
                    type="number"
                    min={0}
                    max={2}
                    step={0.05}
                    value={temperature}
                    onChange={(e) => setTemperature(Number(e.target.value))}
                    onBlur={() => void handleSave({ temperature })}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleSave({ temperature }); }}
                  />
                </div>
              </div>
              <input
                className="settings-slider"
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                onMouseUp={() => void handleSave({ temperature })}
              />
            </div>

            {/* Completion Length */}
            <div className="settings-field">
              <div className="settings-field-header">
                <span className="settings-field-label" onMouseEnter={onTipEnter("自動補完で生成するテキストの最大トークン数。短いほど速く表示されます。（範囲: 10〜300、デフォルト: 80）")} onMouseLeave={onTipLeave}>Completion Length</span>
                <div className="settings-field-controls">
                  {completionLength !== DEFAULTS.completion_length && (
                    <button className="settings-reset-btn" title="デフォルトに戻す" onClick={() => { setCompletionLength(DEFAULTS.completion_length); void handleSave({ completion_length: DEFAULTS.completion_length }); }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                      </svg>
                    </button>
                  )}
                  <input
                    className="settings-number-input"
                    type="number"
                    min={10}
                    max={300}
                    step={10}
                    value={completionLength}
                    onChange={(e) => setCompletionLength(Number(e.target.value))}
                    onBlur={() => void handleSave({ completion_length: completionLength })}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleSave({ completion_length: completionLength }); }}
                  />
                </div>
              </div>
              <input
                className="settings-slider"
                type="range"
                min={10}
                max={300}
                step={10}
                value={completionLength}
                onChange={(e) => setCompletionLength(Number(e.target.value))}
                onMouseUp={() => void handleSave({ completion_length: completionLength })}
              />
            </div>

            {/* Context Length */}
            <div className="settings-field">
              <div className="settings-field-header">
                <span className="settings-field-label" onMouseEnter={onTipEnter("一度に扱える最大トークン数。長い会話や長文処理には大きな値が必要ですが、VRAMを多く消費します。次回モデルロード時に反映。")} onMouseLeave={onTipLeave}>Context Length</span>
                <div className="settings-field-controls">
                  {ctxSize !== DEFAULTS.ctx_size && (
                    <button className="settings-reset-btn" title="デフォルトに戻す" onClick={() => { setCtxSize(DEFAULTS.ctx_size); void handleSave({ ctx_size: DEFAULTS.ctx_size }); }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                      </svg>
                    </button>
                  )}
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
                <span className="settings-field-label" onMouseEnter={onTipEnter("GPUに転送するレイヤー数。-1で全レイヤーをGPUへオフロード（最速）。VRAMが不足する場合は値を下げてください。次回モデルロード時に反映。")} onMouseLeave={onTipLeave}>GPU Offload</span>
                <div className="settings-field-controls">
                  {nGpuLayers !== DEFAULTS.n_gpu_layers && (
                    <button className="settings-reset-btn" title="デフォルトに戻す" onClick={() => { setNGpuLayers(DEFAULTS.n_gpu_layers); void handleSave({ n_gpu_layers: DEFAULTS.n_gpu_layers }); }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                      </svg>
                    </button>
                  )}
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
        <button className="settings-section-header" onClick={() => setAdvancedOpen((v) => !v)} onMouseEnter={onTipEnter("推論エンジン・埋め込みモデル・記憶システムの情報と統計を表示します。")} onMouseLeave={onTipLeave}>
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
    {tooltip && (
      <div
        className="settings-tooltip"
        style={{ top: tooltip.y, left: tooltip.x }}
      >
        {tooltip.text}
      </div>
    )}
    </>
  );
}
