"""推論ランタイム設定（環境側）の永続化。

`ctx_size`・`n_gpu_layers`・`models_dir` は GPU/VRAM やディスク構成に依存する
マシン固有のハード設定であり、
ライブラリ（作品）を切り替えても不変であるべきなので、ライブラリ側の
`config.json`（作風・RAG チューニング）から分離して環境側 `runtime.json` に持つ。

旧構成では `config.json` にこれらが同居し、さらに `n_gpu_layers` が
`llama_paths.json` にも書かれる二重状態だった（llama_paths 側は未読の死んだ値）。
本モジュールが環境側の唯一の正とする。
"""

from __future__ import annotations

from . import paths
from .atomic_io import atomic_write_json, read_json

_DEFAULTS: dict = {
    "ctx_size": 32768,
    "n_gpu_layers": -1,
    # GGUF モデルの探索先。空文字なら既定（`<repo>/models`）。実体が大容量で
    # ライブラリと一緒に持ち歩かないため、マシン固有の環境側設定として持つ。
    "models_dir": "",
}

# 旧 config.json から移設するキー（初回シード用）。models_dir は新規キーなので含めない。
_MIGRATED_KEYS = ("ctx_size", "n_gpu_layers")


def _ensure_seeded() -> None:
    """runtime.json が未作成なら、旧 config.json の該当値を引き継いで作成する。"""
    path = paths.app_runtime_config_path()
    if path.exists():
        return
    seed = dict(_DEFAULTS)
    legacy = read_json(paths.library_config_path(), None)
    if isinstance(legacy, dict):
        for key in _MIGRATED_KEYS:
            if key in legacy:
                seed[key] = legacy[key]
    atomic_write_json(path, seed)


def get() -> dict:
    _ensure_seeded()
    saved = read_json(paths.app_runtime_config_path(), None)
    if isinstance(saved, dict):
        return {**_DEFAULTS, **{k: v for k, v in saved.items() if k in _DEFAULTS}}
    return dict(_DEFAULTS)


def update(patch: dict) -> dict:
    current = get()
    for k, v in patch.items():
        if k in _DEFAULTS:
            current[k] = v
    atomic_write_json(paths.app_runtime_config_path(), current)
    return current
