from __future__ import annotations


class DatabasePlaceholder:
    def __init__(self, dsn: str = "sqlite:///data/history.db") -> None:
        self.dsn = dsn
