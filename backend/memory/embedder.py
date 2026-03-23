from __future__ import annotations

from pathlib import Path

from sentence_transformers import SentenceTransformer

_MODEL_NAME = "cl-nagoya/ruri-v3-310m"
_CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "models" / "embeddings"
_model: SentenceTransformer | None = None


def _get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _model = SentenceTransformer(_MODEL_NAME, cache_folder=str(_CACHE_DIR))
    return _model


def embed(text: str) -> list[float]:
    model = _get_model()
    vector = model.encode(text, normalize_embeddings=True)
    return vector.tolist()
