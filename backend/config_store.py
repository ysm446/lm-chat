from __future__ import annotations

import json
from pathlib import Path

_CONFIG_PATH = Path(__file__).resolve().parent.parent / "data" / "config.json"
_DEFAULTS: dict = {"ctx_size": 32768, "n_gpu_layers": -1, "temperature": 0.8, "completion_length": 80}


def get() -> dict:
    if _CONFIG_PATH.exists():
        try:
            saved = json.loads(_CONFIG_PATH.read_text("utf-8"))
            return {**_DEFAULTS, **{k: v for k, v in saved.items() if k in _DEFAULTS}}
        except Exception:
            pass
    return dict(_DEFAULTS)


def update(patch: dict) -> dict:
    current = get()
    for k, v in patch.items():
        if k in _DEFAULTS:
            current[k] = v
    _CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    _CONFIG_PATH.write_text(json.dumps(current, indent=2, ensure_ascii=False), "utf-8")
    return current
