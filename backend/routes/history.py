from __future__ import annotations

import json
import logging

from fastapi import APIRouter, HTTPException, Query

from ..llm_proxy import SYSTEM_PROMPT, count_tokens, generate_title
from ..models import (
    Message,
    MessageCreate,
    MessageUpdate,
    Session,
    SessionCreate,
    SessionReorderRequest,
    SessionUpdate,
)
from .deps import prepare_image_fields, store

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/history/sessions/reorder")
def reorder_sessions(payload: SessionReorderRequest) -> dict:
    store.reorder_sessions(payload.ids)
    return {"ok": True}


@router.get("/history/sessions", response_model=list[Session])
def list_sessions(workspace_id: str = Query(...)) -> list[Session]:
    return store.list_sessions(workspace_id)


@router.post("/history/sessions", response_model=Session)
def create_session(payload: SessionCreate) -> Session:
    if not store.has_workspace(payload.workspace_id):
        raise HTTPException(status_code=404, detail="Workspace not found")
    return store.create_session(payload)


@router.get("/history/sessions/{session_id}", response_model=Session)
def get_session(session_id: str) -> Session:
    session = store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.patch("/history/sessions/{session_id}", response_model=Session)
def update_session(session_id: str, payload: SessionUpdate) -> Session:
    session = store.update_session(session_id, payload)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post("/history/sessions/{session_id}/generate-title", response_model=Session)
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


@router.delete("/history/sessions/{session_id}")
def delete_session(session_id: str, delete_memory: bool = True) -> dict[str, bool | int]:
    deleted = store.delete_session(session_id, delete_memory=delete_memory)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"deleted": True, "session_count": store.session_count()}


@router.post("/history/sessions/{session_id}/move", response_model=Session)
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


@router.post("/history/sessions/{session_id}/branch", response_model=Session)
def branch_session(session_id: str, payload: dict) -> Session:
    up_to_message_id = payload.get("up_to_message_id", "")
    if not up_to_message_id:
        raise HTTPException(status_code=400, detail="up_to_message_id is required")
    new_session = store.branch_session(session_id, up_to_message_id)
    if new_session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return new_session


@router.post("/history/sessions/{session_id}/duplicate", response_model=Session)
def duplicate_session(session_id: str) -> Session:
    new_session = store.duplicate_session(session_id)
    if new_session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return new_session


@router.post("/history/sessions/{session_id}/messages", response_model=Message)
def append_session_message(session_id: str, payload: MessageCreate) -> Message:
    message = store.append_message(session_id, payload)
    if message is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return message


@router.get("/history/sessions/{session_id}/token_count")
def get_session_token_count(session_id: str) -> dict[str, int]:
    from ..config_store import get as get_config_data
    session = store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    text = SYSTEM_PROMPT + "\n"
    for msg in session.messages:
        text += f"{msg.role}: {msg.content}\n"
    count = count_tokens(text)
    config = get_config_data()
    return {"token_count": count, "ctx_size": config["ctx_size"]}


@router.delete("/history/messages/{message_id}")
def delete_message(message_id: str) -> dict[str, bool]:
    deleted = store.delete_message(message_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"deleted": True}


@router.patch("/history/messages/{message_id}", response_model=Message)
def update_message(message_id: str, payload: MessageUpdate) -> Message:
    session_id = store.get_message_session_id(message_id)
    if session_id is None:
        raise HTTPException(status_code=404, detail="Message not found")
    stored_image_data, stored_image_preview_data = prepare_image_fields(
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


@router.get("/history/messages/{message_id}/prompt-log")
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


@router.delete("/debug/prompt-logs")
def clear_all_prompt_logs() -> dict[str, int]:
    return {"cleared": store.clear_all_message_prompt_logs()}
