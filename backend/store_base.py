from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

import sqlite_vec

from .models import (
    Document,
    DocumentChunk,
    MemoryChunk,
    Message,
    MessageCreate,
    MessagePromptLog,
    Session,
    SessionCreate,
    WorkspaceCreate,
    now_iso,
)
from .models import Workspace


class SQLiteStoreBase:
    def __init__(self, db_path: str | Path | None = None) -> None:
        from . import paths

        paths.library_root()  # ライブラリルートを確実に作成
        self.db_path = Path(db_path) if db_path is not None else paths.library_db_path()
        self.image_root = paths.library_images_dir()
        self.document_root = paths.library_documents_dir()
        self.document_root.mkdir(parents=True, exist_ok=True)
        self._init_db()
        self._seed_if_empty()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path)
        try:
            conn.enable_load_extension(True)
            sqlite_vec.load(conn)
            conn.enable_load_extension(False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")
            # sqlite3.Connection の with は commit/rollback のみで close しないため、ここで確実に閉じる
            with conn:
                yield conn
        finally:
            conn.close()

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
                    image_data TEXT,
                    image_preview_data TEXT,
                    image_summary TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS message_prompt_logs (
                    assistant_message_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (assistant_message_id) REFERENCES messages(id) ON DELETE CASCADE,
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
                    sort_order INTEGER NOT NULL DEFAULT 0,
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
            for col, typedef in [
                ("sort_order", "INTEGER NOT NULL DEFAULT 0"),
            ]:
                for table in ("workspaces", "sessions", "documents"):
                    try:
                        conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typedef}")
                        conn.commit()
                    except Exception:
                        pass
            for col, typedef in [
                ("image_data", "TEXT"),
                ("image_preview_data", "TEXT"),
                ("image_summary", "TEXT"),
                ("prompt_tokens", "INTEGER"),
                ("completion_tokens", "INTEGER"),
                ("tokens_per_second", "REAL"),
                ("elapsed_seconds", "REAL"),
                ("finish_reason", "TEXT"),
                ("model_name", "TEXT"),
                ("position", "REAL NOT NULL DEFAULT 0"),
            ]:
                try:
                    conn.execute(f"ALTER TABLE messages ADD COLUMN {col} {typedef}")
                    conn.commit()
                except Exception:
                    pass

            has_messages = conn.execute("SELECT 1 FROM messages LIMIT 1").fetchone()
            has_positions = conn.execute("SELECT 1 FROM messages WHERE position > 0 LIMIT 1").fetchone()
            if has_messages and not has_positions:
                conn.execute(
                    """
                    UPDATE messages
                    SET position = (
                        SELECT COUNT(*)
                        FROM messages m2
                        WHERE m2.session_id = messages.session_id
                          AND (m2.created_at < messages.created_at
                               OR (m2.created_at = messages.created_at AND m2.rowid <= messages.rowid))
                    )
                    """
                )
                conn.commit()

            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_messages_session_position ON messages(session_id, position)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_memory_chunks_workspace ON memory_chunks(workspace_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_memory_chunks_session ON memory_chunks(session_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_message_prompt_logs_session ON message_prompt_logs(session_id)"
            )
            conn.commit()

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
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_document_chunks_document ON document_chunks(document_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_document_chunks_workspace ON document_chunks(workspace_id)"
            )
            conn.commit()

    def _seed_if_empty(self) -> None:
        if self.workspace_count() > 0:  # type: ignore[attr-defined]
            return
        investing = self.create_workspace(  # type: ignore[attr-defined]
            WorkspaceCreate(name="Investing", description="Stocks, funds, and portfolio notes")
        )
        fiction = self.create_workspace(  # type: ignore[attr-defined]
            WorkspaceCreate(name="Fiction", description="Plot, characters, and revision notes")
        )
        investing_session = self.create_session(  # type: ignore[attr-defined]
            SessionCreate(workspace_id=investing.id, title="Weekly market view")
        )
        fiction_session = self.create_session(  # type: ignore[attr-defined]
            SessionCreate(workspace_id=fiction.id, title="Chapter one outline")
        )
        self.append_message(  # type: ignore[attr-defined]
            investing_session.id,
            MessageCreate(role="assistant", content="This workspace keeps only investing context."),
        )
        self.append_message(  # type: ignore[attr-defined]
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
        data.setdefault("image_preview_data", None)
        data.setdefault("image_summary", None)
        data["has_prompt_log"] = bool(data.get("has_prompt_log", False))
        for col in ("prompt_tokens", "completion_tokens", "tokens_per_second", "elapsed_seconds", "finish_reason", "model_name"):
            data.setdefault(col, None)
        data.setdefault("position", 0.0)
        return Message(**data)

    def _memory_from_row(self, row: sqlite3.Row) -> MemoryChunk:
        return MemoryChunk(**dict(row))

    def _document_from_row(self, row: sqlite3.Row) -> Document:
        data = dict(row)
        data.setdefault("session_id", None)
        data.setdefault("indexed_at", None)
        data.setdefault("sort_order", 0)
        return Document(**data)

    def _session_from_row(self, row: sqlite3.Row, conn: sqlite3.Connection) -> Session:
        messages = [
            self._message_from_row(message_row)
            for message_row in conn.execute(
                """
                SELECT
                    m.id,
                    m.role,
                    m.content,
                    m.image_data,
                    m.image_preview_data,
                    m.image_summary,
                    m.created_at,
                    m.position,
                    m.prompt_tokens,
                    m.completion_tokens,
                    m.tokens_per_second,
                    m.elapsed_seconds,
                    m.finish_reason,
                    m.model_name,
                    CASE WHEN pl.assistant_message_id IS NOT NULL THEN 1 ELSE 0 END AS has_prompt_log
                FROM messages m
                LEFT JOIN message_prompt_logs pl ON pl.assistant_message_id = m.id
                WHERE m.session_id = ?
                ORDER BY m.position ASC, m.created_at ASC, m.rowid ASC
                """,
                (row["id"],),
            ).fetchall()
        ]
        data = dict(row)
        data.setdefault("sort_order", 0)
        data.setdefault("model_name", "")
        return Session(**data, messages=messages)

    def _collect_image_paths_for_message_ids(
        self, conn: sqlite3.Connection, message_ids: list[str]
    ) -> set[str]:
        if not message_ids:
            return set()
        placeholders = ",".join("?" * len(message_ids))
        rows = conn.execute(
            f"""
            SELECT DISTINCT image_path FROM (
                SELECT image_data AS image_path FROM messages
                WHERE id IN ({placeholders}) AND image_data IS NOT NULL
                UNION
                SELECT image_preview_data AS image_path FROM messages
                WHERE id IN ({placeholders}) AND image_preview_data IS NOT NULL
            )
            """,
            [*message_ids, *message_ids],
        ).fetchall()
        return {str(row["image_path"]) for row in rows if row["image_path"]}

    def _collect_image_paths_for_session_ids(
        self, conn: sqlite3.Connection, session_ids: list[str]
    ) -> set[str]:
        if not session_ids:
            return set()
        placeholders = ",".join("?" * len(session_ids))
        rows = conn.execute(
            f"""
            SELECT DISTINCT image_path FROM (
                SELECT image_data AS image_path FROM messages
                WHERE session_id IN ({placeholders}) AND image_data IS NOT NULL
                UNION
                SELECT image_preview_data AS image_path FROM messages
                WHERE session_id IN ({placeholders}) AND image_preview_data IS NOT NULL
            )
            """,
            [*session_ids, *session_ids],
        ).fetchall()
        return {str(row["image_path"]) for row in rows if row["image_path"]}

    def _cleanup_unreferenced_images(self, conn: sqlite3.Connection, image_paths: set[str]) -> None:
        for image_path in image_paths:
            if not image_path.startswith("/assets/images/"):
                continue
            if conn.execute(
                "SELECT 1 FROM messages WHERE image_data = ? OR image_preview_data = ? LIMIT 1",
                (image_path, image_path),
            ).fetchone() is not None:
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
