from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from threading import Thread
from typing import Annotated, Literal, cast

from fastapi import FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.config import get_settings
from app.conversation_registry import ConversationRegistry
from app.document_registry import DocumentRegistry
from app.liteparse_client import LiteParseClient
from app.nvidia_client import NvidiaClient
from app.qdrant_store import QdrantStore
from app.rag_service import RagService
from app.schemas import (
    ChatMessage,
    ChatRequest,
    ChatResponse,
    ConversationDetail,
    ConversationMessage,
    ConversationSummary,
    DocumentDetail,
    DocumentSummary,
    IngestionJob,
    IngestRequest,
    IngestResponse,
    QueryRequest,
    QueryResponse,
    StartIngestionResponse,
    UploadDocumentResponse,
)


def build_service() -> RagService:
    settings = get_settings()
    return RagService(
        settings=settings,
        liteparse_client=LiteParseClient(settings),
        nvidia_client=NvidiaClient(settings),
        qdrant_store=QdrantStore(settings),
    )


settings = get_settings()
service = build_service()
document_registry = DocumentRegistry(settings.app_data_dir)
conversation_registry = ConversationRegistry(settings.app_data_dir)
app = FastAPI(title="LiteParse + Qdrant + NVIDIA RAG")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    try:
        result = service.chat(
            request.messages,
            top_k=request.top_k,
            document_ids=request.document_ids,
        )
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(error),
        ) from error

    history_messages = [
        _to_conversation_message(message)
        for message in request.messages
        if message.role in {"user", "assistant"} and message.content.strip()
    ]
    history_messages.append(
        ConversationMessage(
            message_id=f"msg-{uuid.uuid4().hex[:12]}",
            role="assistant",
            content=result.answer,
            created_at=_utc_now(),
            citations=result.citations,
            context_count=result.context_count,
        )
    )
    conversation = conversation_registry.sync_conversation(
        conversation_id=request.conversation_id,
        messages=history_messages,
        document_ids=request.document_ids,
    )
    return ChatResponse(
        answer=result.answer,
        citations=result.citations,
        context_count=result.context_count,
        conversation=conversation.conversation,
    )


@app.get("/conversations", response_model=list[ConversationSummary])
def list_conversations() -> list[ConversationSummary]:
    return conversation_registry.list_conversations()


@app.get("/conversations/{conversation_id}", response_model=ConversationDetail)
def get_conversation(conversation_id: str) -> ConversationDetail:
    conversation = conversation_registry.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return conversation


@app.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(conversation_id: str) -> None:
    try:
        conversation_registry.delete_conversation(conversation_id)
    except KeyError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        ) from error


@app.get("/documents", response_model=list[DocumentDetail])
def list_documents() -> list[DocumentDetail]:
    return [_build_document_detail(document) for document in document_registry.list_documents()]


