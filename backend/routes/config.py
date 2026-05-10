from __future__ import annotations

from fastapi import APIRouter

from ..config_store import get as get_config_data
from ..config_store import update as update_config_data
from ..models import ConfigUpdate
from ..settings_store import get as get_settings_data
from ..settings_store import update as update_settings_data

router = APIRouter()


@router.get("/config")
def get_config() -> dict:
    return get_config_data()


@router.patch("/config")
def patch_config(payload: ConfigUpdate) -> dict:
    return update_config_data(payload.model_dump(exclude_none=True))


@router.get("/settings")
def get_settings() -> dict:
    return get_settings_data()


@router.patch("/settings")
def patch_settings(payload: dict) -> dict:
    return update_settings_data(payload)
