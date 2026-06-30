from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def atomic_write_text(path: Path, text: str) -> None:
    """テキストをアトミックに書き込む。

    一時ファイルに書き出して fsync で物理ディスクまでフラッシュし、
    os.replace でアトミックに差し替える。これにより書き込み途中で
    プロセスが中断（スリープ・電源断・kill）しても、対象ファイルが
    切り詰められた壊れた状態で残ることがない（全て成功か全て失敗）。
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except OSError:
            pass
        raise


def atomic_write_json(path: Path, data: Any) -> None:
    atomic_write_text(path, json.dumps(data, indent=2, ensure_ascii=False))


def read_json(path: Path, default: Any) -> Any:
    """JSON を読み込む。パース失敗時は壊れたファイルを .bak に退避してから

    default を返す。退避しておくことで、直後の書き込みで上書きされて
    内容を完全に失う前に手動復旧の余地を残す。
    """
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text("utf-8"))
    except Exception:
        try:
            backup = path.with_suffix(path.suffix + ".bak")
            os.replace(path, backup)
        except OSError:
            pass
        return default
