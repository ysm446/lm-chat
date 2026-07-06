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

from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent

# 環境側ルート（アプリ/マシン共通）。
# TODO(library-switch): 将来的に ~/.lmchat へ分離する。現状は後方互換のため repo/data。
_APP_ROOT = _REPO_ROOT / "data"

# アクティブなライブラリのルート。既定は repo/data。
# ライブラリ切り替え実装時にポインタファイルから解決した値を set_library_root() で差し込む。
_library_root: Path = _REPO_ROOT / "data"


def repo_root() -> Path:
    return _REPO_ROOT


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


# --- ライブラリ側（切り替え単位） ---

def library_root() -> Path:
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
