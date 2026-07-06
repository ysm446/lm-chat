from __future__ import annotations

import logging
import struct

from .models import MessageSearchHit

_RRF_K = 60
_SNIPPET_CHARS = 160


def _snippet(content: str, query: str) -> str:
    """クエリ語の周辺を切り出したスニペット。見つからなければ先頭を返す。"""
    text = " ".join(content.split())
    if len(text) <= _SNIPPET_CHARS:
        return text
    lowered = text.lower()
    idx = lowered.find(query.lower().strip())
    if idx < 0:
        return text[:_SNIPPET_CHARS] + "…"
    start = max(0, idx - _SNIPPET_CHARS // 3)
    end = min(len(text), start + _SNIPPET_CHARS)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    return f"{prefix}{text[start:end]}{suffix}"


class SearchMixin:
    def search_messages(
        self,
        query: str,
        top_k: int = 30,
        workspace_id: str | None = None,
    ) -> list[MessageSearchHit]:
        """メッセージ本文をキーワード（FTS5）＋意味（memory_vec 流用）で横断検索する。

        セッション単位に集約し、RRF でランキング。キーワードヒットは正確な
        メッセージ ID をジャンプ先として保持する。意味検索は記憶ベクトル
        （会話の Q&A ペア埋め込み）を流用するため新規ベクトル化は不要。

        workspace_id=None のときは現在のライブラリ全ワークスペースを対象にする。
        """
        logger = logging.getLogger(__name__)
        q = query.strip()
        if not q:
            return []

        scores: dict[str, float] = {}
        titles: dict[str, str] = {}
        ws_ids: dict[str, str] = {}
        jump_msg: dict[str, str] = {}
        snippets: dict[str, str] = {}
        sources: dict[str, set[str]] = {}

        ws_clause = " AND s.workspace_id = ?" if workspace_id else ""
        ws_param: tuple[str, ...] = (workspace_id,) if workspace_id else ()

        with self._connect() as conn:  # type: ignore[attr-defined]
            # --- キーワード検索（message_fts） ---
            safe_query = '"' + q.replace('"', " ") + '"'
            try:
                fts_rows = conn.execute(
                    "SELECT m.id AS message_id, m.content AS content, s.id AS session_id,"
                    " s.title AS session_title, s.workspace_id AS workspace_id"
                    " FROM message_fts f"
                    " JOIN messages m ON m.id = f.id"
                    " JOIN sessions s ON s.id = m.session_id"
                    " WHERE f.content MATCH ?" + ws_clause +
                    " ORDER BY rank LIMIT ?",
                    (safe_query, *ws_param, top_k * 4),
                ).fetchall()
            except Exception as e:
                logger.warning("Message FTS search failed: %s", e)
                fts_rows = []
            for rank, row in enumerate(fts_rows):
                sid = row["session_id"]
                scores[sid] = scores.get(sid, 0.0) + 1.0 / (_RRF_K + rank + 1)
                titles.setdefault(sid, row["session_title"])
                ws_ids.setdefault(sid, row["workspace_id"])
                sources.setdefault(sid, set()).add("keyword")
                # セッションあたり最初（最上位）のキーワードヒットをジャンプ先にする
                if sid not in jump_msg:
                    jump_msg[sid] = row["message_id"]
                    snippets[sid] = _snippet(row["content"], q)

            # --- 意味検索（memory_vec を流用） ---
            from .memory.embedder import embed_query

            query_vec = embed_query(q)
            vec_bytes = struct.pack(f"{len(query_vec)}f", *query_vec)
            try:
                vec_rows = conn.execute(
                    "SELECT mc.session_id AS session_id, mc.content AS content,"
                    " s.title AS session_title, s.workspace_id AS workspace_id,"
                    " vec_distance_cosine(mv.embedding, ?) AS distance"
                    " FROM memory_chunks mc"
                    " JOIN memory_vec mv ON mv.chunk_id = mc.id"
                    " JOIN sessions s ON s.id = mc.session_id"
                    " WHERE 1=1" + ws_clause +
                    " ORDER BY distance ASC LIMIT ?",
                    (vec_bytes, *ws_param, top_k * 4),
                ).fetchall()
            except Exception as e:
                logger.warning("Message semantic search failed: %s", e)
                vec_rows = []
            for rank, row in enumerate(vec_rows):
                sid = row["session_id"]
                scores[sid] = scores.get(sid, 0.0) + 1.0 / (_RRF_K + rank + 1)
                titles.setdefault(sid, row["session_title"])
                ws_ids.setdefault(sid, row["workspace_id"])
                sources.setdefault(sid, set()).add("semantic")
                # キーワードヒットが無いセッションだけ意味ヒットのスニペットを使う
                if sid not in snippets:
                    snippets[sid] = _snippet(row["content"], q)

        ranked = sorted(scores.keys(), key=lambda s: scores[s], reverse=True)[:top_k]
        return [
            MessageSearchHit(
                session_id=sid,
                session_title=titles.get(sid, ""),
                workspace_id=ws_ids.get(sid, ""),
                message_id=jump_msg.get(sid),
                snippet=snippets.get(sid, ""),
                score=round(scores[sid], 6),
                sources=sorted(sources.get(sid, set())),
            )
            for sid in ranked
        ]
