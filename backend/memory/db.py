from __future__ import annotations


class DatabasePlaceholder:
    def __init__(self, dsn: str = "sqlite:///data/lm_chat.db") -> None:
        self.dsn = dsn
