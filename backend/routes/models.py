from __future__ import annotations

import logging
import re
import struct
from pathlib import Path

from fastapi import APIRouter

from .. import paths
from ..llama_manager import get_recent_model_paths
from ..llm_proxy import list_models
from ..runtime_store import get as get_runtime_data

logger = logging.getLogger(__name__)
router = APIRouter()

_QUANTIZATION_PATTERN = re.compile(
    r"(?i)(?:^|[-_.])((?:IQ|Q|TQ)\d+(?:[_-][A-Z0-9]+){0,3}|BF16|FP16|F16|BF8|FP8)(?:[-_.]|$)"
)
_SIZE_LABEL_PATTERN = re.compile(r"(?i)(?:^|[-_.])((?:\d+x)?(?:\d+\.)?\d+[KMBTQ])(?:[-_.]|$)")

_GGUF_UINT8 = 0
_GGUF_INT8 = 1
_GGUF_UINT16 = 2
_GGUF_INT16 = 3
_GGUF_UINT32 = 4
_GGUF_INT32 = 5
_GGUF_FLOAT32 = 6
_GGUF_BOOL = 7
_GGUF_STRING = 8
_GGUF_ARRAY = 9
_GGUF_UINT64 = 10
_GGUF_INT64 = 11
_GGUF_FLOAT64 = 12

_GGUF_FTYPE_LABELS = {
    0: "F32", 1: "F16", 2: "Q4_0", 3: "Q4_1", 7: "Q8_0",
    8: "Q5_0", 9: "Q5_1", 10: "Q2_K", 11: "Q3_K_S", 12: "Q3_K_M",
    13: "Q3_K_L", 14: "Q4_K_S", 15: "Q4_K_M", 16: "Q5_K_S", 17: "Q5_K_M",
    18: "Q6_K", 19: "TQ1_0", 20: "TQ2_0", 21: "IQ2_XXS", 22: "IQ2_XS",
    23: "IQ3_XXS", 24: "IQ1_S", 25: "IQ4_NL", 26: "IQ3_S", 27: "IQ2_S",
    28: "IQ4_XS", 29: "I8", 30: "I16", 31: "I32", 32: "I64",
    33: "F64", 34: "IQ1_M", 35: "BF16", 36: "TQ1_0", 37: "TQ2_0",
    38: "IQ4_NL", 39: "IQ4_NL", 40: "IQ4_NL", 41: "MXFP4",
}


def _read_gguf_string(handle) -> str:
    length = struct.unpack("<Q", handle.read(8))[0]
    return handle.read(length).decode("utf-8", errors="replace") if length else ""


def _read_gguf_value(handle, value_type: int) -> object:
    if value_type == _GGUF_UINT8:
        return struct.unpack("<B", handle.read(1))[0]
    if value_type == _GGUF_INT8:
        return struct.unpack("<b", handle.read(1))[0]
    if value_type == _GGUF_UINT16:
        return struct.unpack("<H", handle.read(2))[0]
    if value_type == _GGUF_INT16:
        return struct.unpack("<h", handle.read(2))[0]
    if value_type == _GGUF_UINT32:
        return struct.unpack("<I", handle.read(4))[0]
    if value_type == _GGUF_INT32:
        return struct.unpack("<i", handle.read(4))[0]
    if value_type == _GGUF_FLOAT32:
        return struct.unpack("<f", handle.read(4))[0]
    if value_type == _GGUF_BOOL:
        return struct.unpack("<?", handle.read(1))[0]
    if value_type == _GGUF_STRING:
        return _read_gguf_string(handle)
    if value_type == _GGUF_UINT64:
        return struct.unpack("<Q", handle.read(8))[0]
    if value_type == _GGUF_INT64:
        return struct.unpack("<q", handle.read(8))[0]
    if value_type == _GGUF_FLOAT64:
        return struct.unpack("<d", handle.read(8))[0]
    if value_type == _GGUF_ARRAY:
        array_type = struct.unpack("<I", handle.read(4))[0]
        length = struct.unpack("<Q", handle.read(8))[0]
        return [_read_gguf_value(handle, array_type) for _ in range(length)]
    raise ValueError(f"Unsupported GGUF metadata value type: {value_type}")


