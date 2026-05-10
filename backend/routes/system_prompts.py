from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..system_prompt_store import (
    create_prompt,
    delete_prompt,
    get_all as get_system_prompts,
    reorder_prompts,
    set_active_id,
    set_active_text,
    update_prompt,
)

router = APIRouter()


@router.get("/system-prompts")
def list_system_prompts() -> dict:
    return get_system_prompts()


@router.post("/system-prompts")
def add_system_prompt(payload: dict) -> dict:
    name = payload.get("name", "").strip()
    content = payload.get("content", "")
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    return create_prompt(name, content)


@router.patch("/system-prompts/{prompt_id}")
def edit_system_prompt(prompt_id: str, payload: dict) -> dict:
    name = payload.get("name")
    content = payload.get("content")
    updated = update_prompt(prompt_id, name, content)
    if not updated:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return updated


@router.post("/system-prompts/reorder")
def reorder_system_prompts(payload: dict) -> dict:
    reorder_prompts(payload.get("ids", []))
    return {"ok": True}


@router.delete("/system-prompts/{prompt_id}")
def remove_system_prompt(prompt_id: str) -> dict[str, bool]:
    deleted = delete_prompt(prompt_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return {"deleted": True}


@router.patch("/system-prompts/active")
def update_active_system_prompt(payload: dict) -> dict[str, str]:
    text = payload.get("text", "")
    prompt_id = payload.get("active_id", "")
    set_active_text(text)
    set_active_id(prompt_id)
    return {"active_text": text, "active_id": prompt_id}
