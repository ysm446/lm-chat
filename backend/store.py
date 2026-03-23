from __future__ import annotations

import sqlite3
from pathlib import Path
from uuid import uuid4

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
                """
            )

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
        return Workspace(**dict(row))

    def _message_from_row(self, row: sqlite3.Row) -> Message:
        return Message(**dict(row))

    def _memory_from_row(self, row: sqlite3.Row) -> MemoryChunk:
        return MemoryChunk(**dict(row))

    def _session_from_row(self, row: sqlite3.Row, conn: sqlite3.Connection) -> Session:
        messages = [
            self._message_from_row(message_row)
            for message_row in conn.execute(
                """
                SELECT id, role, content, created_at
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
                SELECT id, name, description, created_at, updated_at
                FROM workspaces
                ORDER BY created_at ASC
                """
            ).fetchall()
        return [self._workspace_from_row(row) for row in rows]

    def create_workspace(self, payload: WorkspaceCreate) -> Workspace:
        workspace = Workspace(id=self._new_id("ws"), **payload.model_dump())
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO workspaces (id, name, description, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    workspace.id,
                    workspace.name,
                    workspace.description,
                    workspace.created_at,
                    workspace.updated_at,
                ),
            )
        return workspace

    def update_workspace(self, workspace_id: str, payload: WorkspaceUpdate) -> Workspace | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, name, description, created_at, updated_at
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

    def list_sessions(self, workspace_id: str) -> list[Session]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, workspace_id, title, model_name, created_at, updated_at
                FROM sessions
                WHERE workspace_id = ?
                ORDER BY updated_at DESC
                """,
                (workspace_id,),
            ).fetchall()
            return [self._session_from_row(row, conn) for row in rows]

    def get_session(self, session_id: str) -> Session | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, workspace_id, title, model_name, created_at, updated_at
                FROM sessions
                WHERE id = ?
                """,
                (session_id,),
            ).fetchone()
            if row is None:
                return None
            return self._session_from_row(row, conn)

    def create_session(self, payload: SessionCreate) -> Session:
        session = Session(id=self._new_id("session"), **payload.model_dump())
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO sessions (id, workspace_id, title, model_name, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    session.id,
                    session.workspace_id,
                    session.title,
                    session.model_name,
                    session.created_at,
                    session.updated_at,
                ),
            )
        return session

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
                SET title = ?, updated_at = ?
                WHERE id = ?
                """,
                (updated.title, updated.updated_at, session_id),
            )
        return updated

    def append_message(self, session_id: str, payload: MessageCreate) -> Message | None:
        if self.get_session(session_id) is None:
            return None
        message = Message(id=self._new_id("msg"), **payload.model_dump())
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO messages (id, session_id, role, content, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (message.id, session_id, message.role, message.content, message.created_at),
            )
            conn.execute(
                "UPDATE sessions SET updated_at = ? WHERE id = ?",
                (now_iso(), session_id),
            )
        return message

    def delete_session(self, session_id: str, delete_memory: bool) -> bool:
        with self._connect() as conn:
            if delete_memory:
                conn.execute("DELETE FROM memory_chunks WHERE session_id = ?", (session_id,))
            cursor = conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        return cursor.rowcount > 0

    def save_memory(self, session_id: str, messages: list[MessageCreate]) -> list[MemoryChunk] | None:
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
                chunks.append(chunk)
        return chunks

    def search_memory(self, workspace_id: str, query: str, top_k: int) -> list[MemoryChunk]:
        like_query = f"%{query.lower()}%"
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, workspace_id, session_id, chunk_type, content, created_at
                FROM memory_chunks
                WHERE workspace_id = ? AND LOWER(content) LIKE ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (workspace_id, like_query, top_k),
            ).fetchall()
        return [self._memory_from_row(row) for row in rows]

    def delete_workspace_memory(self, workspace_id: str) -> int:
        with self._connect() as conn:
            cursor = conn.execute("DELETE FROM memory_chunks WHERE workspace_id = ?", (workspace_id,))
        return cursor.rowcount

    def delete_session_memory(self, session_id: str) -> int:
        with self._connect() as conn:
            cursor = conn.execute("DELETE FROM memory_chunks WHERE session_id = ?", (session_id,))
        return cursor.rowcount