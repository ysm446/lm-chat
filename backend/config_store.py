from __future__ import annotations

from . import paths
from .atomic_io import atomic_write_json, read_json

_DEFAULTS: dict = {
    "ctx_size": 32768,
    "n_gpu_layers": -1,
    "temperature": 0.8,
    "completion_length": 80,
    "memory_scope": "workspace",
    "memory_context_top_k": 5,
    "document_context_top_k": 3,
    "memory_context_chars": 1500,
    "document_context_chars": 2000,
    "memory_decay_half_life_days": 30,
    "document_chunk_target_chars": 800,
    "document_chunk_max_chars": 1000,
    "document_chunk_overlap_chars": 100,
}


def get() -> dict:
    saved = read_json(paths.library_config_path(), None)
    if isinstance(saved, dict):
        return {**_DEFAULTS, **{k: v for k, v in saved.items() if k in _DEFAULTS}}
    return dict(_DEFAULTS)


def update(patch: dict) -> dict:
    current = get()
    for k, v in patch.items():
        if k in _DEFAULTS:
            current[k] = v
    atomic_write_json(paths.library_config_path(), current)
    return current
