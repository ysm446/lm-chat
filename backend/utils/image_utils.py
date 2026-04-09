from __future__ import annotations

import base64
import re
from pathlib import Path
from uuid import uuid4

_DATA_URL_PATTERN = re.compile(r"^data:(?P<mime>[\w.+-]+/[\w.+-]+);base64,(?P<data>.+)$")
_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def ensure_image_directory(root: str | Path, workspace_id: str, session_id: str) -> Path:
    path = Path(root) / workspace_id / session_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_data_url_image(root: str | Path, workspace_id: str, session_id: str, image_data: str) -> str:
    match = _DATA_URL_PATTERN.match(image_data)
    if match is None:
        raise ValueError("Unsupported image format")

    mime = match.group("mime").lower()
    extension = _EXTENSIONS.get(mime)
    if extension is None:
        raise ValueError(f"Unsupported image MIME type: {mime}")

    payload = base64.b64decode(match.group("data"), validate=True)
    image_dir = ensure_image_directory(root, workspace_id, session_id)
    file_name = f"{uuid4().hex}{extension}"
    file_path = image_dir / file_name
    file_path.write_bytes(payload)
    return f"/assets/images/{workspace_id}/{session_id}/{file_name}"
