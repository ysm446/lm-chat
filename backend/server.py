from __future__ import annotations

import hashlib
import json
import logging
import re
import shutil
import struct
import tempfile
import threading
from pathlib import Path
import zipfile

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)
CORRECTION_PROMPT_MODES = {"light", "standard", "aggressive", "custom"}


def _resolve_correction_prompt(settings: dict) -> str | None:
    mode = settings.get("correction_prompt_mode", "standard")
    if mode not in CORRECTION_PROMPT_MODES:
        mode = "standard"
    if mode == "light":
        return _LIGHT_CORRECTION_PROMPT
    if mode == "aggressive":
        return _AGGRESSIVE_CORRECTION_PROMPT
    if mode == "custom":
        custom_prompt = (settings.get("correction_custom_prompt") or "").strip()
        return custom_prompt or _STANDARD_CORRECTION_PROMPT
    return _STANDARD_CORRECTION_PROMPT

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import psutil
try:
    import pynvml as nvml
    nvml.nvmlInit()
    _NVML_AVAILABLE = True
except Exception:
    _NVML_AVAILABLE = False

from .config_store import get as get_config_data
from .config_store import update as update_config_data
from .settings_store import get as get_settings_data
from .settings_store import update as update_settings_data
from .system_prompt_store import create_prompt, delete_prompt, update_prompt, reorder_prompts, get_all as get_system_prompts, set_active_text, set_active_id
from .llama_manager import eject_model, get_llama_paths, get_llama_server_version, get_model_props, is_ready, switch_model
from .llm_proxy import SYSTEM_PROMPT, _AGGRESSIVE_CORRECTION_PROMPT, _LIGHT_CORRECTION_PROMPT, _STANDARD_CORRECTION_PROMPT, autocomplete as llm_autocomplete, build_chat_messages, correct as llm_correct, count_tokens, generate_chat_completion, generate_title, list_models, stream_chat_completion, stream_temp_chat
from .memory.engine import MemoryEngine
from .documents.chunker import chunk_document
from .models import (
    ChatSendRequest,
    ChatSendResponse,
    ChatRegenerateRequest,
    ConfigUpdate,
    DataArchivePathRequest,
    Document,
    DocumentCreate,
    DocumentReorderRequest,
    DocumentUploadRequest,
    DocumentUpdateRequest,
    MemorySaveRequest,
    MemorySearchResult,
    Message,
    MessageCreate,
    MessageUpdate,
    Session,
    SessionCreate,
    SessionUpdate,
    TempChatRequest,
    WebSearchRequest,
    Workspace,
    WorkspaceCreate,
    WorkspaceReorderRequest,
    SessionReorderRequest,
    WorkspaceUpdate,
)
from .search.web_search import search_web
from .store import SQLiteStore
from .utils.image_utils import save_data_url_image

app = FastAPI(title="LM Chat Backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

store = SQLiteStore()
memory_engine = MemoryEngine(store)
_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_IMAGE_DIR = _DATA_DIR / "assets" / "images"
_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/assets/images", StaticFiles(directory=_IMAGE_DIR), name="chat-images")
_DOCUMENT_DIR = _DATA_DIR / "assets" / "documents"
_DOCUMENT_DIR.mkdir(parents=True, exist_ok=True)
_EXPORT_ITEMS = (
    Path("lm_chat.db"),
    Path("config.json"),
    Path("settings.json"),
    Path("system_prompts.json"),
    Path("llama_paths.json"),
    Path("assets") / "images",
    Path("assets") / "documents",
)
_DOCUMENT_MIME_TYPES = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
}
_DOCUMENT_ALLOWED_EXTENSIONS = tuple(_DOCUMENT_MIME_TYPES)


def _start_background_task(target, *, name: str) -> None:
    threading.Thread(target=target, name=name, daemon=True).start()


def _warmup_embedder() -> None:
    try:
        from .memory.embedder import warmup

        warmup()
    except Exception as exc:
        logger.warning("Embedder warmup failed: %s", exc)


@app.on_event("startup")
def startup_background_tasks() -> None:
    _start_background_task(_warmup_embedder, name="embedder-warmup")


def build_memory_context(session: Session, query: str) -> str:
    try:
        config = get_config_data()
        top_k = max(0, int(config.get("memory_context_top_k", 5)))
        half_life_days = max(0, int(config.get("memory_decay_half_life_days", 30)))
        memory_scope = str(config.get("memory_scope", "workspace"))
        if top_k <= 0:
            return ""
        context = memory_engine.build_prompt_context(
            session.workspace_id,
            query,
            top_k=top_k,
            exclude_session_id=session.id,
            session_scope=memory_scope,
            half_life_days=half_life_days,
        )
        logger.debug("Memory context built (%d chars): %s", len(context), context[:120])
        return context
    except Exception as e:
        logger.warning("Memory context build failed: %s", e)
        return ""


def build_document_context(session: Session, query: str) -> str:
    """ワークスペース資料から関連チャンクを取得してコンテキスト文字列を組み立てる。"""
    try:
        config = get_config_data()
        top_k = max(0, int(config.get("document_context_top_k", 3)))
        if top_k <= 0:
            return ""
        chunks = store.search_documents(session.workspace_id, query, top_k=top_k)
        if not chunks:
            return ""
        lines = [
            "## ワークスペース資料から検索された関連情報",
            "以下はワークスペースに登録された資料から自動検索された情報です。",
            "",
        ]
        # ドキュメントIDでグループ化してファイル名ラベルを付ける
        seen_docs: dict[str, str] = {}
        for chunk in chunks:
            if chunk.document_id not in seen_docs:
                doc = store.get_document(chunk.document_id)
                seen_docs[chunk.document_id] = doc.file_name if doc else chunk.document_id
            label = seen_docs[chunk.document_id]
            lines.append(f"[参照資料: {label}]")
            lines.append(chunk.content)
            lines.append("")
        return "\n".join(lines)
    except Exception as e:
        logger.warning("Document context build failed: %s", e)
        return ""


