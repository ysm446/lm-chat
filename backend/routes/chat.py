from __future__ import annotations

import json
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..config_store import get as get_config_data
from ..llm_proxy import (
    build_chat_messages,
    generate_chat_completion,
    stream_chat_completion,
    stream_temp_chat,
)
from ..models import (
    ChatInsertRequest,
    ChatRegenerateRequest,
    ChatSendRequest,
    ChatSendResponse,
    MessageCreate,
    TempChatRequest,
)
from .deps import (
    build_combined_context,
    get_active_model_name,
    iter_token_events,
    make_assistant_message_create,
    prepare_image_fields,
    rebuild_session_memory,
    save_prompt_log_if_enabled,
    save_turn_memory,
    store,
)

logger = logging.getLogger(__name__)
router = APIRouter()


class ChatContinueRequest(BaseModel):
    session_id: str
    thinking_enabled: bool = False
    memory_enabled: bool = True
    doc_rag_enabled: bool = True
    system_prompt: str | None = None


@router.post("/chat/temp/stream")
def chat_temp_stream(payload: TempChatRequest) -> StreamingResponse:
    messages = [{"role": m.role, "content": m.content} for m in payload.messages]
    temperature = get_config_data().get("temperature", 0.8)

    def event_stream():
        collected: list[str] = []
        stats_box: list = []
        try:
            yield from iter_token_events(
                stream_temp_chat(messages, payload.thinking_enabled, payload.system_prompt, temperature),
                collected,
                stats_box,
            )
        except HTTPException as exc:
            yield f"data: {json.dumps({'type': 'error', 'detail': exc.detail})}\n\n"
            return
        yield f"data: {json.dumps({'type': 'done', 'stats': stats_box[0] if stats_box else None})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/chat/send", response_model=ChatSendResponse)
def chat_send(payload: ChatSendRequest) -> ChatSendResponse:
    stored_image_data, stored_image_preview_data = prepare_image_fields(
        payload.session_id, payload.image_data, payload.image_preview_data
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
        session, full_context, payload.thinking_enabled, payload.system_prompt, temperature,
        messages=prompt_messages,
    )
    assistant_message = store.append_message(
        payload.session_id,
        MessageCreate(role="assistant", content=assistant_text),
    )
    if assistant_message is None:
        raise HTTPException(status_code=500, detail="Failed to store assistant response")
    save_prompt_log_if_enabled(payload.session_id, assistant_message.id, prompt_messages)
    save_turn_memory(payload.session_id, payload.content, assistant_text)

    updated_session = store.get_session(payload.session_id)
    if updated_session is None:
        raise HTTPException(status_code=500, detail="Failed to reload session")
    latest_assistant = next(
        (msg for msg in reversed(updated_session.messages) if msg.id == assistant_message.id),
        assistant_message,
    )
    return ChatSendResponse(session=updated_session, assistant_message=latest_assistant)


