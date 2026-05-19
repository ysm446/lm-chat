import { useEffect, useRef, useState, useCallback, type Dispatch, type SetStateAction } from "react";
import {
  type AppConfig,
  type AppConfigPatch,
  type AppSettings,
  type LlamaRuntimeInfo,
  type SettingsSectionKey,
  SavedSystemPrompt,
  cleanupDocuments,
  cleanupMemory,
  clearAllPromptLogs,
  exportDataArchive,
  fetchMemoryStats,
  getConfig,
  getLlamaProps,
  getLlamaRuntimeInfo,
  getLlamaStatus,
  getSettings,
  importDataArchive,
  installLlamaRuntime,
  listSystemPrompts,
  reindexDocuments,
  saveActiveSystemPrompt,
  updateConfig,
  updateSettings
} from "../api";
import { applyFontSize, applyUIFont, DEFAULT_FONT_SIZE, DEFAULT_UI_FONT, FONT_SIZE_MAX, FONT_SIZE_MIN, UI_FONT_OPTIONS } from "../fontOptions";
import { useChatStore } from "../stores/chatStore";

type MemoryStats = {
  workspace_count: number;
  session_count: number;
  memory_chunk_count: number;
};

type CorrectionMode = "light" | "standard" | "aggressive" | "rewrite" | "custom";

const CORRECTION_MODE_OPTIONS: Array<{ value: CorrectionMode; label: string }> = [
  { value: "light", label: "軽め" },
  { value: "standard", label: "標準" },
  { value: "aggressive", label: "しっかり" },
  { value: "rewrite", label: "リライト" },
  { value: "custom", label: "カスタム" },
];

const MEMORY_SCOPE_OPTIONS: Array<{ value: AppConfig["memory_scope"]; label: string }> = [
  { value: "workspace", label: "Workspace 全体" },
  { value: "above_current", label: "現在より上の会話だけ" },
  { value: "below_current", label: "現在より下の会話だけ" },
];

const DEFAULTS = {
  temperature: 0.8,
  ctx_size: 32768,
  completion_length: 80,
  memory_scope: "workspace",
  memory_context_top_k: 5,
  document_context_top_k: 3,
  memory_context_chars: 1500,
  document_context_chars: 2000,
  memory_decay_half_life_days: 30,
  document_chunk_target_chars: 800,
  document_chunk_max_chars: 1000,
  document_chunk_overlap_chars: 100,
} as const;
const CTX_SIZE_PRESETS = [4096, 8192, 16384, 32768, 65536, 131072, 262144] as const;
const SETTINGS_SECTION_KEYS: SettingsSectionKey[] = [
  "settings_context_open",
  "settings_memory_open",
  "settings_documents_open",
  "settings_advanced_open",
  "settings_system_prompt_open",
  "settings_interface_open",
  "settings_completion_open",
  "settings_data_open",
  "settings_debug_open",
];

function formatCtxSizeLabel(value: number) {
  if (value >= 1024) {
    const asK = value / 1024;
    return Number.isInteger(asK) ? `${asK}k` : `${asK.toFixed(1)}k`;
  }
  return value.toLocaleString();
}

