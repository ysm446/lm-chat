from __future__ import annotations

import json
import uuid
from pathlib import Path

_PATH = Path(__file__).resolve().parent.parent / "data" / "system_prompts.json"


def _load() -> dict:
    if _PATH.exists():
        try:
            return json.loads(_PATH.read_text("utf-8"))
        except Exception:
            pass
    return {"prompts": [], "active_text": "", "active_id": ""}


def _save(data: dict) -> None:
    _PATH.parent.mkdir(parents=True, exist_ok=True)
    _PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")


def get_all() -> dict:
    return _load()


def create_prompt(name: str, content: str) -> dict:
    data = _load()
    prompt = {"id": str(uuid.uuid4()), "name": name, "content": content}
    data["prompts"].append(prompt)
    _save(data)
    return prompt


def update_prompt(prompt_id: str, name: str | None, content: str | None) -> dict | None:
    data = _load()
    for p in data["prompts"]:
        if p["id"] == prompt_id:
            if name is not None:
                p["name"] = name
            if content is not None:
                p["content"] = content
            _save(data)
            return p
    return None


def delete_prompt(prompt_id: str) -> bool:
    data = _load()
    before = len(data["prompts"])
    data["prompts"] = [p for p in data["prompts"] if p["id"] != prompt_id]
    if len(data["prompts"]) == before:
        return False
    _save(data)
    return True


def set_active_text(text: str) -> None:
    data = _load()
    data["active_text"] = text
    _save(data)


def set_active_id(prompt_id: str) -> None:
    data = _load()
    data["active_id"] = prompt_id
    _save(data)
