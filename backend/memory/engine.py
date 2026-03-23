from __future__ import annotations

from ..models import MemoryChunk, MessageCreate
from ..store import SQLiteStore


class MemoryEngine:
    def __init__(self, store: SQLiteStore) -> None:
        self.store = store

    def save_session_messages(self, session_id: str, messages: list[MessageCreate]) -> list[MemoryChunk] | None:
        return self.store.save_memory(session_id, messages)

    def search(self, workspace_id: str, query: str, top_k: int) -> list[MemoryChunk]:
        return self.store.search_memory(workspace_id, query, top_k)

    def build_prompt_context(self, workspace_id: str, query: str, top_k: int = 5) -> str:
        items = self.search(workspace_id, query, top_k)
        if not items:
            return ""

        lines = ["Relevant memory from the current workspace:"]
        for item in items:
            lines.append(f"- {item.content}")
        return "\n".join(lines)