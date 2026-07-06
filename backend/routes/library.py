from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException

from .. import library_store
from ..models import LibraryStateResponse, LibrarySwitchRequest
from .deps import switch_library

logger = logging.getLogger(__name__)
router = APIRouter()


def _state() -> LibraryStateResponse:
    return LibraryStateResponse(
        active=library_store.get_active_path(),
        libraries=library_store.list_libraries(),
    )


@router.get("/library", response_model=LibraryStateResponse)
def get_library_state() -> LibraryStateResponse:
    return _state()


@router.post("/library/switch", response_model=LibraryStateResponse)
def switch_library_endpoint(payload: LibrarySwitchRequest) -> LibraryStateResponse:
    path = Path(payload.path).expanduser()
    if not path.exists():
        raise HTTPException(status_code=404, detail="ライブラリのフォルダが見つかりません")
    if not path.is_dir():
        raise HTTPException(status_code=400, detail="ライブラリはフォルダを指定してください")
    active = library_store.set_active(str(path))
    switch_library(active)
    logger.info("Switched library to: %s", active)
    return _state()


@router.post("/library/create", response_model=LibraryStateResponse)
def create_library_endpoint(payload: LibrarySwitchRequest) -> LibraryStateResponse:
    path = Path(payload.path).expanduser()
    if path.exists() and not path.is_dir():
        raise HTTPException(status_code=400, detail="同名のファイルが既に存在します")
    if path.exists() and (path / "lm_chat.db").exists():
        raise HTTPException(status_code=409, detail="そのフォルダには既にライブラリが存在します")
    # set_active がフォルダを作成し、switch_library → store.reinit が
    # 空ライブラリのテーブル作成と既定ワークスペースのシードを行う。
    active = library_store.set_active(str(path))
    switch_library(active)
    logger.info("Created and switched to new library: %s", active)
    return _state()
