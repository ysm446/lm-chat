import { useState } from "react";
import { useChatStore } from "../stores/chatStore";

export function WorkspaceSwitcher() {
  const workspaces = useChatStore((state) => state.workspaces);
  const currentWorkspaceId = useChatStore((state) => state.currentWorkspaceId);
  const selectWorkspace = useChatStore((state) => state.selectWorkspace);
  const createWorkspace = useChatStore((state) => state.createWorkspace);
  const createSession = useChatStore((state) => state.createSession);
  const [draftName, setDraftName] = useState("");

  const handleAdd = async () => {
    const name = draftName.trim();
    if (!name) return;
    const workspace = await createWorkspace(name, "");
    await createSession(workspace.id, `${workspace.name} new chat`);
    setDraftName("");
  };

  return (
    <section className="panel workspace-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h2>Switch context</h2>
        </div>
      </div>

      <div className="workspace-list">
        {workspaces.map((workspace) => (
          <button
            key={workspace.id}
            className={workspace.id === currentWorkspaceId ? "workspace-item active" : "workspace-item"}
            onClick={() => void selectWorkspace(workspace.id)}
          >
            <span>{workspace.name}</span>
            <small>{workspace.description || "No description"}</small>
          </button>
        ))}
      </div>

      <div className="inline-form">
        <input
          placeholder="New workspace"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
        />
        <button className="primary-button small" onClick={() => void handleAdd()}>
          +
        </button>
      </div>
    </section>
  );
}