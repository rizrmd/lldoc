from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _get_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _get_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    return int(raw) if raw else default


def _get_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    return float(raw) if raw else default


def _get_list(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name)
    if raw is None:
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    qdrant_url: str
    qdrant_collection: str
    qdrant_api_key: str | None
    nvidia_api_key: str
    nvidia_base_url: str
    nvidia_chat_model: str
    nvidia_embed_model: str
    nvidia_embed_truncate: str
    nvidia_chat_temperature: float
    nvidia_chat_max_tokens: int
    nvidia_timeout_seconds: int
    liteparse_ocr_enabled: bool
    liteparse_ocr_language: str
    liteparse_max_pages: int
    liteparse_dpi: int
    liteparse_target_pages: str | None
    chunk_size: int
    chunk_overlap: int
    top_k: int
    rag_context_chars_per_chunk: int
    rag_context_max_chars: int
    app_data_dir: Path
    cors_origins: list[str]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    nvidia_api_key = os.getenv("NVIDIA_API_KEY", "").strip()
    if not nvidia_api_key:
        raise RuntimeError("NVIDIA_API_KEY is required")

    target_pages = os.getenv("LITEPARSE_TARGET_PAGES", "").strip() or None
    qdrant_api_key = os.getenv("QDRANT_API_KEY", "").strip() or None
    app_data_dir = Path(os.getenv("APP_DATA_DIR", "data")).expanduser().resolve()
    cors_origins = _get_list(
        "CORS_ORIGINS",
        [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ],
    )

    return Settings(
        qdrant_url=os.getenv("QDRANT_URL", "http://localhost:6333"),
        qdrant_collection=os.getenv("QDRANT_COLLECTION", "documents"),
        qdrant_api_key=qdrant_api_key,
        nvidia_api_key=nvidia_api_key,
        nvidia_base_url=os.getenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1").rstrip(
            "/"
        ),
        nvidia_chat_model=os.getenv("NVIDIA_CHAT_MODEL", "nvidia/nemotron-mini-4b-instruct"),
        nvidia_embed_model=os.getenv("NVIDIA_EMBED_MODEL", "nvidia/nv-embedqa-e5-v5"),
        nvidia_embed_truncate=os.getenv("NVIDIA_EMBED_TRUNCATE", "NONE"),
        nvidia_chat_temperature=_get_float("NVIDIA_CHAT_TEMPERATURE", 0),
        nvidia_chat_max_tokens=_get_int("NVIDIA_CHAT_MAX_TOKENS", 300),
        nvidia_timeout_seconds=_get_int("NVIDIA_TIMEOUT_SECONDS", 120),
        liteparse_ocr_enabled=_get_bool("LITEPARSE_OCR_ENABLED", True),
        liteparse_ocr_language=os.getenv("LITEPARSE_OCR_LANGUAGE", "en"),
        liteparse_max_pages=_get_int("LITEPARSE_MAX_PAGES", 1000),
        liteparse_dpi=_get_int("LITEPARSE_DPI", 150),
        liteparse_target_pages=target_pages,
        chunk_size=_get_int("CHUNK_SIZE", 1200),
        chunk_overlap=_get_int("CHUNK_OVERLAP", 200),
        top_k=_get_int("TOP_K", 6),
        rag_context_chars_per_chunk=_get_int("RAG_CONTEXT_CHARS_PER_CHUNK", 800),
        rag_context_max_chars=_get_int("RAG_CONTEXT_MAX_CHARS", 2400),
        app_data_dir=app_data_dir,
        cors_origins=cors_origins,
    )
