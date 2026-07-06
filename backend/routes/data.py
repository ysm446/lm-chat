from __future__ import annotations

import base64
import json
import shutil
import sqlite3
import tempfile
import zipfile
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from .. import paths
from ..models import DataArchivePathRequest, now_iso
from .deps import _DOCUMENT_DIR, _IMAGE_DIR, store

router = APIRouter()

# データアーカイブの基点。現状はライブラリ側・環境側が同一ディレクトリ（data/）のため
# _EXPORT_ITEMS の env 側ファイル（settings.json・llama_paths.json）もここに揃う。
# TODO(library-switch): ライブラリ側と環境側のルートが分岐したら、エクスポート対象を
# ライブラリ側のみに絞り、env 側（特にマシン固有の llama_paths.json）は除外する。
_DATA_DIR = paths.library_root()

_EXPORT_ITEMS = (
    Path("lm_chat.db"),
    Path("config.json"),
    Path("settings.json"),
    Path("system_prompts.json"),
    Path("llama_paths.json"),
    Path("assets") / "images",
    Path("assets") / "documents",
)

_WORKSPACE_EXPORT_FORMAT = "lm-chat-workspace-export"
_WORKSPACE_TABLES = (
    "workspaces",
    "sessions",
    "messages",
    "message_prompt_logs",
    "memory_chunks",
    "memory_fts",
    "memory_vec",
    "documents",
    "document_chunks",
    "document_fts",
    "document_vec",
)


def _normalize_archive_path(raw_path: str) -> Path:
    path = Path(raw_path).expanduser()
    if path.suffix.lower() != ".zip":
        path = path.with_suffix(".zip") if not path.suffix else path.with_name(f"{path.name}.zip")
    return path


def _copy_path(source: Path, target: Path) -> None:
    if source.is_dir():
        shutil.copytree(source, target, dirs_exist_ok=True)
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def _copy_workspace_assets(
    import_root: Path,
    old_workspace_id: str,
    new_workspace_id: str,
    session_id_map: dict[str, str],
) -> list[str]:
    copied: list[str] = []
    image_source = import_root / "assets" / "images" / old_workspace_id
    if image_source.exists():
        image_target = _IMAGE_DIR / new_workspace_id
        if image_target.exists():
            shutil.rmtree(image_target)
        image_target.mkdir(parents=True, exist_ok=True)
        for source_session_dir in image_source.iterdir():
            if source_session_dir.is_dir():
                target_name = session_id_map.get(source_session_dir.name, source_session_dir.name)
                shutil.copytree(source_session_dir, image_target / target_name)
            else:
                shutil.copy2(source_session_dir, image_target / source_session_dir.name)
        copied.append(f"assets/images/{new_workspace_id}")

    document_source = import_root / "assets" / "documents" / old_workspace_id
    if document_source.exists():
        document_target = _DOCUMENT_DIR / new_workspace_id
        if document_target.exists():
            shutil.rmtree(document_target)
        shutil.copytree(document_source, document_target)
        copied.append(f"assets/documents/{new_workspace_id}")
    return copied


def _remove_path(target: Path) -> None:
    if target.is_dir():
        shutil.rmtree(target)
    elif target.exists():
        target.unlink()


def _archive_directory(archive: zipfile.ZipFile, source: Path, arc_prefix: Path) -> bool:
    if not source.exists():
        return False
    if source.is_file():
        archive.write(source, arcname=arc_prefix.as_posix())
        return True
    wrote_any = False
    for entry in source.rglob("*"):
        if entry.is_dir():
            continue
        archive.write(entry, arcname=(arc_prefix / entry.relative_to(source)).as_posix())
        wrote_any = True
    if not wrote_any:
        archive.writestr(f"{arc_prefix.as_posix().rstrip('/')}/", "")
    return True


def _encode_db_value(value: object) -> object:
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {"__bytes__": base64.b64encode(bytes(value)).decode("ascii")}
    return value


def _decode_db_value(value: object) -> object:
    if isinstance(value, dict) and set(value.keys()) == {"__bytes__"}:
        return base64.b64decode(str(value["__bytes__"]))
    return value


