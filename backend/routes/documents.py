from __future__ import annotations

import hashlib
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from ..config_store import get as get_config_data
from ..documents.chunker import chunk_document
from ..models import Document, DocumentCreate, DocumentReorderRequest, DocumentUpdateRequest, DocumentUploadRequest
from .deps import _DOCUMENT_DIR, start_background_task, store

logger = logging.getLogger(__name__)
router = APIRouter()

_DOCUMENT_MIME_TYPES = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
}
_DOCUMENT_ALLOWED_EXTENSIONS = tuple(_DOCUMENT_MIME_TYPES)


def _validate_document_extension(file_name: str) -> str:
    ext = Path(file_name).suffix.lower()
    if ext not in _DOCUMENT_ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Only .txt, .md, .json are allowed",
        )
    return ext


def _get_document_chunking_config() -> dict[str, int]:
    config = get_config_data()
    target = max(100, int(config.get("document_chunk_target_chars", 800)))
    max_chars = max(target, int(config.get("document_chunk_max_chars", 1000)))
    overlap = max(0, min(int(config.get("document_chunk_overlap_chars", 100)), max_chars - 1))
    return {"chunk_target": target, "chunk_max": max_chars, "overlap": overlap}


def _start_document_indexing(doc_id: str, file_name: str, content: str, *, action: str) -> None:
    chunking = _get_document_chunking_config()

    def _index_document() -> None:
        try:
            chunks = chunk_document(file_name, content, **chunking)
            store.index_document_chunks(doc_id, chunks)
            logger.info("Document %s: %s (%d chunks)", action, doc_id, len(chunks))
        except Exception as exc:
            logger.warning("Document %s failed: %s", action, exc)

    start_background_task(_index_document, name=f"document-index-{doc_id}")


def _resolve_unique_document_path(workspace_id: str, file_name: str) -> Path:
    workspace_dir = _DOCUMENT_DIR / workspace_id
    workspace_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(file_name).suffix.lower()
    stem = Path(file_name).stem
    target = workspace_dir / file_name
    counter = 1
    while target.exists():
        target = workspace_dir / f"{stem}_{counter}{ext}"
        counter += 1
    return target


@router.get("/documents", response_model=list[Document])
def list_documents(workspace_id: str = Query(...)) -> list[Document]:
    return store.list_documents(workspace_id)


@router.post("/documents/reorder")
def reorder_documents(payload: DocumentReorderRequest) -> dict[str, bool]:
    store.reorder_documents(payload.ids)
    return {"ok": True}


@router.post("/documents/cleanup")
def cleanup_documents() -> dict[str, int]:
    return store.cleanup_documents()


@router.post("/documents/reindex")
def reindex_workspace_documents() -> dict[str, int]:
    docs = store.list_all_workspace_documents()
    total = len(docs)
    succeeded = 0
    failed = 0
    chunking = _get_document_chunking_config()
    for doc in docs:
        file_path = _DOCUMENT_DIR / doc.file_path
        store.set_document_indexed_at(doc.id, None)
        try:
            content = file_path.read_text(encoding="utf-8")
            chunks = chunk_document(doc.file_name, content, **chunking)
            store.index_document_chunks(doc.id, chunks)
            succeeded += 1
        except Exception as exc:
            failed += 1
            logger.warning("Document re-indexing failed for %s: %s", doc.id, exc)
    return {"total": total, "succeeded": succeeded, "failed": failed}


@router.post("/documents/{doc_id}/move", response_model=Document)
def move_document(doc_id: str, payload: dict) -> Document:
    target_workspace_id = payload.get("workspace_id", "")
    if not target_workspace_id:
        raise HTTPException(status_code=400, detail="workspace_id is required")
    if not store.has_workspace(target_workspace_id):
        raise HTTPException(status_code=404, detail="Target workspace not found")
    doc = store.move_document(doc_id, target_workspace_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.post("/documents", response_model=Document)
def create_document(payload: DocumentUploadRequest) -> Document:
    if not store.has_workspace(payload.workspace_id):
        raise HTTPException(status_code=404, detail="Workspace not found")
    _validate_document_extension(payload.file_name)
    mime_type = _DOCUMENT_MIME_TYPES[_validate_document_extension(payload.file_name)]
    content_bytes = payload.content.encode("utf-8")
    file_hash = hashlib.sha256(content_bytes).hexdigest()
    target = _resolve_unique_document_path(payload.workspace_id, payload.file_name)
    target.write_text(payload.content, encoding="utf-8")
    relative_path = f"{payload.workspace_id}/{target.name}"
    doc = store.create_document(
        DocumentCreate(
            workspace_id=payload.workspace_id,
            session_id=payload.session_id,
            scope=payload.scope,
            file_name=target.name,
            mime_type=mime_type,
            file_path=relative_path,
            file_size=len(content_bytes),
            file_hash=file_hash,
        )
    )
    _start_document_indexing(doc.id, doc.file_name, payload.content, action="indexed")
    return doc


@router.get("/documents/{doc_id}")
def get_document(doc_id: str) -> dict:
    doc = store.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    file_path = _DOCUMENT_DIR / doc.file_path
    try:
        content = file_path.read_text(encoding="utf-8")
    except OSError:
        content = ""
    return {**doc.model_dump(), "content": content}


@router.patch("/documents/{doc_id}", response_model=Document)
def update_document(doc_id: str, payload: DocumentUpdateRequest) -> Document:
    doc = store.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")

    if payload.file_name is not None and payload.file_name != doc.file_name:
        _validate_document_extension(payload.file_name)
        renamed = store.rename_document(doc_id, payload.file_name)
        if renamed is None:
            raise HTTPException(status_code=500, detail="Failed to rename file")
        doc = renamed

    if payload.content is not None:
        content_bytes = payload.content.encode("utf-8")
        file_hash = hashlib.sha256(content_bytes).hexdigest()
        file_path = _DOCUMENT_DIR / doc.file_path
        try:
            file_path.write_text(payload.content, encoding="utf-8")
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"Failed to write file: {e}") from e
        store.update_document_file_metadata(doc_id, len(content_bytes), file_hash)
        store.set_document_indexed_at(doc_id, None)
        _start_document_indexing(doc_id, doc.file_name, payload.content, action="re-indexed")

    updated = store.get_document(doc_id)
    if updated is None:
        raise HTTPException(status_code=500, detail="Failed to reload document")
    return updated


@router.delete("/documents/{doc_id}")
def delete_document(doc_id: str) -> dict[str, bool]:
    deleted = store.delete_document(doc_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"deleted": True}
