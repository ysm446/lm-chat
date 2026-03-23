import { useState } from "react";
import { useChatStore } from "../stores/chatStore";

export function WorkspaceEmptyState() {
  const createWorkspace = useChatStore((state) => state.createWorkspace);
  const createSession = useChatStore((state) => state.createSession);
  const [name, setName] = useState("Investing");
  const [description, setDescription] = useState("Stocks, funds, and portfolio notes");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreate = async () => {
    setIsCreating(true);
    setCreateError(null);
    try {
      const workspace = await createWorkspace(name.trim() || "New Workspace", description.trim());
      await createSession(workspace.id, `${workspace.name} first chat`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create workspace");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="empty-shell">
      <div className="empty-card">
        <p className="eyebrow">LM Chat</p>
        <h1>最初のワークスペースを作成</h1>
        <p className="muted">
          投資、小説、開発メモなど、用途ごとにチャットと記憶を分けて管理できます。
        </p>

        <label className="field">
          <span>ワークスペース名</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="field">
          <span>説明</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </label>

        {createError && <p className="error-text">{createError}</p>}

        <button className="primary-button" onClick={() => void handleCreate()} disabled={isCreating}>
          {isCreating ? "作成中…" : "ワークスペースを作成"}
        </button>
      </div>
    </div>
  );
}