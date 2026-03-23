import { useChatStore } from "../stores/chatStore";

export function ModelSelector() {
  const availableModels = useChatStore((s) => s.availableModels);
  const selectedModel = useChatStore((s) => s.selectedModel);
  const activeModelPath = useChatStore((s) => s.activeModelPath);
  const isSwitchingModel = useChatStore((s) => s.isSwitchingModel);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);
  const applyModelSwitch = useChatStore((s) => s.applyModelSwitch);

  const activeModel = availableModels.find((m) => activeModelPath?.includes(m.id));
  const isDirty = selectedModel !== null && selectedModel !== activeModel?.id;

  if (availableModels.length === 0) {
    return (
      <div className="model-chip">
        <span className="eyebrow">モデル</span>
        <strong>{selectedModel ?? "—"}</strong>
      </div>
    );
  }

  return (
    <div className="model-chip">
      <span className="eyebrow">モデル</span>
      {isSwitchingModel ? (
        <span className="model-switching-label">
          <span className="model-spinner" />
          切り替え中…
        </span>
      ) : (
        <>
          <select
            value={selectedModel ?? ""}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="model-select"
          >
            {availableModels.map((m) => (
              <option key={m.id} value={m.id} style={{ background: "#1c1f2b", color: "#e2e4ef" }}>
                {m.id}
              </option>
            ))}
          </select>
          {isDirty && (
            <button
              className="primary-button small"
              onClick={() => void applyModelSwitch()}
              title="このモデルに切り替えて llama-server を再起動"
            >
              適用
            </button>
          )}
        </>
      )}
    </div>
  );
}
