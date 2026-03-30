from __future__ import annotations

import hashlib
import math
import uuid
from collections import Counter
from collections.abc import Callable
from typing import Any

import httpx

from app.chunking import chunk_text
from app.config import Settings
from app.liteparse_client import LiteParseClient, ParsedDocument
from app.nvidia_client import NvidiaClient
from app.qdrant_store import QdrantStore, SearchHit
from app.schemas import ChatMessage, Citation, IngestResponse, QueryResponse

ProgressCallback = Callable[[int, str], None]


class RagService:
    def __init__(
        self,
        settings: Settings,
        liteparse_client: LiteParseClient,
        nvidia_client: NvidiaClient,
        qdrant_store: QdrantStore,
    ) -> None:
        self.settings = settings
        self.liteparse_client = liteparse_client
        self.nvidia_client = nvidia_client
        self.qdrant_store = qdrant_store

    def ingest_document(
        self,
        source_path: str,
        *,
        document_id: str | None = None,
        metadata: dict[str, Any] | None = None,
        progress_callback: ProgressCallback | None = None,
    ) -> IngestResponse:
        self._report_progress(progress_callback, 10, "Parsing dokumen")
        parsed = self.liteparse_client.parse_document(source_path)
        metadata = metadata or {}
        document_id = document_id or self._make_document_id(parsed.source_path)
        sampled_profile_pages = self._sample_profile_pages(parsed)

        self._report_progress(progress_callback, 20, "Menerka judul dokumen")
        try:
            document_title = self.nvidia_client.infer_document_title(
                source_path=parsed.source_path,
                page_snippets=sampled_profile_pages,
            )
        except (httpx.HTTPError, ValueError, TypeError, KeyError):
            document_title = None

        self._report_progress(progress_callback, 30, "Menyusun chunk")
        raw_chunks: list[dict[str, Any]] = []
        for page in parsed.pages:
            page_chunks = chunk_text(
                page.text,
                chunk_size=self.settings.chunk_size,
                chunk_overlap=self.settings.chunk_overlap,
            )
            for index, text in enumerate(page_chunks):
                chunk_id = self._make_chunk_id(document_id, page.page_num, index, text)
                raw_chunks.append(
                    {
                        "chunk_id": chunk_id,
                        "document_id": document_id,
                        "source_path": parsed.source_path,
                        "page_num": page.page_num,
                        "chunk_index": index,
                        "text": text,
                        "metadata": metadata,
                    }
                )

        self._report_progress(progress_callback, 44, "Menyusun profil dokumen")
        raw_chunks.extend(
            self._build_document_profile_chunks(
                parsed,
                document_id=document_id,
                metadata=metadata,
                document_title=document_title,
                sampled_pages=sampled_profile_pages,
            )
        )

        if not raw_chunks:
            raise RuntimeError("No text chunks were produced from the document")

        self._report_progress(progress_callback, 47, "Embedding chunk")
        embeddings = self.nvidia_client.embed_texts(
            [chunk["text"] for chunk in raw_chunks],
            input_type="passage",
            progress_callback=lambda completed, total: self._report_progress(
                progress_callback,
                self._scale_progress(completed, total, start=47, end=78),
                f"Embedding chunk ({completed}/{total})",
            ),
        )
        self._report_progress(progress_callback, 82, "Menyiapkan index")
        self.qdrant_store.ensure_collection(vector_size=len(embeddings[0]))
        self.qdrant_store.delete_document(document_id)

        upsertable = []
        for chunk, embedding in zip(raw_chunks, embeddings, strict=True):
            upsertable.append({**chunk, "embedding": embedding})
        self.qdrant_store.upsert_chunks(
            upsertable,
            progress_callback=lambda completed, total: self._report_progress(
                progress_callback,
                self._scale_progress(completed, total, start=82, end=98),
                f"Menulis ke index ({completed}/{total})",
            ),
        )

        return IngestResponse(
            document_id=document_id,
            source_path=parsed.source_path,
            document_title=document_title,
            pages_indexed=len(parsed.pages),
            chunks_indexed=len(upsertable),
            collection_name=self.settings.qdrant_collection,
        )

    @staticmethod
    def _report_progress(
        progress_callback: ProgressCallback | None,
        progress_percent: int,
        progress_label: str,
    ) -> None:
        if progress_callback is not None:
            progress_callback(progress_percent, progress_label)

    @staticmethod
    def _scale_progress(completed: int, total: int, *, start: int, end: int) -> int:
        if total <= 0:
            return end
        span = max(end - start, 1)
        return min(start + math.ceil((completed / total) * span), end)

    def query(
        self,
        question: str,
        *,
        top_k: int | None = None,
        document_ids: list[str] | None = None,
        conversation_history: list[tuple[str, str]] | None = None,
    ) -> QueryResponse:
        desired_top_k = top_k or self.settings.top_k
        normalized_question = self._normalize_whitespace(question)

        # Single embedding call — no query rewrite LLM call
        query_vector = self.nvidia_client.embed_texts(
            [normalized_question], input_type="query"
        )[0]
        dense_hits = self.qdrant_store.search(
            query_vector,
            limit=desired_top_k * 8,
            document_ids=document_ids,
        )
        if not dense_hits:
            return QueryResponse(
                answer="Tidak ada konteks yang ditemukan.",
                citations=[],
                context_count=0,
            )

        # Send more context to the LLM so it can filter noise itself
        hits = dense_hits[:desired_top_k]

        context_blocks = []
        citations: list[Citation] = []
        remaining_chars = self.settings.rag_context_max_chars
        for index, hit in enumerate(hits, start=1):
            snippet = self._trim_context(
                hit.text,
                max_chars=min(
                    self.settings.rag_context_chars_per_chunk,
                    remaining_chars,
                ),
            )
            if not snippet:
                break
            context_blocks.append(
                f"[{index}] source={hit.source_path} page={hit.page_num} "
                f"document_id={hit.document_id}\n{snippet}"
            )
            citations.append(
                Citation(
                    chunk_id=hit.chunk_id,
                    document_id=hit.document_id,
                    source_path=hit.source_path,
                    page_num=hit.page_num,
                    score=hit.score,
                    text=hit.text,
                )
            )
            remaining_chars -= len(snippet)
            if remaining_chars <= 0:
                break

        try:
            answer = self.nvidia_client.answer_question(
                question,
                context_blocks,
                retrieval_query=normalized_question,
                conversation_history=conversation_history,
            )
        except httpx.TimeoutException:
            answer = (
                "Konteks ditemukan, tetapi model NVIDIA timeout saat menyusun jawaban. "
                "Periksa citation yang dikembalikan atau kecilkan top_k / konteks."
            )
        return QueryResponse(
            answer=answer,
            citations=citations,
            context_count=len(citations),
        )

    def chat(
        self,
        messages: list[ChatMessage],
        *,
        top_k: int | None = None,
        document_ids: list[str] | None = None,
    ) -> QueryResponse:
        turn_messages = [
            message
            for message in messages
            if message.role in {"user", "assistant"} and message.content.strip()
        ]
        if not turn_messages or turn_messages[-1].role != "user":
            raise ValueError("The latest chat message must be from the user")

        latest_question = turn_messages[-1].content.strip()
        conversation_history: list[tuple[str, str]] = []
        for message in turn_messages[:-1]:
            conversation_history.append((message.role, message.content.strip()))
        conversation_history = conversation_history[-6:]
        return self.query(
            latest_question,
            top_k=top_k,
            document_ids=document_ids,
            conversation_history=conversation_history,
        )

    @staticmethod
    def _make_document_id(source_path: str) -> str:
        digest = hashlib.sha1(source_path.encode("utf-8")).hexdigest()[:12]
        return f"doc-{digest}"

    @staticmethod
    def _make_chunk_id(document_id: str, page_num: int, chunk_index: int, text: str) -> str:
        basis = f"{document_id}:{page_num}:{chunk_index}:{text}"
        return str(uuid.uuid5(uuid.NAMESPACE_URL, basis))

    @classmethod
    def _trim_context(cls, text: str, max_chars: int) -> str:
        normalized = cls._normalize_whitespace(text)
        if len(normalized) <= max_chars:
            return normalized

        trimmed = normalized[:max_chars]
        split_at = trimmed.rfind(" ")
        if split_at > max_chars // 2:
            trimmed = trimmed[:split_at]
        return trimmed.rstrip() + "..."

    def _select_context_hits(
        self,
        question: str,
        *,
        retrieval_query: str,
        dense_hits: list[SearchHit],
        document_ids: list[str] | None,
        limit: int,
    ) -> list[SearchHit]:
        candidate_document_ids = document_ids or self._unique_in_order(
            hit.document_id for hit in dense_hits
        )
        candidate_hits = self.qdrant_store.scroll_chunks(document_ids=candidate_document_ids)
        if not candidate_hits:
            return dense_hits[:limit]
        hybrid_hits = self._hybrid_rank_hits(
            question,
            retrieval_query=retrieval_query,
            dense_hits=dense_hits,
            candidate_hits=candidate_hits,
            limit=max(limit * 6, 18),
        )
        profile_hits = self._document_profile_hits(
            retrieval_query,
            candidate_hits=candidate_hits,
        )
        lexical_hits = self._rank_by_lexical_query(
            retrieval_query,
            candidate_hits=candidate_hits,
            limit=max(limit * 6, 18),
        )
        rerank_pool = self._merge_hit_lists(
            profile_hits,
            hybrid_hits,
            dense_hits[: max(limit * 6, 18)],
            lexical_hits,
        )[:24]
        prioritized_pool = self._prioritize_hits_for_query(retrieval_query, rerank_pool)
        if len(prioritized_pool) <= limit:
            return prioritized_pool
        selected_hits = self._select_hits_with_model(
            question,
            candidate_hits=prioritized_pool,
            limit=limit,
        )
        if selected_hits:
            return selected_hits
        return prioritized_pool[:limit]

    def _hybrid_rank_hits(
        self,
        question: str,
        *,
        retrieval_query: str,
        dense_hits: list[SearchHit],
        candidate_hits: list[SearchHit],
        limit: int,
    ) -> list[SearchHit]:
        query_terms = self._tokenize(retrieval_query) or self._tokenize(question)
        query_term_set = set(query_terms)
        dense_ranks = {hit.chunk_id: index for index, hit in enumerate(dense_hits, start=1)}
        dense_score_map = {hit.chunk_id: hit.score for hit in dense_hits}
        dense_norm = self._normalize_score_map(dense_score_map)
        lexical_score_map = self._bm25_scores(query_terms, candidate_hits)
        lexical_norm = self._normalize_score_map(lexical_score_map)
        lexical_ranks = {
            chunk_id: index
            for index, (chunk_id, _) in enumerate(
                sorted(lexical_score_map.items(), key=lambda item: item[1], reverse=True),
                start=1,
            )
        }

        scored_hits: list[tuple[float, SearchHit]] = []
        for index, hit in enumerate(candidate_hits):
            text_term_set = set(self._tokenize(hit.text))
            lexical_overlap = 0.0
            if query_term_set:
                matched = sum(1 for term in query_term_set if term in text_term_set)
                lexical_overlap = matched / len(query_term_set)

            dense_rrf = 1 / (60 + dense_ranks[hit.chunk_id]) if hit.chunk_id in dense_ranks else 0.0
            lexical_rrf = (
                1 / (60 + lexical_ranks[hit.chunk_id]) if hit.chunk_id in lexical_ranks else 0.0
            )
            final_score = (
                (0.6 * dense_norm.get(hit.chunk_id, 0.0))
                + (0.4 * lexical_norm.get(hit.chunk_id, 0.0))
                + (0.14 * lexical_overlap)
                + dense_rrf
                + lexical_rrf
                - (index * 0.0001)
            )
            scored_hits.append(
                (
                    final_score,
                    SearchHit(
                        chunk_id=hit.chunk_id,
                        document_id=hit.document_id,
                        source_path=hit.source_path,
                        page_num=hit.page_num,
                        text=hit.text,
                        score=final_score,
                        payload=hit.payload,
                    ),
                )
            )

        scored_hits.sort(key=lambda item: item[0], reverse=True)
        return [hit for _, hit in scored_hits[:limit]]

    def _build_retrieval_queries(self, question: str) -> tuple[str, list[str]]:
        normalized_question = self._normalize_whitespace(question)
        retrieval_query = normalized_question
        queries = [normalized_question]
        try:
            rewritten = self._normalize_whitespace(self.nvidia_client.rewrite_for_search(question))
        except (httpx.HTTPError, ValueError):
            rewritten = ""
        if rewritten:
            retrieval_query = rewritten
            queries.append(rewritten)
            queries.extend(self._build_backoff_queries(rewritten))
        else:
            queries.extend(self._build_backoff_queries(normalized_question))
        return retrieval_query, self._unique_in_order(query for query in queries if query)

    def _build_backoff_queries(self, query: str) -> list[str]:
        tokens = self._tokenize(query)
        if len(tokens) < 2:
            return []

        queries = [tokens[0], " ".join(tokens[:-1])]
        if len(tokens) >= 3:
            queries.append(" ".join(tokens[: max(2, math.ceil(len(tokens) / 2))]))
        return self._unique_in_order(query for query in queries if query)

    def _search_dense_candidates(
        self,
        queries: list[str],
        *,
        document_ids: list[str] | None,
        limit: int,
    ) -> list[SearchHit]:
        merged_hits: dict[str, SearchHit] = {}
        for query in queries:
            query_vector = self.nvidia_client.embed_texts([query], input_type="query")[0]
            hits = self.qdrant_store.search(
                query_vector,
                limit=limit,
                document_ids=document_ids,
            )
            for index, hit in enumerate(hits, start=1):
                adjusted_score = hit.score + (1 / (60 + index))
                existing_hit = merged_hits.get(hit.chunk_id)
                if existing_hit is None or adjusted_score > existing_hit.score:
                    merged_hits[hit.chunk_id] = SearchHit(
                        chunk_id=hit.chunk_id,
                        document_id=hit.document_id,
                        source_path=hit.source_path,
                        page_num=hit.page_num,
                        text=hit.text,
                        score=adjusted_score,
                        payload=hit.payload,
                    )

        return sorted(merged_hits.values(), key=lambda hit: hit.score, reverse=True)

    def _rank_by_lexical_query(
        self,
        retrieval_query: str,
        *,
        candidate_hits: list[SearchHit],
        limit: int,
    ) -> list[SearchHit]:
        lexical_scores = self._bm25_scores(self._tokenize(retrieval_query), candidate_hits)
        return sorted(
            candidate_hits,
            key=lambda hit: lexical_scores.get(hit.chunk_id, 0.0),
            reverse=True,
        )[:limit]

    def _filter_hits_for_context(
        self,
        retrieval_query: str,
        hits: list[SearchHit],
    ) -> list[SearchHit]:
        prioritized_hits = self._prioritize_hits_for_query(retrieval_query, hits)
        lexical_scores = self._bm25_scores(self._tokenize(retrieval_query), prioritized_hits)
        if not lexical_scores:
            return prioritized_hits

        filtered_hits = [
            item
            for item in sorted(
                prioritized_hits,
                key=lambda hit: lexical_scores.get(hit.chunk_id, 0.0),
                reverse=True,
            )
            if lexical_scores.get(item.chunk_id, 0.0) > 0
        ]
        return filtered_hits or prioritized_hits

    def _prioritize_hits_for_query(
        self,
        retrieval_query: str,
        hits: list[SearchHit],
    ) -> list[SearchHit]:
        if not hits:
            return []

        query_terms = self._tokenize(retrieval_query)
        if not query_terms:
            return hits

        token_sets = {hit.chunk_id: set(self._tokenize(hit.text)) for hit in hits}
        present_terms = [
            term
            for term in query_terms
            if any(term in token_set for token_set in token_sets.values())
        ]
        if not present_terms:
            return hits

        term_document_counts = {
            term: sum(1 for token_set in token_sets.values() if term in token_set)
            for term in present_terms
        }
        max_anchor_frequency = max(1, min(3, math.ceil(len(hits) / 2)))
        anchor_terms = [
            term
            for term in present_terms
            if term_document_counts[term] <= max_anchor_frequency
        ]
        if not anchor_terms:
            rarest_count = min(term_document_counts.values())
            anchor_terms = [
                term for term, count in term_document_counts.items() if count == rarest_count
            ]

        anchor_hits = [
            hit
            for hit in hits
            if any(term in token_sets[hit.chunk_id] for term in anchor_terms)
        ]
        if not anchor_hits:
            return hits

        lexical_scores = self._bm25_scores(anchor_terms, anchor_hits)
        if not lexical_scores:
            return anchor_hits

        prioritized_hits = [
            item
            for item in sorted(
                anchor_hits,
                key=lambda hit: lexical_scores.get(hit.chunk_id, 0.0),
                reverse=True,
            )
            if lexical_scores.get(item.chunk_id, 0.0) > 0
        ]
        return prioritized_hits or anchor_hits

    def _document_profile_hits(
        self,
        retrieval_query: str,
        *,
        candidate_hits: list[SearchHit],
    ) -> list[SearchHit]:
        profile_kinds = {"document_profile", "document_page_count"}
        profile_hits = [
            hit
            for hit in candidate_hits
            if (hit.payload.get("metadata") or {}).get("kind") in profile_kinds
        ]
        return self._rank_by_lexical_query(
            retrieval_query,
            candidate_hits=profile_hits,
            limit=len(profile_hits),
        )

    def _select_hits_with_model(
        self,
        question: str,
        *,
        candidate_hits: list[SearchHit],
        limit: int,
    ) -> list[SearchHit]:
        if not candidate_hits:
            return []

        candidate_blocks = [
            {
                "page_num": hit.page_num,
                "text": self._trim_context(hit.text, max_chars=280),
            }
            for hit in candidate_hits
        ]
        try:
            selected_indexes = self.nvidia_client.select_relevant_chunks(
                question=question,
                candidates=candidate_blocks,
                limit=limit,
            )
        except (httpx.HTTPError, ValueError):
            return []

        selected_hits: list[SearchHit] = []
        seen_chunk_ids: set[str] = set()
        for selected_index in selected_indexes:
            hit = candidate_hits[selected_index - 1]
            if hit.chunk_id in seen_chunk_ids:
                continue
            seen_chunk_ids.add(hit.chunk_id)
            selected_hits.append(hit)
        return selected_hits

    @classmethod
    def _normalize_text(cls, text: str) -> str:
        return cls._normalize_whitespace(text).lower()

    @staticmethod
    def _normalize_whitespace(text: str) -> str:
        return " ".join(text.split()).strip()

    @classmethod
    def _tokenize(cls, text: str) -> list[str]:
        normalized = cls._normalize_text(text)
        normalized_tokens = "".join(
            character if character.isalnum() else " " for character in normalized
        )
        return [token for token in normalized_tokens.split() if token.isdigit() or len(token) > 2]

    def _build_document_profile_chunks(
        self,
        parsed: ParsedDocument,
        *,
        document_id: str,
        metadata: dict[str, Any],
        document_title: str | None = None,
        sampled_pages: list[tuple[int, str]] | None = None,
    ) -> list[dict[str, Any]]:
        if not parsed.pages:
            return []

        first_page = parsed.pages[0]
        summary_chunks: list[dict[str, Any]] = [
            {
                "chunk_id": self._make_chunk_id(
                    document_id,
                    first_page.page_num,
                    -1,
                    f"page-count:{len(parsed.pages)}",
                ),
                "document_id": document_id,
                "source_path": parsed.source_path,
                "page_num": first_page.page_num,
                "chunk_index": -1,
                "text": f"Dokumen ini memiliki {len(parsed.pages)} halaman.",
                "metadata": {**metadata, "kind": "document_page_count"},
            }
        ]

        try:
            statements = self.nvidia_client.generate_retrieval_statements(
                source_path=parsed.source_path,
                page_snippets=sampled_pages or self._sample_profile_pages(parsed),
                document_title=document_title,
            )
        except (httpx.HTTPError, ValueError, TypeError, KeyError):
            statements = []

        for index, statement in enumerate(statements, start=2):
            page_num = int(statement["page_num"])
            text = self._normalize_whitespace(str(statement["text"]))
            if not text:
                continue
            summary_chunks.append(
                {
                    "chunk_id": self._make_chunk_id(document_id, page_num, -index, text),
                    "document_id": document_id,
                    "source_path": parsed.source_path,
                    "page_num": page_num,
                    "chunk_index": -index,
                    "text": text,
                    "metadata": {**metadata, "kind": "document_profile"},
                }
            )

        return summary_chunks

    def _sample_profile_pages(self, parsed: ParsedDocument) -> list[tuple[int, str]]:
        total_pages = len(parsed.pages)
        if total_pages == 0:
            return []

        sample_count = min(total_pages, 20)
        if sample_count == 1:
            sampled_indexes = [0]
        else:
            sampled_indexes = self._unique_in_order(
                round(index * (total_pages - 1) / (sample_count - 1))
                for index in range(sample_count)
            )
        snippets: list[tuple[int, str]] = []
        for page_index in sampled_indexes:
            page = parsed.pages[page_index]
            normalized = self._normalize_whitespace(page.text)
            if len(normalized) <= 240:
                snippet = normalized
            else:
                snippet = f"{normalized[:320]} ... {normalized[-120:]}"
            snippets.append((page.page_num, snippet))
        return snippets

    @staticmethod
    def _normalize_score_map(score_map: dict[str, float]) -> dict[str, float]:
        if not score_map:
            return {}
        max_score = max(score_map.values())
        min_score = min(score_map.values())
        if math.isclose(max_score, min_score):
            return {key: 1.0 for key in score_map}
        score_span = max_score - min_score
        return {key: (value - min_score) / score_span for key, value in score_map.items()}

    def _bm25_scores(self, query_terms: list[str], hits: list[SearchHit]) -> dict[str, float]:
        if not query_terms:
            return {}

        token_counters: dict[str, Counter[str]] = {}
        document_frequencies: Counter[str] = Counter()
        total_length = 0

        for hit in hits:
            counter = Counter(self._tokenize(hit.text))
            if not counter:
                continue
            token_counters[hit.chunk_id] = counter
            total_length += sum(counter.values())
            for term in counter:
                document_frequencies[term] += 1

        document_count = len(token_counters)
        if document_count == 0:
            return {}

        average_length = total_length / document_count
        query_term_counts = Counter(query_terms)
        scores: dict[str, float] = {}
        k1 = 1.5
        b = 0.75

        for hit in hits:
            counter = token_counters.get(hit.chunk_id)
            if counter is None:
                continue

            document_length = sum(counter.values())
            score = 0.0
            for term, query_term_count in query_term_counts.items():
                term_frequency = counter.get(term, 0)
                if term_frequency == 0:
                    continue
                document_frequency = document_frequencies.get(term, 0)
                idf = math.log(
                    1 + ((document_count - document_frequency + 0.5) / (document_frequency + 0.5))
                )
                numerator = term_frequency * (k1 + 1)
                denominator = term_frequency + k1 * (
                    1 - b + (b * (document_length / average_length))
                )
                score += query_term_count * idf * (numerator / denominator)

            if score > 0:
                scores[hit.chunk_id] = score

        return scores

    @staticmethod
    def _unique_in_order(items: Any) -> list[Any]:
        seen: set[Any] = set()
        ordered: list[Any] = []
        for item in items:
            if item in seen:
                continue
            seen.add(item)
            ordered.append(item)
        return ordered

    @staticmethod
    def _merge_hit_lists(*hit_lists: list[SearchHit]) -> list[SearchHit]:
        merged: list[SearchHit] = []
        seen_chunk_ids: set[str] = set()
        for hit_list in hit_lists:
            for hit in hit_list:
                if hit.chunk_id in seen_chunk_ids:
                    continue
                seen_chunk_ids.add(hit.chunk_id)
                merged.append(hit)
        return merged

    def close(self) -> None:
        self.nvidia_client.close()
        self.qdrant_store.close()
