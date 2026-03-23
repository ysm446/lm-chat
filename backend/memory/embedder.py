from __future__ import annotations


class EmbedderPlaceholder:
    def embed(self, text: str) -> list[float]:
        return [float(len(text))]
