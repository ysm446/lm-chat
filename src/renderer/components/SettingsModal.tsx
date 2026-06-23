import { useEffect, useState, type ReactNode } from "react";
import { SettingsPanel, type AppSettingsSection } from "./SettingsPanel";

type Props = {
  onClose: () => void;
};

type Category = {
  key: AppSettingsSection;
  label: string;
  icon: ReactNode;
};

const CATEGORIES: Category[] = [
  {
    key: "interface",
    label: "Interface",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>
      </svg>
    ),
  },
  {
    key: "model",
    label: "Model",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05"/><path d="M12 22.08V12"/>
      </svg>
    ),
  },
  {
    key: "runtime",
    label: "Runtime",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 14h4l2-8 4 16 2-8h4"/>
      </svg>
    ),
  },
  {
    key: "data",
    label: "Data",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>
      </svg>
    ),
  },
  {
    key: "debug",
    label: "Debug",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>
      </svg>
    ),
  },
];

export function SettingsModal({ onClose }: Props) {
  const [active, setActive] = useState<AppSettingsSection>("interface");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const activeLabel = CATEGORIES.find((c) => c.key === active)?.label ?? "";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <nav className="settings-modal-nav">
          <div className="settings-modal-nav-title">設定</div>
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              className={`settings-modal-nav-item${active === c.key ? " active" : ""}`}
              onClick={() => setActive(c.key)}
            >
              <span className="settings-modal-nav-icon">{c.icon}</span>
              <span>{c.label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-modal-main">
          <div className="settings-modal-main-header">
            <h2 className="settings-modal-title">{activeLabel}</h2>
            <button className="model-picker-close" onClick={onClose}>✕</button>
          </div>
          <div className="settings-modal-main-body">
            <SettingsPanel view="app" appSection={active} />
          </div>
        </div>
      </div>
    </div>
  );
}
