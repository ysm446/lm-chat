"""アプリ内のすべてのデータパスを解決する単一の窓口。

ライブラリ（データルート）切り替え構想の土台。パスの所属を2種類に分ける:

- **ライブラリ側** (`library_*`): 切り替え単位。フォルダごとコピー/バックアップできる、
  作品（ワークスペース群）に紐づくデータ。`lm_chat.db`・`assets/`・
  `config.json`（作風・RAG チューニング）・`system_prompts.json`。
- **環境側** (`app_*`): アプリ/マシン共通。ライブラリを切り替えても不変。
  UI 設定（`settings.json`）・`llama_paths.json`（マシン固有の実行ファイルパス）。

現段階ではライブラリ側・環境側とも従来どおり `<repo>/data` を指す（ファイル移動なし）。
ライブラリ切り替え実装時に `set_library_root()` でライブラリ側だけを差し替え、
環境側は `~/.lmchat` 等へ分離する。呼び出し側は必ず関数経由でパスを取得すること
（import 時にパスを固定すると切り替えが効かなくなる）。
"""

from __future__ import annotations

import json
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent

# 環境側ルート（アプリ/マシン共通）。
# TODO(library-switch): 将来的に ~/.lmchat へ分離する。現状は後方互換のため repo/data。
_APP_ROOT = _REPO_ROOT / "data"

# 既定ライブラリ（ポインタ未設定時の後方互換の帰り先）。
_DEFAULT_LIBRARY = _REPO_ROOT / "data"

# 既定の GGUF モデル探索先（環境側設定が未指定のときの帰り先）。
_DEFAULT_MODELS_DIR = _REPO_ROOT / "models"

# マシンレベルのルート。どのライブラリにも属さない（アクティブライブラリのポインタを置く）。
_MACHINE_ROOT = Path.home() / ".lmchat"

# アクティブなライブラリのルート。初回 library_root() 呼び出し時にレジストリから遅延解決する。
# set_library_root() で切り替え時に上書きする。
_library_root: Path | None = None


def repo_root() -> Path:
    return _REPO_ROOT


# --- マシンレベル（ライブラリレジストリ） ---

def machine_root() -> Path:
    _MACHINE_ROOT.mkdir(parents=True, exist_ok=True)
    return _MACHINE_ROOT


def library_registry_path() -> Path:
    """アクティブライブラリと最近開いた一覧を保持するレジストリ。マシンレベル。"""
    return machine_root() / "libraries.json"


def _resolve_active_library() -> Path:
    """レジストリの active を読み、無効なら既定ライブラリへフォールバックする。"""
    try:
        reg = json.loads(library_registry_path().read_text("utf-8"))
        active = reg.get("active")
        if active:
            candidate = Path(active)
            if candidate.exists():
                return candidate.resolve()
    except Exception:
        pass
    return _DEFAULT_LIBRARY


def default_library() -> Path:
    return _DEFAULT_LIBRARY


def set_library_root(path: str | Path) -> None:
    """アクティブなライブラリのルートを差し替える（ライブラリ切り替え用）。"""
    global _library_root
    _library_root = Path(path).resolve()


# --- 環境側（アプリ/マシン共通） ---

def app_root() -> Path:
    _APP_ROOT.mkdir(parents=True, exist_ok=True)
    return _APP_ROOT


def app_settings_path() -> Path:
    return app_root() / "settings.json"


def llama_paths_path() -> Path:
    return app_root() / "llama_paths.json"


def app_runtime_config_path() -> Path:
    """推論ランタイム設定（ctx_size・n_gpu_layers）。マシン固有なので環境側。"""
    return app_root() / "runtime.json"


def default_models_dir() -> Path:
    """GGUF モデルの既定探索先（`<repo>/models`）。"""
    return _DEFAULT_MODELS_DIR


def models_dir() -> Path:
    """GGUF モデルの探索先。

    環境側 `runtime.json` の `models_dir` が指定されていればそれを、
    未指定なら既定の `<repo>/models` を返す。マシン固有（モデルの実体は
    大容量でライブラリと一緒に持ち歩かない）なので環境側に置く。
    存在しないパスが設定されていてもそのまま返す（呼び出し側で存在確認する）。
    """
    # runtime_store が paths を import するため、循環回避で遅延 import する。
    from .runtime_store import get as get_runtime

    configured = str(get_runtime().get("models_dir", "") or "").strip()
    return Path(configured).expanduser() if configured else _DEFAULT_MODELS_DIR


# --- ライブラリ側（切り替え単位） ---

def library_root() -> Path:
    global _library_root
    if _library_root is None:
        _library_root = _resolve_active_library()
    _library_root.mkdir(parents=True, exist_ok=True)
    return _library_root


def library_db_path() -> Path:
    return library_root() / "lm_chat.db"


def library_assets_dir() -> Path:
    return library_root() / "assets"


def library_images_dir() -> Path:
    return library_assets_dir() / "images"


def library_documents_dir() -> Path:
    return library_assets_dir() / "documents"


def library_config_path() -> Path:
    return library_root() / "config.json"


def library_system_prompts_path() -> Path:
    return library_root() / "system_prompts.json"
