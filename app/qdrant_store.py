from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from qdrant_client import QdrantClient
from qdrant_client.http import models

from app.config import Settings


@dataclass(frozen=True)
class SearchHit:
    chunk_id: str
    document_id: str
    source_path: str
    page_num: int
    text: str
    score: float
    payload: dict[str, Any]


class QdrantStore:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        if self.settings.qdrant_url == ":memory:":
            self.client = QdrantClient(":memory:")
        else:
            self.client = QdrantClient(
                url=self.settings.qdrant_url,
                api_key=self.settings.qdrant_api_key,
            )

    def ensure_collection(self, vector_size: int) -> None:
        if not self.client.collection_exists(self.settings.qdrant_collection):
            self.client.create_collection(
                collection_name=self.settings.qdrant_collection,
                vectors_config=models.VectorParams(
                    size=vector_size,
                    distance=models.Distance.COSINE,
                ),
            )

    def delete_document(self, document_id: str) -> None:
        if not self.client.collection_exists(self.settings.qdrant_collection):
            return
        self.client.delete(
            collection_name=self.settings.qdrant_collection,
            wait=True,
            points_selector=models.FilterSelector(
                filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="document_id",
                            match=models.MatchValue(value=document_id),
                        )
                    ]
                )
            ),
        )

    def upsert_chunks(
        self,
        chunks: list[dict[str, Any]],
        *,
        batch_size: int = 128,
        progress_callback: Callable[[int, int], None] | None = None,
    ) -> None:
        total = len(chunks)
        for start in range(0, total, batch_size):
            batch = chunks[start : start + batch_size]
            points = [
                models.PointStruct(
                    id=chunk["chunk_id"],
                    vector=chunk["embedding"],
                    payload={
                        "document_id": chunk["document_id"],
                        "source_path": chunk["source_path"],
                        "page_num": chunk["page_num"],
                        "chunk_index": chunk["chunk_index"],
                        "text": chunk["text"],
                        "metadata": chunk["metadata"],
                    },
                )
                for chunk in batch
            ]
            self.client.upsert(
                collection_name=self.settings.qdrant_collection,
                wait=True,
                points=points,
            )
            if progress_callback is not None:
                progress_callback(min(start + len(batch), total), total)

    def search(
        self,
        query_vector: list[float],
        *,
        limit: int,
        document_ids: list[str] | None = None,
    ) -> list[SearchHit]:
        if not self.client.collection_exists(self.settings.qdrant_collection):
            return []
        response = self.client.query_points(
            collection_name=self.settings.qdrant_collection,
            query=query_vector,
            query_filter=self._build_document_filter(document_ids),
            with_payload=True,
            limit=limit,
        )
        return [
            self._build_hit(point.id, point.payload, score=float(point.score))
            for point in response.points
        ]

    def scroll_chunks(self, *, document_ids: list[str] | None = None) -> list[SearchHit]:
        if not self.client.collection_exists(self.settings.qdrant_collection):
            return []
        hits: list[SearchHit] = []
        offset: Any = None
        query_filter = self._build_document_filter(document_ids)

        while True:
            points, next_offset = self.client.scroll(
                collection_name=self.settings.qdrant_collection,
                scroll_filter=query_filter,
                with_payload=True,
                with_vectors=False,
                limit=256,
                offset=offset,
            )
            hits.extend(self._build_hit(point.id, point.payload, score=0.0) for point in points)
            if next_offset is None:
                break
            offset = next_offset

        return hits

    def close(self) -> None:
        close = getattr(self.client, "close", None)
        if callable(close):
            close()

    @staticmethod
    def _build_hit(
        point_id: Any,
        payload: dict[str, Any] | models.Payload | None,
        *,
        score: float,
    ) -> SearchHit:
        raw_payload = dict(payload or {})
        return SearchHit(
            chunk_id=str(point_id),
            document_id=str(raw_payload["document_id"]),
            source_path=str(raw_payload["source_path"]),
            page_num=int(raw_payload["page_num"]),
            text=str(raw_payload["text"]),
            score=score,
            payload=raw_payload,
        )

    @staticmethod
    def _build_document_filter(document_ids: list[str] | None) -> models.Filter | None:
        if not document_ids:
            return None
        return models.Filter(
            must=[
                models.FieldCondition(
                    key="document_id",
                    match=models.MatchAny(any=document_ids),
                )
            ]
        )
