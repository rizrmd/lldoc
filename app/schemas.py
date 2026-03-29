from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class IngestRequest(BaseModel):
    source_path: str
    document_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class IngestResponse(BaseModel):
    document_id: str
    source_path: str
    document_title: str | None = None
    pages_indexed: int
    chunks_indexed: int
    collection_name: str


class QueryRequest(BaseModel):
    question: str
    top_k: int | None = None
    document_ids: list[str] | None = None


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)
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


DocumentStatus = Literal["uploaded", "ingesting", "ready", "failed"]
IngestionJobStatus = Literal["queued", "running", "completed", "failed"]


class DocumentSummary(BaseModel):
    document_id: str
    file_name: str
    title: str | None = None
    source_path: str
    size_bytes: int
    content_type: str | None = None
    status: DocumentStatus
    created_at: datetime
    updated_at: datetime
    pages_indexed: int = 0
    chunks_indexed: int = 0
    collection_name: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    last_error: str | None = None
    latest_job_id: str | None = None
    download_url: str | None = None


class IngestionJob(BaseModel):
    job_id: str
    document_id: str
    status: IngestionJobStatus
    progress_percent: int = 0
    progress_label: str = "Menunggu antrean"
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error_message: str | None = None
    result: IngestResponse | None = None


class DocumentDetail(BaseModel):
    document: DocumentSummary
    latest_job: IngestionJob | None = None


class UploadDocumentResponse(BaseModel):
    document: DocumentSummary
    job: IngestionJob


class StartIngestionResponse(BaseModel):
    document: DocumentSummary
    job: IngestionJob