def _rows(conn: sqlite3.Connection, sql: str, params: tuple[object, ...] = ()) -> list[dict[str, object]]:
    return [
        {key: _encode_db_value(row[key]) for key in row.keys()}
        for row in conn.execute(sql, params).fetchall()
    ]


def _rows_by_ids(conn: sqlite3.Connection, table: str, id_column: str, ids: list[str]) -> list[dict[str, object]]:
    if not ids:
        return []
    placeholders = ",".join("?" for _ in ids)
    return _rows(conn, f"SELECT * FROM {table} WHERE {id_column} IN ({placeholders})", tuple(ids))


def _new_prefixed_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:10]}"


def _rewrite_asset_path(value: object, old_workspace_id: str, new_workspace_id: str, session_id_map: dict[str, str]) -> object:
    if not isinstance(value, str):
        return value
    old_image_prefix = f"/assets/images/{old_workspace_id}/"
    if value.startswith(old_image_prefix):
        rest = value.removeprefix(old_image_prefix)
        old_session_id, sep, tail = rest.partition("/")
        new_session_id = session_id_map.get(old_session_id, old_session_id)
        return f"/assets/images/{new_workspace_id}/{new_session_id}{sep}{tail}"
    old_document_prefix = f"{old_workspace_id}/"
    if value.startswith(old_document_prefix):
        return f"{new_workspace_id}/{value.removeprefix(old_document_prefix)}"
    return value


def _rewrite_prompt_log_payload(value: object, old_workspace_id: str, new_workspace_id: str, session_id_map: dict[str, str]) -> object:
    if not isinstance(value, str):
        return value
    rewritten = value.replace(f"/assets/images/{old_workspace_id}/", f"/assets/images/{new_workspace_id}/")
    for old_session_id, new_session_id in session_id_map.items():
        rewritten = rewritten.replace(
            f"/assets/images/{new_workspace_id}/{old_session_id}/",
            f"/assets/images/{new_workspace_id}/{new_session_id}/",
        )
    return rewritten


def _insert_row(conn: sqlite3.Connection, table: str, row: dict[str, object]) -> None:
    columns = list(row.keys())
    placeholders = ",".join("?" for _ in columns)
    column_sql = ",".join(columns)
    values = tuple(_decode_db_value(row[column]) for column in columns)
    conn.execute(f"INSERT INTO {table} ({column_sql}) VALUES ({placeholders})", values)


def _workspace_archive_payload(workspace_id: str) -> dict[str, object]:
    with store._connect() as conn:  # type: ignore[attr-defined]
        workspace_rows = _rows(conn, "SELECT * FROM workspaces WHERE id = ?", (workspace_id,))
        if not workspace_rows:
            raise HTTPException(status_code=404, detail="Workspace not found")
        session_rows = _rows(conn, "SELECT * FROM sessions WHERE workspace_id = ?", (workspace_id,))
        session_ids = [str(row["id"]) for row in session_rows]
        message_rows = _rows_by_ids(conn, "messages", "session_id", session_ids)
        memory_rows = _rows(conn, "SELECT * FROM memory_chunks WHERE workspace_id = ?", (workspace_id,))
        memory_ids = [str(row["id"]) for row in memory_rows]
        document_rows = _rows(conn, "SELECT * FROM documents WHERE workspace_id = ?", (workspace_id,))
        document_chunk_rows = _rows(conn, "SELECT * FROM document_chunks WHERE workspace_id = ?", (workspace_id,))
        document_chunk_ids = [str(row["id"]) for row in document_chunk_rows]
        return {
            "workspace_id": workspace_id,
            "tables": {
                "workspaces": workspace_rows,
                "sessions": session_rows,
                "messages": message_rows,
                "message_prompt_logs": _rows_by_ids(conn, "message_prompt_logs", "session_id", session_ids),
                "memory_chunks": memory_rows,
                "memory_fts": _rows_by_ids(conn, "memory_fts", "id", memory_ids),
                "memory_vec": _rows_by_ids(conn, "memory_vec", "chunk_id", memory_ids),
                "documents": document_rows,
                "document_chunks": document_chunk_rows,
                "document_fts": _rows_by_ids(conn, "document_fts", "id", document_chunk_ids),
                "document_vec": _rows_by_ids(conn, "document_vec", "chunk_id", document_chunk_ids),
            },
        }


