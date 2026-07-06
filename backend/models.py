from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


class Workspace(BaseModel):
    id: str
    name: str
    description: str = ""
    sort_order: int = 0
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class WorkspaceCreate(BaseModel):
    name: str
    description: str = ""


class WorkspaceUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class WorkspaceReorderRequest(BaseModel):
    ids: list[str]


class SessionReorderRequest(BaseModel):
    ids: list[str]


class DocumentReorderRequest(BaseModel):
    ids: list[str]


class Message(BaseModel):
    id: str
    role: Literal["user", "assistant", "system"]
    content: str
    image_data: str | None = None
    image_preview_data: str | None = None
    image_summary: str | None = None
    has_prompt_log: bool = False
    created_at: str = Field(default_factory=now_iso)
    position: float = 0.0
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    tokens_per_second: float | None = None
    elapsed_seconds: float | None = None
    finish_reason: str | None = None
    model_name: str | None = None


class MessageCreate(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str
    image_data: str | None = None
    image_preview_data: str | None = None
    image_summary: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    tokens_per_second: float | None = None
    elapsed_seconds: float | None = None
    finish_reason: str | None = None
    model_name: str | None = None


class MessagePromptLog(BaseModel):
    assistant_message_id: str
    session_id: str
    payload_json: str
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class Session(BaseModel):
    id: str
    workspace_id: str
    title: str
    model_name: str = "Qwen3.5-27B"
    sort_order: int = 0
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
    messages: list[Message] = Field(default_factory=list)


class SessionCreate(BaseModel):
    workspace_id: str
    title: str
    model_name: str = "Qwen3.5-27B"


class SessionUpdate(BaseModel):
    title: str | None = None
    model_name: str | None = None


class MessageUpdate(BaseModel):
    content: str
    image_data: str | None = None
    image_preview_data: str | None = None


class ChatSendRequest(BaseModel):
    session_id: str
    content: str
    image_data: str | None = None
    image_preview_data: str | None = None
    memory_enabled: bool = True
    doc_rag_enabled: bool = True
    thinking_enabled: bool = False
    system_prompt: str | None = None
    include_all_prompt_images: bool | None = None


class ChatRegenerateRequest(BaseModel):
    session_id: str
    user_message_id: str
    memory_enabled: bool = True
    doc_rag_enabled: bool = True
    thinking_enabled: bool = False
    system_prompt: str | None = None
    include_all_prompt_images: bool | None = None


class ChatInsertRequest(BaseModel):
    session_id: str
    after_message_id: str | None = None
    content: str
    image_data: str | None = None
    image_preview_data: str | None = None
    memory_enabled: bool = True
    doc_rag_enabled: bool = True
    thinking_enabled: bool = False
    system_prompt: str | None = None
    include_all_prompt_images: bool | None = None


class TempChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class TempChatRequest(BaseModel):
    messages: list[TempChatMessage]
    system_prompt: str | None = None
    thinking_enabled: bool = False


class ChatSendResponse(BaseModel):
    session: Session
    assistant_message: Message


class ConfigUpdate(BaseModel):
    ctx_size: int | None = None
    n_gpu_layers: int | None = None
    temperature: float | None = None
    completion_length: int | None = None
    memory_scope: Literal["workspace", "above_current", "below_current"] | None = None
    memory_context_top_k: int | None = None
    document_context_top_k: int | None = None
    memory_context_chars: int | None = None
    document_context_chars: int | None = None
    memory_decay_half_life_days: int | None = None
    document_chunk_target_chars: int | None = None
    document_chunk_max_chars: int | None = None
    document_chunk_overlap_chars: int | None = None


class DataArchivePathRequest(BaseModel):
    path: str


class LibrarySwitchRequest(BaseModel):
    path: str


class LibraryEntry(BaseModel):
    path: str
    name: str
    exists: bool
    active: bool


class LibraryStateResponse(BaseModel):
    active: str
    libraries: list[LibraryEntry]


class MemoryChunk(BaseModel):
    id: str
    workspace_id: str
    session_id: str
    chunk_type: Literal["qa_pair", "summary", "caption"] = "qa_pair"
    content: str
    created_at: str = Field(default_factory=now_iso)


class MemorySaveRequest(BaseModel):
    session_id: str
    messages: list[MessageCreate]


class MemorySearchResult(BaseModel):
    query: str
    workspace_id: str
    items: list[MemoryChunk]


class WebSearchRequest(BaseModel):
    query: str
    max_results: int = 5


class WebSearchResultItem(BaseModel):
    title: str
    url: str
    snippet: str


class WebSearchResult(BaseModel):
    query: str
    engine: str
    items: list[WebSearchResultItem]


class Document(BaseModel):
    id: str
    workspace_id: str
    session_id: str | None = None
    scope: Literal["workspace", "session"] = "workspace"
    sort_order: int = 0
    file_name: str
    mime_type: str
    file_path: str
    file_size: int = 0
    file_hash: str = ""
    embed_model: str = "ruri-v3-310m"
    created_at: str = Field(default_factory=now_iso)
    indexed_at: str | None = None


class DocumentCreate(BaseModel):
    workspace_id: str
    session_id: str | None = None
    scope: Literal["workspace", "session"] = "workspace"
    sort_order: int = 0
    file_name: str
    mime_type: str
    file_path: str
    file_size: int = 0
    file_hash: str = ""
    embed_model: str = "ruri-v3-310m"


class DocumentChunk(BaseModel):
    id: str
    document_id: str
    workspace_id: str
    session_id: str | None = None
    chunk_index: int
    content: str
    created_at: str = Field(default_factory=now_iso)


class DocumentUploadRequest(BaseModel):
    workspace_id: str
    session_id: str | None = None
    scope: Literal["workspace", "session"] = "workspace"
    file_name: str
    content: str  # raw text content


class DocumentUpdateRequest(BaseModel):
    content: str | None = None
    file_name: str | None = None