function formatBytes(value: number | undefined) {
  const bytes = value ?? 0;
  if (bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function getNearestCtxPresetIndex(value: number, presets: readonly number[]) {
  if (presets.length === 0) return 0;
  let nearestIndex = 0;
  let nearestDistance = Math.abs(presets[0] - value);
  for (let i = 1; i < presets.length; i += 1) {
    const distance = Math.abs(presets[i] - value);
    if (distance < nearestDistance) {
      nearestIndex = i;
      nearestDistance = distance;
    }
  }
  return nearestIndex;
}

function normalizeCorrectionMode(mode: string | undefined): CorrectionMode {
  return CORRECTION_MODE_OPTIONS.some((option) => option.value === mode)
    ? (mode as CorrectionMode)
    : "standard";
}

type SettingsPanelProps = {
  onEditSystemPrompt?: (promptId: string) => void;
};

export function SettingsPanel({ onEditSystemPrompt }: SettingsPanelProps) {
  const currentWorkspace = useChatStore((state) => state.currentWorkspace());
  const currentSession = useChatStore((state) => state.currentSession());
  const selectSession = useChatStore((state) => state.selectSession);
  const activeModelPath = useChatStore((state) => state.activeModelPath);
  const systemPromptText = useChatStore((state) => state.systemPromptText);
  const setSystemPromptText = useChatStore((state) => state.setSystemPromptText);
  const correctionEnabled = useChatStore((state) => state.correctionEnabled);
  const setCorrectionEnabled = useChatStore((state) => state.setCorrectionEnabled);
  const chatScrollPosition = useChatStore((state) => state.chatScrollPosition);
  const setChatScrollPosition = useChatStore((state) => state.setChatScrollPosition);

  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [ctxSize, setCtxSize] = useState(32768);
  const [temperature, setTemperature] = useState(0.8);
  const [completionLength, setCompletionLength] = useState(80);
  const [memoryScope, setMemoryScope] = useState<AppConfig["memory_scope"]>(DEFAULTS.memory_scope);
  const [memoryContextTopK, setMemoryContextTopK] = useState<number>(DEFAULTS.memory_context_top_k);
  const [documentContextTopK, setDocumentContextTopK] = useState<number>(DEFAULTS.document_context_top_k);
  const [memoryContextChars, setMemoryContextChars] = useState<number>(DEFAULTS.memory_context_chars);
  const [documentContextChars, setDocumentContextChars] = useState<number>(DEFAULTS.document_context_chars);
  const [memoryDecayHalfLifeDays, setMemoryDecayHalfLifeDays] = useState<number>(DEFAULTS.memory_decay_half_life_days);
  const [documentChunkTargetChars, setDocumentChunkTargetChars] = useState<number>(DEFAULTS.document_chunk_target_chars);
  const [documentChunkMaxChars, setDocumentChunkMaxChars] = useState<number>(DEFAULTS.document_chunk_max_chars);
  const [documentChunkOverlapChars, setDocumentChunkOverlapChars] = useState<number>(DEFAULTS.document_chunk_overlap_chars);
  const [modelMaxCtx, setModelMaxCtx] = useState<number | null>(null);
  const [llamaServerVersion, setLlamaServerVersion] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [systemPromptOpen, setSystemPromptOpen] = useState(false);
  const [interfaceOpen, setInterfaceOpen] = useState(false);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugPromptLog, setDebugPromptLog] = useState(false);
  const [includeAllPromptImages, setIncludeAllPromptImages] = useState(false);
  const [databaseCleanupBusy, setDatabaseCleanupBusy] = useState(false);
  const [databaseCleanupResult, setDatabaseCleanupResult] = useState<string | null>(null);
  const [promptLogCleanupBusy, setPromptLogCleanupBusy] = useState(false);
  const [promptLogCleanupResult, setPromptLogCleanupResult] = useState<string | null>(null);
  const [dataExportBusy, setDataExportBusy] = useState(false);
  const [dataExportResult, setDataExportResult] = useState<string | null>(null);
  const [dataImportBusy, setDataImportBusy] = useState(false);
  const [dataImportResult, setDataImportResult] = useState<string | null>(null);
  const [documentReindexBusy, setDocumentReindexBusy] = useState(false);
  const [documentReindexResult, setDocumentReindexResult] = useState<string | null>(null);
  const [sysResOpen, setSysResOpen] = useState(false);
  const [runtimeInfo, setRuntimeInfo] = useState<LlamaRuntimeInfo | null>(null);
  const [runtimeInfoBusy, setRuntimeInfoBusy] = useState(false);
  const [runtimeInstallBusy, setRuntimeInstallBusy] = useState(false);
  const [selectedRuntimeVariant, setSelectedRuntimeVariant] = useState("win-cuda12-x64");
  const [includeCudaRuntime, setIncludeCudaRuntime] = useState(false);
  const [runtimeMessage, setRuntimeMessage] = useState<string | null>(null);

  // System prompt state
  const [savedPrompts, setSavedPrompts] = useState<SavedSystemPrompt[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string>("");
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [correctionMode, setCorrectionMode] = useState<CorrectionMode>("standard");
  const [customCorrectionPrompt, setCustomCorrectionPrompt] = useState("");
  const [uiFont, setUIFont] = useState(DEFAULT_UI_FONT);
  const [uiFontSize, setUIFontSize] = useState(DEFAULT_FONT_SIZE);
  const settingsOpenStateLoadedRef = useRef(false);

  const applyConfigState = useCallback((cfg: AppConfig) => {
    setCtxSize(cfg.ctx_size);
    setTemperature(cfg.temperature ?? DEFAULTS.temperature);
    setCompletionLength(cfg.completion_length ?? DEFAULTS.completion_length);
    setMemoryScope(cfg.memory_scope ?? DEFAULTS.memory_scope);
    setMemoryContextTopK(cfg.memory_context_top_k ?? DEFAULTS.memory_context_top_k);
    setDocumentContextTopK(cfg.document_context_top_k ?? DEFAULTS.document_context_top_k);
    setMemoryContextChars(cfg.memory_context_chars ?? DEFAULTS.memory_context_chars);
    setDocumentContextChars(cfg.document_context_chars ?? DEFAULTS.document_context_chars);
    setMemoryDecayHalfLifeDays(cfg.memory_decay_half_life_days ?? DEFAULTS.memory_decay_half_life_days);
    setDocumentChunkTargetChars(cfg.document_chunk_target_chars ?? DEFAULTS.document_chunk_target_chars);
    setDocumentChunkMaxChars(cfg.document_chunk_max_chars ?? DEFAULTS.document_chunk_max_chars);
    setDocumentChunkOverlapChars(cfg.document_chunk_overlap_chars ?? DEFAULTS.document_chunk_overlap_chars);
  }, []);

  const applySettingsState = useCallback((settings: AppSettings) => {
    const nextUIFont = settings.ui_font || DEFAULT_UI_FONT;
    setUIFont(nextUIFont);
    applyUIFont(nextUIFont);

    const nextFontSize = settings.ui_font_size ?? DEFAULT_FONT_SIZE;
    setUIFontSize(nextFontSize);
    applyFontSize(nextFontSize);

    setCorrectionEnabled(settings.correction_enabled ?? true);
    setCorrectionMode(normalizeCorrectionMode(settings.correction_prompt_mode));
    setCustomCorrectionPrompt(settings.correction_custom_prompt || "");
    setIncludeAllPromptImages(settings.include_all_prompt_images ?? false);
    setDebugPromptLog(settings.debug_prompt_log ?? false);

    const sectionSetters: Record<SettingsSectionKey, Dispatch<SetStateAction<boolean>>> = {
      settings_context_open: setContextOpen,
      settings_memory_open: setMemoryOpen,
      settings_documents_open: setDocumentsOpen,
      settings_advanced_open: setAdvancedOpen,
      settings_system_prompt_open: setSystemPromptOpen,
      settings_interface_open: setInterfaceOpen,
      settings_completion_open: setCompletionOpen,
      settings_data_open: setDataOpen,
      settings_debug_open: setDebugOpen,
    };

    for (const key of SETTINGS_SECTION_KEYS) {
      sectionSetters[key](settings[key] ?? false);
    }
  }, [setCorrectionEnabled]);

  const loadMemoryStats = useCallback(() => {
    fetchMemoryStats().then(setStats).catch(() => {});
  }, []);

  const loadRuntimeInfo = useCallback(() => {
    setRuntimeInfoBusy(true);
    setRuntimeMessage(null);
    getLlamaRuntimeInfo()
      .then((info) => {
        setRuntimeInfo(info);
        setSelectedRuntimeVariant((prev) => {
          const preferred = info.installed_variant || prev;
          if (info.variants.some((variant) => variant.id === preferred)) return preferred;
          return info.variants[0]?.id || prev;
        });
      })
      .catch((err) => {
        setRuntimeMessage(err instanceof Error ? err.message : "Runtime 情報の取得に失敗しました");
      })
      .finally(() => setRuntimeInfoBusy(false));
  }, []);

  useEffect(() => {
    getConfig()
      .then(applyConfigState)
      .catch(() => {});
    listSystemPrompts()
      .then((data) => {
        setSavedPrompts(data.prompts);
        if (data.active_id) setSelectedPromptId(data.active_id);
      })
      .catch(() => {});
    getSettings()
      .then((settings) => {
        applySettingsState(settings);
        settingsOpenStateLoadedRef.current = true;
      })
      .catch(() => {
        settingsOpenStateLoadedRef.current = true;
      });
  }, [applyConfigState, applySettingsState]);

  useEffect(() => {
    Promise.all([getLlamaProps(), getLlamaStatus()])
      .then(([props, status]) => {
        if (props.n_ctx) setModelMaxCtx(props.n_ctx);
        setLlamaServerVersion(status.version || "");
      })
      .catch(() => {});
  }, [activeModelPath]);

  useEffect(() => {
    loadMemoryStats();
  }, [currentWorkspace?.id, loadMemoryStats]);

  useEffect(() => {
    if (advancedOpen && !runtimeInfo && !runtimeInfoBusy) {
      loadRuntimeInfo();
    }
  }, [advancedOpen, loadRuntimeInfo, runtimeInfo, runtimeInfoBusy]);

  useEffect(() => {
    const handler = (e: Event) => {
      const prompts = (e as CustomEvent<SavedSystemPrompt[]>).detail;
      setSavedPrompts(prompts);
      setSelectedPromptId((prev) => {
        if (!prev) return prev;
        const found = prompts.find((p) => p.id === prev);
        if (!found) {
          // 選択中プロンプトが削除された → active をリセット
          setSystemPromptText("");
          saveActiveSystemPrompt("", "").catch(() => {});
          return "";
        }
        // 内容が保存されたら systemPromptText を同期
        setSystemPromptText(found.content);
        return prev;
      });
    };
    window.addEventListener("lm-chat:prompts-updated", handler as EventListener);
    return () => window.removeEventListener("lm-chat:prompts-updated", handler as EventListener);
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("lm-chat:statusbar-system-resources", { detail: { enabled: sysResOpen } }));
    return () => {
      window.dispatchEvent(new CustomEvent("lm-chat:statusbar-system-resources", { detail: { enabled: false } }));
    };
  }, [sysResOpen]);

  const handleSave = async (patch: AppConfigPatch) => {
    setSaving(true);
    try {
      const cfg = await updateConfig(patch);
      applyConfigState(cfg);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  };

  const handleRuntimeInstall = async () => {
    if (runtimeInstallBusy) return;
    setRuntimeInstallBusy(true);
    setRuntimeMessage("Downloading and installing llama.cpp server...");
    try {
      const result = await installLlamaRuntime(selectedRuntimeVariant, includeCudaRuntime);
      setRuntimeMessage(`${result.label} ${result.tag} をインストールしました`);
      setLlamaServerVersion(result.tag);
      await loadRuntimeInfo();
    } catch (error) {
      setRuntimeMessage(error instanceof Error ? error.message : "llama.cpp server のインストールに失敗しました");
    } finally {
      setRuntimeInstallBusy(false);
    }
  };

  const handleDatabaseCleanup = async () => {
    if (databaseCleanupBusy) return;
    setDatabaseCleanupBusy(true);
    setDatabaseCleanupResult(null);
    try {
      const [memoryResult, documentResult] = await Promise.all([cleanupMemory(), cleanupDocuments()]);
      const memoryTotal = memoryResult.deleted_chunks + memoryResult.deleted_fts + memoryResult.deleted_vec;
      const documentIndexTotal = documentResult.deleted_chunks + documentResult.deleted_fts + documentResult.deleted_vec;
      const total = memoryTotal + documentIndexTotal + documentResult.deleted_files + documentResult.deleted_dirs;
      setDatabaseCleanupResult(
        total > 0
          ? `掃除完了: memory ${memoryTotal}件 / document indexes ${documentIndexTotal}件 / files ${documentResult.deleted_files}件 / dirs ${documentResult.deleted_dirs}件`
          : "掃除対象は見つかりませんでした"
      );
      loadMemoryStats();
    } catch (error) {
      setDatabaseCleanupResult(error instanceof Error ? error.message : "データベースのクリーンナップに失敗しました");
    } finally {
      setDatabaseCleanupBusy(false);
    }
  };

  const handlePromptLogCleanup = async () => {
    if (promptLogCleanupBusy) return;
    const confirmed = window.confirm("保存したプロンプト全文をすべて削除します。会話履歴は残ります。続行しますか？");
    if (!confirmed) return;
    setPromptLogCleanupBusy(true);
    setPromptLogCleanupResult(null);
    try {
      const result = await clearAllPromptLogs();
      setPromptLogCleanupResult(
        result.cleared > 0
          ? `削除完了: ${result.cleared}件の保存済みプロンプトを削除しました`
          : "削除対象の保存済みプロンプトはありませんでした"
      );
      if (currentSession?.id) {
        await selectSession(currentSession.id);
      }
    } catch (error) {
      setPromptLogCleanupResult(error instanceof Error ? error.message : "保存済みプロンプトの削除に失敗しました");
    } finally {
      setPromptLogCleanupBusy(false);
    }
  };

  const handleDataExport = async () => {
    if (dataExportBusy) return;
    const bridge = window.lmChat;
    if (!bridge?.chooseExportArchivePath) {
      setDataExportResult("Electron 版でのみ利用できます");
      return;
    }
    const exportPath = await bridge.chooseExportArchivePath();
    if (!exportPath) return;
    setDataExportBusy(true);
    setDataExportResult(null);
    try {
      const result = await exportDataArchive(exportPath);
      const sizeMb = (result.size_bytes / (1024 * 1024)).toFixed(1);
      setDataExportResult(`保存しました: ${result.file_name} (${sizeMb} MB)`);
    } catch (error) {
      setDataExportResult(error instanceof Error ? error.message : "データのエクスポートに失敗しました");
    } finally {
      setDataExportBusy(false);
    }
  };

  const handleDataImport = async () => {
    if (dataImportBusy) return;
    const bridge = window.lmChat;
    if (!bridge?.chooseImportArchivePath) {
      setDataImportResult("Electron 版でのみ利用できます");
      return;
    }
    const importPath = await bridge.chooseImportArchivePath();
    if (!importPath) return;
    const confirmed = window.confirm("ZIP からデータ一式を復元します。現在の data フォルダは上書きされます。続行しますか？");
    if (!confirmed) return;
    setDataImportBusy(true);
    setDataImportResult(null);
    try {
      const result = await importDataArchive(importPath);
      setDataImportResult(result.restart_required ? "インポートしました。反映のためアプリを再起動してください。" : "インポートしました");
    } catch (error) {
      setDataImportResult(error instanceof Error ? error.message : "データのインポートに失敗しました");
    } finally {
      setDataImportBusy(false);
    }
  };

  const handleDocumentReindex = async () => {
    if (documentReindexBusy) return;
    const confirmed = window.confirm("既存の workspace 資料を現在のチャンクサイズで再インデックスします。続行しますか？");
    if (!confirmed) return;
    setDocumentReindexBusy(true);
    setDocumentReindexResult(null);
    try {
      const result = await reindexDocuments();
      setDocumentReindexResult(
        result.failed > 0
          ? `再インデックス完了: 対象 ${result.total} 件 / 成功 ${result.succeeded} 件 / 失敗 ${result.failed} 件`
          : `再インデックス完了: ${result.succeeded} / ${result.total} 件`
      );
    } catch (error) {
      setDocumentReindexResult(error instanceof Error ? error.message : "資料の再インデックスに失敗しました");
    } finally {
      setDocumentReindexBusy(false);
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

  const toggleSettingsSection = useCallback(
    (
      setter: Dispatch<SetStateAction<boolean>>,
      key: SettingsSectionKey
    ) => {
      setter((prev) => {
        const next = !prev;
        if (settingsOpenStateLoadedRef.current) {
          void updateSettings({ [key]: next });
        }
        return next;
      });
    },
    []
  );

  const ctxMax = modelMaxCtx ?? 131072;
  const ctxPresetOptions = CTX_SIZE_PRESETS.filter((value) => value <= ctxMax);
  const effectiveCtxPresets = ctxPresetOptions.length > 0 ? ctxPresetOptions : [ctxMax];
  const currentCtxPresetIndex = getNearestCtxPresetIndex(ctxSize, effectiveCtxPresets);
  const selectedRuntime = runtimeInfo?.variants.find((variant) => variant.id === selectedRuntimeVariant) ?? runtimeInfo?.variants[0] ?? null;
  const selectedRuntimeHasOptionalDlls = Boolean(selectedRuntime?.runtime_asset);
  const selectedRuntimeSize = (selectedRuntime?.binary_asset?.size_bytes ?? 0) + (includeCudaRuntime ? (selectedRuntime?.runtime_asset?.size_bytes ?? 0) : 0);

  return (
    <>
    <div className="settings-stack">
      {/* System Prompt */}
      <section className="settings-section">
        <button className="settings-section-header" onClick={() => toggleSettingsSection(setSystemPromptOpen, "settings_system_prompt_open")} onMouseEnter={onTipEnter("AIの振る舞いを定義するテキスト。会話の最初にシステムメッセージとして挿入されます。保存や呼び出しもできます。")} onMouseLeave={onTipLeave}>
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
            <div className="sys-prompt-toolbar">
              <select
                className="sys-prompt-select"
                value={selectedPromptId}
                onChange={(e) => handleSelectPrompt(e.target.value)}
              >
                <option value="">-- なし --</option>
                {savedPrompts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button
                type="button"
                className="sys-prompt-icon-btn"
                title={selectedPromptId ? "このシステムプロンプトを編集" : "編集するシステムプロンプトを選択してください"}
                onClick={() => {
                  if (!selectedPromptId) return;
                  onEditSystemPrompt?.(selectedPromptId);
                }}
                disabled={!selectedPromptId}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9"/>
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
                </svg>
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Interface */}
      <section className="settings-section">
        <button className="settings-section-header" onClick={() => toggleSettingsSection(setInterfaceOpen, "settings_interface_open")} onMouseEnter={onTipEnter("Switch the UI text font for the app.")} onMouseLeave={onTipLeave}>
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
            <div className="settings-field">
              <div className="settings-field-header">
                <span className="settings-field-label" onMouseEnter={onTipEnter("UIのベースフォントサイズを変更します。")} onMouseLeave={onTipLeave}>Font Size</span>
                <div className="settings-field-controls">
                  {uiFontSize !== DEFAULT_FONT_SIZE && (
                    <button className="settings-reset-btn" title="デフォルトに戻す" onClick={() => {
                      setUIFontSize(DEFAULT_FONT_SIZE);
                      applyFontSize(DEFAULT_FONT_SIZE);
                      void updateSettings({ ui_font_size: DEFAULT_FONT_SIZE });
                    }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                      </svg>
                    </button>
                  )}
                  <span className="settings-value-badge">{uiFontSize}px</span>
                </div>
              </div>
              <input
                className="settings-slider"
                type="range"
                min={FONT_SIZE_MIN}
                max={FONT_SIZE_MAX}
                step={1}
                value={uiFontSize}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setUIFontSize(next);
                  applyFontSize(next);
                }}
                onMouseUp={() => void updateSettings({ ui_font_size: uiFontSize })}
                onKeyUp={() => void updateSettings({ ui_font_size: uiFontSize })}
              />
              <div className="settings-slider-labels">
                <span>小 ({FONT_SIZE_MIN}px)</span>
                <span>大 ({FONT_SIZE_MAX}px)</span>
              </div>
            </div>
            <div className="settings-field">
              <div className="settings-field-header">
                <span className="settings-field-label" onMouseEnter={onTipEnter("会話を選んだとき、どの位置から表示するかを選びます。")} onMouseLeave={onTipLeave}>会話の開始位置</span>
              </div>
              <select
                className="sys-prompt-select"
                value={chatScrollPosition}
                onChange={(e) => {
                  const next = e.target.value as "bottom" | "top";
                  const prev = chatScrollPosition;
                  setChatScrollPosition(next);
                  updateSettings({ chat_scroll_position: next }).catch(() => {
                    setChatScrollPosition(prev);
                  });
                }}
              >
                <option value="bottom">下から（最新メッセージ）</option>
                <option value="top">上から（最初のメッセージ）</option>
              </select>
            </div>
          </div>
        )}
      </section>

      {/* Completion */}
      <section className="settings-section">
        <button className="settings-section-header" onClick={() => toggleSettingsSection(setCompletionOpen, "settings_completion_open")} onMouseEnter={onTipEnter("インライン補完の長さと、校正機能・校正プロンプトを設定します。")} onMouseLeave={onTipLeave}>
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

      {/* Context */}
      <section className="settings-section">
        <button className="settings-section-header" onClick={() => toggleSettingsSection(setContextOpen, "settings_context_open")} onMouseEnter={onTipEnter("Temperature や Context Length などの生成設定です。")} onMouseLeave={onTipLeave}>
          <span className="settings-section-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07M8.46 8.46a5 5 0 0 0 0 7.07"/>
            </svg>
          </span>
          <span>Context</span>
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
                  <span className="settings-value-badge">{formatCtxSizeLabel(ctxSize)}</span>
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
                min={0}
                max={Math.max(effectiveCtxPresets.length - 1, 0)}
                step={1}
                value={currentCtxPresetIndex}
                onChange={(e) => setCtxSize(effectiveCtxPresets[Number(e.target.value)] ?? ctxSize)}
                onMouseUp={() => void handleSave({ ctx_size: ctxSize })}
              />
            </div>

            <div className="settings-toggle-row">
              <div className="settings-toggle-copy">
                <span className="settings-field-label" onMouseEnter={onTipEnter("OFF のときは最新画像だけを実画像として送り、過去画像は保存済みサマリーとしてプロンプトに含めます。")} onMouseLeave={onTipLeave}>過去の画像もすべて参照する</span>
              </div>
              <button
                type="button"
                className={`settings-toggle-btn${includeAllPromptImages ? " active" : ""}`}
                aria-pressed={includeAllPromptImages}
                onClick={() => {
                  const next = !includeAllPromptImages;
                  setIncludeAllPromptImages(next);
                  updateSettings({ include_all_prompt_images: next }).catch(() => {
                    setIncludeAllPromptImages(!next);
                  });
                }}
              >
                <span className="settings-toggle-thumb" />
              </button>
            </div>

            {saved && <p className="settings-saved-msg">保存しました</p>}
            {saving && <p className="settings-saved-msg">保存中…</p>}
          </div>
        )}
      </section>
      <section className="settings-section">
        <button className="settings-section-header" onClick={() => toggleSettingsSection(setMemoryOpen, "settings_memory_open")} onMouseEnter={onTipEnter("Memory 検索の量と新しさの効き方を調整します。")} onMouseLeave={onTipLeave}>
          <span className="settings-section-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5C7.582 5 4 7.239 4 10s3.582 5 8 5 8-2.239 8-5-3.582-5-8-5z"/>
              <path d="M6 14.5V17c0 2.209 2.686 4 6 4s6-1.791 6-4v-2.5"/>
              <path d="M6 10.5V13"/>
              <path d="M18 10.5V13"/>
            </svg>
          </span>
          <span>Memory</span>
          <svg className={`settings-chevron${memoryOpen ? " open" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {memoryOpen && (
          <div className="settings-section-body">
            <div className="settings-field">
              <div className="settings-field-header">
                <span className="settings-field-label" onMouseEnter={onTipEnter("Memory 検索で参照する会話の範囲を、サイドバーの並び順を基準に切り替えます。")} onMouseLeave={onTipLeave}>Memory Scope</span>
                <div className="settings-field-controls">
                  {memoryScope !== DEFAULTS.memory_scope && (
                    <button className="settings-reset-btn" title="デフォルトに戻す" onClick={() => { setMemoryScope(DEFAULTS.memory_scope); void handleSave({ memory_scope: DEFAULTS.memory_scope }); }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              <select
                className={`settings-select${memoryScope !== DEFAULTS.memory_scope ? " active" : ""}`}
                value={memoryScope}
                onChange={(e) => {
                  const next = e.target.value as AppConfig["memory_scope"];
                  setMemoryScope(next);
                  void handleSave({ memory_scope: next });
                }}
              >
                {MEMORY_SCOPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div className="settings-field">
              <div className="settings-field-header">
                <span className="settings-field-label" onMouseEnter={onTipEnter("検索で拾った過去記憶を最大何件までプロンプトに含めるかを調整します。")} onMouseLeave={onTipLeave}>Memory Hits</span>
                <div className="settings-field-controls">
                  {memoryContextTopK !== DEFAULTS.memory_context_top_k && (
                    <button className="settings-reset-btn" title="デフォルトに戻す" onClick={() => { setMemoryContextTopK(DEFAULTS.memory_context_top_k); void handleSave({ memory_context_top_k: DEFAULTS.memory_context_top_k }); }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                      </svg>
                    </button>
                  )}
                  <span className="settings-value-badge">{memoryContextTopK.toLocaleString()}件</span>
                </div>
              </div>
              <input
                className={`settings-slider${memoryContextTopK !== DEFAULTS.memory_context_top_k ? " active" : ""}`}
                type="range"
                min={0}
                max={10}
                step={1}
                value={memoryContextTopK}
                onChange={(e) => setMemoryContextTopK(Number(e.target.value))}
                onMouseUp={() => void handleSave({ memory_context_top_k: memoryContextTopK })}
                onKeyUp={() => void handleSave({ memory_context_top_k: memoryContextTopK })}
              />
              <div className="settings-slider-labels">
                <span>0件</span>
                <span>10件</span>
              </div>
            </div>

            <div className="settings-field">
              <div className="settings-field-header">
                <span className="settings-field-label" onMouseEnter={onTipEnter("検索で拾った過去記憶コンテキストを最大何文字までプロンプトに含めるかを調整します。")} onMouseLeave={onTipLeave}>Memory Context</span>
                <div className="settings-field-controls">
                  {memoryContextChars !== DEFAULTS.memory_context_chars && (
                    <button className="settings-reset-btn" title="デフォルトに戻す" onClick={() => { setMemoryContextChars(DEFAULTS.memory_context_chars); void handleSave({ memory_context_chars: DEFAULTS.memory_context_chars }); }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                      </svg>
                    </button>
                  )}
                  <span className="settings-value-badge">{memoryContextChars.toLocaleString()}字</span>
                </div>
              </div>
              <input
                className={`settings-slider${memoryContextChars !== DEFAULTS.memory_context_chars ? " active" : ""}`}
                type="range"
                min={0}
                max={6000}
                step={100}
                value={memoryContextChars}
                onChange={(e) => setMemoryContextChars(Number(e.target.value))}
                onMouseUp={() => void handleSave({ memory_context_chars: memoryContextChars })}
                onKeyUp={() => void handleSave({ memory_context_chars: memoryContextChars })}
              />
              <div className="settings-slider-labels">
                <span>0字</span>
                <span>6000字</span>
              </div>
            </div>

            <div className="settings-field">
              <div className="settings-field-header">
                <span className="settings-field-label" onMouseEnter={onTipEnter("古い記憶のスコアが半分になるまでの日数です。短いほど新しい会話を優先します。")} onMouseLeave={onTipLeave}>半減期</span>
                <div className="settings-field-controls">
                  {memoryDecayHalfLifeDays !== DEFAULTS.memory_decay_half_life_days && (
                    <button className="settings-reset-btn" title="デフォルトに戻す" onClick={() => { setMemoryDecayHalfLifeDays(DEFAULTS.memory_decay_half_life_days); void handleSave({ memory_decay_half_life_days: DEFAULTS.memory_decay_half_life_days }); }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                      </svg>
                    </button>
                  )}
                  <span className="settings-value-badge">{memoryDecayHalfLifeDays <= 0 ? "なし" : `${memoryDecayHalfLifeDays.toLocaleString()}日`}</span>
                </div>
              </div>
              <input
                className={`settings-slider${memoryDecayHalfLifeDays !== DEFAULTS.memory_decay_half_life_days ? " active" : ""}`}
                type="range"
                min={0}
                max={180}
                step={1}
                value={memoryDecayHalfLifeDays}
                onChange={(e) => setMemoryDecayHalfLifeDays(Number(e.target.value))}
                onMouseUp={() => void handleSave({ memory_decay_half_life_days: memoryDecayHalfLifeDays })}
                onKeyUp={() => void handleSave({ memory_decay_half_life_days: memoryDecayHalfLifeDays })}
              />
              <div className="settings-slider-labels">
                <span>なし</span>
                <span>180日</span>
              </div>
            </div>

            {saved && <p className="settings-saved-msg">保存しました</p>}
            {saving && <p className="settings-saved-msg">保存中…</p>}
          </div>
        )}
      </section>
      <section className="settings-section">
        <button className="settings-section-header" onClick={() => toggleSettingsSection(setDocumentsOpen, "settings_documents_open")} onMouseEnter={onTipEnter("Documents の分割設定と再インデックスを管理します。")} onMouseLeave={onTipLeave}>
          <span className="settings-section-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <path d="M14 2v6h6"/>
              <path d="M8 13h8"/>
              <path d="M8 17h6"/>
            </svg>
          </span>
          <span>Documents</span>
          <svg className={`settings-chevron${documentsOpen ? " open" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {documentsOpen && (
          <div className="settings-section-body">
            <div className="settings-field">
              <div className="settings-field-header">
                <span className="settings-field-label" onMouseEnter={onTipEnter("検索で拾った資料を最大何件までプロンプトに含めるかを調整します。")} onMouseLeave={onTipLeave}>Document Hits</span>
                <div className="settings-field-controls">
                  {documentContextTopK !== DEFAULTS.document_context_top_k && (
                    <button className="settings-reset-btn" title="デフォルトに戻す" onClick={() => { setDocumentContextTopK(DEFAULTS.document_context_top_k); void handleSave({ document_context_top_k: DEFAULTS.document_context_top_k }); }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                      </svg>
                    </button>
                  )}
                  <span className="settings-value-badge">{documentContextTopK.toLocaleString()}件</span>
                </div>
              </div>
              <input
                className={`settings-slider${documentContextTopK !== DEFAULTS.document_context_top_k ? " active" : ""}`}
                type="range"
                min={0}
                max={10}
                step={1}
                value={documentContextTopK}
                onChange={(e) => setDocumentContextTopK(Number(e.target.value))}
                onMouseUp={() => void handleSave({ document_context_top_k: documentContextTopK })}
                onKeyUp={() => void handleSave({ document_context_top_k: documentContextTopK })}
              />
              <div className="settings-slider-labels">
                <span>0件</span>
                <span>10件</span>
              </div>
            </div>

            <div className="settings-field">
              <div className="settings-field-header">
                <span className="settings-field-label" onMouseEnter={onTipEnter("検索で拾った資料コンテキストを最大何文字までプロンプトに含めるかを調整します。")} onMouseLeave={onTipLeave}>Document Context</span>
                <div className="settings-field-controls">
                  {documentContextChars !== DEFAULTS.document_context_chars && (
                    <button className="settings-reset-btn" title="デフォルトに戻す" onClick={() => { setDocumentContextChars(DEFAULTS.document_context_chars); void handleSave({ document_context_chars: DEFAULTS.document_context_chars }); }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                      </svg>
                    </button>
                  )}
                  <span className="settings-value-badge">{documentContextChars.toLocaleString()}字</span>
                </div>
              </div>
              <input
                className={`settings-slider${documentContextChars !== DEFAULTS.document_context_chars ? " active" : ""}`}
                type="range"
                min={0}
                max={6000}
                step={100}
                value={documentContextChars}
                onChange={(e) => setDocumentContextChars(Number(e.target.value))}
                onMouseUp={() => void handleSave({ document_context_chars: documentContextChars })}
                onKeyUp={() => void handleSave({ document_context_chars: documentContextChars })}
              />
              <div className="settings-slider-labels">
                <span>0字</span>
                <span>6000字</span>
              </div>
            </div>

            <div className="settings-field">
              <div className="settings-field-header">
                <span className="settings-field-label" onMouseEnter={onTipEnter("1チャンクをどのくらいの長さに寄せるかの目安です。")} onMouseLeave={onTipLeave}>目標サイズ</span>
                <div className="settings-field-controls">
                  {documentChunkTargetChars !== DEFAULTS.document_chunk_target_chars && (
                    <button className="settings-reset-btn" title="デフォルトに戻す" onClick={() => { setDocumentChunkTargetChars(DEFAULTS.document_chunk_target_chars); void handleSave({ document_chunk_target_chars: DEFAULTS.document_chunk_target_chars }); }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                      </svg>
                    </button>
                  )}
                  <span className="settings-value-badge">{documentChunkTargetChars.toLocaleString()}字</span>
                </div>
              </div>
              <input
                className={`settings-slider${documentChunkTargetChars !== DEFAULTS.document_chunk_target_chars ? " active" : ""}`}
                type="range"
                min={200}
                max={2000}
                step={50}
                value={documentChunkTargetChars}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setDocumentChunkTargetChars(next);
                  if (documentChunkMaxChars < next) setDocumentChunkMaxChars(next);
                }}
                onMouseUp={() => void handleSave({
                  document_chunk_target_chars: documentChunkTargetChars,
                  document_chunk_max_chars: Math.max(documentChunkMaxChars, documentChunkTargetChars),
                })}
                onKeyUp={() => void handleSave({
                  document_chunk_target_chars: documentChunkTargetChars,
                  document_chunk_max_chars: Math.max(documentChunkMaxChars, documentChunkTargetChars),
                })}
              />
              <div className="settings-slider-labels">
                <span>200字</span>
                <span>2000字</span>
              </div>
            </div>

            <div className="settings-field">
              <div className="settings-field-header">
                <span className="settings-field-label" onMouseEnter={onTipEnter("この長さを超える塊はさらに分割します。目標サイズ以上にしてください。")} onMouseLeave={onTipLeave}>最大サイズ</span>
                <div className="settings-field-controls">
                  {documentChunkMaxChars !== DEFAULTS.document_chunk_max_chars && (
                    <button className="settings-reset-btn" title="デフォルトに戻す" onClick={() => { setDocumentChunkMaxChars(DEFAULTS.document_chunk_max_chars); void handleSave({ document_chunk_max_chars: DEFAULTS.document_chunk_max_chars }); }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                      </svg>
                    </button>
                  )}
                  <span className="settings-value-badge">{documentChunkMaxChars.toLocaleString()}字</span>
                </div>
              </div>
              <input
                className={`settings-slider${documentChunkMaxChars !== DEFAULTS.document_chunk_max_chars ? " active" : ""}`}
                type="range"
                min={200}
                max={3000}
                step={50}
                value={documentChunkMaxChars}
                onChange={(e) => setDocumentChunkMaxChars(Math.max(Number(e.target.value), documentChunkTargetChars))}
                onMouseUp={() => void handleSave({ document_chunk_max_chars: Math.max(documentChunkMaxChars, documentChunkTargetChars) })}
                onKeyUp={() => void handleSave({ document_chunk_max_chars: Math.max(documentChunkMaxChars, documentChunkTargetChars) })}
              />
              <div className="settings-slider-labels">
                <span>200字</span>
                <span>3000字</span>
              </div>
            </div>

            <div className="settings-field">
              <div className="settings-field-header">
                <span className="settings-field-label" onMouseEnter={onTipEnter("前後の文脈を残すため、隣のチャンクへ重ねて持たせる文字数です。")} onMouseLeave={onTipLeave}>オーバーラップ</span>
                <div className="settings-field-controls">
                  {documentChunkOverlapChars !== DEFAULTS.document_chunk_overlap_chars && (
                    <button className="settings-reset-btn" title="デフォルトに戻す" onClick={() => { setDocumentChunkOverlapChars(DEFAULTS.document_chunk_overlap_chars); void handleSave({ document_chunk_overlap_chars: DEFAULTS.document_chunk_overlap_chars }); }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                      </svg>
                    </button>
                  )}
                  <span className="settings-value-badge">{documentChunkOverlapChars.toLocaleString()}字</span>
                </div>
              </div>
              <input
                className={`settings-slider${documentChunkOverlapChars !== DEFAULTS.document_chunk_overlap_chars ? " active" : ""}`}
                type="range"
                min={0}
                max={500}
                step={25}
                value={documentChunkOverlapChars}
                onChange={(e) => setDocumentChunkOverlapChars(Number(e.target.value))}
                onMouseUp={() => void handleSave({ document_chunk_overlap_chars: documentChunkOverlapChars })}
                onKeyUp={() => void handleSave({ document_chunk_overlap_chars: documentChunkOverlapChars })}
              />
              <div className="settings-slider-labels">
                <span>0字</span>
                <span>500字</span>
              </div>
            </div>

            <div className="settings-toggle-row" style={{ marginTop: 10, alignItems: "flex-start" }}>
              <div className="settings-toggle-copy">
                <span className="settings-field-label" onMouseEnter={onTipEnter("既存の workspace 資料を、現在の分割設定で再インデックスします。")} onMouseLeave={onTipLeave}>資料を再インデックス</span>
                {documentReindexResult ? (
                  <span className="settings-field-hint" style={{ marginTop: 6, color: "var(--text)" }}>{documentReindexResult}</span>
                ) : null}
              </div>
              <button
                type="button"
                className="debug-clear-btn"
                onClick={() => void handleDocumentReindex()}
                disabled={documentReindexBusy}
                style={{ minWidth: 96 }}
              >
                {documentReindexBusy ? "実行中..." : "実行"}
              </button>
            </div>

            {saved && <p className="settings-saved-msg">保存しました</p>}
            {saving && <p className="settings-saved-msg">保存中…</p>}
          </div>
        )}
      </section>
      {/* System Info */}
      <section className="settings-section">
        <button className="settings-section-header" onClick={() => toggleSettingsSection(setAdvancedOpen, "settings_advanced_open")} onMouseEnter={onTipEnter("llama.cpp server の Runtime とシステム情報を管理します。")} onMouseLeave={onTipLeave}>
          <span className="settings-section-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 14h4l2-8 4 16 2-8h4"/>
            </svg>
          </span>
          <span>Runtime</span>
          <svg className={`settings-chevron${advancedOpen ? " open" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {advancedOpen && (
          <div className="settings-section-body">
            <div className="runtime-card">
              <div className="runtime-card-header">
                <div>
                  <span className="settings-field-label">llama.cpp server Runtime</span>
                  <span className="settings-field-hint">
                    {runtimeInfo?.tag ? `Latest: ${runtimeInfo.tag}` : "GitHub Releases から最新版を確認します"}
                  </span>
                </div>
                <button className="runtime-secondary-btn" onClick={loadRuntimeInfo} disabled={runtimeInfoBusy || runtimeInstallBusy}>
                  {runtimeInfoBusy ? "Checking..." : "Check for updates"}
                </button>
              </div>

              <div className="runtime-selection-row">
                <select
                  className="settings-select"
                  value={selectedRuntimeVariant}
                  onChange={(event) => setSelectedRuntimeVariant(event.target.value)}
                  disabled={runtimeInstallBusy || runtimeInfoBusy || !runtimeInfo?.variants.length}
                >
                  {(runtimeInfo?.variants ?? []).map((variant) => (
                    <option key={variant.id} value={variant.id} disabled={!variant.available}>
                      {variant.label}{variant.installed ? " (installed)" : ""}
                    </option>
                  ))}
                </select>
                <button
                  className="primary-button"
                  onClick={() => void handleRuntimeInstall()}
                  disabled={!selectedRuntime?.available || runtimeInstallBusy || runtimeInfoBusy}
                >
                  {runtimeInstallBusy ? "Installing..." : selectedRuntime?.installed ? "Reinstall" : "Install"}
                </button>
              </div>

              {selectedRuntimeHasOptionalDlls && (
                <label className="runtime-checkbox-row">
                  <input
                    type="checkbox"
                    checked={includeCudaRuntime}
                    onChange={(event) => setIncludeCudaRuntime(event.target.checked)}
                    disabled={runtimeInstallBusy}
                  />
                  <span>
                    CUDA runtime DLLs もダウンロードする
                    <small>CUDA Toolkit がインストール済みなら通常は不要です</small>
                  </span>
                </label>
              )}

              {selectedRuntime && (
                <div className="runtime-engine-row">
                  <div>
                    <strong>{selectedRuntime.label}</strong>
                    <span>{selectedRuntime.description}</span>
                    {selectedRuntime.binary_asset && <code>{selectedRuntime.binary_asset.name}</code>}
                    {selectedRuntime.runtime_asset && includeCudaRuntime && <code>{selectedRuntime.runtime_asset.name}</code>}
                  </div>
                  <div className={selectedRuntime.installed ? "runtime-status latest" : "runtime-status"}>
                    {selectedRuntime.installed ? "Installed" : selectedRuntime.available ? formatBytes(selectedRuntimeSize) : "Unavailable"}
                  </div>
                </div>
              )}

              {runtimeMessage && <p className="settings-field-hint runtime-message">{runtimeMessage}</p>}
            </div>

            <div className="stat-list">
              <div className="stat-row"><span>推論サーバー</span><code>{llamaServerVersion ? `llama-server (${llamaServerVersion})` : "llama-server"}</code></div>
              <div className="stat-row"><span>Runtime path</span><code>{runtimeInfo?.llama_exe || "未設定"}</code></div>
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
      {/* Data */}
      <section className="settings-section">
        <button className="settings-section-header" onClick={() => toggleSettingsSection(setDataOpen, "settings_data_open")} onMouseEnter={onTipEnter("アプリ全体のデータを zip でバックアップまたは復元します。")} onMouseLeave={onTipLeave}>
          <span className="settings-section-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </span>
          <span>Data</span>
          <svg className={`settings-chevron${dataOpen ? " open" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {dataOpen && (
          <div className="settings-section-body">
            <div className="settings-toggle-row" style={{ alignItems: "flex-start" }}>
              <div className="settings-toggle-copy">
                <span className="settings-field-label">アプリ全体をエクスポート</span>
                {dataExportResult ? (
                  <span className="settings-field-hint" style={{ marginTop: 6, color: "var(--text)" }}>{dataExportResult}</span>
                ) : null}
              </div>
              <button
                type="button"
                className="debug-clear-btn"
                onClick={() => void handleDataExport()}
                disabled={dataExportBusy}
                style={{ minWidth: 96 }}
              >
                {dataExportBusy ? "出力中..." : "実行"}
              </button>
            </div>
            <div className="settings-toggle-row" style={{ marginTop: 10, alignItems: "flex-start" }}>
              <div className="settings-toggle-copy">
                <span className="settings-field-label">アプリ全体を復元</span>
                {dataImportResult ? (
                  <span className="settings-field-hint" style={{ marginTop: 6, color: "var(--text)" }}>{dataImportResult}</span>
                ) : null}
              </div>
              <button
                type="button"
                className="debug-clear-btn"
                onClick={() => void handleDataImport()}
                disabled={dataImportBusy}
                style={{ minWidth: 96 }}
              >
                {dataImportBusy ? "読込中..." : "実行"}
              </button>
            </div>
          </div>
        )}
      </section>
      {/* Debug */}
      <section className="settings-section">
        <button className="settings-section-header" onClick={() => toggleSettingsSection(setDebugOpen, "settings_debug_open")} onMouseEnter={onTipEnter("デバッグ用の設定です。")} onMouseLeave={onTipLeave}>
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
                <span className="settings-field-label" onMouseEnter={onTipEnter("assistant の各返信に対して、LLM へ送る直前の messages 全体を保存します。会話中のアイコンから後で確認できます。")} onMouseLeave={onTipLeave}>プロンプト全文を保存</span>
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
            <div className="settings-toggle-row" style={{ marginTop: 10, alignItems: "flex-start" }}>
              <div className="settings-toggle-copy">
                <span className="settings-field-label" onMouseEnter={onTipEnter("assistant ごとに保存されたプロンプト全文を一括削除します。会話履歴本文は消えません。")} onMouseLeave={onTipLeave}>保存済みプロンプト全文を全削除</span>
                {promptLogCleanupResult ? (
                  <span className="settings-field-hint" style={{ marginTop: 6, color: "var(--text)" }}>{promptLogCleanupResult}</span>
                ) : null}
              </div>
              <button
                type="button"
                className="debug-clear-btn"
                onClick={() => void handlePromptLogCleanup()}
                disabled={promptLogCleanupBusy}
                style={{ minWidth: 96 }}
              >
                {promptLogCleanupBusy ? "削除中..." : "実行"}
              </button>
            </div>
            <div className="settings-toggle-row" style={{ marginTop: 10, alignItems: "flex-start" }}>
              <div className="settings-toggle-copy">
                <span className="settings-field-label" onMouseEnter={onTipEnter("セッション・ワークスペース・documents と紐づかない孤立データをまとめて掃除します。記憶チャンク、資料チャンク、全文検索行、ベクトル行、未参照ファイルが対象です。")} onMouseLeave={onTipLeave}>データベースのクリーンナップ</span>
                {databaseCleanupResult ? (
                  <span className="settings-field-hint" style={{ marginTop: 6, color: "var(--text)" }}>{databaseCleanupResult}</span>
                ) : null}
              </div>
              <button
                type="button"
                className="debug-clear-btn"
                onClick={() => void handleDatabaseCleanup()}
                disabled={databaseCleanupBusy}
                style={{ minWidth: 96 }}
              >
                {databaseCleanupBusy ? "掃除中..." : "実行"}
              </button>
            </div>
            <div className="settings-toggle-row" style={{ marginTop: 10 }}>
              <div className="settings-toggle-copy">
                <span className="settings-field-label">システムリソース</span>
              </div>
              <button
                type="button"
                className={`settings-toggle-btn${sysResOpen ? " active" : ""}`}
                aria-pressed={sysResOpen}
                onClick={() => setSysResOpen((v) => !v)}
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
