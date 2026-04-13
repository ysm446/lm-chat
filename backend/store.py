from __future__ import annotations

import sqlite3
from pathlib import Path
from uuid import uuid4

import sqlite_vec

from .models import (
    Document,
    DocumentChunk,
    DocumentCreate,
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
        self.image_root = base_dir / "assets" / "images"
        self.document_root = base_dir / "assets" / "documents"
        self.document_root.mkdir(parents=True, exist_ok=True)
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

                CREATE TABLE IF NOT EXISTS documents (
                    id TEXT PRIMARY KEY,
                    workspace_id TEXT NOT NULL,
                    session_id TEXT,
                    scope TEXT NOT NULL DEFAULT 'workspace',
                    file_name TEXT NOT NULL,
                    mime_type TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    file_size INTEGER NOT NULL DEFAULT 0,
                    file_hash TEXT NOT NULL DEFAULT '',
                    embed_model TEXT NOT NULL DEFAULT 'ruri-v3-310m',
                    created_at TEXT NOT NULL,
                    indexed_at TEXT,
                    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS document_chunks (
                    id TEXT PRIMARY KEY,
                    document_id TEXT NOT NULL,
                    workspace_id TEXT NOT NULL,
                    session_id TEXT,
                    chunk_index INTEGER NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
                );

                CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
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
            if "document_vec" not in tables:
                conn.execute(
                    "CREATE VIRTUAL TABLE document_vec USING vec0(chunk_id TEXT PRIMARY KEY, embedding FLOAT[768])"
                )
                conn.commit()
            # document_chunks インデックス
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_document_chunks_document ON document_chunks(document_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_document_chunks_workspace ON document_chunks(workspace_id)"
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

    def _collect_image_paths_for_message_ids(
        self, conn: sqlite3.Connection, message_ids: list[str]
    ) -> set[str]:
        if not message_ids:
            return set()
        placeholders = ",".join("?" * len(message_ids))
        rows = conn.execute(
            f"SELECT DISTINCT image_data FROM messages WHERE id IN ({placeholders}) AND image_data IS NOT NULL",
            message_ids,
        ).fetchall()
        return {str(row["image_data"]) for row in rows if row["image_data"]}

    def _collect_image_paths_for_session_ids(
        self, conn: sqlite3.Connection, session_ids: list[str]
    ) -> set[str]:
        if not session_ids:
            return set()
        placeholders = ",".join("?" * len(session_ids))
        rows = conn.execute(
            f"SELECT DISTINCT image_data FROM messages WHERE session_id IN ({placeholders}) AND image_data IS NOT NULL",
            session_ids,
        ).fetchall()
        return {str(row["image_data"]) for row in rows if row["image_data"]}

    def _cleanup_unreferenced_images(self, conn: sqlite3.Connection, image_paths: set[str]) -> None:
        for image_path in image_paths:
            if not image_path.startswith("/assets/images/"):
                continue
            row = conn.execute(
                "SELECT 1 FROM messages WHERE image_data = ? LIMIT 1",
                (image_path,),
            ).fetchone()
            if row is not None:
                continue

            relative_path = image_path.removeprefix("/assets/images/").replace("/", "\\")
            file_path = self.image_root / relative_path
            try:
                if file_path.exists():
                    file_path.unlink()
            except OSError:
                continue

            for parent in file_path.parents:
                if parent == self.image_root or self.image_root not in parent.parents:
                    break
                try:
                    parent.rmdir()
                except OSError:
                    break

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
            session_rows = conn.execute(
                "SELECT id FROM sessions WHERE workspace_id = ?",
                (workspace_id,),
            ).fetchall()
            session_ids = [str(row["id"]) for row in session_rows]
            image_paths = self._collect_image_paths_for_session_ids(conn, session_ids)
            cursor = conn.execute("DELETE FROM workspaces WHERE id = ?", (workspace_id,))
            self._cleanup_unreferenced_images(conn, image_paths)
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
                "SELECT MIN(sort_order) AS min_order FROM sessions WHERE workspace_id = ?",
                (payload.workspace_id,),
            ).fetchone()
            next_order = (row["min_order"] or 0) - 1
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
            image_paths = self._collect_image_paths_for_message_ids(conn, [message_id])
            cursor = conn.execute("DELETE FROM messages WHERE id = ?", (message_id,))
            self._cleanup_unreferenced_images(conn, image_paths)
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

    def move_session(self, session_id: str, target_workspace_id: str) -> Session | None:
        with self._connect() as conn:
            cursor = conn.execute(
                "UPDATE sessions SET workspace_id = ?, updated_at = ? WHERE id = ?",
                (target_workspace_id, now_iso(), session_id),
            )
            if cursor.rowcount == 0:
                return None
            conn.execute(
                "UPDATE memory_chunks SET workspace_id = ? WHERE session_id = ?",
                (target_workspace_id, session_id),
            )
        return self.get_session(session_id)

    def delete_session(self, session_id: str, delete_memory: bool) -> bool:
        with self._connect() as conn:
            image_paths = self._collect_image_paths_for_session_ids(conn, [session_id])
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
            self._cleanup_unreferenced_images(conn, image_paths)
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

    def cleanup_memory(self) -> dict[str, int]:
        with self._connect() as conn:
            orphan_chunk_ids = [
                row["id"]
                for row in conn.execute(
                    """
                    SELECT mc.id
                    FROM memory_chunks mc
                    LEFT JOIN sessions s ON s.id = mc.session_id
                    LEFT JOIN workspaces w ON w.id = mc.workspace_id
                    WHERE s.id IS NULL
                       OR w.id IS NULL
                       OR s.workspace_id != mc.workspace_id
                    """
                ).fetchall()
            ]

            deleted_chunks = 0
            if orphan_chunk_ids:
                placeholders = ",".join("?" * len(orphan_chunk_ids))
                conn.execute(f"DELETE FROM memory_fts WHERE id IN ({placeholders})", orphan_chunk_ids)
                conn.execute(f"DELETE FROM memory_vec WHERE chunk_id IN ({placeholders})", orphan_chunk_ids)
                deleted_chunks = conn.execute(
                    f"DELETE FROM memory_chunks WHERE id IN ({placeholders})", orphan_chunk_ids
                ).rowcount

            orphan_fts_ids = [
                row["id"]
                for row in conn.execute(
                    """
                    SELECT mf.id
                    FROM memory_fts mf
                    LEFT JOIN memory_chunks mc ON mc.id = mf.id
                    WHERE mc.id IS NULL
                    """
                ).fetchall()
            ]
            deleted_fts = 0
            if orphan_fts_ids:
                placeholders = ",".join("?" * len(orphan_fts_ids))
                deleted_fts = conn.execute(
                    f"DELETE FROM memory_fts WHERE id IN ({placeholders})", orphan_fts_ids
                ).rowcount

            orphan_vec_ids = [
                row["chunk_id"]
                for row in conn.execute(
                    """
                    SELECT mv.chunk_id
                    FROM memory_vec mv
                    LEFT JOIN memory_chunks mc ON mc.id = mv.chunk_id
                    WHERE mc.id IS NULL
                    """
                ).fetchall()
            ]
            deleted_vec = 0
            if orphan_vec_ids:
                placeholders = ",".join("?" * len(orphan_vec_ids))
                deleted_vec = conn.execute(
                    f"DELETE FROM memory_vec WHERE chunk_id IN ({placeholders})", orphan_vec_ids
                ).rowcount

        return {
            "deleted_chunks": deleted_chunks,
            "deleted_fts": deleted_fts,
            "deleted_vec": deleted_vec,
        }

    # ──────────────────────────────────────────────
    # Document CRUD
    # ──────────────────────────────────────────────

    def _document_from_row(self, row: sqlite3.Row) -> Document:
        data = dict(row)
        data.setdefault("session_id", None)
        data.setdefault("indexed_at", None)
        return Document(**data)

    def create_document(self, payload: DocumentCreate) -> Document:
        doc = Document(id=self._new_id("doc"), **payload.model_dump())
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO documents
                    (id, workspace_id, session_id, scope, file_name, mime_type, file_path,
                     file_size, file_hash, embed_model, created_at, indexed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    doc.id, doc.workspace_id, doc.session_id, doc.scope, doc.file_name,
                    doc.mime_type, doc.file_path, doc.file_size, doc.file_hash,
                    doc.embed_model, doc.created_at, doc.indexed_at,
                ),
            )
        return doc

    def get_document(self, doc_id: str) -> Document | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM documents WHERE id = ?", (doc_id,)
            ).fetchone()
        if row is None:
            return None
        return self._document_from_row(row)

    def set_document_indexed_at(self, doc_id: str, indexed_at: str | None) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE documents SET indexed_at = ? WHERE id = ?",
                (indexed_at, doc_id),
            )

    def list_documents(self, workspace_id: str) -> list[Document]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM documents
                WHERE workspace_id = ? AND scope = 'workspace'
                ORDER BY created_at DESC
                """,
                (workspace_id,),
            ).fetchall()
        return [self._document_from_row(r) for r in rows]

    def delete_document(self, doc_id: str) -> bool:
        doc = self.get_document(doc_id)
        if doc is None:
            return False
        with self._connect() as conn:
            chunk_ids = [
                row["id"]
                for row in conn.execute(
                    "SELECT id FROM document_chunks WHERE document_id = ?", (doc_id,)
                ).fetchall()
            ]
            if chunk_ids:
                placeholders = ",".join("?" * len(chunk_ids))
                conn.execute(f"DELETE FROM document_fts WHERE id IN ({placeholders})", chunk_ids)
                conn.execute(f"DELETE FROM document_vec WHERE chunk_id IN ({placeholders})", chunk_ids)
                conn.execute(f"DELETE FROM document_chunks WHERE id IN ({placeholders})", chunk_ids)
            conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        # 実ファイル削除
        try:
            file_path = self.document_root / doc.file_path
            if file_path.exists():
                file_path.unlink()
            # 親ディレクトリが空なら削除
            for parent in file_path.parents:
                if parent == self.document_root or self.document_root not in parent.parents:
                    break
                try:
                    parent.rmdir()
                except OSError:
                    break
        except OSError:
            pass
        return True

    def index_document_chunks(self, doc_id: str, chunks: list[str]) -> None:
        import struct
        from .memory.embedder import embed

        doc = self.get_document(doc_id)
        if doc is None:
            return

        with self._connect() as conn:
            # 既存チャンクを削除して再インデックス
            old_ids = [
                row["id"]
                for row in conn.execute(
                    "SELECT id FROM document_chunks WHERE document_id = ?", (doc_id,)
                ).fetchall()
            ]
            if old_ids:
                placeholders = ",".join("?" * len(old_ids))
                conn.execute(f"DELETE FROM document_fts WHERE id IN ({placeholders})", old_ids)
                conn.execute(f"DELETE FROM document_vec WHERE chunk_id IN ({placeholders})", old_ids)
                conn.execute(f"DELETE FROM document_chunks WHERE id IN ({placeholders})", old_ids)

            for i, text in enumerate(chunks):
                chunk_id = self._new_id("dc")
                conn.execute(
                    """
                    INSERT INTO document_chunks (id, document_id, workspace_id, session_id, chunk_index, content, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (chunk_id, doc_id, doc.workspace_id, doc.session_id, i, text, now_iso()),
                )
                conn.execute(
                    "INSERT INTO document_fts (id, content) VALUES (?, ?)",
                    (chunk_id, text),
                )
                vector = embed(text)
                vec_bytes = struct.pack(f"{len(vector)}f", *vector)
                conn.execute(
                    "INSERT INTO document_vec (chunk_id, embedding) VALUES (?, ?)",
                    (chunk_id, vec_bytes),
                )

            conn.execute(
                "UPDATE documents SET indexed_at = ? WHERE id = ?",
                (now_iso(), doc_id),
            )

    def search_documents(
        self, workspace_id: str, query: str, top_k: int = 3, session_id: str | None = None
    ) -> list[DocumentChunk]:
        from .memory.embedder import embed
        import struct

        query_vec = embed(query)
        rrf_k = 60
        scores: dict[str, float] = {}

        with self._connect() as conn:
            safe_query = '"' + query.replace('"', ' ') + '"'
            try:
                fts_rows = conn.execute(
                    """
                    SELECT dc.id FROM document_fts df
                    JOIN document_chunks dc ON dc.id = df.id
                    WHERE df.content MATCH ? AND dc.workspace_id = ?
                    LIMIT ?
                    """,
                    (safe_query, workspace_id, top_k * 4),
                ).fetchall()
                for rank, row in enumerate(fts_rows):
                    scores[row["id"]] = scores.get(row["id"], 0.0) + 1.0 / (rrf_k + rank + 1)
            except Exception:
                pass

            vec_bytes = struct.pack(f"{len(query_vec)}f", *query_vec)
            vec_rows = conn.execute(
                "SELECT chunk_id, distance FROM document_vec WHERE embedding MATCH ? AND k = ?",
                (vec_bytes, top_k * 4),
            ).fetchall()
            if vec_rows:
                vec_chunk_ids = [row["chunk_id"] for row in vec_rows]
                placeholders_vec = ",".join("?" * len(vec_chunk_ids))
                ws_set = {
                    row["id"]
                    for row in conn.execute(
                        f"SELECT id FROM document_chunks WHERE id IN ({placeholders_vec}) AND workspace_id = ?",
                        (*vec_chunk_ids, workspace_id),
                    ).fetchall()
                }
                for rank, row in enumerate(vec_rows):
                    if row["chunk_id"] in ws_set:
                        scores[row["chunk_id"]] = scores.get(row["chunk_id"], 0.0) + 1.0 / (rrf_k + rank + 1)

            if not scores:
                return []

            ids = list(scores.keys())
            placeholders = ",".join("?" * len(ids))
            chunk_rows = conn.execute(
                f"SELECT * FROM document_chunks WHERE id IN ({placeholders})",
                ids,
            ).fetchall()

        ranked = sorted(scores.keys(), key=lambda cid: scores[cid], reverse=True)[:top_k]
        chunks_by_id = {row["id"]: row for row in chunk_rows}
        result = []
        for cid in ranked:
            if cid in chunks_by_id:
                row = chunks_by_id[cid]
                data = dict(row)
                data.setdefault("session_id", None)
                result.append(DocumentChunk(**data))
        return result

    def update_document_file_size(self, doc_id: str, file_size: int) -> None:
        with self._connect() as conn:
            conn.execute("UPDATE documents SET file_size = ? WHERE id = ?", (file_size, doc_id))

    def rename_document(self, doc_id: str, new_name: str) -> Document | None:
        doc = self.get_document(doc_id)
        if doc is None:
            return None
        old_path = self.document_root / doc.file_path
        new_path = old_path.parent / new_name
        # 名前衝突を避けるためサフィックスを付ける
        stem = Path(new_name).stem
        suffix = Path(new_name).suffix
        counter = 1
        while new_path.exists() and new_path != old_path:
            new_path = old_path.parent / f"{stem}_{counter}{suffix}"
            counter += 1
        try:
            if old_path.exists():
                old_path.rename(new_path)
        except OSError:
            return None
        new_relative = f"{doc.workspace_id}/{new_path.name}"
        with self._connect() as conn:
            conn.execute(
                "UPDATE documents SET file_name = ?, file_path = ? WHERE id = ?",
                (new_path.name, new_relative, doc_id),
            )
        return self.get_document(doc_id)
