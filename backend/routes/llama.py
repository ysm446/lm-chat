from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from ..runtime_store import get as get_runtime_data
from ..llama_manager import (
    eject_model,
    get_llama_paths,
    get_llama_runtime_info,
    get_llama_server_version,
    get_model_props,
    install_llama_runtime,
    is_ready,
    switch_model,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/llama/props")
def llama_props() -> dict:
    return get_model_props()


@router.get("/llama/status")
def llama_status() -> dict:
    paths = get_llama_paths()
    ready = is_ready()
    return {
        "ready": ready,
        "active_model_path": paths.get("active_model_path", "") if ready else "",
        "version": get_llama_server_version(paths=paths),
    }


@router.get("/llama/runtime-info")
def llama_runtime_info() -> dict:
    try:
        return get_llama_runtime_info()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/llama/install-runtime")
def llama_install_runtime(payload: dict) -> dict:
    variant = payload.get("variant", "")
    include_runtime = bool(payload.get("include_runtime", False))
    if not variant:
        raise HTTPException(status_code=400, detail="variant is required")
    try:
        return install_llama_runtime(variant, include_runtime=include_runtime)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/llama/eject")
def llama_eject() -> dict:
    eject_model()
    return {"status": "ejected"}


@router.post("/llama/switch-model")
def llama_switch_model(payload: dict) -> dict:
    model_path = payload.get("model_path", "")
    if not model_path:
        raise HTTPException(status_code=400, detail="model_path is required")
    runtime = get_runtime_data()
    logger.info("Switching model to: %s", model_path)
    try:
        switch_model(
            model_path,
            ctx_size=runtime.get("ctx_size", 32768),
            n_gpu_layers=runtime.get("n_gpu_layers", -1),
        )
    except ValueError as exc:
        logger.error("Model switch failed: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    logger.info("Model switch initiated successfully")
    return {"status": "restarting", "model_path": model_path}
