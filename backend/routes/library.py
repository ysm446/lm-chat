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


def _switch_then_record(resolved: str) -> None:
    """先に reinit（版チェック/移行を含む）を試み、成功時のみレジストリを更新する。

    失敗時に switch_library が元ライブラリへ戻すので、レジストリを壊れたライブラリへ
    向けたまま残さない。
    """
    switch_library(resolved)
    library_store.set_active(resolved)


@router.post("/library/switch", response_model=LibraryStateResponse)
def switch_library_endpoint(payload: LibrarySwitchRequest) -> LibraryStateResponse:
    path = Path(payload.path).expanduser()
    if not path.exists():
        raise HTTPException(status_code=404, detail="ライブラリのフォルダが見つかりません")
    if not path.is_dir():
        raise HTTPException(status_code=400, detail="ライブラリはフォルダを指定してください")
    try:
        _switch_then_record(str(path.resolve()))
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    logger.info("Switched library to: %s", library_store.get_active_path())
    return _state()


@router.post("/library/create", response_model=LibraryStateResponse)
def create_library_endpoint(payload: LibrarySwitchRequest) -> LibraryStateResponse:
    path = Path(payload.path).expanduser()
    if path.exists() and not path.is_dir():
        raise HTTPException(status_code=400, detail="同名のファイルが既に存在します")
    if path.exists() and (path / "lm_chat.db").exists():
        raise HTTPException(status_code=409, detail="そのフォルダには既にライブラリが存在します")
    # switch_library → store.reinit が空ライブラリのテーブル作成と既定ワークスペースの
    # シードを行い、成功後にレジストリへ記録する。
    try:
        _switch_then_record(str(path.resolve()))
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    logger.info("Created and switched to new library: %s", library_store.get_active_path())
    return _state()
