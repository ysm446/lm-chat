from __future__ import annotations

import sqlite3
from pathlib import Path
from uuid import uuid4

import sqlite_vec

from .models import (
    MemoryChunk,
    Message,
    MessageCreate,
    Session,
    SessionCreate,
    SessionUpdate,
    Workspace,
    WorkspaceCreate,
    WorkspaceUpdate,
    now_iso,
)



class SQLiteStore:
    def __init__(self, db_path: str | Path | None = None) -> None:
        base_dir = Path(__file__).resolve().parent.parent / "data"
        base_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = Path(db_path) if db_path is not None else base_dir / "lm_chat.db"
        self._init_db()
        self._seed_if_empty()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.enable_load_extension(True)
        sqlite_vec.load(conn)
        conn.enable_load_extension(False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS workspaces (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    workspace_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    model_name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS memory_chunks (
                    id TEXT PRIMARY KEY,
                    workspace_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    chunk_type TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
                    id UNINDEXED,
                    content,
                    tokenize='trigram'
                );
                """
            )
            # workspaces sort_order カラムのマイグレーション
            try:
                conn.execute("ALTER TABLE workspaces ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
                conn.commit()
            except Exception:
                pass  # already exists
            # sessions sort_order カラムのマイグレーション
            try:
                conn.execute("ALTER TABLE sessions ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
                conn.commit()
            except Exception:
                pass  # already exists
            # image_data カラムのマイグレーション（既存 DB 対応）
            try:
                conn.execute("ALTER TABLE messages ADD COLUMN image_data TEXT")
                conn.commit()
            except Exception:
                pass  # already exists
            # 生成統計カラムのマイグレーション
            for col, typedef in [
                ("completion_tokens", "INTEGER"),
                ("tokens_per_second", "REAL"),
                ("elapsed_seconds", "REAL"),
                ("finish_reason", "TEXT"),
                ("model_name", "TEXT"),
            ]:
                try:
                    conn.execute(f"ALTER TABLE messages ADD COLUMN {col} {typedef}")
                    conn.commit()
                except Exception:
                    pass  # already exists

            # memory_chunks インデックス（既存 DB にも自動適用）
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_memory_chunks_workspace ON memory_chunks(workspace_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_memory_chunks_session ON memory_chunks(session_id)"
            )
            conn.commit()

            # sqlite-vec テーブルは CREATE IF NOT EXISTS が使えないため個別に確認
            tables = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
            if "memory_vec" not in tables:
                conn.execute(
                    "CREATE VIRTUAL TABLE memory_vec USING vec0(chunk_id TEXT PRIMARY KEY, embedding FLOAT[768])"
                )
                conn.commit()

    def _seed_if_empty(self) -> None:
        if self.workspace_count() > 0:
            return

        investing = self.create_workspace(
            WorkspaceCreate(name="Investing", description="Stocks, funds, and portfolio notes")
        )
        fiction = self.create_workspace(
            WorkspaceCreate(name="Fiction", description="Plot, characters, and revision notes")
        )
        investing_session = self.create_session(
            SessionCreate(workspace_id=investing.id, title="Weekly market view")
        )
        fiction_session = self.create_session(
            SessionCreate(workspace_id=fiction.id, title="Chapter one outline")
        )
        self.append_message(
            investing_session.id,
            MessageCreate(role="assistant", content="This workspace keeps only investing context."),
        )
        self.append_message(
            fiction_session.id,
            MessageCreate(role="assistant", content="This workspace keeps only fiction context."),
        )

    def _new_id(self, prefix: str) -> str:
        return f"{prefix}_{uuid4().hex[:10]}"

    def _workspace_from_row(self, row: sqlite3.Row) -> Workspace:
        data = dict(row)
        data.setdefault("sort_order", 0)
        return Workspace(**data)

    def _message_from_row(self, row: sqlite3.Row) -> Message:
        data = dict(row)
        data.setdefault("image_data", None)
        data.setdefault("completion_tokens", None)
        data.setdefault("tokens_per_second", None)
        data.setdefault("elapsed_seconds", None)
        data.setdefault("finish_reason", None)
        data.setdefault("model_name", None)
        return Message(**data)

    def _memory_from_row(self, row: sqlite3.Row) -> MemoryChunk:
        return MemoryChunk(**dict(row))

    def _session_from_row(self, row: sqlite3.Row, conn: sqlite3.Connection) -> Session:
        messages = [
            self._message_from_row(message_row)
            for message_row in conn.execute(
                """
                SELECT id, role, content, image_data, created_at, completion_tokens, tokens_per_second, elapsed_seconds, finish_reason, model_name
                FROM messages
                WHERE session_id = ?
                ORDER BY created_at ASC
                """,
                (row["id"],),
            ).fetchall()
        ]
        data = dict(row)
        data["messages"] = messages
        return Session(**data)

    def workspace_count(self) -> int:
        with self._connect() as conn:
            row = conn.execute("SELECT COUNT(*) AS count FROM workspaces").fetchone()
        return 0 if row is None else int(row["count"])

    def session_count(self) -> int:
        with self._connect() as conn:
            row = conn.execute("SELECT COUNT(*) AS count FROM sessions").fetchone()
        return 0 if row is None else int(row["count"])

    def memory_chunk_count(self) -> int:
        with self._connect() as conn:
            row = conn.execute("SELECT COUNT(*) AS count FROM memory_chunks").fetchone()
        return 0 if row is None else int(row["count"])

    def has_workspace(self, workspace_id: str) -> bool:
        with self._connect() as conn:
            row = conn.execute("SELECT 1 FROM workspaces WHERE id = ?", (workspace_id,)).fetchone()
        return row is not None

    def list_workspaces(self) -> list[Workspace]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, name, description, sort_order, created_at, updated_at
                FROM workspaces
                ORDER BY sort_order ASC, created_at ASC
                """
            ).fetchall()
        return [self._workspace_from_row(row) for row in rows]

    def create_workspace(self, payload: WorkspaceCreate) -> Workspace:
        with self._connect() as conn:
            row = conn.execute("SELECT MAX(sort_order) AS max_order FROM workspaces").fetchone()
            next_order = (row["max_order"] + 1) if row and row["max_order"] is not None else 0
        workspace = Workspace(id=self._new_id("ws"), sort_order=next_order, **payload.model_dump())
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO workspaces (id, name, description, sort_order, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    workspace.id,
                    workspace.name,
                    workspace.description,
                    workspace.sort_order,
                    workspace.created_at,
                    workspace.updated_at,
                ),
            )
        return workspace

    def update_workspace(self, workspace_id: str, payload: WorkspaceUpdate) -> Workspace | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, name, description, sort_order, created_at, updated_at
                FROM workspaces
                WHERE id = ?
                """,
                (workspace_id,),
            ).fetchone()
            if row is None:
                return None
            data = dict(row)
            for key, value in payload.model_dump(exclude_none=True).items():
                data[key] = value
            data["updated_at"] = now_iso()
            conn.execute(
                """
                UPDATE workspaces
                SET name = ?, description = ?, updated_at = ?
                WHERE id = ?
                """,
                (data["name"], data["description"], data["updated_at"], workspace_id),
            )
        return Workspace(**data)

    def delete_workspace(self, workspace_id: str) -> bool:
        with self._connect() as conn:
            cursor = conn.execute("DELETE FROM workspaces WHERE id = ?", (workspace_id,))
        return cursor.rowcount > 0

    def reorder_workspaces(self, ids: list[str]) -> None:
        with self._connect() as conn:
            for order, ws_id in enumerate(ids):
                conn.execute("UPDATE workspaces SET sort_order = ? WHERE id = ?", (order, ws_id))

    def list_sessions(self, workspace_id: str) -> list[Session]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, workspace_id, title, model_name, created_at, updated_at, sort_order
                FROM sessions
                WHERE workspace_id = ?
                ORDER BY sort_order ASC, created_at ASC
                """,
                (workspace_id,),
            ).fetchall()
            return [self._session_from_row(row, conn) for row in rows]

    def get_session(self, session_id: str) -> Session | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, workspace_id, title, model_name, sort_order, created_at, updated_at
                FROM sessions
                WHERE id = ?
                """,
                (session_id,),
            ).fetchone()
            if row is None:
                return None
            return self._session_from_row(row, conn)

    def create_session(self, payload: SessionCreate) -> Session:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT MAX(sort_order) AS max_order FROM sessions WHERE workspace_id = ?",
                (payload.workspace_id,),
            ).fetchone()
            next_order = (row["max_order"] or 0) + 1
        session = Session(id=self._new_id("session"), sort_order=next_order, **payload.model_dump())
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO sessions (id, workspace_id, title, model_name, sort_order, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session.id,
                    session.workspace_id,
                    session.title,
                    session.model_name,
                    session.sort_order,
                    session.created_at,
                    session.updated_at,
                ),
            )
        return session

    def reorder_sessions(self, ids: list[str]) -> None:
        with self._connect() as conn:
            for order, session_id in enumerate(ids):
                conn.execute("UPDATE sessions SET sort_order = ? WHERE id = ?", (order, session_id))

    def update_session(self, session_id: str, payload: SessionUpdate) -> Session | None:
        current = self.get_session(session_id)
        if current is None:
            return None
        data = current.model_dump()
        for key, value in payload.model_dump(exclude_none=True).items():
            data[key] = value
        data["updated_at"] = now_iso()
        updated = Session(**data)
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE sessions
                SET title = ?, model_name = ?, updated_at = ?
                WHERE id = ?
                """,
                (updated.title, updated.model_name, updated.updated_at, session_id),
            )
        return updated

    def append_message(self, session_id: str, payload: MessageCreate) -> Message | None:
        if self.get_session(session_id) is None:
            return None
        message = Message(id=self._new_id("msg"), **payload.model_dump())
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO messages (id, session_id, role, content, image_data, created_at, completion_tokens, tokens_per_second, elapsed_seconds, finish_reason, model_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (message.id, session_id, message.role, message.content, message.image_data, message.created_at,
                 message.completion_tokens, message.tokens_per_second, message.elapsed_seconds, message.finish_reason,
                 message.model_name),
            )
            conn.execute(
                "UPDATE sessions SET updated_at = ? WHERE id = ?",
                (now_iso(), session_id),
            )
        return message

    def delete_message(self, message_id: str) -> bool:
        with self._connect() as conn:
            cursor = conn.execute("DELETE FROM messages WHERE id = ?", (message_id,))
        return cursor.rowcount > 0

    def update_message(self, message_id: str, content: str) -> Message | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id, role, content, image_data, created_at FROM messages WHERE id = ?",
                (message_id,),
            ).fetchone()
            if row is None:
                return None
            conn.execute("UPDATE messages SET content = ? WHERE id = ?", (content, message_id))
        data = dict(row)
        data["content"] = content
        data.setdefault("image_data", None)
        return Message(**data)

    def branch_session(self, session_id: str, up_to_message_id: str) -> Session | None:
        session = self.get_session(session_id)
        if session is None:
            return None
        messages_to_copy: list[Message] = []
        for msg in session.messages:
            messages_to_copy.append(msg)
            if msg.id == up_to_message_id:
                break
        new_session = self.create_session(
            SessionCreate(
                workspace_id=session.workspace_id,
                title=f"{session.title} (分岐)",
                model_name=session.model_name,
            )
        )
        for msg in messages_to_copy:
            self.append_message(
                new_session.id,
                MessageCreate(role=msg.role, content=msg.content, image_data=msg.image_data),
            )
        return self.get_session(new_session.id)

    def delete_session(self, session_id: str, delete_memory: bool) -> bool:
        with self._connect() as conn:
            if delete_memory:
                chunk_ids = [
                    row["id"]
                    for row in conn.execute(
                        "SELECT id FROM memory_chunks WHERE session_id = ?", (session_id,)
                    ).fetchall()
                ]
                if chunk_ids:
                    placeholders = ",".join("?" * len(chunk_ids))
                    conn.execute(f"DELETE FROM memory_fts WHERE id IN ({placeholders})", chunk_ids)
                    conn.execute(f"DELETE FROM memory_vec WHERE chunk_id IN ({placeholders})", chunk_ids)
                conn.execute("DELETE FROM memory_chunks WHERE session_id = ?", (session_id,))
            cursor = conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        return cursor.rowcount > 0

    def save_memory(self, session_id: str, messages: list[MessageCreate]) -> list[MemoryChunk] | None:
        import struct
        from .memory.embedder import embed

        session = self.get_session(session_id)
        if session is None:
            return None
        chunks: list[MemoryChunk] = []
        with self._connect() as conn:
            for payload in messages:
                chunk = MemoryChunk(
                    id=self._new_id("mem"),
                    workspace_id=session.workspace_id,
                    session_id=session.id,
                    content=payload.content,
                )
                conn.execute(
                    """
                    INSERT INTO memory_chunks (id, workspace_id, session_id, chunk_type, content, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        chunk.id,
                        chunk.workspace_id,
                        chunk.session_id,
                        chunk.chunk_type,
                        chunk.content,
                        chunk.created_at,
                    ),
                )
                conn.execute(
                    "INSERT INTO memory_fts (id, content) VALUES (?, ?)",
                    (chunk.id, chunk.content),
                )
                vector = embed(chunk.content)
                vec_bytes = struct.pack(f"{len(vector)}f", *vector)
                conn.execute(
                    "INSERT INTO memory_vec (chunk_id, embedding) VALUES (?, ?)",
                    (chunk.id, vec_bytes),
                )
                chunks.append(chunk)
        return chunks

    def search_memory(self, workspace_id: str, query: str, top_k: int) -> list[MemoryChunk]:
        from .memory.embedder import embed
        import math
        import logging

        logger = logging.getLogger(__name__)
        query_vec = embed(query)
        rrf_k = 60
        half_life_days = 30
        scores: dict[str, float] = {}

        with self._connect() as conn:
            # --- FTS5 キーワード検索 ---
            # 特殊文字をエスケープしてフレーズ検索クエリに変換
            safe_query = '"' + query.replace('"', ' ') + '"'
            try:
                fts_rows = conn.execute(
                    """
                    SELECT mc.id FROM memory_fts mf
                    JOIN memory_chunks mc ON mc.id = mf.id
                    WHERE mf.content MATCH ? AND mc.workspace_id = ?
                    LIMIT ?
                    """,
                    (safe_query, workspace_id, top_k * 4),
                ).fetchall()
                for rank, row in enumerate(fts_rows):
                    scores[row["id"]] = scores.get(row["id"], 0.0) + 1.0 / (rrf_k + rank + 1)
                logger.debug("FTS5 hits: %d", len(fts_rows))
            except Exception as e:
                logger.warning("FTS5 search failed: %s", e)

            # --- ベクトル検索 ---
            import struct
            vec_bytes = struct.pack(f"{len(query_vec)}f", *query_vec)
            # KNN クエリは memory_vec 単体で実行し、workspace フィルタは後処理で行う
            vec_rows = conn.execute(
                "SELECT chunk_id, distance FROM memory_vec WHERE embedding MATCH ? AND k = ?",
                (vec_bytes, top_k * 4),
            ).fetchall()
            # workspace_id で絞り込む
            if vec_rows:
                vec_chunk_ids = [row["chunk_id"] for row in vec_rows]
                placeholders_vec = ",".join("?" * len(vec_chunk_ids))
                ws_set = {
                    row["id"]
                    for row in conn.execute(
                        f"SELECT id FROM memory_chunks WHERE id IN ({placeholders_vec}) AND workspace_id = ?",
                        (*vec_chunk_ids, workspace_id),
                    ).fetchall()
                }
                for rank, row in enumerate(vec_rows):
                    if row["chunk_id"] in ws_set:
                        scores[row["chunk_id"]] = scores.get(row["chunk_id"], 0.0) + 1.0 / (rrf_k + rank + 1)

            if not scores:
                return []

            # --- 時間減衰 ---
            ids = list(scores.keys())
            placeholders = ",".join("?" * len(ids))
            chunk_rows = conn.execute(
                f"""
                SELECT id, workspace_id, session_id, chunk_type, content, created_at
                FROM memory_chunks
                WHERE id IN ({placeholders})
                """,
                ids,
            ).fetchall()

        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        chunks_by_id = {row["id"]: row for row in chunk_rows}

        def _decayed_score(chunk_id: str) -> float:
            row = chunks_by_id[chunk_id]
            try:
                created = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
                days_elapsed = (now - created).total_seconds() / 86400
                decay = math.pow(0.5, days_elapsed / half_life_days)
            except Exception:
                decay = 1.0
            return scores[chunk_id] * decay

        ranked = sorted(scores.keys(), key=_decayed_score, reverse=True)[:top_k]
        return [self._memory_from_row(chunks_by_id[cid]) for cid in ranked if cid in chunks_by_id]

    def delete_workspace_memory(self, workspace_id: str) -> int:
        with self._connect() as conn:
            chunk_ids = [
                row["id"]
                for row in conn.execute(
                    "SELECT id FROM memory_chunks WHERE workspace_id = ?", (workspace_id,)
                ).fetchall()
            ]
            if chunk_ids:
                placeholders = ",".join("?" * len(chunk_ids))
                conn.execute(f"DELETE FROM memory_fts WHERE id IN ({placeholders})", chunk_ids)
                conn.execute(f"DELETE FROM memory_vec WHERE chunk_id IN ({placeholders})", chunk_ids)
            cursor = conn.execute("DELETE FROM memory_chunks WHERE workspace_id = ?", (workspace_id,))
        return cursor.rowcount

    def delete_session_memory(self, session_id: str) -> int:
        with self._connect() as conn:
            chunk_ids = [
                row["id"]
                for row in conn.execute(
                    "SELECT id FROM memory_chunks WHERE session_id = ?", (session_id,)
                ).fetchall()
            ]
            if chunk_ids:
                placeholders = ",".join("?" * len(chunk_ids))
                conn.execute(f"DELETE FROM memory_fts WHERE id IN ({placeholders})", chunk_ids)
                conn.execute(f"DELETE FROM memory_vec WHERE chunk_id IN ({placeholders})", chunk_ids)
            cursor = conn.execute("DELETE FROM memory_chunks WHERE session_id = ?", (session_id,))
        return cursor.rowcount