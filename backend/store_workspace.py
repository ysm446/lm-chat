from __future__ import annotations

from .models import Workspace, WorkspaceCreate, WorkspaceUpdate, now_iso


class WorkspaceMixin:
    def workspace_count(self) -> int:
        with self._connect() as conn:  # type: ignore[attr-defined]
            row = conn.execute("SELECT COUNT(*) AS count FROM workspaces").fetchone()
        return 0 if row is None else int(row["count"])

    def has_workspace(self, workspace_id: str) -> bool:
        with self._connect() as conn:  # type: ignore[attr-defined]
            row = conn.execute("SELECT 1 FROM workspaces WHERE id = ?", (workspace_id,)).fetchone()
        return row is not None

    def list_workspaces(self) -> list[Workspace]:
        with self._connect() as conn:  # type: ignore[attr-defined]
            rows = conn.execute(
                "SELECT id, name, description, sort_order, created_at, updated_at FROM workspaces ORDER BY sort_order ASC, created_at ASC"
            ).fetchall()
        return [self._workspace_from_row(row) for row in rows]  # type: ignore[attr-defined]

    def create_workspace(self, payload: WorkspaceCreate) -> Workspace:
        with self._connect() as conn:  # type: ignore[attr-defined]
            row = conn.execute("SELECT MAX(sort_order) AS max_order FROM workspaces").fetchone()
            next_order = (row["max_order"] + 1) if row and row["max_order"] is not None else 0
        workspace = Workspace(id=self._new_id("ws"), sort_order=next_order, **payload.model_dump())  # type: ignore[attr-defined]
        with self._connect() as conn:  # type: ignore[attr-defined]
            conn.execute(
                "INSERT INTO workspaces (id, name, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (workspace.id, workspace.name, workspace.description, workspace.sort_order, workspace.created_at, workspace.updated_at),
            )
        return workspace

    def update_workspace(self, workspace_id: str, payload: WorkspaceUpdate) -> Workspace | None:
        with self._connect() as conn:  # type: ignore[attr-defined]
            row = conn.execute(
                "SELECT id, name, description, sort_order, created_at, updated_at FROM workspaces WHERE id = ?",
                (workspace_id,),
            ).fetchone()
            if row is None:
                return None
            data = dict(row)
            for key, value in payload.model_dump(exclude_none=True).items():
                data[key] = value
            data["updated_at"] = now_iso()
            conn.execute(
                "UPDATE workspaces SET name = ?, description = ?, updated_at = ? WHERE id = ?",
                (data["name"], data["description"], data["updated_at"], workspace_id),
            )
        return Workspace(**data)

    def delete_workspace(self, workspace_id: str) -> bool:
        with self._connect() as conn:  # type: ignore[attr-defined]
            session_rows = conn.execute(
                "SELECT id FROM sessions WHERE workspace_id = ?", (workspace_id,)
            ).fetchall()
            session_ids = [str(row["id"]) for row in session_rows]
            image_paths = self._collect_image_paths_for_session_ids(conn, session_ids)  # type: ignore[attr-defined]
            cursor = conn.execute("DELETE FROM workspaces WHERE id = ?", (workspace_id,))
            self._cleanup_unreferenced_images(conn, image_paths)  # type: ignore[attr-defined]
        return cursor.rowcount > 0

    def reorder_workspaces(self, ids: list[str]) -> None:
        with self._connect() as conn:  # type: ignore[attr-defined]
            for order, ws_id in enumerate(ids):
                conn.execute("UPDATE workspaces SET sort_order = ? WHERE id = ?", (order, ws_id))
