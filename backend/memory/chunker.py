from __future__ import annotations

from ..models import MessageCreate


def chunk_messages(messages: list[MessageCreate]) -> list[MessageCreate]:
    return messages
