from __future__ import annotations

from ..models import MemoryChunk
from .engine import MemoryEngine


def search_workspace_memory(engine: MemoryEngine, workspace_id: str, query: str, top_k: int) -> list[MemoryChunk]:
    return engine.search(workspace_id, query, top_k)
