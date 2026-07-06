from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Iterator

from fastapi import HTTPException

from .. import paths
from ..config_store import get as get_config_data
from ..llama_manager import get_llama_paths, is_ready
from ..llm_proxy import build_chat_messages, stream_chat_completion, summarize_image
from ..memory.engine import MemoryEngine
from ..models import Message, MessageCreate, Session
from ..settings_store import get as get_settings_data
from ..store import SQLiteStore
from ..utils.image_utils import save_data_url_image

logger = logging.getLogger(__name__)

_IMAGE_DIR = paths.library_images_dir()
_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
_DOCUMENT_DIR = paths.library_documents_dir()
_DOCUMENT_DIR.mkdir(parents=True, exist_ok=True)

store = SQLiteStore()
memory_engine = MemoryEngine(store)


def start_background_task(target, *, name: str) -> None:
    threading.Thread(target=target, name=name, daemon=True).start()


# --- Context builders ---

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
    parts = []
    for ctx, max_chars in ((doc_context, doc_max_chars), (memory_context, memory_max_chars)):
        if not ctx or max_chars <= 0:
            continue
        parts.append(ctx[:max_chars] if len(ctx) > max_chars else ctx)
    return "\n\n".join(parts)


def build_combined_context(
    session: Session, query: str, include_memory: bool, include_documents: bool
) -> str:
    memory_context = build_memory_context(session, query) if include_memory else ""
    doc_context = build_document_context(session, query) if include_documents else ""
    config = get_config_data()
    return combine_contexts(
        memory_context,
        doc_context,
        memory_max_chars=int(config.get("memory_context_chars", 1500)),
        doc_max_chars=int(config.get("document_context_chars", 2000)),
    )


# --- Memory helpers ---

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
        MessageCreate(role=m.role, content=m.content)
        for m in session.messages
        if m.role in {"user", "assistant"} and m.content.strip()
    ]
    if memory_messages:
        memory_engine.save_session_messages(session_id, memory_messages)


# --- Image helpers ---

def _prepare_image_data(session_id: str, image_data: str | None) -> str | None:
    if not image_data:
        return None
    if not image_data.startswith("data:"):
        return image_data
    session = store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return save_data_url_image(_IMAGE_DIR, session.workspace_id, session.id, image_data)


def prepare_image_fields(
    session_id: str,
    image_data: str | None,
    image_preview_data: str | None,
) -> tuple[str | None, str | None]:
    return (
        _prepare_image_data(session_id, image_data),
        _prepare_image_data(session_id, image_preview_data),
    )


def include_all_prompt_images(override: bool | None = None) -> bool:
    if override is not None:
        return bool(override)
    return bool(get_settings_data().get("include_all_prompt_images", False))


def ensure_image_summaries(session: Session, skip_message_id: str | None = None) -> Session:
    changed = False
    updated_messages = []
    for message in session.messages:
        image_ref = message.image_data or message.image_preview_data
        if not image_ref or message.id == skip_message_id or (message.image_summary or "").strip():
            updated_messages.append(message)
            continue
        try:
            summary = summarize_image(image_ref, message.content)
        except Exception as exc:
            logger.warning("Image summary generation failed for message %s: %s", message.id, exc)
            summary = "画像サマリー生成に失敗しました。必要に応じて「過去の画像もすべて参照する」を有効にしてください。"
        if store.update_message_image_summary(message.id, summary):
            changed = True
            updated_messages.append(message.model_copy(update={"image_summary": summary}))
        else:
            updated_messages.append(message)
    if changed and len(updated_messages) == len(session.messages):
        return session.model_copy(update={"messages": updated_messages})
    return session


def build_prompt_messages(
    session: Session,
    memory_context: str = "",
    system_prompt: str | None = None,
    include_all_images_override: bool | None = None,
) -> list[dict]:
    include_all_images = include_all_prompt_images(include_all_images_override)
    if not include_all_images:
        latest_image_message = next(
            (m for m in reversed(session.messages) if m.image_preview_data or m.image_data),
            None,
        )
        session = ensure_image_summaries(
            session,
            skip_message_id=latest_image_message.id if latest_image_message is not None else None,
        )
    return build_chat_messages(
        session,
        memory_context,
        system_prompt,
        include_all_images=include_all_images,
    )


# --- Prompt log ---

def save_prompt_log_if_enabled(
    session_id: str, assistant_message_id: str, prompt_messages: list[dict]
) -> None:
    if not get_settings_data().get("debug_prompt_log", False):
        return
    saved = store.save_message_prompt_log(assistant_message_id, session_id, prompt_messages)
    if saved is None:
        logger.warning("Prompt log save failed for message %s", assistant_message_id)


# --- Model name ---

def get_active_model_name() -> str | None:
    if not is_ready():
        return None
    active_path = get_llama_paths().get("active_model_path", "")
    return Path(active_path).stem if active_path else None


# --- Streaming helper ---

def make_assistant_message_create(
    text: str, final_stats: dict | None, model_name: str | None
) -> MessageCreate:
    return MessageCreate(
        role="assistant",
        content=text,
        prompt_tokens=final_stats.get("prompt_tokens") if final_stats else None,
        completion_tokens=final_stats.get("completion_tokens") if final_stats else None,
        tokens_per_second=final_stats.get("tokens_per_second") if final_stats else None,
        elapsed_seconds=final_stats.get("elapsed_seconds") if final_stats else None,
        finish_reason=final_stats.get("finish_reason") if final_stats else None,
        model_name=model_name,
    )


def iter_token_events(
    gen: Iterator,
    collected: list[str],
    stats_box: list,
) -> Iterator[str]:
    """ストリームからトークンを読み出してSSEイベントを yield する。collected/stats_box は呼び出し元で参照する。"""
    for item in gen:
        if isinstance(item, str):
            collected.append(item)
            yield f"data: {json.dumps({'type': 'token', 'content': item})}\n\n"
        else:
            stats_box.append(item)
