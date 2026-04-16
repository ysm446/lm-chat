import { useState } from "react";
import { useChatStore } from "../stores/chatStore";
import { ModelPickerModal } from "./ModelPickerModal";

type Props = {
  showLeft: boolean;
  showRight: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
};

export function ModelBar({ showLeft, showRight, onToggleLeft, onToggleRight }: Props) {
  const availableModels = useChatStore((s) => s.availableModels);
  const activeModelPath = useChatStore((s) => s.activeModelPath);
  const isSwitchingModel = useChatStore((s) => s.isSwitchingModel);
  const ejectModel = useChatStore((s) => s.ejectModel);
  const [showPicker, setShowPicker] = useState(false);

  const activeModel = availableModels.find((m) => activeModelPath?.includes(m.id));
  const hasModel = !!activeModel;

  return (
    <>
      <div className="model-bar">
        {/* 左サイドバートグル */}
        <button
          className={`model-bar-panel-btn${showLeft ? " active" : ""}`}
          onClick={onToggleLeft}
          title={showLeft ? "左サイドバーを隠す" : "左サイドバーを表示"}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="16" height="14" rx="2"/>
            <line x1="7" y1="3" x2="7" y2="17"/>
          </svg>
        </button>

        {/* 中央：モデル選択 + イジェクト */}
        <div className="model-bar-center">
          <button
            className={`model-bar-select-btn${hasModel ? " active" : ""}${isSwitchingModel ? " loading" : ""}`}
            onClick={() => setShowPicker(true)}
            disabled={isSwitchingModel}
            title="モデルを選択"
            aria-busy={isSwitchingModel}
          >
            <span
              className={`model-bar-progress${isSwitchingModel ? " switching" : ""}`}
              aria-hidden="true"
            />
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="2"/>
              <rect x="9" y="9" width="6" height="6"/>
              <line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/>
              <line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/>
              <line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/>
              <line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>
            </svg>
            <span className="model-bar-label">
              {isSwitchingModel ? "切り替え中…" : hasModel ? activeModel.id : "Select a model to load"}
            </span>
            {isSwitchingModel && <span className="model-bar-loading-dot" aria-hidden="true" />}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          {hasModel && (
            <button
              className="model-bar-eject-btn"
              onClick={() => void ejectModel()}
              disabled={isSwitchingModel}
              title="モデルをアンロード (VRAM 解放)"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 21 12 3 12"/>
                <rect x="3" y="18" width="18" height="4" rx="1"/>
              </svg>
            </button>
          )}
        </div>

        {/* 右サイドバートグル */}
        <button
          className={`model-bar-panel-btn${showRight ? " active" : ""}`}
          onClick={onToggleRight}
          title={showRight ? "右サイドバーを隠す" : "右サイドバーを表示"}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="16" height="14" rx="2"/>
            <line x1="13" y1="3" x2="13" y2="17"/>
          </svg>
        </button>
      </div>

      {showPicker && <ModelPickerModal onClose={() => setShowPicker(false)} />}
    </>
  );
}