def _write_workspace_archive(workspace_id: str, target_path: Path) -> dict:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    payload = _workspace_archive_payload(workspace_id)
    exported_items = ["workspace.json"]
    with zipfile.ZipFile(target_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "manifest.json",
            json.dumps(
                {
                    "format": _WORKSPACE_EXPORT_FORMAT,
                    "version": 1,
                    "workspace_id": workspace_id,
                    "exported_at": now_iso(),
                },
                ensure_ascii=False,
                indent=2,
            ),
        )
        archive.writestr("workspace.json", json.dumps(payload, ensure_ascii=False, indent=2))
        for asset_name, root in (("images", _IMAGE_DIR), ("documents", _DOCUMENT_DIR)):
            relative = Path("assets") / asset_name / workspace_id
            if _archive_directory(archive, root / workspace_id, relative):
                exported_items.append(relative.as_posix())
    return {
        "path": str(target_path),
        "file_name": target_path.name,
        "size_bytes": target_path.stat().st_size if target_path.exists() else 0,
        "items": exported_items,
        "workspace_id": workspace_id,
    }


def _safe_extract_archive(archive: zipfile.ZipFile, destination: Path) -> None:
    for member in archive.infolist():
        member_path = Path(member.filename)
        if member_path.is_absolute() or ".." in member_path.parts:
            raise HTTPException(status_code=400, detail="Archive contains unsafe paths")
        archive.extract(member, destination)


def _find_import_root(extracted_dir: Path) -> Path | None:
    if (extracted_dir / "lm_chat.db").exists():
        return extracted_dir
    if (extracted_dir / "data" / "lm_chat.db").exists():
        return extracted_dir / "data"
    for child in extracted_dir.iterdir():
        if child.is_dir() and (child / "lm_chat.db").exists():
            return child
        if child.is_dir() and (child / "data" / "lm_chat.db").exists():
            return child / "data"
    return None


def _write_data_archive(target_path: Path) -> dict:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    exported_items: list[str] = []
    with zipfile.ZipFile(target_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "manifest.json",
            json.dumps(
                {
                    "format": "lm-chat-data-export",
                    "version": 1,
                    "exported_at": store.db_path.stat().st_mtime if store.db_path.exists() else None,
                },
                ensure_ascii=False,
                indent=2,
            ),
        )
        for relative_path in _EXPORT_ITEMS:
            source = _DATA_DIR / relative_path
            if not source.exists():
                continue
            exported_items.append(relative_path.as_posix())
            if source.is_file():
                archive.write(source, arcname=relative_path.as_posix())
                continue
            wrote_any = False
            for entry in source.rglob("*"):
                if entry.is_dir():
                    continue
                archive.write(entry, arcname=entry.relative_to(_DATA_DIR).as_posix())
                wrote_any = True
            if not wrote_any:
                archive.writestr(f"{relative_path.as_posix().rstrip('/')}/", "")
    return {
        "path": str(target_path),
        "file_name": target_path.name,
        "size_bytes": target_path.stat().st_size if target_path.exists() else 0,
        "items": exported_items,
    }


def _restore_from_backup(backup_dir: Path) -> None:
    for relative_path in _EXPORT_ITEMS:
        current_path = _DATA_DIR / relative_path
        backup_path = backup_dir / relative_path
        if current_path.exists():
            _remove_path(current_path)
        if backup_path.exists():
            _copy_path(backup_path, current_path)
    _IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    _DOCUMENT_DIR.mkdir(parents=True, exist_ok=True)


