from __future__ import annotations

import json
from pathlib import Path

_PATH = Path(__file__).resolve().parent.parent / "data" / "settings.json"
_DEFAULTS: dict = {
    "show_left": True,
    "show_right": True,
    "correction_prompt_mode": "standard",
    "correction_custom_prompt": "",
}


def get() -> dict:
    if _PATH.exists():
        try:
            saved = json.loads(_PATH.read_text("utf-8"))
            return {**_DEFAULTS, **{k: v for k, v in saved.items() if k in _DEFAULTS}}
        except Exception:
            pass
    return dict(_DEFAULTS)


def update(patch: dict) -> dict:
    current = get()
    for k, v in patch.items():
        if k in _DEFAULTS:
            current[k] = v
    _PATH.parent.mkdir(parents=True, exist_ok=True)
    _PATH.write_text(json.dumps(current, indent=2, ensure_ascii=False), "utf-8")
    return current
