import { useEffect, useRef, useState } from "react";

import { useChatStore } from "../stores/chatStore";

type WorkspaceMenuState = {
  workspaceId: string;
  name: string;
  description: string;
  x: number;
  y: number;
};

export function WorkspaceSwitcher() {
  const workspaces = useChatStore((state) => state.workspaces);
  const currentWorkspaceId = useChatStore((state) => state.currentWorkspaceId);
  const selectWorkspace = useChatStore((state) => state.selectWorkspace);
  const createWorkspace = useChatStore((state) => state.createWorkspace);
  const createSession = useChatStore((state) => state.createSession);
  const renameWorkspace = useChatStore((state) => state.renameWorkspace);
  const removeWorkspace = useChatStore((state) => state.removeWorkspace);
  const [draftName, setDraftName] = useState("");
  const [menu, setMenu] = useState<WorkspaceMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menu) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && event.target instanceof Node && !menuRef.current.contains(event.target)) {
        setMenu(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [menu]);

  const handleAdd = async () => {
    const name = draftName.trim();
    if (!name) return;
    const workspace = await createWorkspace(name, "");
    await createSession(workspace.id, "新規チャット");
    setDraftName("");
  };

  const handleRename = async (workspaceId: string, currentName: string, currentDescription: string) => {
    const name = window.prompt("ワークスペース名を変更", currentName);
    if (!name) return;
    const description = window.prompt("説明", currentDescription) ?? currentDescription;
    await renameWorkspace(workspaceId, name.trim(), description.trim());
    setMenu(null);
  };

  const handleDelete = async (workspaceId: string, currentName: string) => {
    const ok = window.confirm(`ワークスペース「${currentName}」を削除しますか？チャット履歴と記憶もすべて削除されます。`);
    if (!ok) return;
    await removeWorkspace(workspaceId);
    setMenu(null);
  };

  const openMenu = (workspaceId: string, name: string, description: string, x: number, y: number) => {
    setMenu({ workspaceId, name, description, x, y });
  };

  return (
    <section className="panel workspace-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">ワークスペース</p>
          <h2>切り替え</h2>
        </div>
      </div>

      <div className="workspace-list">
        {workspaces.map((workspace) => (
          <div key={workspace.id} className={workspace.id === currentWorkspaceId ? "workspace-row active" : "workspace-row"}>
            <button className={workspace.id === currentWorkspaceId ? "workspace-item active" : "workspace-item"} onClick={() => void selectWorkspace(workspace.id)}>
              <span>{workspace.name}</span>
              <small>{workspace.description || "説明なし"}</small>
            </button>
            <div className="row-actions">
              <button
                className="row-menu-button"
                aria-label={`${workspace.name} menu`}
                onClick={(event) => {
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  openMenu(workspace.id, workspace.name, workspace.description, rect.right - 8, rect.bottom + 6);
                }}
              >
                ...
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="inline-form">
        <input placeholder="新しいワークスペース" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
        <button className="primary-button small" onClick={() => void handleAdd()}>
          +
        </button>
      </div>

      {menu ? (
        <div ref={menuRef} className="context-menu" style={{ left: `${menu.x}px`, top: `${menu.y}px` }} role="menu">
          <button className="context-menu-item" onClick={() => void handleRename(menu.workspaceId, menu.name, menu.description)}>
            名前を変更
          </button>
          <button className="context-menu-item danger" onClick={() => void handleDelete(menu.workspaceId, menu.name)}>
            削除
          </button>
        </div>
      ) : null}
    </section>
  );
}
