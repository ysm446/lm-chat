from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from itertools import count
from threading import Lock

_MAX_LOGS = 200
_logs: deque[dict] = deque(maxlen=_MAX_LOGS)
_lock = Lock()
_ids = count(1)


def append_prompt_log(*, label: str, lines: list[str]) -> dict:
    entry = {
        "id": next(_ids),
        "label": label,
        "content": "\n".join(lines),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    with _lock:
        _logs.append(entry)
    return entry


def list_prompt_logs(limit: int = 100) -> list[dict]:
    safe_limit = max(1, min(limit, _MAX_LOGS))
    with _lock:
        return list(_logs)[-safe_limit:]

def clear_prompt_logs() -> int:
    with _lock:
        count = len(_logs)
        _logs.clear()
    return count
