from __future__ import annotations

import json
import logging
import os
from collections.abc import Iterator
from typing import TypedDict
from urllib import error, request

from .debug_store import append_prompt_log
from .settings_store import get as get_settings_data

logger = logging.getLogger(__name__)


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


def _build_messages(session: Session, memory_context: str = "", system_prompt: str | None = None) -> list[dict]:
    base_prompt = system_prompt if system_prompt else SYSTEM_PROMPT
    effective_prompt = f"{base_prompt}\n\n{memory_context}" if memory_context else base_prompt

    messages: list[dict] = [{"role": "system", "content": effective_prompt}]
    for message in session.messages:
        if message.image_data:
            content: list[dict] = []
            if message.content:
                content.append({"type": "text", "text": message.content})
            content.append({"type": "image_url", "image_url": {"url": message.image_data}})
            messages.append({"role": message.role, "content": content})
        else:
            messages.append({"role": message.role, "content": message.content})
    if get_settings_data().get("debug_prompt_log", False):
        sep = "-" * 60
        lines = [f"_build_messages ({len(messages)} msgs)", sep]
        for i, m in enumerate(messages):
            role = m["role"]
            content = m["content"] if isinstance(m["content"], str) else "[image content]"
            lines.append(f"[{i}] {role}:\n{content}\n{sep}")
        prompt_log = "\n".join(lines)
        append_prompt_log(label="Prompt", lines=lines)
        logger.debug(prompt_log)
    return messages


