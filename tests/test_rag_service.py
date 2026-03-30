from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import MagicMock

from app.config import Settings
from app.qdrant_store import SearchHit
from app.rag_service import RagService


def make_settings() -> Settings:
    return Settings(
        qdrant_url=":memory:",
        qdrant_collection="documents",
        qdrant_api_key=None,
        nvidia_api_key="test-key",
        nvidia_base_url="https://example.invalid/v1",
        nvidia_chat_model="test-chat-model",
        nvidia_embed_model="test-embed-model",
        nvidia_embed_truncate="NONE",
        nvidia_chat_temperature=0.0,
        nvidia_chat_max_tokens=300,
        nvidia_timeout_seconds=30,
        liteparse_ocr_enabled=False,
        liteparse_ocr_language="en",
        liteparse_max_pages=100,
        liteparse_dpi=150,
        liteparse_target_pages=None,
        chunk_size=1200,
        chunk_overlap=200,
        top_k=3,
        rag_context_chars_per_chunk=400,
        rag_context_max_chars=1200,
        app_data_dir=Path("/tmp/lldoc-tests"),
        cors_origins=["http://localhost:5173"],
    )


def make_hit(chunk_id: str, page_num: int, text: str, *, score: float = 0.0) -> SearchHit:
    return SearchHit(
        chunk_id=chunk_id,
        document_id="doc-1",
        source_path="/tmp/document.pdf",
        page_num=page_num,
        text=text,
        score=score,
        payload={},
    )


class DummyLiteParseClient:
    pass


class DummyNvidiaClient:
    def __init__(self, *, rewrite_query: str = "") -> None:
        self.rewrite_for_search = MagicMock(return_value=rewrite_query)
        self.answer_question = MagicMock(return_value="Jawaban teruji.")

    def close(self) -> None:
        return None


class DummyQdrantStore:
    def search(self, *args: object, **kwargs: object) -> list[SearchHit]:
        raise AssertionError("query() should go through _search_dense_candidates")

    def close(self) -> None:
        return None


def make_service(
    *,
    rewrite_query: str = "",
    nvidia_client: DummyNvidiaClient | None = None,
    qdrant_store: DummyQdrantStore | None = None,
) -> RagService:
    return RagService(
        settings=make_settings(),
        liteparse_client=DummyLiteParseClient(),
        nvidia_client=nvidia_client or DummyNvidiaClient(rewrite_query=rewrite_query),
        qdrant_store=qdrant_store or DummyQdrantStore(),
    )


class RagServiceTests(unittest.TestCase):
    def test_build_retrieval_queries_adds_backoff_query(self) -> None:
        service = make_service(rewrite_query="sanksi pelanggan")

        retrieval_query, search_queries = service._build_retrieval_queries(
            "apa sangsi bagi pelanggan"
        )

        self.assertEqual(retrieval_query, "sanksi pelanggan")
        self.assertEqual(search_queries[0], "apa sangsi bagi pelanggan")
        self.assertIn("sanksi pelanggan", search_queries)
        self.assertIn("sanksi", search_queries)

    def test_filter_hits_for_context_prefers_anchor_terms(self) -> None:
        service = make_service()
        generic_hit = make_hit(
            "generic",
            63,
            "Masa sanggah atas bukti pelanggaran dalam proses lelang.",
        )
        sanction_hit = make_hit(
            "sanction",
            15,
            "Peserta lelang dikenai sanksi berupa daftar hitam selama 5 tahun.",
        )
        administrative_hit = make_hit(
            "administrative",
            44,
            "Pemegang IUP dikenakan sanksi administratif sesuai ketentuan.",
        )

        filtered_hits = service._filter_hits_for_context(
            "sanksi pelanggan",
            [generic_hit, sanction_hit, administrative_hit],
        )

        filtered_ids = {hit.chunk_id for hit in filtered_hits}
        self.assertNotIn("generic", filtered_ids)
        self.assertIn("sanction", filtered_ids)
        self.assertIn("administrative", filtered_ids)

    def test_query_uses_context_selection_pipeline(self) -> None:
        nvidia_client = DummyNvidiaClient(rewrite_query="sanksi pelanggan")
        service = make_service(nvidia_client=nvidia_client)
        generic_hit = make_hit(
            "generic",
            63,
            "Masa sanggah atas bukti pelanggaran dalam proses lelang.",
            score=0.7,
        )
        sanction_hit = make_hit(
            "sanction",
            15,
            "Peserta lelang dikenai sanksi berupa daftar hitam selama 5 tahun.",
            score=0.6,
        )

        service._build_retrieval_queries = MagicMock(
            return_value=("sanksi pelanggan", ["apa sangsi bagi pelanggan", "sanksi pelanggan"])
        )
        service._search_dense_candidates = MagicMock(return_value=[generic_hit, sanction_hit])
        service._select_context_hits = MagicMock(return_value=[generic_hit, sanction_hit])
        service._filter_hits_for_context = MagicMock(return_value=[sanction_hit])

        response = service.query("apa sangsi bagi pelanggan", document_ids=["doc-1"])

        self.assertEqual(response.answer, "Jawaban teruji.")
        self.assertEqual([citation.chunk_id for citation in response.citations], ["sanction"])
        service._search_dense_candidates.assert_called_once()
        service._select_context_hits.assert_called_once()
        nvidia_client.answer_question.assert_called_once()
        _, kwargs = nvidia_client.answer_question.call_args
        self.assertEqual(kwargs["retrieval_query"], "sanksi pelanggan")


if __name__ == "__main__":
    unittest.main()
