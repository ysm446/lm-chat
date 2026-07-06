from __future__ import annotations

from fastapi import APIRouter

from ..models import MessageSearchResponse
from .deps import store

router = APIRouter()


@router.get("/search/messages", response_model=MessageSearchResponse)
def search_messages(query: str, workspace_id: str | None = None, top_k: int = 30) -> MessageSearchResponse:
    q = query.strip()
    if not q:
        return MessageSearchResponse(query=query, hits=[])
    hits = store.search_messages(q, top_k=top_k, workspace_id=workspace_id or None)
    return MessageSearchResponse(query=query, hits=hits)
