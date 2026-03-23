from __future__ import annotations

from ..models import MemoryChunk, MessageCreate
from ..store import SQLiteStore
from .chunker import chunk_messages


class MemoryEngine:
    def __init__(self, store: SQLiteStore) -> None:
        self.store = store

    def save_session_messages(self, session_id: str, messages: list[MessageCreate]) -> list[MemoryChunk] | None:
        chunks = chunk_messages(messages)
        return self.store.save_memory(session_id, chunks)

    def search(self, workspace_id: str, query: str, top_k: int) -> list[MemoryChunk]:
        return self.store.search_memory(workspace_id, query, top_k)

    def build_prompt_context(self, workspace_id: str, query: str, top_k: int = 5) -> str:
        items = self.search(workspace_id, query, top_k)
        if not items:
            return ""

        lines = [
            "## 過去の会話から検索された関連記憶",
            "以下はこのワークスペース内の過去の会話から自動検索された情報です。",
            "ユーザーの質問に答える際、自然に参照してください。",
            "",
        ]
        for i, item in enumerate(items, 1):
            lines.append(f"[記憶 {i}]")
            lines.append(item.content)
            lines.append("")
        return "\n".join(lines)