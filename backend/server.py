from __future__ import annotations

import json
import logging
from pathlib import Path

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .config_store import get as get_config_data
from .config_store import update as update_config_data
from .settings_store import get as get_settings_data
from .settings_store import update as update_settings_data
from .system_prompt_store import create_prompt, delete_prompt, update_prompt, get_all as get_system_prompts, set_active_text, set_active_id
from .llama_manager import eject_model, get_llama_paths, get_model_props, is_ready, switch_model
from .llm_proxy import SYSTEM_PROMPT, count_tokens, generate_chat_completion, generate_title, list_models, stream_chat_completion, stream_temp_chat
from .memory.embedder import warmup as warmup_embedder
from .memory.engine import MemoryEngine
from .models import (
    ChatSendRequest,
    ChatSendResponse,
    ConfigUpdate,
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
    WorkspaceUpdate,
)
from .search.web_search import search_web
from .store import SQLiteStore

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

# 埋め込みモデルをバックグラウンドでウォームアップ（初回リクエストの遅延を防ぐ）
import threading
threading.Thread(target=warmup_embedder, daemon=True).start()


def build_memory_context(session: Session, query: str) -> str:
    try:
        context = memory_engine.build_prompt_context(session.workspace_id, query, top_k=5)
        logger.debug("Memory context built (%d chars): %s", len(context), context[:120])
        return context
    except Exception as e:
        logger.warning("Memory context build failed: %s", e)
        return ""


def save_turn_memory(session_id: str, user_content: str, assistant_content: str) -> None:
    memory_engine.save_session_messages(
        session_id,
        [
            MessageCreate(role="user", content=user_content),
            MessageCreate(role="assistant", content=assistant_content),
        ],
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


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


@app.get("/models/local")
def list_local_models() -> list[dict]:
    if not _MODELS_DIR.exists():
        return []
    return [
        {"id": p.stem, "path": str(p), "size_bytes": p.stat().st_size}
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
    message = store.update_message(message_id, payload.content)
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found")
    return message


@app.post("/history/sessions/{session_id}/branch", response_model=Session)
def branch_session(session_id: str, payload: dict) -> Session:
    up_to_message_id = payload.get("up_to_message_id", "")
    if not up_to_message_id:
        raise HTTPException(status_code=400, detail="up_to_message_id is required")
    new_session = store.branch_session(session_id, up_to_message_id)
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

    def event_stream():
        collected: list[str] = []
        final_stats: dict | None = None
        try:
            for item in stream_temp_chat(messages, payload.thinking_enabled, payload.system_prompt):
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
    user_message = store.append_message(payload.session_id, MessageCreate(role="user", content=payload.content, image_data=payload.image_data))
    if user_message is None:
        raise HTTPException(status_code=404, detail="Session not found")

    session = store.get_session(payload.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    memory_context = build_memory_context(session, payload.content) if payload.memory_enabled else ""
    assistant_text = generate_chat_completion(session, memory_context, payload.thinking_enabled, payload.system_prompt)
    assistant_message = store.append_message(
        payload.session_id,
        MessageCreate(role="assistant", content=assistant_text),
    )
    if assistant_message is None:
        raise HTTPException(status_code=500, detail="Failed to store assistant response")

    save_turn_memory(payload.session_id, payload.content, assistant_text)

    updated_session = store.get_session(payload.session_id)
    if updated_session is None:
        raise HTTPException(status_code=500, detail="Failed to reload session")

    return ChatSendResponse(session=updated_session, assistant_message=assistant_message)


@app.post("/chat/send/stream")
def chat_send_stream(payload: ChatSendRequest) -> StreamingResponse:
    user_message = store.append_message(payload.session_id, MessageCreate(role="user", content=payload.content, image_data=payload.image_data))
    if user_message is None:
        raise HTTPException(status_code=404, detail="Session not found")

    session = store.get_session(payload.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    memory_context = build_memory_context(session, payload.content) if payload.memory_enabled else ""
    thinking_enabled = payload.thinking_enabled
    system_prompt = payload.system_prompt

    def event_stream():
        collected: list[str] = []
        final_stats: dict | None = None
        try:
            for item in stream_chat_completion(session, memory_context, thinking_enabled, system_prompt):
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
                completion_tokens=final_stats.get("completion_tokens") if final_stats else None,
                tokens_per_second=final_stats.get("tokens_per_second") if final_stats else None,
                elapsed_seconds=final_stats.get("elapsed_seconds") if final_stats else None,
                finish_reason=final_stats.get("finish_reason") if final_stats else None,
                model_name=session.model_name or None,
            ),
        )
        updated_session = store.get_session(payload.session_id)
        if assistant_message is None or updated_session is None:
            yield f"data: {json.dumps({'type': 'error', 'detail': 'Failed to store assistant response'})}\n\n"
            return

        try:
            save_turn_memory(payload.session_id, payload.content, assistant_text)
            logger.debug("Memory saved for session %s", payload.session_id)
        except Exception as e:
            logger.warning("Memory save failed: %s", e)
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
    items = memory_engine.search(workspace_id, query, top_k)
    return MemorySearchResult(query=query, workspace_id=workspace_id, items=items)


@app.delete("/memory/session/{session_id}")
def delete_session_memory(session_id: str) -> dict[str, int]:
    return {"deleted": store.delete_session_memory(session_id)}


@app.delete("/memory/workspace/{workspace_id}")
def delete_workspace_memory(workspace_id: str) -> dict[str, int]:
    return {"deleted": store.delete_workspace_memory(workspace_id)}


@app.get("/memory/stats")
def memory_stats() -> dict[str, int]:
    return {
        "workspace_count": store.workspace_count(),
        "session_count": store.session_count(),
        "memory_chunk_count": store.memory_chunk_count(),
    }


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
