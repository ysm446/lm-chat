import { useEffect } from "react";
import { SettingsPanel } from "./SettingsPanel";

type Props = {
  onClose: () => void;
};

export function SettingsModal({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <h2 className="settings-modal-title">設定</h2>
          <button className="model-picker-close" onClick={onClose}>✕</button>
        </div>
        <div className="settings-modal-body">
          <SettingsPanel view="app" />
        </div>
      </div>
    </div>
  );
}
