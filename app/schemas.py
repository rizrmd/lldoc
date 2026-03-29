from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class IngestRequest(BaseModel):
    source_path: str
    document_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class IngestResponse(BaseModel):
    document_id: str
    source_path: str
    pages_indexed: int
    chunks_indexed: int
    collection_name: str


class QueryRequest(BaseModel):
    question: str
    top_k: int | None = None
    document_ids: list[str] | None = None


class Citation(BaseModel):
    chunk_id: str
    document_id: str
    source_path: str
    page_num: int
    score: float
    text: str


class QueryResponse(BaseModel):
    answer: str
    citations: list[Citation]
    context_count: int