def combine_contexts(
    memory_context: str,
    doc_context: str,
    memory_max_chars: int,
    doc_max_chars: int,
) -> str:
    """メモリと資料を個別上限で切り詰めて結合する。"""
    parts = []
    for ctx, max_chars in ((doc_context, doc_max_chars), (memory_context, memory_max_chars)):
        if not ctx:
            continue
        if max_chars <= 0:
            continue
        if len(ctx) > max_chars:
            ctx = ctx[:max_chars]
        parts.append(ctx)
    return "\n\n".join(parts)


def build_combined_context(session: Session, query: str, include_memory: bool, include_documents: bool) -> str:
    memory_context = build_memory_context(session, query) if include_memory else ""
    doc_context = build_document_context(session, query) if include_documents else ""
    config = get_config_data()
    return combine_contexts(
        memory_context,
        doc_context,
        memory_max_chars=int(config.get("memory_context_chars", 1500)),
        doc_max_chars=int(config.get("document_context_chars", 2000)),
    )


def save_turn_memory(session_id: str, user_content: str, assistant_content: str) -> None:
    memory_engine.save_session_messages(
        session_id,
        [
            MessageCreate(role="user", content=user_content),
            MessageCreate(role="assistant", content=assistant_content),
        ],
    )


def rebuild_session_memory(session_id: str) -> None:
    session = store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    store.delete_session_memory(session_id)
    memory_messages = [
        MessageCreate(role=message.role, content=message.content)
        for message in session.messages
        if message.role in {"user", "assistant"} and message.content.strip()
    ]
    if memory_messages:
        memory_engine.save_session_messages(session_id, memory_messages)


def _get_active_model_name() -> str | None:
    """現在 llama-server で動いているモデルの名前（ファイル stem）を返す。"""
    active_path = get_llama_paths().get("active_model_path", "")
    return Path(active_path).stem if active_path else None


def _prepare_image_data(session_id: str, image_data: str | None) -> str | None:
    if not image_data:
        return None
    if not image_data.startswith("data:"):
        return image_data

    session = store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return save_data_url_image(_IMAGE_DIR, session.workspace_id, session.id, image_data)


def _prepare_image_fields(
    session_id: str,
    image_data: str | None,
    image_preview_data: str | None,
) -> tuple[str | None, str | None]:
    return (
        _prepare_image_data(session_id, image_data),
        _prepare_image_data(session_id, image_preview_data),
    )


def _save_prompt_log_if_enabled(session_id: str, assistant_message_id: str, prompt_messages: list[dict]) -> None:
    if not get_settings_data().get("debug_prompt_log", False):
        return
    saved = store.save_message_prompt_log(assistant_message_id, session_id, prompt_messages)
    if saved is None:
        logger.warning("Prompt log save failed for message %s", assistant_message_id)


def _validate_document_extension(file_name: str) -> str:
    ext = Path(file_name).suffix.lower()
    if ext not in _DOCUMENT_ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Only .txt, .md, .json are allowed",
        )
    return ext


def _document_mime_type(file_name: str) -> str:
    return _DOCUMENT_MIME_TYPES[_validate_document_extension(file_name)]


def _hash_document_content(content: str) -> tuple[bytes, str]:
    content_bytes = content.encode("utf-8")
    return content_bytes, hashlib.sha256(content_bytes).hexdigest()


def _resolve_unique_document_path(workspace_id: str, file_name: str) -> Path:
    workspace_dir = _DOCUMENT_DIR / workspace_id
    workspace_dir.mkdir(parents=True, exist_ok=True)

    ext = Path(file_name).suffix.lower()
    stem = Path(file_name).stem
    target = workspace_dir / file_name
    counter = 1
    while target.exists():
        target = workspace_dir / f"{stem}_{counter}{ext}"
        counter += 1
    return target


def _start_document_indexing(doc_id: str, file_name: str, content: str, *, action: str) -> None:
    chunking = _get_document_chunking_config()

    def _index_document() -> None:
        try:
            chunks = chunk_document(file_name, content, **chunking)
            store.index_document_chunks(doc_id, chunks)
            logger.info("Document %s: %s (%d chunks)", action, doc_id, len(chunks))
        except Exception as exc:
            logger.warning("Document %s failed: %s", action, exc)

    _start_background_task(_index_document, name=f"document-index-{doc_id}")


def _get_document_chunking_config() -> dict[str, int]:
    config = get_config_data()
    target = max(100, int(config.get("document_chunk_target_chars", 800)))
    max_chars = max(target, int(config.get("document_chunk_max_chars", 1000)))
    overlap = max(0, min(int(config.get("document_chunk_overlap_chars", 100)), max_chars - 1))
    return {
        "chunk_target": target,
        "chunk_max": max_chars,
        "overlap": overlap,
    }


def _normalize_archive_path(raw_path: str) -> Path:
    path = Path(raw_path).expanduser()
    if path.suffix.lower() != ".zip":
        if path.suffix:
            path = path.with_name(f"{path.name}.zip")
        else:
            path = path.with_suffix(".zip")
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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/autocomplete")
def autocomplete_endpoint(payload: dict) -> dict[str, str]:
    text = payload.get("text", "").strip()
    if not text or len(text) < 4 or not is_ready():
        return {"completion": ""}
    try:
        max_tokens = get_config_data().get("completion_length", 80)
        return {"completion": llm_autocomplete(text, max_tokens)}
    except Exception:
        return {"completion": ""}


@app.post("/correct")
def correct_endpoint(payload: dict) -> dict[str, str]:
    text = payload.get("text", "").strip()
    if not text or not is_ready():
        return {"corrected": ""}
    try:
        system_prompt = _resolve_correction_prompt(get_settings_data())
        return {"corrected": llm_correct(text, system_prompt)}
    except Exception:
        return {"corrected": ""}


