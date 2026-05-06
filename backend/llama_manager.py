from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib import request as urllib_request
from urllib.error import URLError
import zipfile

logger = logging.getLogger(__name__)

_PATHS_FILE = Path(__file__).resolve().parent.parent / "data" / "llama_paths.json"
_INSTALL_ROOT = Path(__file__).resolve().parent.parent / "data" / "llama_cpp" / "versions"
_GITHUB_LATEST_RELEASE_URL = "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest"
LLAMA_SERVER_BASE_URL = os.environ.get("LLAMA_SERVER_BASE_URL", "http://127.0.0.1:8080")

_RUNTIME_VARIANTS = {
    "win-cpu-x64": {
        "label": "CPU llama.cpp (Windows)",
        "description": "CPU-only llama.cpp server",
        "required": ("llama-", "bin-win", "x64", ".zip"),
        "excluded": ("cudart", "cuda", "vulkan", "sycl", "hip", "opencl"),
    },
    "win-cuda12-x64": {
        "label": "CUDA 12 llama.cpp (Windows)",
        "description": "NVIDIA CUDA 12 accelerated llama.cpp server",
        "required": ("llama-", "bin-win", "cuda", "12", "x64", ".zip"),
        "excluded": ("cudart",),
        "runtime_required": ("cudart-llama", "bin-win", "cuda", "12", "x64", ".zip"),
    },
    "win-cuda13-x64": {
        "label": "CUDA 13 llama.cpp (Windows)",
        "description": "NVIDIA CUDA 13 accelerated llama.cpp server",
        "required": ("llama-", "bin-win", "cuda", "13", "x64", ".zip"),
        "excluded": ("cudart",),
        "runtime_required": ("cudart-llama", "bin-win", "cuda", "13", "x64", ".zip"),
    },
    "win-vulkan-x64": {
        "label": "Vulkan llama.cpp (Windows)",
        "description": "Vulkan accelerated llama.cpp server",
        "required": ("llama-", "bin-win", "vulkan", "x64", ".zip"),
        "excluded": ("cudart",),
    },
}


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


def _fetch_latest_release() -> dict:
    req = urllib_request.Request(
        _GITHUB_LATEST_RELEASE_URL,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "lm-chat",
        },
    )
    try:
        with urllib_request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except URLError as exc:
        raise ValueError(f"Failed to fetch llama.cpp release info: {exc}") from exc


def _asset_matches(asset: dict, required: tuple[str, ...], excluded: tuple[str, ...] = ()) -> bool:
    name = str(asset.get("name", "")).lower()
    return all(part in name for part in required) and not any(part in name for part in excluded)


def _find_asset(assets: list[dict], required: tuple[str, ...], excluded: tuple[str, ...] = ()) -> dict | None:
    matches = [asset for asset in assets if _asset_matches(asset, required, excluded)]
    if not matches:
        return None
    return sorted(matches, key=lambda asset: str(asset.get("name", "")))[0]


def _format_asset(asset: dict | None) -> dict | None:
    if not asset:
        return None
    return {
        "name": asset.get("name", ""),
        "size_bytes": asset.get("size", 0),
        "download_url": asset.get("browser_download_url", ""),
    }


def get_llama_runtime_info() -> dict:
    release = _fetch_latest_release()
    assets = release.get("assets") or []
    paths = get_llama_paths()
    installed_variant = paths.get("llama_runtime_variant", "")
    installed_tag = paths.get("llama_runtime_tag", "")

    variants = []
    for key, spec in _RUNTIME_VARIANTS.items():
        binary_asset = _find_asset(assets, spec["required"], spec.get("excluded", ()))
        runtime_asset = None
        runtime_required = spec.get("runtime_required")
        if runtime_required:
            runtime_asset = _find_asset(assets, runtime_required)
        variants.append({
            "id": key,
            "label": spec["label"],
            "description": spec["description"],
            "available": bool(binary_asset),
            "installed": installed_variant == key and installed_tag == release.get("tag_name", ""),
            "binary_asset": _format_asset(binary_asset),
            "runtime_asset": _format_asset(runtime_asset),
        })

    return {
        "tag": release.get("tag_name", ""),
        "name": release.get("name", ""),
        "html_url": release.get("html_url", ""),
        "installed_tag": installed_tag,
        "installed_variant": installed_variant,
        "llama_exe": paths.get("llama_exe", ""),
        "variants": variants,
    }


