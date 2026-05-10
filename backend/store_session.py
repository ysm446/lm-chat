from __future__ import annotations

import json

from .models import (
    Message,
    MessageCreate,
    MessagePromptLog,
    Session,
    SessionCreate,
    SessionUpdate,
    now_iso,
)


class SessionMixin:
    def session_count(self) -> int:
        with self._connect() as conn:  # type: ignore[attr-defined]
            row = conn.execute("SELECT COUNT(*) AS count FROM sessions").fetchone()
        return 0 if row is None else int(row["count"])

    def list_sessions(self, workspace_id: str) -> list[Session]:
        with self._connect() as conn:  # type: ignore[attr-defined]
            rows = conn.execute(
                "SELECT id, workspace_id, title, model_name, created_at, updated_at, sort_order FROM sessions WHERE workspace_id = ? ORDER BY sort_order ASC, created_at ASC",
                (workspace_id,),
            ).fetchall()
            return [self._session_from_row(row, conn) for row in rows]  # type: ignore[attr-defined]

    def get_session(self, session_id: str) -> Session | None:
        with self._connect() as conn:  # type: ignore[attr-defined]
            row = conn.execute(
                "SELECT id, workspace_id, title, model_name, sort_order, created_at, updated_at FROM sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
            if row is None:
                return None
            return self._session_from_row(row, conn)  # type: ignore[attr-defined]

    def create_session(self, payload: SessionCreate) -> Session:
        with self._connect() as conn:  # type: ignore[attr-defined]
            row = conn.execute(
                "SELECT MIN(sort_order) AS min_order FROM sessions WHERE workspace_id = ?",
                (payload.workspace_id,),
            ).fetchone()
            next_order = (row["min_order"] or 0) - 1
        session = Session(id=self._new_id("session"), sort_order=next_order, **payload.model_dump())  # type: ignore[attr-defined]
        with self._connect() as conn:  # type: ignore[attr-defined]
            conn.execute(
                "INSERT INTO sessions (id, workspace_id, title, model_name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (session.id, session.workspace_id, session.title, session.model_name, session.sort_order, session.created_at, session.updated_at),
            )
        return session

    def reorder_sessions(self, ids: list[str]) -> None:
        with self._connect() as conn:  # type: ignore[attr-defined]
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
        with self._connect() as conn:  # type: ignore[attr-defined]
            conn.execute(
                "UPDATE sessions SET title = ?, model_name = ?, updated_at = ? WHERE id = ?",
                (updated.title, updated.model_name, updated.updated_at, session_id),
            )
        return updated

    def append_message(
        self, session_id: str, payload: MessageCreate, position: float | None = None
    ) -> Message | None:
        if self.get_session(session_id) is None:
            return None
        with self._connect() as conn:  # type: ignore[attr-defined]
            if position is None:
                row = conn.execute(
                    "SELECT MAX(position) AS max_pos FROM messages WHERE session_id = ?",
                    (session_id,),
                ).fetchone()
                max_pos = row["max_pos"] if row and row["max_pos"] is not None else 0.0
                position = float(max_pos) + 1.0
            message = Message(id=self._new_id("msg"), position=float(position), **payload.model_dump())  # type: ignore[attr-defined]
            conn.execute(
                """
                INSERT INTO messages
                    (id, session_id, role, content, image_data, image_preview_data, created_at, position,
                     prompt_tokens, completion_tokens, tokens_per_second, elapsed_seconds, finish_reason, model_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    message.id, session_id, message.role, message.content,
                    message.image_data, message.image_preview_data, message.created_at, message.position,
                    message.prompt_tokens, message.completion_tokens, message.tokens_per_second,
                    message.elapsed_seconds, message.finish_reason, message.model_name,
                ),
            )
            conn.execute("UPDATE sessions SET updated_at = ? WHERE id = ?", (now_iso(), session_id))
        return message

    def compute_insert_positions(
        self, session_id: str, after_message_id: str | None
    ) -> tuple[float, float] | None:
        with self._connect() as conn:  # type: ignore[attr-defined]
            rows = conn.execute(
                "SELECT id, position FROM messages WHERE session_id = ? ORDER BY position ASC, created_at ASC, rowid ASC",
                (session_id,),
            ).fetchall()
        if not rows:
            return (1.0, 2.0)
        if not after_message_id:
            first_pos = float(rows[0]["position"])
            return (first_pos - 1.0, first_pos - 0.5)
        for i, row in enumerate(rows):
            if row["id"] == after_message_id:
                a = float(row["position"])
                b = float(rows[i + 1]["position"]) if i + 1 < len(rows) else a + 2.0
                gap = b - a
                return (a + gap / 3.0, a + 2.0 * gap / 3.0)
        return None

    def normalize_session_positions(self, session_id: str) -> None:
        with self._connect() as conn:  # type: ignore[attr-defined]
            conn.execute(
                """
                WITH ordered AS (
                    SELECT rowid, ROW_NUMBER() OVER (ORDER BY position ASC, created_at ASC, rowid ASC) AS new_position
                    FROM messages WHERE session_id = ?
                )
                UPDATE messages
                SET position = (SELECT new_position FROM ordered WHERE ordered.rowid = messages.rowid)
                WHERE session_id = ? AND rowid IN (SELECT rowid FROM ordered)
                """,
                (session_id, session_id),
            )

    def save_message_prompt_log(
        self, assistant_message_id: str, session_id: str, messages: list[dict]
    ) -> MessagePromptLog | None:
        payload_json = json.dumps(messages, ensure_ascii=False)
        created_at = now_iso()
        updated_at = created_at
        with self._connect() as conn:  # type: ignore[attr-defined]
            row = conn.execute(
                "SELECT id, role FROM messages WHERE id = ? AND session_id = ?",
                (assistant_message_id, session_id),
            ).fetchone()
            if row is None or str(row["role"]) != "assistant":
                return None
            existing = conn.execute(
                "SELECT created_at FROM message_prompt_logs WHERE assistant_message_id = ?",
                (assistant_message_id,),
            ).fetchone()
            if existing is not None:
                created_at = str(existing["created_at"])
            conn.execute(
                """
                INSERT INTO message_prompt_logs (assistant_message_id, session_id, payload_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(assistant_message_id) DO UPDATE SET
                    session_id = excluded.session_id, payload_json = excluded.payload_json, updated_at = excluded.updated_at
                """,
                (assistant_message_id, session_id, payload_json, created_at, updated_at),
            )
        return MessagePromptLog(
            assistant_message_id=assistant_message_id,
            session_id=session_id,
            payload_json=payload_json,
            created_at=created_at,
            updated_at=updated_at,
        )

    def get_message_prompt_log(self, assistant_message_id: str) -> MessagePromptLog | None:
        with self._connect() as conn:  # type: ignore[attr-defined]
            row = conn.execute(
                "SELECT assistant_message_id, session_id, payload_json, created_at, updated_at FROM message_prompt_logs WHERE assistant_message_id = ?",
                (assistant_message_id,),
            ).fetchone()
        return MessagePromptLog(**dict(row)) if row is not None else None

    def copy_message_prompt_log(self, source_message_id: str, target_message_id: str, session_id: str) -> bool:
        with self._connect() as conn:  # type: ignore[attr-defined]
            source = conn.execute(
                "SELECT payload_json FROM message_prompt_logs WHERE assistant_message_id = ?",
                (source_message_id,),
            ).fetchone()
            target = conn.execute(
                "SELECT id, role FROM messages WHERE id = ? AND session_id = ?",
                (target_message_id, session_id),
            ).fetchone()
            if source is None or target is None or str(target["role"]) != "assistant":
                return False
            created_at = now_iso()
            conn.execute(
                """
                INSERT INTO message_prompt_logs (assistant_message_id, session_id, payload_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(assistant_message_id) DO UPDATE SET
                    session_id = excluded.session_id, payload_json = excluded.payload_json, updated_at = excluded.updated_at
                """,
                (target_message_id, session_id, str(source["payload_json"]), created_at, created_at),
            )
        return True

    def clear_all_message_prompt_logs(self) -> int:
        with self._connect() as conn:  # type: ignore[attr-defined]
            cursor = conn.execute("DELETE FROM message_prompt_logs")
        return cursor.rowcount if cursor.rowcount is not None and cursor.rowcount >= 0 else 0

    def delete_message(self, message_id: str) -> bool:
        with self._connect() as conn:  # type: ignore[attr-defined]
            image_paths = self._collect_image_paths_for_message_ids(conn, [message_id])  # type: ignore[attr-defined]
            cursor = conn.execute("DELETE FROM messages WHERE id = ?", (message_id,))
            self._cleanup_unreferenced_images(conn, image_paths)  # type: ignore[attr-defined]
        return cursor.rowcount > 0

    def get_message_session_id(self, message_id: str) -> str | None:
        with self._connect() as conn:  # type: ignore[attr-defined]
            row = conn.execute("SELECT session_id FROM messages WHERE id = ?", (message_id,)).fetchone()
        return str(row["session_id"]) if row else None

    def update_message(
        self,
        message_id: str,
        content: str,
        image_data: str | None = None,
        image_preview_data: str | None = None,
    ) -> Message | None:
        with self._connect() as conn:  # type: ignore[attr-defined]
            image_paths = self._collect_image_paths_for_message_ids(conn, [message_id])  # type: ignore[attr-defined]
            row = conn.execute(
                "SELECT id, session_id, role, content, image_data, image_preview_data, created_at, prompt_tokens, completion_tokens, tokens_per_second, elapsed_seconds, finish_reason, model_name FROM messages WHERE id = ?",
                (message_id,),
            ).fetchone()
            if row is None:
                return None
            conn.execute(
                "UPDATE messages SET content = ?, image_data = ?, image_preview_data = ? WHERE id = ?",
                (content, image_data, image_preview_data, message_id),
            )
            self._cleanup_unreferenced_images(conn, image_paths)  # type: ignore[attr-defined]
        data = dict(row)
        del data["session_id"]
        data["content"] = content
        data["image_data"] = image_data
        data["image_preview_data"] = image_preview_data
        return Message(**data)

    def replace_message(self, message_id: str, payload: MessageCreate) -> Message | None:
        with self._connect() as conn:  # type: ignore[attr-defined]
            row = conn.execute(
                "SELECT id, session_id, role, content, image_data, image_preview_data, created_at, prompt_tokens, completion_tokens, tokens_per_second, elapsed_seconds, finish_reason, model_name FROM messages WHERE id = ?",
                (message_id,),
            ).fetchone()
            if row is None:
                return None
            conn.execute(
                "UPDATE messages SET content = ?, prompt_tokens = ?, completion_tokens = ?, tokens_per_second = ?, elapsed_seconds = ?, finish_reason = ?, model_name = ? WHERE id = ?",
                (payload.content, payload.prompt_tokens, payload.completion_tokens, payload.tokens_per_second, payload.elapsed_seconds, payload.finish_reason, payload.model_name, message_id),
            )
            conn.execute("UPDATE sessions SET updated_at = ? WHERE id = ?", (now_iso(), row["session_id"]))
        data = dict(row)
        data.pop("session_id", None)
        data.update({
            "content": payload.content,
            "prompt_tokens": payload.prompt_tokens,
            "completion_tokens": payload.completion_tokens,
            "tokens_per_second": payload.tokens_per_second,
            "elapsed_seconds": payload.elapsed_seconds,
            "finish_reason": payload.finish_reason,
            "model_name": payload.model_name,
        })
        data.setdefault("image_data", None)
        data.setdefault("image_preview_data", None)
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
            SessionCreate(workspace_id=session.workspace_id, title=f"{session.title} (分岐)", model_name=session.model_name)
        )
        for msg in messages_to_copy:
            copied = self.append_message(
                new_session.id,
                MessageCreate(role=msg.role, content=msg.content, image_data=msg.image_data, image_preview_data=msg.image_preview_data),
            )
            if copied is not None and msg.role == "assistant":
                self.copy_message_prompt_log(msg.id, copied.id, new_session.id)
        return self.get_session(new_session.id)

    def duplicate_session(self, session_id: str) -> Session | None:
        session = self.get_session(session_id)
        if session is None:
            return None
        new_session = self.create_session(
            SessionCreate(workspace_id=session.workspace_id, title=f"{session.title} (コピー)", model_name=session.model_name)
        )
        for msg in session.messages:
            copied = self.append_message(
                new_session.id,
                MessageCreate(
                    role=msg.role, content=msg.content, image_data=msg.image_data, image_preview_data=msg.image_preview_data,
                    prompt_tokens=msg.prompt_tokens, completion_tokens=msg.completion_tokens,
                    tokens_per_second=msg.tokens_per_second, elapsed_seconds=msg.elapsed_seconds,
                    finish_reason=msg.finish_reason, model_name=msg.model_name,
                ),
            )
            if copied is not None and msg.role == "assistant":
                self.copy_message_prompt_log(msg.id, copied.id, new_session.id)
        return self.get_session(new_session.id)

    def move_session(self, session_id: str, target_workspace_id: str) -> Session | None:
        with self._connect() as conn:  # type: ignore[attr-defined]
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
        with self._connect() as conn:  # type: ignore[attr-defined]
            image_paths = self._collect_image_paths_for_session_ids(conn, [session_id])  # type: ignore[attr-defined]
            if delete_memory:
                chunk_ids = [row["id"] for row in conn.execute("SELECT id FROM memory_chunks WHERE session_id = ?", (session_id,)).fetchall()]
                if chunk_ids:
                    placeholders = ",".join("?" * len(chunk_ids))
                    conn.execute(f"DELETE FROM memory_fts WHERE id IN ({placeholders})", chunk_ids)
                    conn.execute(f"DELETE FROM memory_vec WHERE chunk_id IN ({placeholders})", chunk_ids)
                conn.execute("DELETE FROM memory_chunks WHERE session_id = ?", (session_id,))
            cursor = conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            self._cleanup_unreferenced_images(conn, image_paths)  # type: ignore[attr-defined]
        return cursor.rowcount > 0
