from __future__ import annotations

import struct
from pathlib import Path

from .models import Document, DocumentChunk, DocumentCreate, now_iso


class DocumentMixin:
    def cleanup_documents(self) -> dict[str, int]:
        with self._connect() as conn:  # type: ignore[attr-defined]
            orphan_chunk_ids = [
                row["id"] for row in conn.execute(
                    "SELECT dc.id FROM document_chunks dc LEFT JOIN documents d ON d.id = dc.document_id LEFT JOIN workspaces w ON w.id = dc.workspace_id WHERE d.id IS NULL OR w.id IS NULL OR d.workspace_id != dc.workspace_id"
                ).fetchall()
            ]
            deleted_chunks = 0
            if orphan_chunk_ids:
                placeholders = ",".join("?" * len(orphan_chunk_ids))
                conn.execute(f"DELETE FROM document_fts WHERE id IN ({placeholders})", orphan_chunk_ids)
                conn.execute(f"DELETE FROM document_vec WHERE chunk_id IN ({placeholders})", orphan_chunk_ids)
                deleted_chunks = conn.execute(f"DELETE FROM document_chunks WHERE id IN ({placeholders})", orphan_chunk_ids).rowcount

            orphan_fts_ids = [row["id"] for row in conn.execute("SELECT df.id FROM document_fts df LEFT JOIN document_chunks dc ON dc.id = df.id WHERE dc.id IS NULL").fetchall()]
            deleted_fts = 0
            if orphan_fts_ids:
                placeholders = ",".join("?" * len(orphan_fts_ids))
                deleted_fts = conn.execute(f"DELETE FROM document_fts WHERE id IN ({placeholders})", orphan_fts_ids).rowcount

            orphan_vec_ids = [row["chunk_id"] for row in conn.execute("SELECT dv.chunk_id FROM document_vec dv LEFT JOIN document_chunks dc ON dc.id = dv.chunk_id WHERE dc.id IS NULL").fetchall()]
            deleted_vec = 0
            if orphan_vec_ids:
                placeholders = ",".join("?" * len(orphan_vec_ids))
                deleted_vec = conn.execute(f"DELETE FROM document_vec WHERE chunk_id IN ({placeholders})", orphan_vec_ids).rowcount

            referenced_paths = {row["file_path"] for row in conn.execute("SELECT file_path FROM documents").fetchall() if row["file_path"]}

        deleted_files = 0
        deleted_dirs = 0
        if self.document_root.exists():  # type: ignore[attr-defined]
            for file_path in sorted((p for p in self.document_root.rglob("*") if p.is_file()), key=lambda p: len(p.parts), reverse=True):  # type: ignore[attr-defined]
                if file_path.relative_to(self.document_root).as_posix() in referenced_paths:  # type: ignore[attr-defined]
                    continue
                try:
                    file_path.unlink()
                    deleted_files += 1
                except OSError:
                    pass
            for dir_path in sorted((p for p in self.document_root.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):  # type: ignore[attr-defined]
                try:
                    dir_path.rmdir()
                    deleted_dirs += 1
                except OSError:
                    pass

        return {"deleted_chunks": deleted_chunks, "deleted_fts": deleted_fts, "deleted_vec": deleted_vec, "deleted_files": deleted_files, "deleted_dirs": deleted_dirs}

    def create_document(self, payload: DocumentCreate) -> Document:
        with self._connect() as conn:  # type: ignore[attr-defined]
            row = conn.execute(
                "SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM documents WHERE workspace_id = ? AND scope = ?",
                (payload.workspace_id, payload.scope),
            ).fetchone()
        next_order = int(row["max_order"]) + 1 if row is not None else 0
        doc = Document(id=self._new_id("doc"), sort_order=next_order, **payload.model_dump(exclude={"sort_order"}))  # type: ignore[attr-defined]
        with self._connect() as conn:  # type: ignore[attr-defined]
            conn.execute(
                "INSERT INTO documents (id, workspace_id, session_id, scope, sort_order, file_name, mime_type, file_path, file_size, file_hash, embed_model, created_at, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (doc.id, doc.workspace_id, doc.session_id, doc.scope, doc.sort_order, doc.file_name, doc.mime_type, doc.file_path, doc.file_size, doc.file_hash, doc.embed_model, doc.created_at, doc.indexed_at),
            )
        return doc

    def get_document(self, doc_id: str) -> Document | None:
        with self._connect() as conn:  # type: ignore[attr-defined]
            row = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        return self._document_from_row(row) if row is not None else None  # type: ignore[attr-defined]

    def set_document_indexed_at(self, doc_id: str, indexed_at: str | None) -> None:
        with self._connect() as conn:  # type: ignore[attr-defined]
            conn.execute("UPDATE documents SET indexed_at = ? WHERE id = ?", (indexed_at, doc_id))

    def list_documents(self, workspace_id: str) -> list[Document]:
        with self._connect() as conn:  # type: ignore[attr-defined]
            rows = conn.execute(
                "SELECT * FROM documents WHERE workspace_id = ? AND scope = 'workspace' ORDER BY sort_order ASC, created_at DESC",
                (workspace_id,),
            ).fetchall()
        return [self._document_from_row(r) for r in rows]  # type: ignore[attr-defined]

    def list_all_workspace_documents(self) -> list[Document]:
        with self._connect() as conn:  # type: ignore[attr-defined]
            rows = conn.execute(
                "SELECT * FROM documents WHERE scope = 'workspace' ORDER BY created_at DESC"
            ).fetchall()
        return [self._document_from_row(r) for r in rows]  # type: ignore[attr-defined]

    def reorder_documents(self, ids: list[str]) -> None:
        with self._connect() as conn:  # type: ignore[attr-defined]
            for order, doc_id in enumerate(ids):
                conn.execute("UPDATE documents SET sort_order = ? WHERE id = ?", (order, doc_id))

    def move_document(self, doc_id: str, target_workspace_id: str) -> Document | None:
        doc = self.get_document(doc_id)
        if doc is None:
            return None
        if doc.workspace_id == target_workspace_id:
            return doc

        old_path = self.document_root / doc.file_path  # type: ignore[attr-defined]
        target_dir = self.document_root / target_workspace_id  # type: ignore[attr-defined]
        target_dir.mkdir(parents=True, exist_ok=True)

        stem = Path(doc.file_name).stem
        suffix = Path(doc.file_name).suffix
        new_path = target_dir / doc.file_name
        counter = 1
        while new_path.exists():
            new_path = target_dir / f"{stem}_{counter}{suffix}"
            counter += 1

        try:
            if old_path.exists():
                old_path.rename(new_path)
        except OSError:
            return None

        new_relative = f"{target_workspace_id}/{new_path.name}"
        with self._connect() as conn:  # type: ignore[attr-defined]
            row = conn.execute(
                "SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM documents WHERE workspace_id = ? AND scope = ?",
                (target_workspace_id, doc.scope),
            ).fetchone()
            next_order = int(row["max_order"]) + 1 if row is not None else 0
            conn.execute(
                "UPDATE documents SET workspace_id = ?, sort_order = ?, file_name = ?, file_path = ? WHERE id = ?",
                (target_workspace_id, next_order, new_path.name, new_relative, doc_id),
            )
            conn.execute(
                "UPDATE document_chunks SET workspace_id = ? WHERE document_id = ?",
                (target_workspace_id, doc_id),
            )

        try:
            for parent in old_path.parents:
                if parent == self.document_root or self.document_root not in parent.parents:  # type: ignore[attr-defined]
                    break
                parent.rmdir()
        except OSError:
            pass
        return self.get_document(doc_id)

    def delete_document(self, doc_id: str) -> bool:
        doc = self.get_document(doc_id)
        if doc is None:
            return False
        with self._connect() as conn:  # type: ignore[attr-defined]
            chunk_ids = [row["id"] for row in conn.execute("SELECT id FROM document_chunks WHERE document_id = ?", (doc_id,)).fetchall()]
            if chunk_ids:
                placeholders = ",".join("?" * len(chunk_ids))
                conn.execute(f"DELETE FROM document_fts WHERE id IN ({placeholders})", chunk_ids)
                conn.execute(f"DELETE FROM document_vec WHERE chunk_id IN ({placeholders})", chunk_ids)
                conn.execute(f"DELETE FROM document_chunks WHERE id IN ({placeholders})", chunk_ids)
            conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        try:
            file_path = self.document_root / doc.file_path  # type: ignore[attr-defined]
            if file_path.exists():
                file_path.unlink()
            for parent in file_path.parents:
                if parent == self.document_root or self.document_root not in parent.parents:  # type: ignore[attr-defined]
                    break
                try:
                    parent.rmdir()
                except OSError:
                    break
        except OSError:
            pass
        return True

    def index_document_chunks(self, doc_id: str, chunks: list[str]) -> None:
        from .memory.embedder import embed

        doc = self.get_document(doc_id)
        if doc is None:
            return
        with self._connect() as conn:  # type: ignore[attr-defined]
            old_ids = [row["id"] for row in conn.execute("SELECT id FROM document_chunks WHERE document_id = ?", (doc_id,)).fetchall()]
            if old_ids:
                placeholders = ",".join("?" * len(old_ids))
                conn.execute(f"DELETE FROM document_fts WHERE id IN ({placeholders})", old_ids)
                conn.execute(f"DELETE FROM document_vec WHERE chunk_id IN ({placeholders})", old_ids)
                conn.execute(f"DELETE FROM document_chunks WHERE id IN ({placeholders})", old_ids)

            for i, text in enumerate(chunks):
                chunk_id = self._new_id("dc")  # type: ignore[attr-defined]
                conn.execute(
                    "INSERT INTO document_chunks (id, document_id, workspace_id, session_id, chunk_index, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (chunk_id, doc_id, doc.workspace_id, doc.session_id, i, text, now_iso()),
                )
                conn.execute("INSERT INTO document_fts (id, content) VALUES (?, ?)", (chunk_id, text))
                vector = embed(text)
                vec_bytes = struct.pack(f"{len(vector)}f", *vector)
                conn.execute("INSERT INTO document_vec (chunk_id, embedding) VALUES (?, ?)", (chunk_id, vec_bytes))

            conn.execute("UPDATE documents SET indexed_at = ? WHERE id = ?", (now_iso(), doc_id))

    def search_documents(
        self, workspace_id: str, query: str, top_k: int = 3, session_id: str | None = None
    ) -> list[DocumentChunk]:
        from .memory.embedder import embed

        query_vec = embed(query)
        rrf_k = 60
        scores: dict[str, float] = {}

        with self._connect() as conn:  # type: ignore[attr-defined]
            safe_query = '"' + query.replace('"', ' ') + '"'
            try:
                fts_rows = conn.execute(
                    "SELECT dc.id FROM document_fts df JOIN document_chunks dc ON dc.id = df.id WHERE df.content MATCH ? AND dc.workspace_id = ? LIMIT ?",
                    (safe_query, workspace_id, top_k * 4),
                ).fetchall()
                for rank, row in enumerate(fts_rows):
                    scores[row["id"]] = scores.get(row["id"], 0.0) + 1.0 / (rrf_k + rank + 1)
            except Exception:
                pass

            # グローバル KNN だと他ワークスペースのチャンクが上位を占めて取りこぼすため、
            # 対象ワークスペース内のチャンクに限定して距離を直接計算する
            vec_bytes_q = struct.pack(f"{len(query_vec)}f", *query_vec)
            try:
                vec_rows = conn.execute(
                    "SELECT dc.id AS chunk_id, vec_distance_cosine(dv.embedding, ?) AS distance"
                    " FROM document_chunks dc JOIN document_vec dv ON dv.chunk_id = dc.id"
                    " WHERE dc.workspace_id = ?"
                    " ORDER BY distance ASC LIMIT ?",
                    (vec_bytes_q, workspace_id, top_k * 4),
                ).fetchall()
            except Exception:
                vec_rows = []
            for rank, row in enumerate(vec_rows):
                scores[row["chunk_id"]] = scores.get(row["chunk_id"], 0.0) + 1.0 / (rrf_k + rank + 1)

            if not scores:
                return []

            ids = list(scores.keys())
            placeholders = ",".join("?" * len(ids))
            chunk_rows = conn.execute(f"SELECT * FROM document_chunks WHERE id IN ({placeholders})", ids).fetchall()

        ranked = sorted(scores.keys(), key=lambda cid: scores[cid], reverse=True)[:top_k]
        chunks_by_id = {row["id"]: row for row in chunk_rows}
        result = []
        for cid in ranked:
            if cid in chunks_by_id:
                data = dict(chunks_by_id[cid])
                data.setdefault("session_id", None)
                result.append(DocumentChunk(**data))
        return result

    def update_document_file_metadata(self, doc_id: str, file_size: int, file_hash: str) -> None:
        with self._connect() as conn:  # type: ignore[attr-defined]
            conn.execute("UPDATE documents SET file_size = ?, file_hash = ? WHERE id = ?", (file_size, file_hash, doc_id))

    def rename_document(self, doc_id: str, new_name: str) -> Document | None:
        doc = self.get_document(doc_id)
        if doc is None:
            return None
        old_path = self.document_root / doc.file_path  # type: ignore[attr-defined]
        stem = Path(new_name).stem
        suffix = Path(new_name).suffix
        new_path = old_path.parent / new_name
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
        with self._connect() as conn:  # type: ignore[attr-defined]
            conn.execute(
                "UPDATE documents SET file_name = ?, file_path = ? WHERE id = ?",
                (new_path.name, new_relative, doc_id),
            )
        return self.get_document(doc_id)