def _import_data_archive(source_path: Path) -> dict:
    if not source_path.exists() or not source_path.is_file():
        raise HTTPException(status_code=404, detail="Archive file not found")
    extract_dir = Path(tempfile.mkdtemp(prefix="lm-chat-import-"))
    backup_dir = Path(tempfile.mkdtemp(prefix="lm-chat-import-backup-"))
    try:
        try:
            with zipfile.ZipFile(source_path, "r") as archive:
                _safe_extract_archive(archive, extract_dir)
        except zipfile.BadZipFile as exc:
            raise HTTPException(status_code=400, detail="Invalid ZIP archive") from exc

        import_root = _find_import_root(extract_dir)
        if import_root is None:
            raise HTTPException(status_code=400, detail="Archive does not contain lm_chat.db")

        for relative_path in _EXPORT_ITEMS:
            current_path = _DATA_DIR / relative_path
            imported_path = import_root / relative_path
            backup_path = backup_dir / relative_path
            if current_path.exists() and imported_path.exists():
                _copy_path(current_path, backup_path)
                _remove_path(current_path)
            if imported_path.exists():
                _copy_path(imported_path, current_path)

        _IMAGE_DIR.mkdir(parents=True, exist_ok=True)
        _DOCUMENT_DIR.mkdir(parents=True, exist_ok=True)
    except HTTPException:
        _restore_from_backup(backup_dir)
        raise
    except Exception as exc:
        _restore_from_backup(backup_dir)
        raise HTTPException(status_code=500, detail=f"Import failed: {exc}") from exc
    finally:
        shutil.rmtree(extract_dir, ignore_errors=True)
        shutil.rmtree(backup_dir, ignore_errors=True)

    return {
        "imported": True,
        "restart_required": True,
        "source_path": str(source_path),
        "file_name": source_path.name,
    }


def _find_workspace_import_root(extracted_dir: Path) -> Path | None:
    if (extracted_dir / "workspace.json").exists():
        return extracted_dir
    for child in extracted_dir.iterdir():
        if child.is_dir() and (child / "workspace.json").exists():
            return child
    return None


