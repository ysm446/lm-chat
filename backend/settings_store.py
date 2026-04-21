from __future__ import annotations

import json
from pathlib import Path

_PATH = Path(__file__).resolve().parent.parent / "data" / "settings.json"
_DEFAULTS: dict = {
    "show_left": True,
    "show_right": True,
    "sidebar_expanded_workspace_ids": [],
    "sidebar_expanded_document_workspace_ids": [],
    "ui_font": "default-sans",
    "ui_font_size": 14,
    "correction_enabled": True,
    "correction_prompt_mode": "standard",
    "correction_custom_prompt": "",
    "debug_prompt_log": False,
    "settings_context_open": False,
    "settings_memory_open": False,
    "settings_documents_open": False,
    "settings_advanced_open": False,
    "settings_system_prompt_open": False,
    "settings_interface_open": False,
    "settings_completion_open": False,
    "settings_data_open": False,
    "settings_debug_open": False,
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
