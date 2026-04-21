from __future__ import annotations

import json
import re

CHUNK_TARGET = 800   # 目標チャンクサイズ（文字数）
CHUNK_MAX = 1000     # 最大チャンクサイズ（文字数）
OVERLAP = 100        # チャンク間のオーバーラップ（文字数）


def chunk_document(
    file_name: str,
    content: str,
    *,
    chunk_target: int = CHUNK_TARGET,
    chunk_max: int = CHUNK_MAX,
    overlap: int = OVERLAP,
) -> list[str]:
    """ファイル名から拡張子を判断してチャンク分割する。"""
    chunk_target = max(100, int(chunk_target))
    chunk_max = max(chunk_target, int(chunk_max))
    overlap = max(0, min(int(overlap), chunk_max - 1))
    lower = file_name.lower()
    if lower.endswith(".md"):
        return _chunk_markdown(content, chunk_target=chunk_target, chunk_max=chunk_max, overlap=overlap)
    if lower.endswith(".json"):
        return _chunk_json(content, chunk_target=chunk_target, chunk_max=chunk_max, overlap=overlap)
    return _chunk_text(content, chunk_target=chunk_target, chunk_max=chunk_max, overlap=overlap)


def _split_long(text: str, *, chunk_target: int, chunk_max: int, overlap: int) -> list[str]:
    """長すぎるテキストを CHUNK_MAX 文字以内に分割する（OVERLAP 付き）。"""
    text = text.strip()
    if not text:
        return []
    if len(text) <= chunk_max:
        return [text]
    parts: list[str] = []
    start = 0
    while start < len(text):
        end = start + chunk_max
        if end >= len(text):
            parts.append(text[start:].strip())
            break
        # 句読点・改行で区切れる位置を探す
        split_at = -1
        for sep in ("\n", "。", "．", ". ", " "):
            pos = text.rfind(sep, start + chunk_target // 2, end)
            if pos > start:
                split_at = pos + len(sep)
                break
        if split_at < 0:
            split_at = end
        chunk = text[start:split_at].strip()
        if chunk:
            parts.append(chunk)
        start = max(start + 1, split_at - overlap)
    return [p for p in parts if p]


def _chunk_text(content: str, *, chunk_target: int, chunk_max: int, overlap: int) -> list[str]:
    """プレーンテキスト: 段落単位で分割し、長すぎる段落はさらに分割する。"""
    paragraphs = re.split(r"\n{2,}", content)
    result: list[str] = []
    buffer = ""
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        candidate = (buffer + "\n\n" + para).strip() if buffer else para
        if len(candidate) <= chunk_max:
            buffer = candidate
        else:
            if buffer:
                result.extend(
                    _split_long(buffer, chunk_target=chunk_target, chunk_max=chunk_max, overlap=overlap)
                )
            buffer = para
    if buffer:
        result.extend(_split_long(buffer, chunk_target=chunk_target, chunk_max=chunk_max, overlap=overlap))
    return [c for c in result if c.strip()]


def _chunk_markdown(content: str, *, chunk_target: int, chunk_max: int, overlap: int) -> list[str]:
    """Markdown: 見出し（#）を一次分割境界とし、長すぎるセクションはさらに分割する。"""
    # 見出し行で分割
    heading_re = re.compile(r"^(#{1,6})\s+.+", re.MULTILINE)
    sections: list[str] = []
    prev_end = 0
    for m in heading_re.finditer(content):
        if m.start() > prev_end:
            sections.append(content[prev_end:m.start()])
        prev_end = m.start()
    sections.append(content[prev_end:])

    result: list[str] = []
    for section in sections:
        section = section.strip()
        if not section:
            continue
        if len(section) <= chunk_max:
            result.append(section)
        else:
            # 見出しを先頭に保持したままテキスト部分を分割
            lines = section.split("\n", 1)
            heading = lines[0].strip() if lines else ""
            body = lines[1] if len(lines) > 1 else ""
            sub_chunks = _chunk_text(body, chunk_target=chunk_target, chunk_max=chunk_max, overlap=overlap)
            if sub_chunks:
                # 見出しを各サブチャンクに付ける
                result.append(heading + "\n" + sub_chunks[0] if heading else sub_chunks[0])
                result.extend(sub_chunks[1:])
            elif heading:
                result.append(heading)
    return [c for c in result if c.strip()]


def _chunk_json(content: str, *, chunk_target: int, chunk_max: int, overlap: int) -> list[str]:
    """JSON: トップレベルのキー/配列要素を区切りとして使い、フォールバックはテキスト分割。"""
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return _chunk_text(content, chunk_target=chunk_target, chunk_max=chunk_max, overlap=overlap)

    if isinstance(parsed, dict):
        # トップレベルキーごとに文字列化してチャンク化
        items = [json.dumps({k: v}, ensure_ascii=False, indent=2) for k, v in parsed.items()]
    elif isinstance(parsed, list):
        items = [json.dumps(item, ensure_ascii=False, indent=2) for item in parsed]
    else:
        items = [json.dumps(parsed, ensure_ascii=False, indent=2)]

    result: list[str] = []
    buffer = ""
    for item in items:
        candidate = (buffer + "\n" + item).strip() if buffer else item
        if len(candidate) <= chunk_max:
            buffer = candidate
        else:
            if buffer:
                result.extend(
                    _split_long(buffer, chunk_target=chunk_target, chunk_max=chunk_max, overlap=overlap)
                )
            buffer = item
    if buffer:
        result.extend(_split_long(buffer, chunk_target=chunk_target, chunk_max=chunk_max, overlap=overlap))
    return [c for c in result if c.strip()]
