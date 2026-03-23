from __future__ import annotations

from pathlib import Path


def ensure_image_directory(root: str, workspace_id: str, session_id: str) -> Path:
    path = Path(root) / workspace_id / session_id
    path.mkdir(parents=True, exist_ok=True)
    return path
