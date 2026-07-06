from __future__ import annotations

from fastapi import APIRouter

from ..config_store import get as get_config_data
from ..config_store import update as update_config_data
from ..models import ConfigUpdate
from ..runtime_store import get as get_runtime_data
from ..runtime_store import update as update_runtime_data
from ..settings_store import get as get_settings_data
from ..settings_store import update as update_settings_data

router = APIRouter()

# runtime_store（環境側）が持つキー。/config は両ストアをマージして従来通りのビューを返す。
_RUNTIME_KEYS = frozenset({"ctx_size", "n_gpu_layers"})


@router.get("/config")
def get_config() -> dict:
    # ライブラリ側（作風・RAG）と環境側（ランタイム）をマージして一枚のビューにする。
    return {**get_runtime_data(), **get_config_data()}


@router.patch("/config")
def patch_config(payload: ConfigUpdate) -> dict:
    patch = payload.model_dump(exclude_none=True)
    runtime_patch = {k: v for k, v in patch.items() if k in _RUNTIME_KEYS}
    config_patch = {k: v for k, v in patch.items() if k not in _RUNTIME_KEYS}
    runtime = update_runtime_data(runtime_patch) if runtime_patch else get_runtime_data()
    config = update_config_data(config_patch) if config_patch else get_config_data()
    return {**runtime, **config}


@router.get("/settings")
def get_settings() -> dict:
    return get_settings_data()


@router.patch("/settings")
def patch_settings(payload: dict) -> dict:
    return update_settings_data(payload)
