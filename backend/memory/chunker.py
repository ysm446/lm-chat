from __future__ import annotations

from ..models import MessageCreate

MAX_CHUNK_CHARS = 4000


def chunk_messages(messages: list[MessageCreate]) -> list[MessageCreate]:
    """連続する user+assistant メッセージを Q&A ペアとしてチャンク化する。"""
    chunks: list[MessageCreate] = []
    i = 0
    while i < len(messages):
        msg = messages[i]
        if msg.role == "system":
            i += 1
            continue
        if msg.role == "user" and i + 1 < len(messages) and messages[i + 1].role == "assistant":
            user_text = msg.content.strip()
            assistant_text = messages[i + 1].content.strip()
            combined = f"Q: {user_text}\nA: {assistant_text}"
            # 長すぎる場合は分割
            if len(combined) > MAX_CHUNK_CHARS:
                for part in _split_text(combined):
                    chunks.append(MessageCreate(role="assistant", content=part))
            else:
                chunks.append(MessageCreate(role="assistant", content=combined))
            i += 2
        else:
            # 単独メッセージはそのまま
            if msg.content.strip():
                chunks.append(MessageCreate(role=msg.role, content=msg.content.strip()))
            i += 1
    return chunks


def _split_text(text: str, max_chars: int = MAX_CHUNK_CHARS) -> list[str]:
    parts: list[str] = []
    while len(text) > max_chars:
        split_at = text.rfind("\n", 0, max_chars)
        if split_at == -1:
            split_at = max_chars
        parts.append(text[:split_at])
        text = text[split_at:].lstrip()
    if text:
        parts.append(text)
    return parts