def _read_gguf_metadata(path: Path) -> dict[str, object]:
    try:
        with path.open("rb") as handle:
            if handle.read(4) != b"GGUF":
                return {}
            version = struct.unpack("<I", handle.read(4))[0]
            if version not in {2, 3}:
                logger.debug("Unsupported GGUF version %s for %s", version, path)
                return {}
            _tensor_count = struct.unpack("<Q", handle.read(8))[0]
            metadata_count = struct.unpack("<Q", handle.read(8))[0]
            metadata: dict[str, object] = {}
            for _ in range(metadata_count):
                key = _read_gguf_string(handle)
                value_type = struct.unpack("<I", handle.read(4))[0]
                metadata[key] = _read_gguf_value(handle, value_type)
            return metadata
    except Exception as exc:
        logger.debug("Failed to read GGUF metadata for %s: %s", path, exc)
        return {}


def _clean_str(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _get_local_model_display_info(path: Path) -> dict[str, object]:
    metadata = _read_gguf_metadata(path)
    size_label = metadata.get("general.size_label")
    quantization = _GGUF_FTYPE_LABELS.get(metadata.get("general.file_type"))  # type: ignore[arg-type]
    if not isinstance(size_label, str) or not size_label.strip():
        m = _SIZE_LABEL_PATTERN.search(path.stem)
        size_label = m.group(1).replace("-", "_").upper() if m else None
    if not quantization:
        m = _QUANTIZATION_PATTERN.search(path.stem)
        quantization = m.group(1).replace("-", "_").upper() if m else None

    architecture = _clean_str(metadata.get("general.architecture"))
    name = _clean_str(metadata.get("general.name"))

    context_length = None
    if architecture:
        ctx = metadata.get(f"{architecture}.context_length")
        if isinstance(ctx, int) and ctx > 0:
            context_length = ctx

    param_count = metadata.get("general.parameter_count")
    if not (isinstance(param_count, int) and param_count > 0):
        param_count = None

    # 同ディレクトリに mmproj 用 GGUF があればマルチモーダル対応とみなす
    multimodal = any("mmproj" in sibling.stem.lower() for sibling in path.parent.glob("*.gguf"))

    return {
        "id": path.stem,
        "path": str(path),
        "size_bytes": path.stat().st_size,
        "params_label": size_label.strip().upper() if isinstance(size_label, str) else None,
        "quantization": quantization,
        "architecture": architecture,
        "name": name,
        "context_length": context_length,
        "parameter_count": param_count,
        "multimodal": multimodal,
    }


@router.get("/v1/models")
def get_models() -> dict[str, list[dict[str, str]]]:
    return list_models()


@router.get("/models/dir")
def get_models_dir() -> dict:
    """GGUF の探索先（実効パス）と、設定値・既定値・存在有無を返す。"""
    effective = paths.models_dir()
    configured = str(get_runtime_data().get("models_dir", "") or "").strip()
    return {
        "path": str(effective),
        "configured": configured,
        "default_path": str(paths.default_models_dir()),
        "is_default": not configured,
        "exists": effective.is_dir(),
    }


@router.get("/models/local")
def list_local_models() -> list[dict]:
    """モデルフォルダ内の GGUF 一覧。最近使ったモデル（新しい順）を先頭に、残りは名前順。"""
    models_dir = paths.models_dir()
    if not models_dir.is_dir():
        return []
    recent_rank: dict[str, int] = {}
    for i, rp in enumerate(get_recent_model_paths()):
        try:
            recent_rank.setdefault(str(Path(rp).resolve()), i)
        except OSError:
            continue
    models = []
    for p in sorted(models_dir.rglob("*.gguf")):
        if "mmproj" in p.stem.lower():
            continue
        info = _get_local_model_display_info(p)
        rank = recent_rank.get(str(p.resolve()))
        info["recent_rank"] = rank
        models.append(info)
    models.sort(key=lambda m: (m["recent_rank"] is None, m["recent_rank"] or 0, m["id"].lower()))
    return models
