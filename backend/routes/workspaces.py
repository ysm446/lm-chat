from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..models import Workspace, WorkspaceCreate, WorkspaceReorderRequest, WorkspaceUpdate
from .deps import store

router = APIRouter()


@router.get("/workspaces", response_model=list[Workspace])
def list_workspaces() -> list[Workspace]:
    return store.list_workspaces()


@router.post("/workspaces", response_model=Workspace)
def create_workspace(payload: WorkspaceCreate) -> Workspace:
    return store.create_workspace(payload)


@router.patch("/workspaces/{workspace_id}", response_model=Workspace)
def update_workspace(workspace_id: str, payload: WorkspaceUpdate) -> Workspace:
    workspace = store.update_workspace(workspace_id, payload)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return workspace


@router.delete("/workspaces/{workspace_id}")
def delete_workspace(workspace_id: str) -> dict[str, int | bool]:
    deleted = store.delete_workspace(workspace_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return {"deleted": True, "workspace_count": store.workspace_count()}


@router.post("/workspaces/reorder")
def reorder_workspaces(payload: WorkspaceReorderRequest) -> dict:
    store.reorder_workspaces(payload.ids)
    return {"ok": True}