def generate_title(text: str) -> str:
    """最初のユーザーメッセージからセッションタイトルを生成する"""
    import logging
    import re
    logger = logging.getLogger(__name__)
    title_payload = {
        "model": LLAMA_MODEL,
        "messages": [
            {"role": "system", "content": "あなたはタイトル生成専門のアシスタントです。与えられたテキストに対し、内容を端的に表す15〜25文字程度の日本語タイトルを1行だけ返してください。説明・引用符・記号は不要です。"},
            {"role": "user", "content": text[:500]},
        ],
        "stream": False,
        "max_tokens": 50,
        "chat_template_kwargs": {"enable_thinking": False},
        "thinking": {"type": "disabled"},
    }
    req = request.Request(
        f"{LLAMA_SERVER_BASE_URL}/v1/chat/completions",
        data=json.dumps(title_payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
        raw = body["choices"][0]["message"]["content"].strip()
        # <think>...</think> ブロックを除去
        raw = re.sub(r"<think>[\s\S]*?</think>", "", raw).strip()
        title = raw.splitlines()[0].strip()
        logger.debug("generate_title result: %r", title)
        return title[:60] if title else text[:40]
    except Exception as e:
        logger.error("generate_title failed: %s", e)
        return text[:40]


def autocomplete(text: str, max_tokens: int = 80) -> str:
    """入力テキストの続きを短く補完する"""
    payload = {
        "model": LLAMA_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "あなたはテキスト補完アシスタントです。"
                    "ユーザーが入力しているテキストの続きを自然に補完してください。"
                    "補完部分のみを返してください。元のテキストは繰り返さないでください。"
                    "1〜2文以内で簡潔に。"
                ),
            },
            {"role": "user", "content": text},
        ],
        "stream": False,
        "max_tokens": max_tokens,
        "temperature": 0.3,
        "chat_template_kwargs": {"enable_thinking": False},
        "thinking": {"type": "disabled"},
    }
    req = request.Request(
        f"{LLAMA_SERVER_BASE_URL}/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=10) as response:
            body = json.loads(response.read().decode("utf-8"))
        return body["choices"][0]["message"]["content"].strip()
    except Exception:
        return ""


_DEFAULT_CORRECTION_PROMPT = (
    "あなたはテキスト校正アシスタントです。"
    "ユーザーが選択したテキストを校正・改善してください。"
    "改善後のテキストのみを返してください。説明や前置きは不要です。"
)

_LIGHT_CORRECTION_PROMPT = (
    "あなたはテキスト校正アシスタントです。"
    "ユーザーが選択した文章の意味や文体はなるべく維持したまま、"
    "明らかな誤字脱字や不自然な表現だけを軽く整えてください。"
    "説明は不要で、校正後の本文のみを返してください。"
)

_STANDARD_CORRECTION_PROMPT = _DEFAULT_CORRECTION_PROMPT

_AGGRESSIVE_CORRECTION_PROMPT = (
    "あなたはテキスト校正アシスタントです。"
    "ユーザーが選択した文章を、意味を保ちながらより自然で読みやすく、"
    "分かりやすい表現へ積極的に改善してください。"
    "必要に応じて語順や言い回しも整えてください。"
    "説明は不要で、校正後の本文のみを返してください。"
)

def correct(text: str, system_prompt: str | None = None) -> str:
    """選択テキストを校正・改善する"""
    payload = {
        "model": LLAMA_MODEL,
        "messages": [
            {
                "role": "system",
                "content": system_prompt if system_prompt else _DEFAULT_CORRECTION_PROMPT,
            },
            {"role": "user", "content": text},
        ],
        "stream": False,
        "max_tokens": 200,
        "temperature": 0.3,
        "chat_template_kwargs": {"enable_thinking": False},
        "thinking": {"type": "disabled"},
    }
    req = request.Request(
        f"{LLAMA_SERVER_BASE_URL}/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=15) as response:
            body = json.loads(response.read().decode("utf-8"))
        return body["choices"][0]["message"]["content"].strip()
    except Exception:
        return ""


def generate_chat_completion(session: Session, memory_context: str = "", thinking_enabled: bool = False, system_prompt: str | None = None, temperature: float = 0.8) -> str:
    payload = {
        "model": session.model_name or LLAMA_MODEL,
        "messages": _build_messages(session, memory_context, system_prompt),
        "stream": False,
        "temperature": temperature,
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


def _iter_stream(payload: dict) -> Iterator[str | GenerationStats]:
    req = request.Request(
        f"{LLAMA_SERVER_BASE_URL}/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        in_thinking = False
        with request.urlopen(req, timeout=600) as response:
            for raw_line in response:
                line = raw_line.decode("utf-8", errors="ignore").strip()
                if not line or not line.startswith("data: "):
                    continue
                data = line[6:]
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choice = chunk.get("choices", [{}])[0]
                delta = choice.get("delta", {})
                reasoning = delta.get("reasoning_content")
                content = delta.get("content")
                if reasoning:
                    if not in_thinking:
                        in_thinking = True
                        yield "<think>"
                    yield reasoning
                elif content:
                    if in_thinking:
                        in_thinking = False
                        yield "</think>\n"
                    yield content
                elif choice.get("finish_reason"):
                    usage = chunk.get("usage", {})
                    timings = chunk.get("timings", {})
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


def stream_temp_chat(messages: list[dict], thinking_enabled: bool = False, system_prompt: str | None = None, temperature: float = 0.8) -> Iterator[str | GenerationStats]:
    base = system_prompt if system_prompt else SYSTEM_PROMPT
    built = [{"role": "system", "content": base}] + [{"role": m["role"], "content": m["content"]} for m in messages]
    payload: dict = {
        "model": LLAMA_MODEL,
        "messages": built,
        "stream": True,
        "temperature": temperature,
        "chat_template_kwargs": {"enable_thinking": thinking_enabled},
    }
    if not thinking_enabled:
        payload["thinking"] = {"type": "disabled"}
    yield from _iter_stream(payload)


def stream_chat_completion(session: Session, memory_context: str = "", thinking_enabled: bool = False, system_prompt: str | None = None, temperature: float = 0.8) -> Iterator[str | GenerationStats]:
    payload: dict = {
        "model": session.model_name or LLAMA_MODEL,
        "messages": _build_messages(session, memory_context, system_prompt),
        "stream": True,
        "temperature": temperature,
        "chat_template_kwargs": {"enable_thinking": thinking_enabled},
    }
    if not thinking_enabled:
        payload["thinking"] = {"type": "disabled"}
    yield from _iter_stream(payload)




