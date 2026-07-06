from __future__ import annotations

from . import paths
from .atomic_io import atomic_write_json, read_json

_DEFAULTS: dict = {
    "show_left": True,
    "show_right": True,
    "sidebar_expanded_workspace_ids": [],
    "sidebar_expanded_document_workspace_ids": [],
    "ui_font": "default-sans",
    "ui_font_size": 14,
    "window_resolution": "1920x1080",
    "correction_enabled": True,
    "correction_prompt_mode": "standard",
    "correction_custom_prompt": "",
    "include_all_prompt_images": False,
    "debug_prompt_log": False,
    "show_system_resources": False,
    "chat_scroll_position": "bottom",
    "settings_context_open": False,
    "settings_memory_open": False,
    "settings_documents_open": False,
    "settings_model_open": False,
    "settings_advanced_open": False,
    "settings_system_prompt_open": False,
    "settings_interface_open": False,
    "settings_completion_open": False,
    "settings_data_open": False,
    "settings_debug_open": False,
}


def get() -> dict:
    saved = read_json(paths.app_settings_path(), None)
    if isinstance(saved, dict):
        return {**_DEFAULTS, **{k: v for k, v in saved.items() if k in _DEFAULTS}}
    return dict(_DEFAULTS)


def update(patch: dict) -> dict:
    current = get()
    for k, v in patch.items():
        if k in _DEFAULTS:
            current[k] = v
    atomic_write_json(paths.app_settings_path(), current)
    return current