def _download_asset(asset: dict, dest: Path) -> None:
    url = asset.get("browser_download_url")
    if not url:
        raise ValueError(f"Download URL was not found for {asset.get('name', 'asset')}")
    req = urllib_request.Request(url, headers={"User-Agent": "lm-chat"})
    with urllib_request.urlopen(req, timeout=60) as resp:
        with dest.open("wb") as handle:
            shutil.copyfileobj(resp, handle)


def _extract_zip_safe(archive_path: Path, dest_dir: Path) -> None:
    with zipfile.ZipFile(archive_path) as archive:
        dest_resolved = dest_dir.resolve()
        for member in archive.infolist():
            target = (dest_dir / member.filename).resolve()
            if dest_resolved != target and dest_resolved not in target.parents:
                raise ValueError(f"Unsafe path in archive: {member.filename}")
        archive.extractall(dest_dir)


def _find_llama_server_exe(root: Path) -> Path | None:
    names = ("llama-server.exe",) if sys.platform == "win32" else ("llama-server",)
    for name in names:
        matches = list(root.rglob(name))
        if matches:
            return matches[0]
    return None


def install_llama_runtime(variant: str, include_runtime: bool = False) -> dict:
    if variant not in _RUNTIME_VARIANTS:
        raise ValueError(f"Unsupported llama runtime variant: {variant}")

    release = _fetch_latest_release()
    tag = release.get("tag_name") or "latest"
    assets = release.get("assets") or []
    spec = _RUNTIME_VARIANTS[variant]
    binary_asset = _find_asset(assets, spec["required"], spec.get("excluded", ()))
    if not binary_asset:
        raise ValueError(f"No llama.cpp release asset found for {spec['label']}")

    runtime_asset = None
    runtime_required = spec.get("runtime_required")
    if include_runtime and runtime_required:
        runtime_asset = _find_asset(assets, runtime_required)

    install_dir = _INSTALL_ROOT / f"{tag}-{variant}"
    temp_dir = _INSTALL_ROOT / f".tmp-{tag}-{variant}"
    archive_dir = temp_dir / "archives"

    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir(parents=True, exist_ok=True)
    archive_dir.mkdir(parents=True, exist_ok=True)

    try:
        binary_zip = archive_dir / str(binary_asset["name"])
        logger.info("Downloading llama.cpp runtime asset: %s", binary_asset["name"])
        _download_asset(binary_asset, binary_zip)
        _extract_zip_safe(binary_zip, temp_dir)

        if runtime_asset:
            runtime_zip = archive_dir / str(runtime_asset["name"])
            logger.info("Downloading llama.cpp runtime dependency asset: %s", runtime_asset["name"])
            _download_asset(runtime_asset, runtime_zip)
            _extract_zip_safe(runtime_zip, temp_dir)

        shutil.rmtree(archive_dir, ignore_errors=True)
        exe = _find_llama_server_exe(temp_dir)
        if not exe:
            raise ValueError("Downloaded llama.cpp archive did not contain llama-server")

        if install_dir.exists():
            current_exe = Path(get_llama_paths().get("llama_exe", ""))
            try:
                if current_exe.resolve().is_relative_to(install_dir.resolve()):
                    _kill_running()
                    time.sleep(1)
            except (OSError, ValueError):
                pass
            shutil.rmtree(install_dir)
        temp_dir.replace(install_dir)
        final_exe = install_dir / exe.relative_to(temp_dir)

        paths = get_llama_paths()
        paths["llama_exe"] = str(final_exe)
        paths["llama_runtime_variant"] = variant
        paths["llama_runtime_tag"] = tag
        paths["llama_runtime_label"] = spec["label"]
        _save_llama_paths(paths)

        return {
            "status": "installed",
            "tag": tag,
            "variant": variant,
            "label": spec["label"],
            "llama_exe": str(final_exe),
        }
    except Exception:
        if temp_dir.exists():
            shutil.rmtree(temp_dir, ignore_errors=True)
        raise


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
    kwargs: dict = {"stdout": subprocess.PIPE, "stderr": subprocess.PIPE, "stdin": subprocess.DEVNULL}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW

    proc = subprocess.Popen(cmd, **kwargs)

    llama_logger = logging.getLogger("llama_server")
    for stream, level in ((proc.stdout, logging.DEBUG), (proc.stderr, logging.INFO)):
        def _drain(s=stream, lv=level):
            for raw in s:
                line = raw.decode("utf-8", errors="replace").rstrip()
                if line:
                    llama_logger.log(lv, line)
        threading.Thread(target=_drain, daemon=True).start()
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
