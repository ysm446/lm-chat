from __future__ import annotations

import json
import os
from collections.abc import Iterator
from typing import TypedDict
from urllib import error, request


class GenerationStats(TypedDict):
    completion_tokens: int
    tokens_per_second: float
    elapsed_seconds: float
    finish_reason: str

from fastapi import HTTPException

from .models import Session

LLAMA_SERVER_BASE_URL = os.environ.get("LLAMA_SERVER_BASE_URL", "http://127.0.0.1:8080")
LLAMA_MODEL = os.environ.get("LLAMA_MODEL", "Qwen3.5-27B")
SYSTEM_PROMPT = (
    "あなたは親切なローカルアシスタントです。"
    "ユーザーの質問に明確かつ簡潔に答えてください。"
    "内部の推論過程は出力せず、最終的な回答を直接述べてください。"
)


def count_tokens(text: str) -> int:
    payload = {"content": text}
    req = request.Request(
        f"{LLAMA_SERVER_BASE_URL}/tokenize",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=10) as response:
            body = json.loads(response.read().decode("utf-8"))
            return len(body.get("tokens", []))
    except Exception:
        return len(text) // 2  # rough fallback


def list_models() -> dict[str, list[dict[str, str]]]:
    return {
        "data": [
            {
                "id": LLAMA_MODEL,
                "object": "model",
            }
        ]
    }


def _build_messages(session: Session, memory_context: str = "") -> list[dict]:
    system_prompt = SYSTEM_PROMPT
    if memory_context:
        system_prompt = f"{SYSTEM_PROMPT}\n\n{memory_context}"

    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    for message in session.messages:
        if message.image_data:
            content: list[dict] = []
            if message.content:
                content.append({"type": "text", "text": message.content})
            content.append({"type": "image_url", "image_url": {"url": message.image_data}})
            messages.append({"role": message.role, "content": content})
        else:
            messages.append({"role": message.role, "content": message.content})
    return messages


def generate_chat_completion(session: Session, memory_context: str = "", thinking_enabled: bool = False) -> str:
    payload = {
        "model": session.model_name or LLAMA_MODEL,
        "messages": _build_messages(session, memory_context),
        "stream": False,
        "chat_template_kwargs": {"enable_thinking": thinking_enabled},
    }
    if not thinking_enabled:
        payload["thinking"] = {"type": "disabled"}
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


def stream_chat_completion(session: Session, memory_context: str = "", thinking_enabled: bool = False) -> Iterator[str | GenerationStats]:
    payload = {
        "model": session.model_name or LLAMA_MODEL,
        "messages": _build_messages(session, memory_context),
        "stream": True,
        "chat_template_kwargs": {"enable_thinking": thinking_enabled},
    }
    if not thinking_enabled:
        payload["thinking"] = {"type": "disabled"}
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
                choice = payload.get("choices", [{}])[0]
                delta = choice.get("delta", {})
                content = delta.get("content")
                if content:
                    yield content
                elif choice.get("finish_reason"):
                    usage = payload.get("usage", {})
                    timings = payload.get("timings", {})
                    # predicted_n はストリーミング時に確実に返る生成トークン数
                    token_count = timings.get("predicted_n") or usage.get("completion_tokens", 0)
                    if timings or usage:
                        yield GenerationStats(
                            completion_tokens=token_count,
                            tokens_per_second=timings.get("predicted_per_second", 0.0),
                            elapsed_seconds=timings.get("predicted_ms", 0.0) / 1000.0,
                            finish_reason=choice.get("finish_reason", "stop"),
                        )
    except error.URLError as exc:
        raise HTTPException(status_code=503, detail=f"llama-server is unavailable: {exc}") from exc