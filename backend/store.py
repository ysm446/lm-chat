from __future__ import annotations

from .store_base import SQLiteStoreBase
from .store_document import DocumentMixin
from .store_memory import MemoryMixin
from .store_session import SessionMixin
from .store_workspace import WorkspaceMixin


class SQLiteStore(WorkspaceMixin, SessionMixin, MemoryMixin, DocumentMixin, SQLiteStoreBase):
    """ドメイン別 Mixin を合成した SQLite ストア。"""
