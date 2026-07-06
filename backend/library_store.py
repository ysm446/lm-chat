"""ライブラリレジストリ（アクティブ / 最近開いた一覧）の管理。

レジストリはどのライブラリにも属さないマシンレベルのファイル
（`~/.lmchat/libraries.json`）。ライブラリの中に置くと切り替えのポインタに
ならないため、意図的に外に置く。

このモジュールはレジストリの読み書きのみ担当し、実際の Store 再初期化は
`routes.deps.switch_library()` が行う（オーケストレーションはルート層）。
"""

from __future__ import annotations

from pathlib import Path

from . import paths
from .atomic_io import atomic_write_json, read_json

_MAX_RECENT = 20


def _read_registry() -> dict:
    data = read_json(paths.library_registry_path(), None)
    if isinstance(data, dict):
        data.setdefault("active", "")
        data.setdefault("recent", [])
        return data
    return {"active": "", "recent": []}


def _save_registry(reg: dict) -> None:
    atomic_write_json(paths.library_registry_path(), reg)


def get_active_path() -> str:
    """現在アクティブなライブラリの絶対パス。未設定なら既定ライブラリ。"""
    reg = _read_registry()
    active = reg.get("active") or str(paths.default_library())
    return str(Path(active).resolve())


def _touch_recent(reg: dict, path_str: str) -> None:
    recent = [p for p in reg.get("recent", []) if p != path_str]
    recent.insert(0, path_str)
    reg["recent"] = recent[:_MAX_RECENT]


def set_active(path: str) -> str:
    """アクティブライブラリを更新し、最近開いた一覧の先頭へ繰り上げる。

    ディレクトリが無ければ作成する（新規ライブラリはこれで空フォルダを用意し、
    Store 側の init/seed が中身を作る）。Store 再初期化はここでは行わない。
    """
    resolved = Path(path).expanduser().resolve()
    resolved.mkdir(parents=True, exist_ok=True)
    path_str = str(resolved)
    reg = _read_registry()
    reg["active"] = path_str
    _touch_recent(reg, path_str)
    _save_registry(reg)
    return path_str


def list_libraries() -> list[dict]:
    """最近開いたライブラリ一覧。アクティブが未登録なら先頭に補う。"""
    reg = _read_registry()
    active = get_active_path()
    entries: list[str] = list(reg.get("recent", []))
    if active not in entries:
        entries.insert(0, active)
    result: list[dict] = []
    for raw in entries:
        p = Path(raw)
        result.append(
            {
                "path": str(p),
                "name": p.name or str(p),
                "exists": p.exists(),
                "active": str(p.resolve()) == active if p.exists() else raw == active,
            }
        )
    return result
