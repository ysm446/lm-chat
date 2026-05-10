from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..config_store import get as get_config_data
from ..llama_manager import is_ready
from ..llm_proxy import (
    _AGGRESSIVE_CORRECTION_PROMPT,
    _LIGHT_CORRECTION_PROMPT,
    _REWRITE_CORRECTION_PROMPT,
    _STANDARD_CORRECTION_PROMPT,
    autocomplete as llm_autocomplete,
    correct as llm_correct,
    count_tokens,
)
from ..search.web_search import search_web
from ..settings_store import get as get_settings_data
from ..models import WebSearchRequest

try:
    import psutil
    _PSUTIL_AVAILABLE = True
except ImportError:
    _PSUTIL_AVAILABLE = False

try:
    import pynvml as nvml
    nvml.nvmlInit()
    _NVML_AVAILABLE = True
except Exception:
    _NVML_AVAILABLE = False

logger = logging.getLogger(__name__)
router = APIRouter()

_CORRECTION_PROMPT_MODES = {"light", "standard", "aggressive", "rewrite", "custom"}


def _resolve_correction_prompt(settings: dict) -> str | None:
    mode = settings.get("correction_prompt_mode", "standard")
    if mode not in _CORRECTION_PROMPT_MODES:
        mode = "standard"
    if mode == "light":
        return _LIGHT_CORRECTION_PROMPT
    if mode == "aggressive":
        return _AGGRESSIVE_CORRECTION_PROMPT
    if mode == "rewrite":
        return _REWRITE_CORRECTION_PROMPT
    if mode == "custom":
        custom_prompt = (settings.get("correction_custom_prompt") or "").strip()
        return custom_prompt or _STANDARD_CORRECTION_PROMPT
    return _STANDARD_CORRECTION_PROMPT


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/autocomplete")
def autocomplete_endpoint(payload: dict) -> dict[str, str]:
    text = payload.get("text", "").strip()
    if not text or len(text) < 4 or not is_ready():
        return {"completion": ""}
    try:
        max_tokens = get_config_data().get("completion_length", 80)
        return {"completion": llm_autocomplete(text, max_tokens)}
    except Exception:
        return {"completion": ""}


@router.post("/correct")
def correct_endpoint(payload: dict) -> dict[str, str]:
    text = payload.get("text", "").strip()
    if not text or not is_ready():
        return {"corrected": ""}
    try:
        system_prompt = _resolve_correction_prompt(get_settings_data())
        return {"corrected": llm_correct(text, system_prompt)}
    except Exception:
        return {"corrected": ""}


@router.post("/tokenize")
def tokenize(payload: dict) -> dict[str, int]:
    text = payload.get("text", "")
    if not text:
        return {"token_count": 0}
    try:
        return {"token_count": count_tokens(text)}
    except Exception:
        return {"token_count": max(1, len(text) // 2)}


@router.post("/search/web")
def web_search(payload: WebSearchRequest) -> dict:
    return search_web(payload.query, payload.max_results).model_dump()


@router.get("/system/resources")
def system_resources() -> dict:
    cpu_percent = psutil.cpu_percent(interval=None) if _PSUTIL_AVAILABLE else 0
    vm = psutil.virtual_memory() if _PSUTIL_AVAILABLE else None
    ram_used_gb = vm.used / (1024 ** 3) if vm else 0
    ram_total_gb = vm.total / (1024 ** 3) if vm else 0
    ram_percent = vm.percent if vm else 0

    gpus: list[dict] = []
    if _NVML_AVAILABLE:
        try:
            device_count = nvml.nvmlDeviceGetCount()
            for i in range(device_count):
                handle = nvml.nvmlDeviceGetHandleByIndex(i)
                name = nvml.nvmlDeviceGetName(handle)
                util = nvml.nvmlDeviceGetUtilizationRates(handle)
                mem = nvml.nvmlDeviceGetMemoryInfo(handle)
                gpus.append({
                    "name": name if isinstance(name, str) else name.decode(),
                    "gpu_percent": util.gpu,
                    "vram_used_gb": mem.used / (1024 ** 3),
                    "vram_total_gb": mem.total / (1024 ** 3),
                    "vram_percent": round(mem.used / mem.total * 100, 1) if mem.total else 0,
                })
        except Exception:
            pass

    return {
        "cpu_percent": cpu_percent,
        "ram_used_gb": round(ram_used_gb, 2),
        "ram_total_gb": round(ram_total_gb, 2),
        "ram_percent": ram_percent,
        "gpus": gpus,
    }
