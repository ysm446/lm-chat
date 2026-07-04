from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from sentence_transformers import SentenceTransformer

_MODEL_NAME = "cl-nagoya/ruri-v3-310m"
_CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "models" / "embeddings"
_model: SentenceTransformer | None = None

# Ruri v3 は非対称検索用のプレフィックスを前提に学習されている。
# 検索側とインデックス側で異なるプレフィックスを付けないと本来の検索精度が出ない。
QUERY_PREFIX = "検索クエリ: "
DOCUMENT_PREFIX = "検索文書: "


def _get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _model = SentenceTransformer(_MODEL_NAME, cache_folder=str(_CACHE_DIR))
    return _model


@lru_cache(maxsize=512)
def _embed(text: str) -> tuple[float, ...]:
    model = _get_model()
    vector = model.encode(text, normalize_embeddings=True, show_progress_bar=False)
    return tuple(vector.tolist())


def embed_query(text: str) -> tuple[float, ...]:
    """検索クエリ側の埋め込み（検索時に使用）。"""
    return _embed(QUERY_PREFIX + text)


def embed_document(text: str) -> tuple[float, ...]:
    """文書側の埋め込み（記憶・資料のインデックス時に使用）。"""
    return _embed(DOCUMENT_PREFIX + text)


def warmup() -> None:
    """サーバー起動時にモデルをロードして最初のリクエストの遅延をなくす。"""
    embed_query("warmup")
