import { useEffect, useRef, useState, useCallback } from "react";
import { SavedSystemPrompt, countTokens, createSystemPrompt, deleteSystemPrompt, fetchMemoryStats, getConfig, getSettings, getLlamaProps, listSystemPrompts, saveActiveSystemPrompt, updateConfig, updateSettings, updateSystemPrompt } from "../api";
import { applyUIFont, DEFAULT_UI_FONT, UI_FONT_OPTIONS } from "../fontOptions";
import { useChatStore } from "../stores/chatStore";

type MemoryStats = {
  workspace_count: number;
  session_count: number;
  memory_chunk_count: number;
};

type CorrectionMode = "light" | "standard" | "aggressive" | "custom";

const CORRECTION_MODE_OPTIONS: Array<{ value: CorrectionMode; label: string }> = [
  { value: "light", label: "軽め" },
  { value: "standard", label: "標準" },
  { value: "aggressive", label: "しっかり" },
  { value: "custom", label: "カスタム" },
];

const DEFAULTS = { temperature: 0.8, ctx_size: 32768, n_gpu_layers: -1, completion_length: 80 } as const;

export function SettingsPanel() {
  const currentWorkspace = useChatStore((state) => state.currentWorkspace());
  const activeModelPath = useChatStore((state) => state.activeModelPath);
  const systemPromptText = useChatStore((state) => state.systemPromptText);
  const setSystemPromptText = useChatStore((state) => state.setSystemPromptText);
  const correctionEnabled = useChatStore((state) => state.correctionEnabled);
  const setCorrectionEnabled = useChatStore((state) => state.setCorrectionEnabled);

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
  const [interfaceOpen, setInterfaceOpen] = useState(false);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugPromptLog, setDebugPromptLog] = useState(false);

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
  const [correctionMode, setCorrectionMode] = useState<CorrectionMode>("standard");
  const [customCorrectionPrompt, setCustomCorrectionPrompt] = useState("");
  const [uiFont, setUIFont] = useState(DEFAULT_UI_FONT);

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
      .then((s) => {
        const nextUIFont = s.ui_font || DEFAULT_UI_FONT;
        setUIFont(nextUIFont);
        applyUIFont(nextUIFont);
        setCorrectionEnabled(s.correction_enabled ?? true);
        const mode = (s.correction_prompt_mode || "standard") as CorrectionMode;
        setCorrectionMode(CORRECTION_MODE_OPTIONS.some((option) => option.value === mode) ? mode : "standard");
        setCustomCorrectionPrompt(s.correction_custom_prompt || "");
        setDebugPromptLog(s.debug_prompt_log ?? false);
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
    // テキストが保存済みプロンプトと一致したら、その選択状態に切り替える
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
        <button className="settings-section-header" onClick={() => setSystemPromptOpen((v) => !v)} onMouseEnter={onTipEnter("AIの振る舞いを定義するテキスト。会話の最初にシステムメッセージとして挿入されます。保存や呼び出しもできます。")} onMouseLeave={onTipLeave}>
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
          </div>
        )}
      </section>

      {/* Interface */}
      <section className="settings-section">
        <button className="settings-section-header" onClick={() => setInterfaceOpen((v) => !v)} onMouseEnter={onTipEnter("Switch the UI text font for the app.")} onMouseLeave={onTipLeave}>
          <span className="settings-section-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>
            </svg>
          </span>
          <span>Interface</span>
          <svg className={`settings-chevron${interfaceOpen ? " open" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {interfaceOpen && (
          <div className="settings-section-body">
            <div className="settings-field">
              <div className="settings-field-header">
                <span className="settings-field-label" onMouseEnter={onTipEnter("Choose the font used for interface text.")} onMouseLeave={onTipLeave}>Text Font</span>
              </div>
              <select
                className={`sys-prompt-select${uiFont !== DEFAULT_UI_FONT ? " ui-font-select-custom" : ""}`}
                value={uiFont}
                onChange={(e) => {
                  const next = e.target.value;
                  const previous = uiFont;
                  setUIFont(next);
                  applyUIFont(next);
                  updateSettings({ ui_font: next }).catch(() => {
                    setUIFont(previous);
                    applyUIFont(previous);
                  });
                }}
              >
                {UI_FONT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </section>

      {/* Completion */}
      <section className="settings-section">
        <button className="settings-section-header" onClick={() => setCompletionOpen((v) => !v)} onMouseEnter={onTipEnter("インライン補完の長さと、校正機能・校正プロンプトを設定します。")} onMouseLeave={onTipLeave}>
          <span className="settings-section-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
          </span>
          <span>Completion</span>
          <svg className={`settings-chevron${completionOpen ? " open" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {completionOpen && (
          <div className="settings-section-body">
            <div className="settings-field">
              <div className="settings-field-header">
                <span className="settings-field-label" onMouseEnter={onTipEnter("自動補完で生成する最大トークン数です。大きいほど長い候補を返します。")} onMouseLeave={onTipLeave}>Completion Length</span>
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
            <div className="settings-toggle-row">
              <div className="settings-toggle-copy">
                <span className="settings-field-label" onMouseEnter={onTipEnter("テキスト選択時の校正ボタンと校正ポップアップを有効にします。補完とは独立して切り替えられます。")} onMouseLeave={onTipLeave}>校正</span>
                <span className="settings-field-hint">補完とは独立して動作します</span>
              </div>
              <button
                type="button"
                className={`settings-toggle-btn${correctionEnabled ? " active" : ""}`}
                aria-pressed={correctionEnabled}
                onClick={() => {
                  const next = !correctionEnabled;
                  setCorrectionEnabled(next);
                  updateSettings({ correction_enabled: next }).catch(() => {
                    setCorrectionEnabled(!next);
                  });
                }}
              >
                <span className="settings-toggle-thumb" />
              </button>
            </div>
            <div className="sys-prompt-correction-row">
              <span className="sys-prompt-correction-label" onMouseEnter={onTipEnter("テキスト選択時の校正の強さを選びます。カスタムでは校正専用のプロンプトを自由に保存できます。")} onMouseLeave={onTipLeave}>
                校正プロンプト
              </span>
              <select
                className="sys-prompt-select sys-prompt-correction-select"
                value={correctionMode}
                onChange={(e) => {
                  const mode = e.target.value as CorrectionMode;
                  setCorrectionMode(mode);
                  updateSettings({ correction_prompt_mode: mode }).catch(() => {});
                }}
              >
                {CORRECTION_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            {correctionMode === "custom" && (
              <div className="sys-prompt-correction-custom">
                <textarea
                  className="sys-prompt-textarea sys-prompt-correction-textarea"
                  value={customCorrectionPrompt}
                  onChange={(e) => setCustomCorrectionPrompt(e.target.value)}
                  onBlur={() => {
                    updateSettings({ correction_custom_prompt: customCorrectionPrompt }).catch(() => {});
                  }}
                  placeholder="校正用のカスタムプロンプトを入力してください…"
                  spellCheck={false}
                />
                <div className="sys-prompt-footer">
                  <span className="sys-prompt-token-count">カスタム校正プロンプトは自動保存されます</span>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Context and Offload */}
      <section className="settings-section">
        <button className="settings-section-header" onClick={() => setContextOpen((v) => !v)} onMouseEnter={onTipEnter("Temperature、Context Length、GPU Offload などの生成設定です。")} onMouseLeave={onTipLeave}>
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
            <div className="settings-field">
              <div className="settings-field-header">
                <span className="settings-field-label" onMouseEnter={onTipEnter("生成のランダム性です。低いほど安定し、高いほど多様になります。")} onMouseLeave={onTipLeave}>Temperature</span>
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

            <div className="settings-field">
              <div className="settings-field-header">
                <span className="settings-field-label" onMouseEnter={onTipEnter("一度に扱える最大トークン数です。大きいほど長い会話を保持できますが、メモリ使用量も増えます。")} onMouseLeave={onTipLeave}>Context Length</span>
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

            <div className="settings-field">
              <div className="settings-field-header">
                <span className="settings-field-label" onMouseEnter={onTipEnter("GPUにオフロードするレイヤー数です。-1 で全レイヤー対象になります。VRAMが足りない場合は値を下げてください。")} onMouseLeave={onTipLeave}>GPU Offload</span>
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
        <button className="settings-section-header" onClick={() => setAdvancedOpen((v) => !v)} onMouseEnter={onTipEnter("補完エンジン、埋め込みモデル、検索システムの情報を表示します。")} onMouseLeave={onTipLeave}>
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
              <div className="stat-row"><span>補完サーバー</span><code>llama-server</code></div>
              <div className="stat-row"><span>埋め込みモデル</span><code>ruri-v3-310m</code></div>
              <div className="stat-row"><span>検索方式</span><strong>FTS5 + ベクトル</strong></div>
            </div>
            {stats && (
              <div className="stat-list" style={{ marginTop: 8 }}>
                <div className="stat-row"><span>ワークスペース</span><strong>{stats.workspace_count}</strong></div>
                <div className="stat-row"><span>セッション</span><strong>{stats.session_count}</strong></div>
                <div className="stat-row"><span>検索チャンク</span><strong>{stats.memory_chunk_count}</strong></div>
              </div>
            )}
          </div>
        )}
      </section>
      {/* Debug */}
      <section className="settings-section">
        <button className="settings-section-header" onClick={() => setDebugOpen((v) => !v)} onMouseEnter={onTipEnter("デバッグ用の設定です。")} onMouseLeave={onTipLeave}>
          <span className="settings-section-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
              <path d="M12 8v4"/><path d="M12 16h.01"/>
            </svg>
          </span>
          <span>Debug</span>
          {debugPromptLog && (
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", marginLeft: 4, flexShrink: 0 }} />
          )}
          <svg className={`settings-chevron${debugOpen ? " open" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {debugOpen && (
          <div className="settings-section-body">
            <div className="settings-toggle-row">
              <div className="settings-toggle-copy">
                <span className="settings-field-label" onMouseEnter={onTipEnter("llama-server に送信するプロンプト全文をバックエンドのログに出力します。uvicorn のコンソールで確認できます。")} onMouseLeave={onTipLeave}>プロンプトログ出力</span>
                <span className="settings-field-hint">llama-server への送信内容をログに表示</span>
              </div>
              <button
                type="button"
                className={`settings-toggle-btn${debugPromptLog ? " active" : ""}`}
                aria-pressed={debugPromptLog}
                onClick={() => {
                  const next = !debugPromptLog;
                  setDebugPromptLog(next);
                  updateSettings({ debug_prompt_log: next }).catch(() => {
                    setDebugPromptLog(!next);
                  });
                }}
              >
                <span className="settings-toggle-thumb" />
              </button>
            </div>
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











