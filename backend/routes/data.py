from __future__ import annotations

import json
import shutil
import tempfile
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..models import DataArchivePathRequest
from .deps import _DATA_DIR, _DOCUMENT_DIR, _IMAGE_DIR, store

router = APIRouter()

_EXPORT_ITEMS = (
    Path("lm_chat.db"),
    Path("config.json"),
    Path("settings.json"),
    Path("system_prompts.json"),
    Path("llama_paths.json"),
    Path("assets") / "images",
    Path("assets") / "documents",
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


def _remove_path(target: Path) -> None:
    if target.is_dir():
        shutil.rmtree(target)
    elif target.exists():
        target.unlink()


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