def _load_workspace_payload(import_root: Path) -> dict[str, object]:
    payload_path = import_root / "workspace.json"
    if not payload_path.exists():
        raise HTTPException(status_code=400, detail="Archive does not contain workspace.json")
    try:
        payload = json.loads(payload_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid workspace archive metadata") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("tables"), dict):
        raise HTTPException(status_code=400, detail="Invalid workspace archive")
    return payload


def _remap_workspace_payload(payload: dict[str, object]) -> tuple[str, str, dict[str, str], dict[str, list[dict[str, object]]]]:
    tables_raw = payload["tables"]
    if not isinstance(tables_raw, dict):
        raise HTTPException(status_code=400, detail="Invalid workspace archive")
    tables: dict[str, list[dict[str, object]]] = {}
    for table in _WORKSPACE_TABLES:
        rows = tables_raw.get(table, [])
        if not isinstance(rows, list):
            raise HTTPException(status_code=400, detail="Invalid workspace archive rows")
        tables[table] = [dict(row) for row in rows if isinstance(row, dict)]

    if not tables["workspaces"]:
        raise HTTPException(status_code=400, detail="Workspace archive has no workspace row")

    old_workspace_id = str(tables["workspaces"][0]["id"])
    new_workspace_id = _new_prefixed_id("ws")
    session_id_map = {str(row["id"]): _new_prefixed_id("sess") for row in tables["sessions"]}
    message_id_map = {str(row["id"]): _new_prefixed_id("msg") for row in tables["messages"]}
    memory_id_map = {str(row["id"]): _new_prefixed_id("mem") for row in tables["memory_chunks"]}
    document_id_map = {str(row["id"]): _new_prefixed_id("doc") for row in tables["documents"]}
    document_chunk_id_map = {str(row["id"]): _new_prefixed_id("dchunk") for row in tables["document_chunks"]}

    workspace_row = tables["workspaces"][0]
    workspace_row["id"] = new_workspace_id
    workspace_row["created_at"] = now_iso()
    workspace_row["updated_at"] = now_iso()

    for row in tables["sessions"]:
        row["id"] = session_id_map[str(row["id"])]
        row["workspace_id"] = new_workspace_id

    for row in tables["messages"]:
        row["id"] = message_id_map[str(row["id"])]
        row["session_id"] = session_id_map[str(row["session_id"])]
        for field in ("image_data", "image_preview_data"):
            row[field] = _rewrite_asset_path(row.get(field), old_workspace_id, new_workspace_id, session_id_map)

    for row in tables["message_prompt_logs"]:
        row["assistant_message_id"] = message_id_map[str(row["assistant_message_id"])]
        row["session_id"] = session_id_map[str(row["session_id"])]
        row["payload_json"] = _rewrite_prompt_log_payload(row.get("payload_json"), old_workspace_id, new_workspace_id, session_id_map)

    for row in tables["memory_chunks"]:
        row["id"] = memory_id_map[str(row["id"])]
        row["workspace_id"] = new_workspace_id
        row["session_id"] = session_id_map.get(str(row["session_id"]), str(row["session_id"]))

    for row in tables["memory_fts"]:
        row["id"] = memory_id_map[str(row["id"])]

    for row in tables["memory_vec"]:
        row["chunk_id"] = memory_id_map[str(row["chunk_id"])]

    for row in tables["documents"]:
        row["id"] = document_id_map[str(row["id"])]
        row["workspace_id"] = new_workspace_id
        if row.get("session_id") is not None:
            row["session_id"] = session_id_map.get(str(row["session_id"]), str(row["session_id"]))
        row["file_path"] = _rewrite_asset_path(row.get("file_path"), old_workspace_id, new_workspace_id, session_id_map)

    for row in tables["document_chunks"]:
        row["id"] = document_chunk_id_map[str(row["id"])]
        row["document_id"] = document_id_map[str(row["document_id"])]
        row["workspace_id"] = new_workspace_id
        if row.get("session_id") is not None:
            row["session_id"] = session_id_map.get(str(row["session_id"]), str(row["session_id"]))

    for row in tables["document_fts"]:
        row["id"] = document_chunk_id_map[str(row["id"])]

    for row in tables["document_vec"]:
        row["chunk_id"] = document_chunk_id_map[str(row["chunk_id"])]

    return old_workspace_id, new_workspace_id, session_id_map, tables


def _import_workspace_archive(source_path: Path) -> dict:
    if not source_path.exists() or not source_path.is_file():
        raise HTTPException(status_code=404, detail="Archive file not found")
    extract_dir = Path(tempfile.mkdtemp(prefix="lm-chat-workspace-import-"))
    copied_assets: list[str] = []
    try:
        try:
            with zipfile.ZipFile(source_path, "r") as archive:
                _safe_extract_archive(archive, extract_dir)
        except zipfile.BadZipFile as exc:
            raise HTTPException(status_code=400, detail="Invalid ZIP archive") from exc

        import_root = _find_workspace_import_root(extract_dir)
        if import_root is None:
            raise HTTPException(status_code=400, detail="Archive does not contain workspace.json")

        old_workspace_id, new_workspace_id, session_id_map, tables = _remap_workspace_payload(_load_workspace_payload(import_root))
        copied_assets = _copy_workspace_assets(import_root, old_workspace_id, new_workspace_id, session_id_map)

        with store._connect() as conn:  # type: ignore[attr-defined]
            row = conn.execute("SELECT MAX(sort_order) AS max_order FROM workspaces").fetchone()
            tables["workspaces"][0]["sort_order"] = (row["max_order"] + 1) if row and row["max_order"] is not None else 0
            for table in _WORKSPACE_TABLES:
                for item in tables[table]:
                    _insert_row(conn, table, item)
            conn.commit()
    except HTTPException:
        for relative in copied_assets:
            _remove_path(_DATA_DIR / relative)
        raise
    except Exception as exc:
        for relative in copied_assets:
            _remove_path(_DATA_DIR / relative)
        raise HTTPException(status_code=500, detail=f"Workspace import failed: {exc}") from exc
    finally:
        shutil.rmtree(extract_dir, ignore_errors=True)

    return {
        "imported": True,
        "restart_required": False,
        "source_path": str(source_path),
        "file_name": source_path.name,
        "workspace_id": new_workspace_id,
    }


@router.post("/data/export")
def export_data_archive(payload: DataArchivePathRequest) -> dict:
    target_path = _normalize_archive_path(payload.path)
    try:
        return _write_data_archive(target_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Export failed: {exc}") from exc


@router.post("/data/import")
def import_data_archive(payload: DataArchivePathRequest) -> dict:
    return _import_data_archive(Path(payload.path).expanduser())


@router.post("/data/workspaces/{workspace_id}/export")
def export_workspace_archive(workspace_id: str, payload: DataArchivePathRequest) -> dict:
    target_path = _normalize_archive_path(payload.path)
    try:
        return _write_workspace_archive(workspace_id, target_path)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Workspace export failed: {exc}") from exc


@router.post("/data/workspaces/import")
def import_workspace_archive(payload: DataArchivePathRequest) -> dict:
    return _import_workspace_archive(Path(payload.path).expanduser())
