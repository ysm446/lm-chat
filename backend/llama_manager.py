from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib import request as urllib_request

logger = logging.getLogger(__name__)

_PATHS_FILE = Path(__file__).resolve().parent.parent / "data" / "llama_paths.json"
LLAMA_SERVER_BASE_URL = os.environ.get("LLAMA_SERVER_BASE_URL", "http://127.0.0.1:8080")


def get_llama_paths() -> dict:
    if _PATHS_FILE.exists():
        try:
            # PowerShell Out-File may emit a UTF-8 BOM on Windows.
            return json.loads(_PATHS_FILE.read_text("utf-8-sig"))
        except Exception as exc:
            logger.warning("Failed to read llama_paths.json: %s", exc)
    return {}


def _save_llama_paths(paths: dict) -> None:
    _PATHS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _PATHS_FILE.write_text(json.dumps(paths, indent=2, ensure_ascii=False), "utf-8")


def _get_tracked_pid(paths: dict | None = None) -> int | None:
    current = paths if paths is not None else get_llama_paths()
    raw_pid = current.get("llama_server_pid")
    try:
        pid = int(raw_pid)
    except (TypeError, ValueError):
        return None
    return pid if pid > 0 else None


def is_ready() -> bool:
    try:
        with urllib_request.urlopen(f"{LLAMA_SERVER_BASE_URL}/health", timeout=2) as resp:
            return resp.status == 200
    except Exception:
        return False


def _kill_running() -> None:
    paths = get_llama_paths()
    tracked_pid = _get_tracked_pid(paths)

    if tracked_pid:
        if sys.platform == "win32":
            result = subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(tracked_pid)],
                capture_output=True,
                text=True,
            )
            logger.info("taskkill /PID result: %s %s", result.returncode, result.stdout.strip())
            if result.returncode == 0:
                paths["llama_server_pid"] = None
                _save_llama_paths(paths)
                return
        else:
            try:
                os.kill(tracked_pid, 9)
                logger.info("Killed tracked llama-server PID %s", tracked_pid)
                paths["llama_server_pid"] = None
                _save_llama_paths(paths)
                return
            except OSError:
                logger.warning("Tracked llama-server PID %s was not running", tracked_pid)

    if is_ready():
        logger.warning(
            "A llama-server is already responding at %s, but this app has no tracked PID. "
            "Skipping global termination to avoid affecting another app.",
            LLAMA_SERVER_BASE_URL,
        )
        return

    logger.info("No tracked llama-server PID found; nothing to kill.")


def get_model_props() -> dict:
    """Fetch model metadata from llama-server /props."""
    try:
        with urllib_request.urlopen(f"{LLAMA_SERVER_BASE_URL}/props", timeout=2) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return {}


def get_llama_server_version(paths: dict | None = None, props: dict | None = None) -> str:
    current = paths if paths is not None else get_llama_paths()
    metadata = props if props is not None else {}

    for key in ("version", "build", "build_number"):
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, int):
            return str(value)

    exe = current.get("llama_exe", "")
    if not exe:
        return ""

    parent_name = Path(exe).parent.name
    match = re.search(r"(b\d{3,})", parent_name, re.IGNORECASE)
    return match.group(1) if match else ""


def switch_model(model_path: str, ctx_size: int = 32768, n_gpu_layers: int = -1) -> None:
    paths = get_llama_paths()
    exe = paths.get("llama_exe", "")

    if not exe or not Path(exe).exists():
        raise ValueError(f"llama-server was not found: {exe}")
    if not Path(model_path).exists():
        raise ValueError(f"Model file was not found: {model_path}")

    model_dir = Path(model_path).parent
    mmproj_candidates = [candidate for candidate in model_dir.glob("*.gguf") if "mmproj" in candidate.name.lower()]
    effective_mmproj = str(mmproj_candidates[0]) if mmproj_candidates else ""
    llama_port = LLAMA_SERVER_BASE_URL.rsplit(":", 1)[-1]

    logger.info("Stopping tracked llama-server before model switch...")
    _kill_running()
    time.sleep(2)

    cmd = [
        exe,
        "--model", model_path,
        "--host", "127.0.0.1",
        "--port", llama_port,
        "--ctx-size", str(ctx_size),
        "--n-gpu-layers", str(n_gpu_layers),
        "--flash-attn", "on",
        "--parallel", "1",
    ]
    if effective_mmproj:
        cmd += ["--mmproj", effective_mmproj]

    logger.info("Starting llama-server for %s on %s", Path(model_path).name, LLAMA_SERVER_BASE_URL)
    kwargs: dict = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NEW_CONSOLE

    proc = subprocess.Popen(cmd, **kwargs)
    time.sleep(1)
    if proc.poll() is not None:
        raise ValueError(
            f"llama-server failed to start on {LLAMA_SERVER_BASE_URL}. "
            "Port conflict or another startup error is likely."
        )

    paths["active_model_path"] = model_path
    paths["mmproj_path"] = effective_mmproj
    paths["llama_server_pid"] = proc.pid
    paths["llama_server_base_url"] = LLAMA_SERVER_BASE_URL
    _save_llama_paths(paths)


def eject_model() -> None:
    """Stop llama-server and release the loaded model."""
    logger.info("Ejecting model by stopping tracked llama-server...")
    _kill_running()
    paths = get_llama_paths()
    paths["active_model_path"] = ""
    paths["llama_server_pid"] = None
    _save_llama_paths(paths)
    logger.info("Model ejected.")
