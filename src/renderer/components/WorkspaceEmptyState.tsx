import { useState } from "react";
import { useChatStore } from "../stores/chatStore";

export function WorkspaceEmptyState() {
  const createWorkspace = useChatStore((state) => state.createWorkspace);
  const createSession = useChatStore((state) => state.createSession);
  const [name, setName] = useState("Investing");
  const [description, setDescription] = useState("Stocks, funds, and portfolio notes");

  const handleCreate = async () => {
    const workspace = await createWorkspace(name.trim() || "New Workspace", description.trim());
    await createSession(workspace.id, `${workspace.name} first chat`);
  };

  return (
    <div className="empty-shell">
      <div className="empty-card">
        <p className="eyebrow">LM Chat</p>
        <h1>Create your first workspace</h1>
        <p className="muted">
          Split chats and memory by topic, such as investing, fiction, or development notes.
        </p>

        <label className="field">
          <span>Workspace name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="field">
          <span>Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </label>

        <button className="primary-button" onClick={() => void handleCreate()}>
          Create Workspace
        </button>
      </div>
    </div>
  );
}