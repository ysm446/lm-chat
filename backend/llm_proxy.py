from __future__ import annotations

import json
import os
from collections.abc import Iterator
from urllib import error, request

from fastapi import HTTPException

from .models import Session

LLAMA_SERVER_BASE_URL = os.environ.get("LLAMA_SERVER_BASE_URL", "http://127.0.0.1:8080")
LLAMA_MODEL = os.environ.get("LLAMA_MODEL", "Qwen3.5-27B")
SYSTEM_PROMPT = (
    "You are a helpful local assistant. "
    "Answer clearly and concisely. "
    "Do not output hidden chain-of-thought or internal reasoning. "
    "Give the final answer directly."
)


def list_models() -> dict[str, list[dict[str, str]]]:
    return {
        "data": [
            {
                "id": LLAMA_MODEL,
                "object": "model",
            }
        ]
    }


def _build_messages(session: Session, memory_context: str = "") -> list[dict[str, str]]:
    system_prompt = SYSTEM_PROMPT
    if memory_context:
        system_prompt = f"{SYSTEM_PROMPT}\n\n{memory_context}"

    messages: list[dict[str, str]] = [
        {
            "role": "system",
            "content": system_prompt,
        }
    ]
    for message in session.messages:
        messages.append({"role": message.role, "content": message.content})
    return messages


def generate_chat_completion(session: Session, memory_context: str = "") -> str:
    payload = {
        "model": session.model_name or LLAMA_MODEL,
        "messages": _build_messages(session, memory_context),
        "stream": False,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    req = request.Request(
        f"{LLAMA_SERVER_BASE_URL}/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=120) as response:
            body = json.loads(response.read().decode("utf-8"))
    except error.URLError as exc:
        raise HTTPException(status_code=503, detail=f"llama-server is unavailable: {exc}") from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=502, detail=f"Failed to decode llama-server response: {exc}") from exc

    try:
        return body["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, AttributeError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Invalid response from llama-server") from exc


def stream_chat_completion(session: Session, memory_context: str = "") -> Iterator[str]:
    payload = {
        "model": session.model_name or LLAMA_MODEL,
        "messages": _build_messages(session, memory_context),
        "stream": True,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    req = request.Request(
        f"{LLAMA_SERVER_BASE_URL}/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=600) as response:
            for raw_line in response:
                line = raw_line.decode("utf-8", errors="ignore").strip()
                if not line or not line.startswith("data: "):
                    continue
                data = line[6:]
                if data == "[DONE]":
                    break
                try:
                    payload = json.loads(data)
                except json.JSONDecodeError:
                    continue
                delta = payload.get("choices", [{}])[0].get("delta", {})
                content = delta.get("content")
                if content:
                    yield content
    except error.URLError as exc:
        raise HTTPException(status_code=503, detail=f"llama-server is unavailable: {exc}") from exc