@router.post("/chat/send/stream")
def chat_send_stream(payload: ChatSendRequest) -> StreamingResponse:
    stored_image_data, stored_image_preview_data = prepare_image_fields(
        payload.session_id, payload.image_data, payload.image_preview_data
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

    def event_stream():
        collected: list[str] = []
        stats_box: list = []
        try:
            yield from iter_token_events(
                stream_chat_completion(
                    session, full_context, payload.thinking_enabled,
                    payload.system_prompt, temperature, messages=prompt_messages,
                ),
                collected,
                stats_box,
            )
        except HTTPException as exc:
            yield f"data: {json.dumps({'type': 'error', 'detail': exc.detail})}\n\n"
            return

        final_stats = stats_box[0] if stats_box else None
        assistant_text = "".join(collected).strip()
        assistant_message = store.append_message(
            payload.session_id,
            make_assistant_message_create(assistant_text, final_stats, get_active_model_name() or session.model_name or None),
        )
        if assistant_message is None:
            yield f"data: {json.dumps({'type': 'error', 'detail': 'Failed to store assistant response'})}\n\n"
            return
        save_prompt_log_if_enabled(payload.session_id, assistant_message.id, prompt_messages)
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


@router.post("/chat/continue/stream")
def chat_continue_stream(payload: ChatContinueRequest) -> StreamingResponse:
    session = store.get_session(payload.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.messages or session.messages[-1].role != "user":
        raise HTTPException(status_code=400, detail="Last message must be from user")

    last_user_content = session.messages[-1].content
    full_context = build_combined_context(session, last_user_content, payload.memory_enabled, payload.doc_rag_enabled)
    temperature = get_config_data().get("temperature", 0.8)
    prompt_messages = build_chat_messages(session, full_context, payload.system_prompt)

    def event_stream():
        collected: list[str] = []
        stats_box: list = []
        try:
            yield from iter_token_events(
                stream_chat_completion(
                    session, full_context, payload.thinking_enabled,
                    payload.system_prompt, temperature, messages=prompt_messages,
                ),
                collected,
                stats_box,
            )
        except HTTPException as exc:
            yield f"data: {json.dumps({'type': 'error', 'detail': exc.detail})}\n\n"
            return

        final_stats = stats_box[0] if stats_box else None
        assistant_text = "".join(collected).strip()
        assistant_message = store.append_message(
            payload.session_id,
            make_assistant_message_create(assistant_text, final_stats, get_active_model_name() or session.model_name or None),
        )
        if assistant_message is None:
            yield f"data: {json.dumps({'type': 'error', 'detail': 'Failed to store assistant response'})}\n\n"
            return
        save_prompt_log_if_enabled(payload.session_id, assistant_message.id, prompt_messages)
        updated_session = store.get_session(payload.session_id)
        if updated_session is None:
            yield f"data: {json.dumps({'type': 'error', 'detail': 'Failed to store assistant response'})}\n\n"
            return
        yield f"data: {json.dumps({'type': 'done', 'session': updated_session.model_dump()})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/chat/regenerate/stream")
def chat_regenerate_stream(payload: ChatRegenerateRequest) -> StreamingResponse:
    session = store.get_session(payload.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    user_index = next(
        (i for i, m in enumerate(session.messages) if m.id == payload.user_message_id), -1
    )
    if user_index < 0:
        raise HTTPException(status_code=404, detail="User message not found")
    user_message = session.messages[user_index]
    if user_message.role != "user":
        raise HTTPException(status_code=400, detail="Target message must be from user")

    assistant_index = user_index + 1
    if assistant_index >= len(session.messages) or session.messages[assistant_index].role != "assistant":
        raise HTTPException(status_code=400, detail="The next message after the target user message must be assistant")

    target_assistant = session.messages[assistant_index]
    generation_session = session.model_copy(update={"messages": session.messages[: user_index + 1]})
    full_context = build_combined_context(
        generation_session, user_message.content, payload.memory_enabled, payload.doc_rag_enabled
    )
    temperature = get_config_data().get("temperature", 0.8)
    prompt_messages = build_chat_messages(generation_session, full_context, payload.system_prompt)

    def event_stream():
        collected: list[str] = []
        stats_box: list = []
        try:
            yield from iter_token_events(
                stream_chat_completion(
                    generation_session, full_context, payload.thinking_enabled,
                    payload.system_prompt, temperature, messages=prompt_messages,
                ),
                collected,
                stats_box,
            )
        except HTTPException as exc:
            yield f"data: {json.dumps({'type': 'error', 'detail': exc.detail})}\n\n"
            return

        final_stats = stats_box[0] if stats_box else None
        assistant_text = "".join(collected).strip()
        updated_assistant = store.replace_message(
            target_assistant.id,
            make_assistant_message_create(assistant_text, final_stats, get_active_model_name() or session.model_name or None),
        )
        if updated_assistant is None:
            yield f"data: {json.dumps({'type': 'error', 'detail': 'Failed to update assistant response'})}\n\n"
            return
        save_prompt_log_if_enabled(payload.session_id, updated_assistant.id, prompt_messages)

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


@router.post("/chat/insert/stream")
def chat_insert_stream(payload: ChatInsertRequest) -> StreamingResponse:
    session = store.get_session(payload.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if payload.after_message_id:
        reference_message = next(
            (m for m in session.messages if m.id == payload.after_message_id), None
        )
        if reference_message is None:
            raise HTTPException(status_code=404, detail="Reference message not found")
        if reference_message.role != "assistant":
            raise HTTPException(status_code=400, detail="Insert reference must be an assistant message")

    positions = store.compute_insert_positions(payload.session_id, payload.after_message_id)
    if positions is None:
        raise HTTPException(status_code=404, detail="Reference message not found")
    user_position, assistant_position = positions

    stored_image_data, stored_image_preview_data = prepare_image_fields(
        payload.session_id, payload.image_data, payload.image_preview_data
    )
    user_message = store.append_message(
        payload.session_id,
        MessageCreate(
            role="user",
            content=payload.content,
            image_data=stored_image_data,
            image_preview_data=stored_image_preview_data,
        ),
        position=user_position,
    )
    if user_message is None:
        raise HTTPException(status_code=404, detail="Session not found")

    refreshed = store.get_session(payload.session_id)
    if refreshed is None:
        raise HTTPException(status_code=404, detail="Session not found")
    prefix_messages = [m for m in refreshed.messages if m.position <= user_position]
    generation_session = refreshed.model_copy(update={"messages": prefix_messages})
    full_context = build_combined_context(
        generation_session, payload.content, payload.memory_enabled, payload.doc_rag_enabled
    )
    temperature = get_config_data().get("temperature", 0.8)
    prompt_messages = build_chat_messages(generation_session, full_context, payload.system_prompt)

    def event_stream():
        collected: list[str] = []
        stats_box: list = []
        try:
            yield from iter_token_events(
                stream_chat_completion(
                    generation_session, full_context, payload.thinking_enabled,
                    payload.system_prompt, temperature, messages=prompt_messages,
                ),
                collected,
                stats_box,
            )
        except (HTTPException, Exception) as exc:
            store.delete_message(user_message.id)
            detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
            if not isinstance(exc, HTTPException):
                logger.exception("Inserted message generation failed")
            yield f"data: {json.dumps({'type': 'error', 'detail': detail})}\n\n"
            return

        final_stats = stats_box[0] if stats_box else None
        assistant_text = "".join(collected).strip()
        assistant_message = store.append_message(
            payload.session_id,
            make_assistant_message_create(assistant_text, final_stats, get_active_model_name() or session.model_name or None),
            position=assistant_position,
        )
        if assistant_message is None:
            store.delete_message(user_message.id)
            yield f"data: {json.dumps({'type': 'error', 'detail': 'Failed to store assistant response'})}\n\n"
            return
        save_prompt_log_if_enabled(payload.session_id, assistant_message.id, prompt_messages)
        store.normalize_session_positions(payload.session_id)

        try:
            save_turn_memory(payload.session_id, payload.content, assistant_text)
        except Exception as e:
            logger.warning("Memory save failed: %s", e)

        updated_session = store.get_session(payload.session_id)
        if updated_session is None:
            yield f"data: {json.dumps({'type': 'error', 'detail': 'Failed to reload session'})}\n\n"
            return
        yield f"data: {json.dumps({'type': 'done', 'session': updated_session.model_dump()})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
