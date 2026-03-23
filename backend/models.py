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
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class WorkspaceCreate(BaseModel):
    name: str
    description: str = ""


class WorkspaceUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class Message(BaseModel):
    id: str
    role: Literal["user", "assistant", "system"]
    content: str
    created_at: str = Field(default_factory=now_iso)


class MessageCreate(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class Session(BaseModel):
    id: str
    workspace_id: str
    title: str
    model_name: str = "Qwen3.5-27B"
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
    messages: list[Message] = Field(default_factory=list)


class SessionCreate(BaseModel):
    workspace_id: str
    title: str
    model_name: str = "Qwen3.5-27B"


class SessionUpdate(BaseModel):
    title: str | None = None


class ChatSendRequest(BaseModel):
    session_id: str
    content: str
    memory_enabled: bool = True
    thinking_enabled: bool = False


class ChatSendResponse(BaseModel):
    session: Session
    assistant_message: Message


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