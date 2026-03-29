from __future__ import annotations

import re


def _best_split_offset(text: str, start: int, end: int) -> int:
    window = text[start:end]
    splitters = ("\n\n", "\n", ". ", " ")
    threshold = int(len(window) * 0.55)

    for marker in splitters:
        idx = window.rfind(marker)
        if idx >= threshold:
            return start + idx + len(marker)
    return end


def chunk_text(text: str, chunk_size: int, chunk_overlap: int) -> list[str]:
    clean = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not clean:
        return []

    if chunk_overlap >= chunk_size:
        raise ValueError("chunk_overlap must be smaller than chunk_size")

    chunks: list[str] = []
    start = 0
    text_length = len(clean)

    while start < text_length:
        end = min(text_length, start + chunk_size)
        if end < text_length:
            end = _best_split_offset(clean, start, end)

        chunk = clean[start:end].strip()
        if chunk:
            chunks.append(chunk)

        if end >= text_length:
            break

        next_start = max(end - chunk_overlap, start + 1)
        start = next_start

    return chunks
