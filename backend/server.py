from __future__ import annotations

import json
import logging
from pathlib import Path

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
from .debug_store import clear_prompt_logs, list_prompt_logs
from .settings_store import get as get_settings_data
from .settings_store import update as update_settings_data
from .system_prompt_store import create_prompt, delete_prompt, update_prompt, reorder_prompts, get_all as get_system_prompts, set_active_text, set_active_id
from .llama_manager import eject_model, get_llama_paths, get_model_props, is_ready, switch_model
from .llm_proxy import SYSTEM_PROMPT, _AGGRESSIVE_CORRECTION_PROMPT, _LIGHT_CORRECTION_PROMPT, _STANDARD_CORRECTION_PROMPT, autocomplete as llm_autocomplete, correct as llm_correct, count_tokens, generate_chat_completion, generate_title, list_models, stream_chat_completion, stream_temp_chat
from .memory.embedder import warmup as warmup_embedder
from .memory.engine import MemoryEngine
from .documents.chunker import chunk_document
from .models import (
    ChatSendRequest,
    ChatSendResponse,
    ConfigUpdate,
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

# 蝓九ａ霎ｼ縺ｿ繝｢繝・Ν繧偵ヰ繝・け繧ｰ繝ｩ繧ｦ繝ｳ繝峨〒繧ｦ繧ｩ繝ｼ繝繧｢繝・・・亥・蝗槭Μ繧ｯ繧ｨ繧ｹ繝医・驕・ｻｶ繧帝亟縺撰ｼ・
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


def build_document_context(session: Session, query: str) -> str:
    """ワークスペース資料から関連チャンクを取得してコンテキスト文字列を組み立てる。"""
    try:
        chunks = store.search_documents(session.workspace_id, query, top_k=3)
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


def combine_contexts(memory_context: str, doc_context: str, max_chars: int = 2000) -> str:
    """メモリコンテキストと資料コンテキストを結合し、合計文字数の上限を超えないよう調整する。"""
    parts = []
    total = 0
    for ctx in [doc_context, memory_context]:  # 資料を優先
        if not ctx:
            continue
        remaining = max_chars - total
        if remaining <= 0:
            break
        if len(ctx) > remaining:
            ctx = ctx[:remaining]
        parts.append(ctx)
        total += len(ctx)
    return "\n\n".join(parts)


def save_turn_memory(session_id: str, user_content: str, assistant_content: str) -> None:
    memory_engine.save_session_messages(
        session_id,
        [
            MessageCreate(role="user", content=user_content),
            MessageCreate(role="assistant", content=assistant_content),
        ],
    )


def _prepare_image_data(session_id: str, image_data: str | None) -> str | None:
    if not image_data:
        return None
    if not image_data.startswith("data:"):
        return image_data

    session = store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return save_data_url_image(_IMAGE_DIR, session.workspace_id, session.id, image_data)


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
    message = store.update_message(message_id, payload.content)
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
    stored_image_data = _prepare_image_data(payload.session_id, payload.image_data)
    user_message = store.append_message(payload.session_id, MessageCreate(role="user", content=payload.content, image_data=stored_image_data))
    if user_message is None:
        raise HTTPException(status_code=404, detail="Session not found")

    session = store.get_session(payload.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    memory_context = build_memory_context(session, payload.content) if payload.memory_enabled else ""
    doc_context = build_document_context(session, payload.content) if payload.doc_rag_enabled else ""
    full_context = combine_contexts(memory_context, doc_context)
    temperature = get_config_data().get("temperature", 0.8)
    assistant_text = generate_chat_completion(session, full_context, payload.thinking_enabled, payload.system_prompt, temperature)
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
    stored_image_data = _prepare_image_data(payload.session_id, payload.image_data)
    user_message = store.append_message(payload.session_id, MessageCreate(role="user", content=payload.content, image_data=stored_image_data))
    if user_message is None:
        raise HTTPException(status_code=404, detail="Session not found")

    session = store.get_session(payload.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    memory_context = build_memory_context(session, payload.content) if payload.memory_enabled else ""
    doc_context = build_document_context(session, payload.content) if payload.doc_rag_enabled else ""
    full_context = combine_contexts(memory_context, doc_context)
    thinking_enabled = payload.thinking_enabled
    system_prompt = payload.system_prompt
    temperature = get_config_data().get("temperature", 0.8)

    def event_stream():
        collected: list[str] = []
        final_stats: dict | None = None
        try:
            for item in stream_chat_completion(session, full_context, thinking_enabled, system_prompt, temperature):
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


class ChatContinueRequest(BaseModel):
    session_id: str
    thinking_enabled: bool = False
    system_prompt: str | None = None


@app.post("/chat/continue/stream")
def chat_continue_stream(payload: ChatContinueRequest) -> StreamingResponse:
    session = store.get_session(payload.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.messages or session.messages[-1].role != "user":
        raise HTTPException(status_code=400, detail="Last message must be from user")

    thinking_enabled = payload.thinking_enabled
    system_prompt = payload.system_prompt
    temperature = get_config_data().get("temperature", 0.8)

    def event_stream():
        collected: list[str] = []
        final_stats: dict | None = None
        try:
            for item in stream_chat_completion(session, "", thinking_enabled, system_prompt, temperature):
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


@app.post("/memory/cleanup")
def cleanup_memory() -> dict[str, int]:
    return store.cleanup_memory()


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


@app.post("/documents", response_model=Document)
def create_document(payload: DocumentUploadRequest) -> Document:
    import hashlib

    if not store.has_workspace(payload.workspace_id):
        raise HTTPException(status_code=404, detail="Workspace not found")

    ext = Path(payload.file_name).suffix.lower()
    if ext not in (".txt", ".md", ".json"):
        raise HTTPException(status_code=400, detail="Unsupported file type. Only .txt, .md, .json are allowed")

    # MIME type
    mime_map = {".txt": "text/plain", ".md": "text/markdown", ".json": "application/json"}
    mime_type = mime_map.get(ext, "text/plain")

    # ファイルハッシュ
    content_bytes = payload.content.encode("utf-8")
    file_hash = hashlib.sha256(content_bytes).hexdigest()

    # 保存パス（workspace_id 配下）
    workspace_dir = _DOCUMENT_DIR / payload.workspace_id
    workspace_dir.mkdir(parents=True, exist_ok=True)

    # 同名ファイルが存在する場合はサフィックスを付ける
    target = workspace_dir / payload.file_name
    stem = Path(payload.file_name).stem
    suffix = ext
    counter = 1
    while target.exists():
        target = workspace_dir / f"{stem}_{counter}{suffix}"
        counter += 1

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

    # バックグラウンドでインデックス
    import threading
    def _index():
        try:
            chunks = chunk_document(doc.file_name, payload.content)
            store.index_document_chunks(doc.id, chunks)
            logger.info("Document indexed: %s (%d chunks)", doc.id, len(chunks))
        except Exception as e:
            logger.warning("Document indexing failed: %s", e)

    threading.Thread(target=_index, daemon=True).start()
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
    import hashlib
    import threading

    doc = store.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")

    # ファイル名変更
    if payload.file_name is not None and payload.file_name != doc.file_name:
        new_ext = Path(payload.file_name).suffix.lower()
        if new_ext not in (".txt", ".md", ".json"):
            raise HTTPException(status_code=400, detail="Unsupported file type. Only .txt, .md, .json are allowed")
        renamed = store.rename_document(doc_id, payload.file_name)
        if renamed is None:
            raise HTTPException(status_code=500, detail="Failed to rename file")
        doc = renamed

    # 内容更新
    if payload.content is not None:
        content_bytes = payload.content.encode("utf-8")
        file_hash = hashlib.sha256(content_bytes).hexdigest()
        file_path = _DOCUMENT_DIR / doc.file_path
        try:
            file_path.write_text(payload.content, encoding="utf-8")
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"Failed to write file: {e}") from e

        store.update_document_file_size(doc_id, len(content_bytes))
        store.set_document_indexed_at(doc_id, None)
        content_for_index = payload.content
        file_name_for_index = doc.file_name

        def _reindex():
            try:
                chunks = chunk_document(file_name_for_index, content_for_index)
                store.index_document_chunks(doc_id, chunks)
                logger.info("Document re-indexed: %s (%d chunks)", doc_id, len(chunks))
            except Exception as e:
                logger.warning("Document re-indexing failed: %s", e)

        threading.Thread(target=_reindex, daemon=True).start()

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


@app.get("/debug/prompt-logs")
def get_debug_prompt_logs(limit: int = Query(100, ge=1, le=200)) -> dict[str, list[dict]]:
    return {"items": list_prompt_logs(limit)}


@app.delete("/debug/prompt-logs")
def clear_debug_prompt_logs() -> dict[str, int]:
    return {"cleared": clear_prompt_logs()}


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