@app.get("/documents/{document_id}", response_model=DocumentDetail)
def get_document(document_id: str) -> DocumentDetail:
    document = document_registry.get_document(document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return _build_document_detail(document)


@app.get("/jobs", response_model=list[IngestionJob])
def list_jobs() -> list[IngestionJob]:
    return document_registry.list_jobs()


@app.get("/jobs/{job_id}", response_model=IngestionJob)
def get_job(job_id: str) -> IngestionJob:
    job = document_registry.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return job


@app.post(
    "/documents/upload",
    response_model=UploadDocumentResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def upload_document(
    file: Annotated[UploadFile, File(...)],
) -> UploadDocumentResponse:
    file_name = _sanitize_filename(file.filename or "document.bin")
    document_id = f"doc-{uuid.uuid4().hex[:12]}"
    suffix = Path(file_name).suffix
    stored_name = f"{document_id}{suffix}" if suffix else document_id
    target_path = document_registry.uploads_dir / stored_name

    size_bytes = 0
    with target_path.open("wb") as handle:
        while chunk := file.file.read(1024 * 1024):
            size_bytes += len(chunk)
            handle.write(chunk)
    file.file.close()

    document = document_registry.create_document(
        document_id=document_id,
        file_name=file_name,
        source_path=str(target_path),
        size_bytes=size_bytes,
        content_type=file.content_type,
    )
    document, job = _enqueue_document_ingestion(document.document_id)
    return UploadDocumentResponse(
        document=_with_download_url(document),
        job=job,
    )


@app.post(
    "/documents/{document_id}/ingest",
    response_model=StartIngestionResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def start_document_ingestion(document_id: str) -> StartIngestionResponse:
    document = document_registry.get_document(document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if not Path(document.source_path).exists():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Stored document file is missing",
        )

    document, job = _enqueue_document_ingestion(document_id)
    return StartIngestionResponse(
        document=_with_download_url(document),
        job=job,
    )


@app.get("/documents/{document_id}/download")
def download_document(document_id: str) -> FileResponse:
    document = document_registry.get_document(document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    source_path = Path(document.source_path)
    if not source_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stored file not found")

    return FileResponse(
        path=source_path,
        filename=document.file_name,
        media_type=document.content_type or "application/octet-stream",
    )


@app.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(document_id: str) -> None:
    document = document_registry.get_document(document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if document.status == "ingesting":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Document is still being ingested",
        )

    service.qdrant_store.delete_document(document_id)
    document_registry.delete_document(document_id)

    source_path = Path(document.source_path)
    if source_path.exists():
        source_path.unlink()


def _build_document_detail(document: DocumentSummary) -> DocumentDetail:
    latest_job = (
        document_registry.get_job(document.latest_job_id) if document.latest_job_id else None
    )
    return DocumentDetail(
        document=_with_download_url(document),
        latest_job=latest_job,
    )


def _with_download_url(document: DocumentSummary) -> DocumentSummary:
    return document.model_copy(
        update={"download_url": f"/documents/{document.document_id}/download"}
    )


def _enqueue_document_ingestion(document_id: str) -> tuple[DocumentSummary, IngestionJob]:
    try:
        document, job = document_registry.enqueue_ingestion(document_id)
    except KeyError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        ) from error
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error

    worker = Thread(
        target=_run_ingestion_job,
        args=(job.job_id,),
        daemon=True,
        name=f"ingest-{document_id}",
    )
    worker.start()
    return document, job


def _run_ingestion_job(job_id: str) -> None:
    document_registry.mark_job_running(job_id)
    job = document_registry.get_job(job_id)
    if job is None:
        return

    document = document_registry.get_document(job.document_id)
    if document is None:
        document_registry.fail_job(job_id, "Document no longer exists")
        return

    worker_service = build_service()
    try:
        result = worker_service.ingest_document(
            document.source_path,
            document_id=document.document_id,
            metadata=document.metadata,
            progress_callback=lambda progress_percent, progress_label: (
                document_registry.update_job_progress(
                    job_id,
                    progress_percent=progress_percent,
                    progress_label=progress_label,
                )
            ),
        )
    except Exception as error:  # noqa: BLE001
        document_registry.fail_job(job_id, _format_job_error(error))
    else:
        document_registry.complete_job(job_id, result)
    finally:
        worker_service.close()


def _format_job_error(error: Exception) -> str:
    detail = str(error).strip()
    if detail:
        return detail
    return error.__class__.__name__


def _sanitize_filename(file_name: str) -> str:
    cleaned = Path(file_name).name.strip() or "document.bin"
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", cleaned)
    return cleaned or "document.bin"


def _to_conversation_message(message: ChatMessage) -> ConversationMessage:
    normalized_content = message.content.strip()
    if message.role not in {"user", "assistant"}:
        raise ValueError(f"Unsupported conversation role: {message.role}")
    role = cast(Literal["user", "assistant"], message.role)
    return ConversationMessage(
        message_id=message.message_id or f"msg-{uuid.uuid4().hex[:12]}",
        role=role,
        content=normalized_content,
        created_at=message.created_at or _utc_now(),
        citations=message.citations if role == "assistant" else [],
        context_count=message.context_count if role == "assistant" else 0,
    )


def _utc_now() -> datetime:
    return datetime.now(UTC)
