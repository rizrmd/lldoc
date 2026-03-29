from __future__ import annotations

from fastapi import FastAPI

from app.config import get_settings
from app.liteparse_client import LiteParseClient
from app.nvidia_client import NvidiaClient
from app.qdrant_store import QdrantStore
from app.rag_service import RagService
from app.schemas import IngestRequest, IngestResponse, QueryRequest, QueryResponse


def build_service() -> RagService:
    settings = get_settings()
    return RagService(
        settings=settings,
        liteparse_client=LiteParseClient(settings),
        nvidia_client=NvidiaClient(settings),
        qdrant_store=QdrantStore(settings),
    )


service = build_service()
app = FastAPI(title="LiteParse + Qdrant + NVIDIA RAG")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/ingest", response_model=IngestResponse)
def ingest(request: IngestRequest) -> IngestResponse:
    return service.ingest_document(
        request.source_path,
        document_id=request.document_id,
        metadata=request.metadata,
    )


@app.post("/query", response_model=QueryResponse)
def query(request: QueryRequest) -> QueryResponse:
    return service.query(
        request.question,
        top_k=request.top_k,
        document_ids=request.document_ids,
    )
