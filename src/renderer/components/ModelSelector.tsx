import { useChatStore } from "../stores/chatStore";

export function ModelSelector() {
  const { availableModels, selectedModel, setSelectedModel } = useChatStore();

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
      <select
        value={selectedModel ?? ""}
        onChange={(e) => setSelectedModel(e.target.value)}
        style={{
          background: "transparent",
          border: "none",
          color: "inherit",
          font: "inherit",
          fontWeight: 600,
          cursor: "pointer",
          outline: "none",
          padding: 0,
          maxWidth: "200px"
        }}
      >
        {availableModels.map((m) => (
          <option key={m.id} value={m.id} style={{ background: "var(--panel)", color: "var(--text)" }}>
            {m.id}
          </option>
        ))}
      </select>
    </div>
  );
}