@app.post("/tokenize")
def tokenize(payload: dict) -> dict[str, int]:
    text = payload.get("text", "")
    if not text:
        return {"token_count": 0}
    try:
        return {"token_count": count_tokens(text)}
    except Exception:
        return {"token_count": max(1, len(text) // 2)}


@app.get("/system-prompts")
def list_system_prompts() -> dict:
    return get_system_prompts()


@app.post("/system-prompts")
def add_system_prompt(payload: dict) -> dict:
    name = payload.get("name", "").strip()
    content = payload.get("content", "")
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    prompt = create_prompt(name, content)
    return prompt


@app.patch("/system-prompts/{prompt_id}")
def edit_system_prompt(prompt_id: str, payload: dict) -> dict:
    name = payload.get("name")
    content = payload.get("content")
    updated = update_prompt(prompt_id, name, content)
    if not updated:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return updated


@app.post("/system-prompts/reorder")
def reorder_system_prompts(payload: dict) -> dict:
    ids = payload.get("ids", [])
    reorder_prompts(ids)
    return {"ok": True}


@app.delete("/system-prompts/{prompt_id}")
def remove_system_prompt(prompt_id: str) -> dict[str, bool]:
    deleted = delete_prompt(prompt_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return {"deleted": True}


@app.patch("/system-prompts/active")
def update_active_system_prompt(payload: dict) -> dict[str, str]:
    text = payload.get("text", "")
    prompt_id = payload.get("active_id", "")
    set_active_text(text)
    set_active_id(prompt_id)
    return {"active_text": text, "active_id": prompt_id}


@app.get("/v1/models")
def get_models() -> dict[str, list[dict[str, str]]]:
    return list_models()


_MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

_QUANTIZATION_PATTERN = re.compile(
    r"(?i)(?:^|[-_.])((?:IQ|Q|TQ)\d+(?:[_-][A-Z0-9]+){0,3}|BF16|FP16|F16|BF8|FP8)(?:[-_.]|$)"
)
_SIZE_LABEL_PATTERN = re.compile(r"(?i)(?:^|[-_.])((?:\d+x)?(?:\d+\.)?\d+[KMBTQ])(?:[-_.]|$)")

_GGUF_METADATA_VALUE_UINT8 = 0
_GGUF_METADATA_VALUE_INT8 = 1
_GGUF_METADATA_VALUE_UINT16 = 2
_GGUF_METADATA_VALUE_INT16 = 3
_GGUF_METADATA_VALUE_UINT32 = 4
_GGUF_METADATA_VALUE_INT32 = 5
_GGUF_METADATA_VALUE_FLOAT32 = 6
_GGUF_METADATA_VALUE_BOOL = 7
_GGUF_METADATA_VALUE_STRING = 8
_GGUF_METADATA_VALUE_ARRAY = 9
_GGUF_METADATA_VALUE_UINT64 = 10
_GGUF_METADATA_VALUE_INT64 = 11
_GGUF_METADATA_VALUE_FLOAT64 = 12

_GGUF_FTYPE_LABELS = {
    0: "F32",
    1: "F16",
    2: "Q4_0",
    3: "Q4_1",
    7: "Q8_0",
    8: "Q5_0",
    9: "Q5_1",
    10: "Q2_K",
    11: "Q3_K_S",
    12: "Q3_K_M",
    13: "Q3_K_L",
    14: "Q4_K_S",
    15: "Q4_K_M",
    16: "Q5_K_S",
    17: "Q5_K_M",
    18: "Q6_K",
    19: "TQ1_0",
    20: "TQ2_0",
    21: "IQ2_XXS",
    22: "IQ2_XS",
    23: "IQ3_XXS",
    24: "IQ1_S",
    25: "IQ4_NL",
    26: "IQ3_S",
    27: "IQ2_S",
    28: "IQ4_XS",
    29: "I8",
    30: "I16",
    31: "I32",
    32: "I64",
    33: "F64",
    34: "IQ1_M",
    35: "BF16",
    36: "TQ1_0",
    37: "TQ2_0",
    38: "IQ4_NL",
    39: "IQ4_NL",
    40: "IQ4_NL",
    41: "MXFP4",
}


def _extract_quantization_label(path: Path) -> str | None:
    match = _QUANTIZATION_PATTERN.search(path.stem)
    if not match:
        return None
    return match.group(1).replace("-", "_").upper()


def _extract_size_label(path: Path) -> str | None:
    match = _SIZE_LABEL_PATTERN.search(path.stem)
    if not match:
        return None
    return match.group(1).replace("-", "_").upper()


def _read_gguf_string(handle) -> str:
    length = struct.unpack("<Q", handle.read(8))[0]
    if length == 0:
        return ""
    return handle.read(length).decode("utf-8", errors="replace")


def _read_gguf_value(handle, value_type: int) -> object:
    if value_type == _GGUF_METADATA_VALUE_UINT8:
        return struct.unpack("<B", handle.read(1))[0]
    if value_type == _GGUF_METADATA_VALUE_INT8:
        return struct.unpack("<b", handle.read(1))[0]
    if value_type == _GGUF_METADATA_VALUE_UINT16:
        return struct.unpack("<H", handle.read(2))[0]
    if value_type == _GGUF_METADATA_VALUE_INT16:
        return struct.unpack("<h", handle.read(2))[0]
    if value_type == _GGUF_METADATA_VALUE_UINT32:
        return struct.unpack("<I", handle.read(4))[0]
    if value_type == _GGUF_METADATA_VALUE_INT32:
        return struct.unpack("<i", handle.read(4))[0]
    if value_type == _GGUF_METADATA_VALUE_FLOAT32:
        return struct.unpack("<f", handle.read(4))[0]
    if value_type == _GGUF_METADATA_VALUE_BOOL:
        return struct.unpack("<?", handle.read(1))[0]
    if value_type == _GGUF_METADATA_VALUE_STRING:
        return _read_gguf_string(handle)
    if value_type == _GGUF_METADATA_VALUE_UINT64:
        return struct.unpack("<Q", handle.read(8))[0]
    if value_type == _GGUF_METADATA_VALUE_INT64:
        return struct.unpack("<q", handle.read(8))[0]
    if value_type == _GGUF_METADATA_VALUE_FLOAT64:
        return struct.unpack("<d", handle.read(8))[0]
    if value_type == _GGUF_METADATA_VALUE_ARRAY:
        array_type = struct.unpack("<I", handle.read(4))[0]
        length = struct.unpack("<Q", handle.read(8))[0]
        return [_read_gguf_value(handle, array_type) for _ in range(length)]
    raise ValueError(f"Unsupported GGUF metadata value type: {value_type}")


def _read_gguf_metadata(path: Path) -> dict[str, object]:
    try:
        with path.open("rb") as handle:
            magic = handle.read(4)
            if magic != b"GGUF":
                return {}
            version = struct.unpack("<I", handle.read(4))[0]
            if version not in {2, 3}:
                logger.debug("Unsupported GGUF version %s for %s", version, path)
                return {}
            _tensor_count = struct.unpack("<Q", handle.read(8))[0]
            metadata_count = struct.unpack("<Q", handle.read(8))[0]
            metadata: dict[str, object] = {}
            for _ in range(metadata_count):
                key = _read_gguf_string(handle)
                value_type = struct.unpack("<I", handle.read(4))[0]
                value = _read_gguf_value(handle, value_type)
                metadata[key] = value
            return metadata
    except Exception as exc:
        logger.debug("Failed to read GGUF metadata for %s: %s", path, exc)
        return {}


def _format_quantization_from_ftype(value: object) -> str | None:
    if not isinstance(value, int):
        return None
    return _GGUF_FTYPE_LABELS.get(value)


def _get_local_model_display_info(path: Path) -> dict[str, object]:
    metadata = _read_gguf_metadata(path)
    size_label = metadata.get("general.size_label")
    quantization = _format_quantization_from_ftype(metadata.get("general.file_type"))
    if not isinstance(size_label, str) or not size_label.strip():
        size_label = _extract_size_label(path)
    if not quantization:
        quantization = _extract_quantization_label(path)
    return {
        "id": path.stem,
        "path": str(path),
        "size_bytes": path.stat().st_size,
        "params_label": size_label.strip().upper() if isinstance(size_label, str) else None,
        "quantization": quantization,
    }


@app.get("/models/local")
def list_local_models() -> list[dict]:
    if not _MODELS_DIR.exists():
        return []
    return [
        _get_local_model_display_info(p)
        for p in sorted(_MODELS_DIR.rglob("*.gguf"))
        if "mmproj" not in p.stem.lower()
    ]


@app.get("/workspaces", response_model=list[Workspace])
def list_workspaces() -> list[Workspace]:
    return store.list_workspaces()


@app.post("/workspaces", response_model=Workspace)
def create_workspace(payload: WorkspaceCreate) -> Workspace:
    return store.create_workspace(payload)


@app.patch("/workspaces/{workspace_id}", response_model=Workspace)
def update_workspace(workspace_id: str, payload: WorkspaceUpdate) -> Workspace:
    workspace = store.update_workspace(workspace_id, payload)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return workspace


@app.delete("/workspaces/{workspace_id}")
def delete_workspace(workspace_id: str) -> dict[str, int | bool]:
    deleted = store.delete_workspace(workspace_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return {"deleted": True, "workspace_count": store.workspace_count()}


@app.post("/workspaces/reorder")
def reorder_workspaces(payload: WorkspaceReorderRequest) -> dict:
    store.reorder_workspaces(payload.ids)
    return {"ok": True}


@app.post("/history/sessions/reorder")
def reorder_sessions(payload: SessionReorderRequest) -> dict:
    store.reorder_sessions(payload.ids)
    return {"ok": True}


@app.get("/history/sessions", response_model=list[Session])
def list_sessions(workspace_id: str = Query(...)) -> list[Session]:
    return store.list_sessions(workspace_id)


@app.post("/history/sessions", response_model=Session)
def create_session(payload: SessionCreate) -> Session:
    if not store.has_workspace(payload.workspace_id):
        raise HTTPException(status_code=404, detail="Workspace not found")
    return store.create_session(payload)


@app.get("/history/sessions/{session_id}", response_model=Session)
def get_session(session_id: str) -> Session:
    session = store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.patch("/history/sessions/{session_id}", response_model=Session)
def update_session(session_id: str, payload: SessionUpdate) -> Session:
    session = store.update_session(session_id, payload)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.post("/history/sessions/{session_id}/generate-title", response_model=Session)
def generate_session_title(session_id: str) -> Session:
    session = store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    first_user = next((m for m in session.messages if m.role == "user"), None)
    if first_user is None:
        raise HTTPException(status_code=400, detail="No user message found")
    title = generate_title(first_user.content)
    updated = store.update_session(session_id, SessionUpdate(title=title))
    if updated is None:
        raise HTTPException(status_code=500, detail="Failed to update session title")
    return updated


@app.delete("/history/messages/{message_id}")
def delete_message(message_id: str) -> dict[str, bool]:
    deleted = store.delete_message(message_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"deleted": True}


@app.patch("/history/messages/{message_id}", response_model=Message)
def update_message(message_id: str, payload: MessageUpdate) -> Message:
    session_id = store.get_message_session_id(message_id)
    if session_id is None:
        raise HTTPException(status_code=404, detail="Message not found")
    stored_image_data, stored_image_preview_data = _prepare_image_fields(
        session_id,
        payload.image_data,
        payload.image_preview_data,
    )
    message = store.update_message(
        message_id,
        payload.content,
        stored_image_data,
        stored_image_preview_data,
    )
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found")
    return message


@app.post("/history/sessions/{session_id}/move", response_model=Session)
def move_session(session_id: str, payload: dict) -> Session:
    target_workspace_id = payload.get("workspace_id", "")
    if not target_workspace_id:
        raise HTTPException(status_code=400, detail="workspace_id is required")
    if not store.has_workspace(target_workspace_id):
        raise HTTPException(status_code=404, detail="Target workspace not found")
    session = store.move_session(session_id, target_workspace_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.post("/history/sessions/{session_id}/branch", response_model=Session)
def branch_session(session_id: str, payload: dict) -> Session:
    up_to_message_id = payload.get("up_to_message_id", "")
    if not up_to_message_id:
        raise HTTPException(status_code=400, detail="up_to_message_id is required")
    new_session = store.branch_session(session_id, up_to_message_id)
    if new_session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return new_session


@app.post("/history/sessions/{session_id}/duplicate", response_model=Session)
def duplicate_session(session_id: str) -> Session:
    new_session = store.duplicate_session(session_id)
    if new_session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return new_session


@app.post("/history/sessions/{session_id}/messages", response_model=Message)
def append_session_message(session_id: str, payload: MessageCreate) -> Message:
    message = store.append_message(session_id, payload)
    if message is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return message


@app.post("/chat/temp/stream")
def chat_temp_stream(payload: TempChatRequest) -> StreamingResponse:
    messages = [{"role": m.role, "content": m.content} for m in payload.messages]

    temperature = get_config_data().get("temperature", 0.8)

    def event_stream():
        collected: list[str] = []
        final_stats: dict | None = None
        try:
            for item in stream_temp_chat(messages, payload.thinking_enabled, payload.system_prompt, temperature):
                if isinstance(item, str):
                    collected.append(item)
                    yield f"data: {json.dumps({'type': 'token', 'content': item})}\n\n"
                else:
                    final_stats = item
        except HTTPException as exc:
            yield f"data: {json.dumps({'type': 'error', 'detail': exc.detail})}\n\n"
            return
        yield f"data: {json.dumps({'type': 'done', 'stats': final_stats})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/chat/send", response_model=ChatSendResponse)
def chat_send(payload: ChatSendRequest) -> ChatSendResponse:
    stored_image_data, stored_image_preview_data = _prepare_image_fields(
        payload.session_id,
        payload.image_data,
        payload.image_preview_data,
    )
    user_message = store.append_message(
        payload.session_id,
        MessageCreate(
            role="user",
            content=payload.content,
            image_data=stored_image_data,
            image_preview_data=stored_image_preview_data,
        ),
    )
    if user_message is None:
        raise HTTPException(status_code=404, detail="Session not found")

    session = store.get_session(payload.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    full_context = build_combined_context(session, payload.content, payload.memory_enabled, payload.doc_rag_enabled)
    temperature = get_config_data().get("temperature", 0.8)
    prompt_messages = build_chat_messages(session, full_context, payload.system_prompt)
    assistant_text = generate_chat_completion(
        session,
        full_context,
        payload.thinking_enabled,
        payload.system_prompt,
        temperature,
        messages=prompt_messages,
    )
    assistant_message = store.append_message(
        payload.session_id,
        MessageCreate(role="assistant", content=assistant_text),
    )
    if assistant_message is None:
        raise HTTPException(status_code=500, detail="Failed to store assistant response")
    _save_prompt_log_if_enabled(payload.session_id, assistant_message.id, prompt_messages)

    save_turn_memory(payload.session_id, payload.content, assistant_text)

    updated_session = store.get_session(payload.session_id)
    if updated_session is None:
        raise HTTPException(status_code=500, detail="Failed to reload session")
    latest_assistant = next((msg for msg in reversed(updated_session.messages) if msg.id == assistant_message.id), assistant_message)
    return ChatSendResponse(session=updated_session, assistant_message=latest_assistant)


@app.post("/chat/send/stream")
def chat_send_stream(payload: ChatSendRequest) -> StreamingResponse:
    stored_image_data, stored_image_preview_data = _prepare_image_fields(
        payload.session_id,
        payload.image_data,
        payload.image_preview_data,
    )
    user_message = store.append_message(
        payload.session_id,
        MessageCreate(
            role="user",
            content=payload.content,
            image_data=stored_image_data,
            image_preview_data=stored_image_preview_data,
        ),
    )
    if user_message is None:
        raise HTTPException(status_code=404, detail="Session not found")

    session = store.get_session(payload.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    full_context = build_combined_context(session, payload.content, payload.memory_enabled, payload.doc_rag_enabled)
    thinking_enabled = payload.thinking_enabled
    system_prompt = payload.system_prompt
    temperature = get_config_data().get("temperature", 0.8)
    prompt_messages = build_chat_messages(session, full_context, system_prompt)

    def event_stream():
        collected: list[str] = []
        final_stats: dict | None = None
        try:
            for item in stream_chat_completion(
                session,
                full_context,
                thinking_enabled,
                system_prompt,
                temperature,
                messages=prompt_messages,
            ):
                if isinstance(item, str):
                    collected.append(item)
                    yield f"data: {json.dumps({'type': 'token', 'content': item})}\n\n"
                else:
                    final_stats = item
        except HTTPException as exc:
            yield f"data: {json.dumps({'type': 'error', 'detail': exc.detail})}\n\n"
            return

        assistant_text = "".join(collected).strip()
        assistant_message = store.append_message(
            payload.session_id,
            MessageCreate(
                role="assistant",
                content=assistant_text,
                prompt_tokens=final_stats.get("prompt_tokens") if final_stats else None,
                completion_tokens=final_stats.get("completion_tokens") if final_stats else None,
                tokens_per_second=final_stats.get("tokens_per_second") if final_stats else None,
                elapsed_seconds=final_stats.get("elapsed_seconds") if final_stats else None,
                finish_reason=final_stats.get("finish_reason") if final_stats else None,
                model_name=_get_active_model_name() or session.model_name or None,
            ),
        )
        if assistant_message is None:
            yield f"data: {json.dumps({'type': 'error', 'detail': 'Failed to store assistant response'})}\n\n"
            return
        _save_prompt_log_if_enabled(payload.session_id, assistant_message.id, prompt_messages)
        updated_session = store.get_session(payload.session_id)
        if updated_session is None:
            yield f"data: {json.dumps({'type': 'error', 'detail': 'Failed to store assistant response'})}\n\n"
            return

        try:
            save_turn_memory(payload.session_id, payload.content, assistant_text)
            logger.debug("Memory saved for session %s", payload.session_id)
        except Exception as e:
            logger.warning("Memory save failed: %s", e)
        yield f"data: {json.dumps({'type': 'done', 'session': updated_session.model_dump()})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


class ChatContinueRequest(BaseModel):
    session_id: str
    thinking_enabled: bool = False
    memory_enabled: bool = True
    doc_rag_enabled: bool = True
    system_prompt: str | None = None


@app.post("/chat/continue/stream")
def chat_continue_stream(payload: ChatContinueRequest) -> StreamingResponse:
    session = store.get_session(payload.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.messages or session.messages[-1].role != "user":
        raise HTTPException(status_code=400, detail="Last message must be from user")

    last_user_content = session.messages[-1].content
    full_context = build_combined_context(session, last_user_content, payload.memory_enabled, payload.doc_rag_enabled)
    thinking_enabled = payload.thinking_enabled
    system_prompt = payload.system_prompt
    temperature = get_config_data().get("temperature", 0.8)
    prompt_messages = build_chat_messages(session, full_context, system_prompt)

    def event_stream():
        collected: list[str] = []
        final_stats: dict | None = None
        try:
            for item in stream_chat_completion(
                session,
                full_context,
                thinking_enabled,
                system_prompt,
                temperature,
                messages=prompt_messages,
            ):
                if isinstance(item, str):
                    collected.append(item)
                    yield f"data: {json.dumps({'type': 'token', 'content': item})}\n\n"
                else:
                    final_stats = item
        except HTTPException as exc:
            yield f"data: {json.dumps({'type': 'error', 'detail': exc.detail})}\n\n"
            return

        assistant_text = "".join(collected).strip()
        assistant_message = store.append_message(
            payload.session_id,
            MessageCreate(
                role="assistant",
                content=assistant_text,
                prompt_tokens=final_stats.get("prompt_tokens") if final_stats else None,
                completion_tokens=final_stats.get("completion_tokens") if final_stats else None,
                tokens_per_second=final_stats.get("tokens_per_second") if final_stats else None,
                elapsed_seconds=final_stats.get("elapsed_seconds") if final_stats else None,
                finish_reason=final_stats.get("finish_reason") if final_stats else None,
                model_name=_get_active_model_name() or session.model_name or None,
            ),
        )
        if assistant_message is None:
            yield f"data: {json.dumps({'type': 'error', 'detail': 'Failed to store assistant response'})}\n\n"
            return
        _save_prompt_log_if_enabled(payload.session_id, assistant_message.id, prompt_messages)
        updated_session = store.get_session(payload.session_id)
        if updated_session is None:
            yield f"data: {json.dumps({'type': 'error', 'detail': 'Failed to store assistant response'})}\n\n"
            return
        yield f"data: {json.dumps({'type': 'done', 'session': updated_session.model_dump()})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/chat/regenerate/stream")
def chat_regenerate_stream(payload: ChatRegenerateRequest) -> StreamingResponse:
    session = store.get_session(payload.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    user_index = next((i for i, message in enumerate(session.messages) if message.id == payload.user_message_id), -1)
    if user_index < 0:
        raise HTTPException(status_code=404, detail="User message not found")

    user_message = session.messages[user_index]
    if user_message.role != "user":
        raise HTTPException(status_code=400, detail="Target message must be from user")

    assistant_index = user_index + 1
    if assistant_index >= len(session.messages) or session.messages[assistant_index].role != "assistant":
        raise HTTPException(status_code=400, detail="The next message after the target user message must be assistant")

    target_assistant = session.messages[assistant_index]
    prefix_messages = session.messages[: user_index + 1]
    generation_session = session.model_copy(update={"messages": prefix_messages})

    full_context = build_combined_context(
        generation_session,
        user_message.content,
        payload.memory_enabled,
        payload.doc_rag_enabled,
    )
    temperature = get_config_data().get("temperature", 0.8)
    prompt_messages = build_chat_messages(generation_session, full_context, payload.system_prompt)

    def event_stream():
        collected: list[str] = []
        final_stats: dict | None = None
        try:
            for item in stream_chat_completion(
                generation_session,
                full_context,
                payload.thinking_enabled,
                payload.system_prompt,
                temperature,
                messages=prompt_messages,
            ):
                if isinstance(item, str):
                    collected.append(item)
                    yield f"data: {json.dumps({'type': 'token', 'content': item})}\n\n"
                else:
                    final_stats = item
        except HTTPException as exc:
            yield f"data: {json.dumps({'type': 'error', 'detail': exc.detail})}\n\n"
            return

        assistant_text = "".join(collected).strip()
        updated_assistant = store.replace_message(
            target_assistant.id,
            MessageCreate(
                role="assistant",
                content=assistant_text,
                prompt_tokens=final_stats.get("prompt_tokens") if final_stats else None,
                completion_tokens=final_stats.get("completion_tokens") if final_stats else None,
                tokens_per_second=final_stats.get("tokens_per_second") if final_stats else None,
                elapsed_seconds=final_stats.get("elapsed_seconds") if final_stats else None,
                finish_reason=final_stats.get("finish_reason") if final_stats else None,
                model_name=_get_active_model_name() or session.model_name or None,
            ),
        )
        if updated_assistant is None:
            yield f"data: {json.dumps({'type': 'error', 'detail': 'Failed to update assistant response'})}\n\n"
            return
        _save_prompt_log_if_enabled(payload.session_id, updated_assistant.id, prompt_messages)

        try:
            rebuild_session_memory(payload.session_id)
        except Exception as exc:
            logger.warning("Session memory rebuild failed after regenerate: %s", exc)

        updated_session = store.get_session(payload.session_id)
        if updated_session is None:
            yield f"data: {json.dumps({'type': 'error', 'detail': 'Failed to reload session'})}\n\n"
            return
        yield f"data: {json.dumps({'type': 'done', 'session': updated_session.model_dump()})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.delete("/history/sessions/{session_id}")
def delete_session(session_id: str, delete_memory: bool = True) -> dict[str, bool | int]:
    deleted = store.delete_session(session_id, delete_memory=delete_memory)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"deleted": True, "session_count": store.session_count()}


@app.post("/memory/save")
def save_memory(payload: MemorySaveRequest) -> dict[str, int]:
    chunks = memory_engine.save_session_messages(payload.session_id, payload.messages)
    if chunks is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"saved": len(chunks)}


@app.get("/memory/search", response_model=MemorySearchResult)
def search_memory(query: str, workspace_id: str, top_k: int = 5) -> MemorySearchResult:
    half_life_days = max(0, int(get_config_data().get("memory_decay_half_life_days", 30)))
    items = memory_engine.search(workspace_id, query, top_k, half_life_days=half_life_days)
    return MemorySearchResult(query=query, workspace_id=workspace_id, items=items)


@app.delete("/memory/session/{session_id}")
def delete_session_memory(session_id: str) -> dict[str, int]:
    return {"deleted": store.delete_session_memory(session_id)}


@app.delete("/memory/workspace/{workspace_id}")
def delete_workspace_memory(workspace_id: str) -> dict[str, int]:
    return {"deleted": store.delete_workspace_memory(workspace_id)}


@app.post("/memory/cleanup")
def cleanup_memory() -> dict[str, int]:
    return store.cleanup_memory()


@app.post("/documents/cleanup")
def cleanup_documents() -> dict[str, int]:
    return store.cleanup_documents()


@app.post("/documents/reindex")
def reindex_workspace_documents() -> dict[str, int]:
    docs = store.list_all_workspace_documents()
    total = len(docs)
    succeeded = 0
    failed = 0
    chunking = _get_document_chunking_config()

    for doc in docs:
        file_path = _DOCUMENT_DIR / doc.file_path
        store.set_document_indexed_at(doc.id, None)
        try:
            content = file_path.read_text(encoding="utf-8")
            chunks = chunk_document(doc.file_name, content, **chunking)
            store.index_document_chunks(doc.id, chunks)
            succeeded += 1
        except Exception as exc:
            failed += 1
            logger.warning("Document re-indexing failed for %s: %s", doc.id, exc)

    return {"total": total, "succeeded": succeeded, "failed": failed}


@app.delete("/debug/prompt-logs")
def clear_all_prompt_logs() -> dict[str, int]:
    return {"cleared": store.clear_all_message_prompt_logs()}


@app.get("/memory/stats")
def memory_stats() -> dict[str, int]:
    return {
        "workspace_count": store.workspace_count(),
        "session_count": store.session_count(),
        "memory_chunk_count": store.memory_chunk_count(),
    }


@app.get("/documents", response_model=list[Document])
def list_documents(workspace_id: str = Query(...)) -> list[Document]:
    return store.list_documents(workspace_id)


@app.post("/documents/reorder")
def reorder_documents(payload: DocumentReorderRequest) -> dict[str, bool]:
    store.reorder_documents(payload.ids)
    return {"ok": True}


@app.post("/documents/{doc_id}/move", response_model=Document)
def move_document(doc_id: str, payload: dict) -> Document:
    target_workspace_id = payload.get("workspace_id", "")
    if not target_workspace_id:
        raise HTTPException(status_code=400, detail="workspace_id is required")
    if not store.has_workspace(target_workspace_id):
        raise HTTPException(status_code=404, detail="Target workspace not found")
    doc = store.move_document(doc_id, target_workspace_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@app.post("/documents", response_model=Document)
def create_document(payload: DocumentUploadRequest) -> Document:
    if not store.has_workspace(payload.workspace_id):
        raise HTTPException(status_code=404, detail="Workspace not found")

    _validate_document_extension(payload.file_name)
    mime_type = _document_mime_type(payload.file_name)
    content_bytes, file_hash = _hash_document_content(payload.content)
    target = _resolve_unique_document_path(payload.workspace_id, payload.file_name)
    target.write_text(payload.content, encoding="utf-8")
    relative_path = f"{payload.workspace_id}/{target.name}"

    doc = store.create_document(
        DocumentCreate(
            workspace_id=payload.workspace_id,
            session_id=payload.session_id,
            scope=payload.scope,
            file_name=target.name,
            mime_type=mime_type,
            file_path=relative_path,
            file_size=len(content_bytes),
            file_hash=file_hash,
        )
    )

    _start_document_indexing(doc.id, doc.file_name, payload.content, action="indexed")
    return doc


@app.get("/documents/{doc_id}")
def get_document(doc_id: str) -> dict:
    doc = store.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    # ファイル内容を読み込む
    file_path = _DOCUMENT_DIR / doc.file_path
    try:
        content = file_path.read_text(encoding="utf-8")
    except OSError:
        content = ""
    return {**doc.model_dump(), "content": content}


@app.patch("/documents/{doc_id}", response_model=Document)
def update_document(doc_id: str, payload: DocumentUpdateRequest) -> Document:
    doc = store.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")

    # ファイル名変更
    if payload.file_name is not None and payload.file_name != doc.file_name:
        _validate_document_extension(payload.file_name)
        renamed = store.rename_document(doc_id, payload.file_name)
        if renamed is None:
            raise HTTPException(status_code=500, detail="Failed to rename file")
        doc = renamed

    # 内容更新
    if payload.content is not None:
        content_bytes, file_hash = _hash_document_content(payload.content)
        file_path = _DOCUMENT_DIR / doc.file_path
        try:
            file_path.write_text(payload.content, encoding="utf-8")
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"Failed to write file: {e}") from e

        store.update_document_file_metadata(doc_id, len(content_bytes), file_hash)
        store.set_document_indexed_at(doc_id, None)
        _start_document_indexing(doc_id, doc.file_name, payload.content, action="re-indexed")

    updated = store.get_document(doc_id)
    if updated is None:
        raise HTTPException(status_code=500, detail="Failed to reload document")
    return updated


@app.delete("/documents/{doc_id}")
def delete_document(doc_id: str) -> dict[str, bool]:
    deleted = store.delete_document(doc_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"deleted": True}


@app.post("/search/web")
def web_search(payload: WebSearchRequest) -> dict:
    return search_web(payload.query, payload.max_results).model_dump()


@app.get("/config")
def get_config() -> dict:
    return get_config_data()


@app.patch("/config")
def patch_config(payload: ConfigUpdate) -> dict:
    return update_config_data(payload.model_dump(exclude_none=True))


@app.get("/settings")
def get_settings() -> dict:
    return get_settings_data()


@app.patch("/settings")
def patch_settings(payload: dict) -> dict:
    return update_settings_data(payload)


@app.post("/data/export")
def export_data_archive(payload: DataArchivePathRequest) -> dict:
    target_path = _normalize_archive_path(payload.path)
    try:
        return _write_data_archive(target_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Export failed: {exc}") from exc


@app.post("/data/import")
def import_data_archive(payload: DataArchivePathRequest) -> dict:
    return _import_data_archive(Path(payload.path).expanduser())


@app.get("/history/messages/{message_id}/prompt-log")
def get_message_prompt_log(message_id: str) -> dict:
    prompt_log = store.get_message_prompt_log(message_id)
    if prompt_log is None:
        raise HTTPException(status_code=404, detail="Prompt log not found")
    try:
        messages = json.loads(prompt_log.payload_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="Prompt log is corrupted") from exc
    return {
        "assistant_message_id": prompt_log.assistant_message_id,
        "session_id": prompt_log.session_id,
        "messages": messages,
        "created_at": prompt_log.created_at,
        "updated_at": prompt_log.updated_at,
    }


@app.get("/history/sessions/{session_id}/token_count")
def get_session_token_count(session_id: str) -> dict[str, int]:
    session = store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    text = SYSTEM_PROMPT + "\n"
    for msg in session.messages:
        text += f"{msg.role}: {msg.content}\n"
    count = count_tokens(text)
    config = get_config_data()
    return {"token_count": count, "ctx_size": config["ctx_size"]}


@app.get("/llama/props")
def llama_props() -> dict:
    return get_model_props()


@app.get("/llama/status")
def llama_status() -> dict:
    paths = get_llama_paths()
    return {
        "ready": is_ready(),
        "active_model_path": paths.get("active_model_path", ""),
        "version": get_llama_server_version(paths=paths),
    }


@app.post("/llama/eject")
def llama_eject() -> dict:
    eject_model()
    return {"status": "ejected"}


@app.post("/llama/switch-model")
def llama_switch_model(payload: dict) -> dict:
    model_path = payload.get("model_path", "")
    if not model_path:
        raise HTTPException(status_code=400, detail="model_path is required")
    config = get_config_data()
    logger.info("Switching model to: %s", model_path)
    try:
        switch_model(model_path, ctx_size=config.get("ctx_size", 32768), n_gpu_layers=config.get("n_gpu_layers", -1))
    except ValueError as exc:
        logger.error("Model switch failed: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    logger.info("Model switch initiated successfully")
    return {"status": "restarting", "model_path": model_path}


@app.get("/system/resources")
def system_resources() -> dict:
    cpu_percent = psutil.cpu_percent(interval=None)
    vm = psutil.virtual_memory()
    ram_used_gb = vm.used / (1024 ** 3)
    ram_total_gb = vm.total / (1024 ** 3)
    ram_percent = vm.percent

    gpus: list[dict] = []
    if _NVML_AVAILABLE:
        try:
            device_count = nvml.nvmlDeviceGetCount()
            for i in range(device_count):
                handle = nvml.nvmlDeviceGetHandleByIndex(i)
                name = nvml.nvmlDeviceGetName(handle)
                util = nvml.nvmlDeviceGetUtilizationRates(handle)
                mem = nvml.nvmlDeviceGetMemoryInfo(handle)
                gpus.append({
                    "name": name if isinstance(name, str) else name.decode(),
                    "gpu_percent": util.gpu,
                    "vram_used_gb": mem.used / (1024 ** 3),
                    "vram_total_gb": mem.total / (1024 ** 3),
                    "vram_percent": round(mem.used / mem.total * 100, 1) if mem.total else 0,
                })
        except Exception:
            pass

    return {
        "cpu_percent": cpu_percent,
        "ram_used_gb": round(ram_used_gb, 2),
        "ram_total_gb": round(ram_total_gb, 2),
        "ram_percent": ram_percent,
        "gpus": gpus,
    }



