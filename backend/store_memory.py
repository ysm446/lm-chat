from __future__ import annotations

import logging
import math
import struct
from datetime import datetime, timezone

from .models import MemoryChunk, MessageCreate


class MemoryMixin:
    def memory_chunk_count(self) -> int:
        with self._connect() as conn:  # type: ignore[attr-defined]
            row = conn.execute("SELECT COUNT(*) AS count FROM memory_chunks").fetchone()
        return 0 if row is None else int(row["count"])

    def save_memory(self, session_id: str, messages: list[MessageCreate]) -> list[MemoryChunk] | None:
        from .memory.embedder import embed

        session = self.get_session(session_id)  # type: ignore[attr-defined]
        if session is None:
            return None
        chunks: list[MemoryChunk] = []
        with self._connect() as conn:  # type: ignore[attr-defined]
            for payload in messages:
                chunk = MemoryChunk(
                    id=self._new_id("mem"),  # type: ignore[attr-defined]
                    workspace_id=session.workspace_id,
                    session_id=session.id,
                    content=payload.content,
                )
                conn.execute(
                    "INSERT INTO memory_chunks (id, workspace_id, session_id, chunk_type, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (chunk.id, chunk.workspace_id, chunk.session_id, chunk.chunk_type, chunk.content, chunk.created_at),
                )
                conn.execute("INSERT INTO memory_fts (id, content) VALUES (?, ?)", (chunk.id, chunk.content))
                vector = embed(chunk.content)
                vec_bytes = struct.pack(f"{len(vector)}f", *vector)
                conn.execute("INSERT INTO memory_vec (chunk_id, embedding) VALUES (?, ?)", (chunk.id, vec_bytes))
                chunks.append(chunk)
        return chunks

    def search_memory(
        self,
        workspace_id: str,
        query: str,
        top_k: int,
        exclude_session_id: str | None = None,
        session_scope: str = "workspace",
        half_life_days: int = 30,
    ) -> list[MemoryChunk]:
        from .memory.embedder import embed

        logger = logging.getLogger(__name__)
        query_vec = embed(query)
        rrf_k = 60
        half_life_days = max(0, int(half_life_days))
        scores: dict[str, float] = {}

        with self._connect() as conn:  # type: ignore[attr-defined]
            session_filter_clause = ""
            session_filter_params: tuple[str, ...] = ()
            if session_scope in {"above_current", "below_current"}:
                if not exclude_session_id:
                    return []
                current = conn.execute(
                    "SELECT sort_order FROM sessions WHERE id = ? AND workspace_id = ?",
                    (exclude_session_id, workspace_id),
                ).fetchone()
                if current is None:
                    return []
                operator = "<" if session_scope == "above_current" else ">"
                scoped_rows = conn.execute(
                    f"SELECT id FROM sessions WHERE workspace_id = ? AND sort_order {operator} ?",
                    (workspace_id, current["sort_order"]),
                ).fetchall()
                scoped_session_ids = [row["id"] for row in scoped_rows]
                if not scoped_session_ids:
                    return []
                placeholders_scope = ",".join("?" * len(scoped_session_ids))
                session_filter_clause = f" AND mc.session_id IN ({placeholders_scope})"
                session_filter_params = tuple(scoped_session_ids)
            elif exclude_session_id:
                session_filter_clause = " AND mc.session_id != ?"
                session_filter_params = (exclude_session_id,)

            safe_query = '"' + query.replace('"', ' ') + '"'
            try:
                fts_rows = conn.execute(
                    "SELECT mc.id FROM memory_fts mf JOIN memory_chunks mc ON mc.id = mf.id WHERE mf.content MATCH ? AND mc.workspace_id = ?" + session_filter_clause + " LIMIT ?",
                    (safe_query, workspace_id, *session_filter_params, top_k * 4),
                ).fetchall()
                for rank, row in enumerate(fts_rows):
                    scores[row["id"]] = scores.get(row["id"], 0.0) + 1.0 / (rrf_k + rank + 1)
                logger.debug("FTS5 hits: %d", len(fts_rows))
            except Exception as e:
                logger.warning("FTS5 search failed: %s", e)

            # グローバル KNN だと他ワークスペースのチャンクが上位を占めて取りこぼすため、
            # 対象ワークスペース内のチャンクに限定して距離を直接計算する
            vec_bytes = struct.pack(f"{len(query_vec)}f", *query_vec)
            try:
                vec_rows = conn.execute(
                    "SELECT mc.id AS chunk_id, vec_distance_cosine(mv.embedding, ?) AS distance"
                    " FROM memory_chunks mc JOIN memory_vec mv ON mv.chunk_id = mc.id"
                    " WHERE mc.workspace_id = ?" + session_filter_clause +
                    " ORDER BY distance ASC LIMIT ?",
                    (vec_bytes, workspace_id, *session_filter_params, top_k * 4),
                ).fetchall()
            except Exception as e:
                logger.warning("Vector search failed: %s", e)
                vec_rows = []
            for rank, row in enumerate(vec_rows):
                scores[row["chunk_id"]] = scores.get(row["chunk_id"], 0.0) + 1.0 / (rrf_k + rank + 1)

            if not scores:
                return []

            ids = list(scores.keys())
            placeholders = ",".join("?" * len(ids))
            chunk_rows = conn.execute(
                f"SELECT id, workspace_id, session_id, chunk_type, content, created_at FROM memory_chunks mc WHERE id IN ({placeholders})" + session_filter_clause,
                ids + list(session_filter_params),
            ).fetchall()

        now = datetime.now(timezone.utc)
        chunks_by_id = {row["id"]: row for row in chunk_rows}

        def _decayed_score(chunk_id: str) -> float:
            row = chunks_by_id[chunk_id]
            try:
                created = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
                days_elapsed = (now - created).total_seconds() / 86400
                decay = 1.0 if half_life_days <= 0 else math.pow(0.5, days_elapsed / half_life_days)
            except Exception:
                decay = 1.0
            return scores[chunk_id] * decay

        ranked = sorted(scores.keys(), key=_decayed_score, reverse=True)[:top_k]
        return [self._memory_from_row(chunks_by_id[cid]) for cid in ranked if cid in chunks_by_id]  # type: ignore[attr-defined]

    def delete_workspace_memory(self, workspace_id: str) -> int:
        with self._connect() as conn:  # type: ignore[attr-defined]
            chunk_ids = [row["id"] for row in conn.execute("SELECT id FROM memory_chunks WHERE workspace_id = ?", (workspace_id,)).fetchall()]
            if chunk_ids:
                placeholders = ",".join("?" * len(chunk_ids))
                conn.execute(f"DELETE FROM memory_fts WHERE id IN ({placeholders})", chunk_ids)
                conn.execute(f"DELETE FROM memory_vec WHERE chunk_id IN ({placeholders})", chunk_ids)
            cursor = conn.execute("DELETE FROM memory_chunks WHERE workspace_id = ?", (workspace_id,))
        return cursor.rowcount

    def delete_session_memory(self, session_id: str) -> int:
        with self._connect() as conn:  # type: ignore[attr-defined]
            chunk_ids = [row["id"] for row in conn.execute("SELECT id FROM memory_chunks WHERE session_id = ?", (session_id,)).fetchall()]
            if chunk_ids:
                placeholders = ",".join("?" * len(chunk_ids))
                conn.execute(f"DELETE FROM memory_fts WHERE id IN ({placeholders})", chunk_ids)
                conn.execute(f"DELETE FROM memory_vec WHERE chunk_id IN ({placeholders})", chunk_ids)
            cursor = conn.execute("DELETE FROM memory_chunks WHERE session_id = ?", (session_id,))
        return cursor.rowcount

    def cleanup_memory(self) -> dict[str, int]:
        with self._connect() as conn:  # type: ignore[attr-defined]
            orphan_chunk_ids = [
                row["id"] for row in conn.execute(
                    "SELECT mc.id FROM memory_chunks mc LEFT JOIN sessions s ON s.id = mc.session_id LEFT JOIN workspaces w ON w.id = mc.workspace_id WHERE s.id IS NULL OR w.id IS NULL OR s.workspace_id != mc.workspace_id"
                ).fetchall()
            ]
            deleted_chunks = 0
            if orphan_chunk_ids:
                placeholders = ",".join("?" * len(orphan_chunk_ids))
                conn.execute(f"DELETE FROM memory_fts WHERE id IN ({placeholders})", orphan_chunk_ids)
                conn.execute(f"DELETE FROM memory_vec WHERE chunk_id IN ({placeholders})", orphan_chunk_ids)
                deleted_chunks = conn.execute(f"DELETE FROM memory_chunks WHERE id IN ({placeholders})", orphan_chunk_ids).rowcount

            orphan_fts_ids = [row["id"] for row in conn.execute("SELECT mf.id FROM memory_fts mf LEFT JOIN memory_chunks mc ON mc.id = mf.id WHERE mc.id IS NULL").fetchall()]
            deleted_fts = 0
            if orphan_fts_ids:
                placeholders = ",".join("?" * len(orphan_fts_ids))
                deleted_fts = conn.execute(f"DELETE FROM memory_fts WHERE id IN ({placeholders})", orphan_fts_ids).rowcount

            orphan_vec_ids = [row["chunk_id"] for row in conn.execute("SELECT mv.chunk_id FROM memory_vec mv LEFT JOIN memory_chunks mc ON mc.id = mv.chunk_id WHERE mc.id IS NULL").fetchall()]
            deleted_vec = 0
            if orphan_vec_ids:
                placeholders = ",".join("?" * len(orphan_vec_ids))
                deleted_vec = conn.execute(f"DELETE FROM memory_vec WHERE chunk_id IN ({placeholders})", orphan_vec_ids).rowcount

        return {"deleted_chunks": deleted_chunks, "deleted_fts": deleted_fts, "deleted_vec": deleted_vec}
