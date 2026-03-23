from __future__ import annotations

import json
import logging
import subprocess
import sys
import time
from pathlib import Path
from urllib import request as urllib_request

import os

logger = logging.getLogger(__name__)

_PATHS_FILE = Path(__file__).resolve().parent.parent / "data" / "llama_paths.json"
LLAMA_SERVER_BASE_URL = os.environ.get("LLAMA_SERVER_BASE_URL", "http://127.0.0.1:8080")


def get_llama_paths() -> dict:
    if _PATHS_FILE.exists():
        try:
            return json.loads(_PATHS_FILE.read_text("utf-8"))
        except Exception as e:
            logger.warning("Failed to read llama_paths.json: %s", e)
    return {}


def is_ready() -> bool:
    try:
        with urllib_request.urlopen(f"{LLAMA_SERVER_BASE_URL}/health", timeout=2) as resp:
            return resp.status == 200
    except Exception:
        return False


def _kill_running() -> None:
    if sys.platform == "win32":
        # Windows では taskkill が最も確実
        result = subprocess.run(
            ["taskkill", "/F", "/IM", "llama-server.exe"],
            capture_output=True,
            text=True,
        )
        logger.info("taskkill result: %s %s", result.returncode, result.stdout.strip())
    else:
        try:
            import psutil
            for proc in psutil.process_iter(["name", "pid"]):
                try:
                    if "llama-server" in proc.info["name"].lower():
                        proc.kill()
                        logger.info("Killed llama-server PID %s", proc.info["pid"])
                except Exception:
                    pass
        except ImportError:
            subprocess.run(["pkill", "-f", "llama-server"], capture_output=True)


def switch_model(model_path: str, ctx_size: int = 32768) -> None:
    paths = get_llama_paths()
    exe = paths.get("llama_exe", "")
    n_gpu = paths.get("n_gpu_layers", -1)

    if not exe or not Path(exe).exists():
        raise ValueError(f"llama-server が見つかりません: {exe}")
    if not Path(model_path).exists():
        raise ValueError(f"モデルファイルが見つかりません: {model_path}")

    # 同ディレクトリに mmproj があれば自動検出
    model_dir = Path(model_path).parent
    mmproj_candidates = [p for p in model_dir.glob("*.gguf") if "mmproj" in p.name.lower()]
    effective_mmproj = str(mmproj_candidates[0]) if mmproj_candidates else ""

    logger.info("Killing existing llama-server...")
    _kill_running()
    time.sleep(2)  # GPU メモリ解放を待つ

    cmd = [
        exe,
        "--model", model_path,
        "--host", "127.0.0.1",
        "--port", "8080",
        "--ctx-size", str(ctx_size),
        "--n-gpu-layers", str(n_gpu),
        "--flash-attn", "on",
        "--parallel", "1",
    ]
    if effective_mmproj:
        cmd += ["--mmproj", effective_mmproj]

    logger.info("Starting llama-server: %s", Path(model_path).name)
    kwargs: dict = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NEW_CONSOLE

    subprocess.Popen(cmd, **kwargs)

    # アクティブモデルと mmproj を保存
    paths["active_model_path"] = model_path
    paths["mmproj_path"] = effective_mmproj
    _PATHS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _PATHS_FILE.write_text(json.dumps(paths, indent=2, ensure_ascii=False), "utf-8")
