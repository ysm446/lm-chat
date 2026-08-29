import { Fragment, useEffect, useRef, useState } from "react";
import { useChatStore } from "../stores/chatStore";

function formatSize(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

function extractParams(id: string): string | null {
  const m = id.match(/(\d+(?:\.\d+)?)\s*[Bb](?:[^a-zA-Z]|$)/);
  return m ? `${m[1]}B` : null;
}

type Props = { onClose: () => void };

export function ModelPickerModal({ onClose }: Props) {
  const availableModels = useChatStore((s) => s.availableModels);
  const activeModelPath = useChatStore((s) => s.activeModelPath);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);
  const applyModelSwitch = useChatStore((s) => s.applyModelSwitch);

  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const activeModel = availableModels.find((m) => activeModelPath?.includes(m.id));

  const filtered = availableModels.filter((m) =>
    m.id.toLowerCase().includes(filter.toLowerCase())
  );

  const handleSelect = async (modelId: string) => {
    if (modelId === activeModel?.id) { onClose(); return; }
    setSelectedModel(modelId);
    onClose();
    await applyModelSwitch();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="model-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="model-picker-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: "var(--text-faint)" }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={inputRef}
            className="model-picker-input"
            placeholder="Type to filter models..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button className="model-picker-close" onClick={onClose}>✕</button>
        </div>

        <div className="model-picker-list">
          {filtered.map((m, i) => {
            const isActive = m.id === activeModel?.id;
            const isRecent = m.recent_rank != null;
            const prevRecent = i > 0 ? filtered[i - 1].recent_rank != null : null;
            const sectionLabel =
              i === 0 ? (isRecent ? "Recent" : "Your Models")
              : prevRecent && !isRecent ? "Your Models"
              : null;
            const paramsLabel = m.params_label ?? extractParams(m.id) ?? "";
            const quantLabel = m.quantization ?? "";
            return (
              <Fragment key={m.id}>
              {sectionLabel && <div className="model-picker-section-label">{sectionLabel}</div>}
              <button
                className={`model-picker-item${isActive ? " active" : ""}`}
                onClick={() => void handleSelect(m.id)}
              >
                <span className="model-picker-name">{m.id}</span>
                <span className="model-picker-meta">
                  <span className={`model-picker-params${paramsLabel ? "" : " is-empty"}`}>{paramsLabel}</span>
                  <span className={`model-picker-quant${quantLabel ? "" : " is-empty"}`}>{quantLabel}</span>
                  <span className="model-picker-size">{formatSize(m.size_bytes)}</span>
                  <span className={`model-picker-badge${isActive ? "" : " is-empty"}`}>{isActive ? "読込中" : ""}</span>
                </span>
              </button>
              </Fragment>
            );
          })}
          {filtered.length === 0 && (
            <p className="model-picker-empty">モデルが見つかりません</p>
          )}
        </div>
      </div>
    </div>
  );
}
