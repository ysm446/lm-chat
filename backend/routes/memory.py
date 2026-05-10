from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..config_store import get as get_config_data
from ..models import MemorySaveRequest, MemorySearchResult, MessageCreate
from .deps import memory_engine, store

router = APIRouter()


@router.post("/memory/save")
def save_memory(payload: MemorySaveRequest) -> dict[str, int]:
    chunks = memory_engine.save_session_messages(payload.session_id, payload.messages)
    if chunks is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"saved": len(chunks)}


@router.get("/memory/search", response_model=MemorySearchResult)
def search_memory(query: str, workspace_id: str, top_k: int = 5) -> MemorySearchResult:
    half_life_days = max(0, int(get_config_data().get("memory_decay_half_life_days", 30)))
    items = memory_engine.search(workspace_id, query, top_k, half_life_days=half_life_days)
    return MemorySearchResult(query=query, workspace_id=workspace_id, items=items)


@router.delete("/memory/session/{session_id}")
def delete_session_memory(session_id: str) -> dict[str, int]:
    return {"deleted": store.delete_session_memory(session_id)}


@router.delete("/memory/workspace/{workspace_id}")
def delete_workspace_memory(workspace_id: str) -> dict[str, int]:
    return {"deleted": store.delete_workspace_memory(workspace_id)}


@router.post("/memory/cleanup")
def cleanup_memory() -> dict[str, int]:
    return store.cleanup_memory()


@router.get("/memory/stats")
def memory_stats() -> dict[str, int]:
    return {
        "workspace_count": store.workspace_count(),
        "session_count": store.session_count(),
        "memory_chunk_count": store.memory_chunk_count(),
    }
