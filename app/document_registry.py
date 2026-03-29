from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock

from pydantic import BaseModel, Field

from app.schemas import DocumentSummary, IngestionJob, IngestResponse


class RegistryState(BaseModel):
    documents: dict[str, DocumentSummary] = Field(default_factory=dict)
    jobs: dict[str, IngestionJob] = Field(default_factory=dict)


class DocumentRegistry:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.uploads_dir = self.data_dir / "uploads"
        self.registry_path = self.data_dir / "documents.json"
        self._lock = Lock()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self._state = self._load_state()

    def list_documents(self) -> list[DocumentSummary]:
        with self._lock:
            documents = sorted(
                self._state.documents.values(),
                key=lambda item: item.updated_at,
                reverse=True,
            )
            return [document.model_copy(deep=True) for document in documents]

    def get_document(self, document_id: str) -> DocumentSummary | None:
        with self._lock:
            document = self._state.documents.get(document_id)
            return document.model_copy(deep=True) if document is not None else None

    def create_document(
        self,
        *,
        document_id: str,
        file_name: str,
        source_path: str,
        size_bytes: int,
        content_type: str | None,
        metadata: dict[str, object] | None = None,
    ) -> DocumentSummary:
        now = self._utc_now()
        document = DocumentSummary(
            document_id=document_id,
            file_name=file_name,
            source_path=source_path,
            size_bytes=size_bytes,
            content_type=content_type,
            status="uploaded",
            created_at=now,
            updated_at=now,
            metadata=metadata or {},
        )
        with self._lock:
            self._state.documents[document_id] = document
            self._persist_locked()
            return document.model_copy(deep=True)

    def delete_document(self, document_id: str) -> DocumentSummary:
        with self._lock:
            document = self._require_document_locked(document_id)
            if document.status == "ingesting":
                raise ValueError("Document is currently being ingested and cannot be deleted")

            removed = self._state.documents.pop(document_id)
            stale_job_ids = [
                job_id for job_id, job in self._state.jobs.items() if job.document_id == document_id
            ]
            for job_id in stale_job_ids:
                self._state.jobs.pop(job_id, None)
            self._persist_locked()
            return removed.model_copy(deep=True)

    def enqueue_ingestion(self, document_id: str) -> tuple[DocumentSummary, IngestionJob]:
        with self._lock:
            document = self._require_document_locked(document_id)
            if document.status == "ingesting":
                raise ValueError("Document is already being ingested")

            now = self._utc_now()
            job = IngestionJob(
                job_id=f"job-{uuid.uuid4().hex[:12]}",
                document_id=document_id,
                status="queued",
                progress_percent=0,
                progress_label="Menunggu antrean",
                created_at=now,
                updated_at=now,
            )
            updated_document = document.model_copy(
                update={
                    "status": "ingesting",
                    "updated_at": now,
                    "last_error": None,
                    "latest_job_id": job.job_id,
                }
            )
            self._state.documents[document_id] = updated_document
            self._state.jobs[job.job_id] = job
            self._persist_locked()
            return updated_document.model_copy(deep=True), job.model_copy(deep=True)

    def mark_job_running(self, job_id: str) -> IngestionJob:
        with self._lock:
            job = self._require_job_locked(job_id)
            now = self._utc_now()
            updated_job = job.model_copy(
                update={
                    "status": "running",
                    "progress_percent": max(job.progress_percent, 5),
                    "progress_label": "Parsing dokumen",
                    "started_at": job.started_at or now,
                    "updated_at": now,
                }
            )
            self._state.jobs[job_id] = updated_job
            self._persist_locked()
            return updated_job.model_copy(deep=True)

    def update_job_progress(
        self,
        job_id: str,
        *,
        progress_percent: int,
        progress_label: str | None = None,
    ) -> IngestionJob:
        with self._lock:
            job = self._require_job_locked(job_id)
            if job.status in {"completed", "failed"}:
                return job.model_copy(deep=True)

            now = self._utc_now()
            next_percent = max(job.progress_percent, min(progress_percent, 99))
            updated_job = job.model_copy(
                update={
                    "status": "running",
                    "started_at": job.started_at or now,
                    "updated_at": now,
                    "progress_percent": next_percent,
                    "progress_label": progress_label or job.progress_label,
                }
            )
            self._state.jobs[job_id] = updated_job
            self._persist_locked()
            return updated_job.model_copy(deep=True)

    def complete_job(self, job_id: str, result: IngestResponse) -> IngestionJob:
        with self._lock:
            job = self._require_job_locked(job_id)
            now = self._utc_now()
            updated_job = job.model_copy(
                update={
                    "status": "completed",
                    "updated_at": now,
                    "finished_at": now,
                    "progress_percent": 100,
                    "progress_label": "Selesai",
                    "result": result,
                    "error_message": None,
                }
            )
            self._state.jobs[job_id] = updated_job

            document = self._state.documents.get(job.document_id)
            if document is not None:
                self._state.documents[job.document_id] = document.model_copy(
                    update={
                        "status": "ready",
                        "updated_at": now,
                        "title": result.document_title,
                        "pages_indexed": result.pages_indexed,
                        "chunks_indexed": result.chunks_indexed,
                        "collection_name": result.collection_name,
                        "last_error": None,
                        "latest_job_id": job_id,
                    }
                )

            self._persist_locked()
            return updated_job.model_copy(deep=True)

    def fail_job(self, job_id: str, error_message: str) -> IngestionJob:
        with self._lock:
            job = self._require_job_locked(job_id)
            now = self._utc_now()
            updated_job = job.model_copy(
                update={
                    "status": "failed",
                    "updated_at": now,
                    "finished_at": now,
                    "progress_label": "Gagal",
                    "error_message": error_message,
                }
            )
            self._state.jobs[job_id] = updated_job

            document = self._state.documents.get(job.document_id)
            if document is not None:
                self._state.documents[job.document_id] = document.model_copy(
                    update={
                        "status": "failed",
                        "updated_at": now,
                        "last_error": error_message,
                        "latest_job_id": job_id,
                    }
                )

            self._persist_locked()
            return updated_job.model_copy(deep=True)

    def get_job(self, job_id: str) -> IngestionJob | None:
        with self._lock:
            job = self._state.jobs.get(job_id)
            return job.model_copy(deep=True) if job is not None else None

    def list_jobs(self, *, limit: int = 20) -> list[IngestionJob]:
        with self._lock:
            jobs = sorted(
                self._state.jobs.values(),
                key=lambda item: item.created_at,
                reverse=True,
            )
            return [job.model_copy(deep=True) for job in jobs[:limit]]

    def _load_state(self) -> RegistryState:
        if not self.registry_path.exists():
            return RegistryState()
        return RegistryState.model_validate_json(self.registry_path.read_text(encoding="utf-8"))

    def _persist_locked(self) -> None:
        self.registry_path.write_text(
            self._state.model_dump_json(indent=2),
            encoding="utf-8",
        )

    def _require_document_locked(self, document_id: str) -> DocumentSummary:
        document = self._state.documents.get(document_id)
        if document is None:
            raise KeyError(document_id)
        return document

    def _require_job_locked(self, job_id: str) -> IngestionJob:
        job = self._state.jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        return job

    @staticmethod
    def _utc_now() -> datetime:
        return datetime.now(UTC)
