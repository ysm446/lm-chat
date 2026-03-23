from __future__ import annotations

from ..models import WebSearchResult, WebSearchResultItem


def search_web(query: str, max_results: int, engine: str = "searxng") -> WebSearchResult:
    items = [
        WebSearchResultItem(
            title=f"{query} に関するダミー結果 {index + 1}",
            url=f"https://example.com/search/{index + 1}",
            snippet="SearXNG 統合前のスタブ結果です。",
        )
        for index in range(max_results)
    ]
    return WebSearchResult(query=query, engine=engine, items=items)