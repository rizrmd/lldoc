from __future__ import annotations

import json
import re
from collections.abc import Callable, Sequence

import httpx

from app.config import Settings


class NvidiaClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = httpx.Client(
            base_url=self.settings.nvidia_base_url,
            timeout=self.settings.nvidia_timeout_seconds,
            headers={
                "Authorization": f"Bearer {self.settings.nvidia_api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )

    def embed_texts(
        self,
        texts: Sequence[str],
        *,
        input_type: str,
        batch_size: int = 64,
        progress_callback: Callable[[int, int], None] | None = None,
    ) -> list[list[float]]:
        if not texts:
            return []

        text_list = list(texts)
        embeddings: list[list[float]] = []
        total = len(text_list)

        for start in range(0, total, batch_size):
            batch = text_list[start : start + batch_size]
            response = self.client.post(
                "/embeddings",
                json={
                    "input": batch,
                    "model": self.settings.nvidia_embed_model,
                    "input_type": input_type,
                    "encoding_format": "float",
                    "truncate": self.settings.nvidia_embed_truncate,
                },
            )
            response.raise_for_status()
            data = response.json()
            ordered = sorted(data["data"], key=lambda item: item["index"])
            embeddings.extend(item["embedding"] for item in ordered)
            if progress_callback is not None:
                progress_callback(min(start + len(batch), total), total)

        return embeddings

    def generate_retrieval_statements(
        self,
        *,
        source_path: str,
        page_snippets: Sequence[tuple[int, str]],
        document_title: str | None = None,
    ) -> list[dict[str, int | str]]:
        if not page_snippets:
            return []

        statements: list[dict[str, int | str]] = []
        first_pages = list(page_snippets[:3])
        first_page_num = first_pages[0][0]
        first_page_blocks = "\n\n".join(
            f"[PAGE {page_num}]\n{snippet}" for page_num, snippet in first_pages
        )
        full_blocks = "\n\n".join(
            f"[PAGE {page_num}]\n{snippet}" for page_num, snippet in page_snippets
        )

        title = document_title or self.infer_document_title(
            source_path=source_path,
            page_snippets=page_snippets,
        )
        if title is not None:
            statements.append({"page_num": first_page_num, "text": title})

        topic = self._extract_profile_statement(
            prompt=(
                f"Source path: {source_path}\n\n"
                f"Cuplikan halaman awal:\n{first_page_blocks}\n\n"
                "Tulis satu kalimat singkat dalam Bahasa Indonesia tentang apa yang diatur "
                "dokumen ini. Jika tidak cukup, tulis TIDAK JELAS."
            ),
        )
        if topic is not None:
            statements.append({"page_num": first_page_num, "text": topic})

        structure = self._extract_profile_statement(
            prompt=(
                f"Source path: {source_path}\n\n"
                f"Cuplikan halaman dokumen:\n{full_blocks}\n\n"
                "Tulis satu kalimat singkat tentang fakta struktur dokumen yang paling jelas "
                "terlihat, misalnya nomor pasal terakhir yang tampak. Jika tidak cukup, "
                "tulis TIDAK JELAS."
            ),
        )
        if structure is not None:
            statements.append(
                {
                    "page_num": self._match_statement_page(structure, page_snippets),
                    "text": structure,
                }
            )

        deduped: list[dict[str, int | str]] = []
        seen_texts: set[str] = set()
        for statement in statements:
            normalized_text = self._normalize_statement(str(statement["text"]))
            if not normalized_text or normalized_text in seen_texts:
                continue
            seen_texts.add(normalized_text)
            deduped.append(statement)
        return deduped

    def infer_document_title(
        self,
        *,
        source_path: str,
        page_snippets: Sequence[tuple[int, str]],
    ) -> str | None:
        if not page_snippets:
            return None

        first_pages = list(page_snippets[:3])
        first_page_blocks = "\n\n".join(
            f"[PAGE {page_num}]\n{snippet}" for page_num, snippet in first_pages
        )
        content = self._chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Buat judul tampilan dokumen yang singkat dan mudah dipindai. "
                        "Pertahankan jenis dokumen, nomor/tahun, dan topik inti. "
                        "Gunakan hanya informasi yang benar-benar terlihat pada cuplikan. "
                        "Boleh gunakan singkatan umum seperti Permen, PP, Kepmen, Perpres, "
                        "atau UU jika membuat judul lebih ringkas. "
                        "Jangan awali dengan kata seperti Dokumen ini, Dokumen dimaksud, "
                        "atau Judul dokumen. Jika tidak cukup jelas, jawab TIDAK JELAS. "
                        "Keluarkan hanya judul tanpa penjelasan tambahan."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Source path: {source_path}\n\nCuplikan halaman awal:\n{first_page_blocks}"
                    ),
                },
            ],
            temperature=0,
            max_tokens=120,
        )
        normalized = self._normalize_statement(content)
        if not normalized or normalized == "tidak jelas":
            return None
        return self._format_document_title(content)

    @staticmethod
    def _format_document_title(title: str) -> str:
        cleaned = " ".join(title.split()).strip().rstrip(".")
        cleaned = re.sub(
            r"^(dokumen (ini|tersebut|dimaksud) (adalah|berjudul)\s+)",
            "",
            cleaned,
            flags=re.IGNORECASE,
        )
        cleaned = re.sub(
            r"^(judul (dokumen\s*)?(resmi\s*)?(adalah\s*)?)",
            "",
            cleaned,
            flags=re.IGNORECASE,
        )

        phrase_replacements = [
            ("Peraturan Menteri Energi dan Sumber Daya Mineral", "Permen ESDM"),
            ("Peraturan Menteri", "Permen"),
            ("Peraturan Pemerintah", "PP"),
            ("Keputusan Menteri", "Kepmen"),
            ("Peraturan Presiden", "Perpres"),
            ("Undang-Undang", "UU"),
            ("Peraturan Daerah", "Perda"),
            ("Peraturan Gubernur", "Pergub"),
            ("Peraturan Bupati", "Perbup"),
            ("Peraturan Wali Kota", "Perwali"),
            ("Peraturan Walikota", "Perwali"),
            ("Peraturan Pelaksanaan", "Pelaksanaan"),
            ("Kegiatan Usaha Pertambangan Mineral dan Batubara", "Usaha Pertambangan Minerba"),
        ]
        for source, replacement in phrase_replacements:
            cleaned = re.sub(source, replacement, cleaned, flags=re.IGNORECASE)

        cleaned = re.sub(
            r"\bNomor\s+(\d+)\s+Tahun\s+(\d{4})\b",
            r"\1/\2",
            cleaned,
            flags=re.IGNORECASE,
        )
        cleaned = re.sub(r"\btentang\b", ":", cleaned, count=1, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*:\s*", ": ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip(" ,;:")

        if len(cleaned) <= 96:
            return cleaned

        trimmed = cleaned[:96]
        split_at = trimmed.rfind(" ")
        if split_at > 64:
            trimmed = trimmed[:split_at]
        return trimmed.rstrip(" ,;:") + "…"

    def _extract_profile_statement(self, *, prompt: str) -> str | None:
        content = self._chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Jawab dalam Bahasa Indonesia. Gunakan hanya informasi pada cuplikan. "
                        "Jangan gunakan placeholder. Keluarkan hanya satu kalimat."
                    ),
                },
                {
                    "role": "user",
                    "content": prompt,
                },
            ],
            temperature=0,
            max_tokens=220,
        )
        normalized = self._normalize_statement(content)
        if not normalized or normalized == "tidak jelas":
            return None
        return content.strip()

    def _match_statement_page(
        self,
        statement: str,
        page_snippets: Sequence[tuple[int, str]],
    ) -> int:
        statement_terms = set(self._tokenize(statement))
        numeric_terms = {term for term in statement_terms if term.isdigit()}
        if not statement_terms:
            return page_snippets[0][0]

        best_page_num = page_snippets[0][0]
        best_score = -1.0
        for page_num, snippet in page_snippets:
            snippet_terms = set(self._tokenize(snippet))
            if not snippet_terms:
                continue
            overlap = len(statement_terms & snippet_terms)
            numeric_overlap = len(numeric_terms & snippet_terms)
            score = (overlap / len(statement_terms)) + (numeric_overlap * 2)
            if score > best_score:
                best_score = score
                best_page_num = page_num
        return best_page_num

    @classmethod
    def _tokenize(cls, text: str) -> list[str]:
        normalized = cls._normalize_statement(text)
        normalized_tokens = "".join(
            character if character.isalnum() else " " for character in normalized
        )
        return [token for token in normalized_tokens.split() if token.isdigit() or len(token) > 2]

    @staticmethod
    def _normalize_statement(text: str) -> str:
        return " ".join(text.split()).strip().lower()

    def rewrite_for_search(self, question: str) -> str:
        return self._chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Ubah pertanyaan pengguna menjadi query pencarian dokumen dalam Bahasa "
                        "Indonesia. Keluarkan hanya istilah inti 3 sampai 8 kata yang kemungkinan "
                        "muncul di dokumen. Hilangkan kata tanya, kata percakapan, deiksis "
                        "seperti ini atau itu, dan jangan memparafrasekan sebagai kalimat. "
                        "Fokus pada konsep dokumen seperti judul, topik, ruang lingkup, jumlah "
                        "pasal, lampiran, nomor, tahun, atau istilah domain yang relevan. Jangan "
                        "jawab pertanyaannya, jangan gunakan bahasa Inggris, jangan gunakan tanda "
                        "kutip, dan jangan beri penjelasan tambahan. Hindari kata generik seperti "
                        "dokumen jika ada istilah yang lebih spesifik.\n\n"
                        "Contoh:\n"
                        "Pertanyaan: ada berapa pasal?\n"
                        "Query: jumlah pasal\n\n"
                        "Pertanyaan: apa judul peraturan ini?\n"
                        "Query: judul peraturan\n\n"
                        "Pertanyaan: ini tentang apa?\n"
                        "Query: topik ruang lingkup peraturan"
                    ),
                },
                {
                    "role": "user",
                    "content": question,
                },
            ],
            temperature=0,
            max_tokens=48,
        )

    def select_relevant_chunks(
        self,
        *,
        question: str,
        candidates: Sequence[dict[str, int | str]],
        limit: int,
    ) -> list[int]:
        if not candidates:
            return []

        candidate_blocks = "\n\n".join(
            f"[{index}] page={candidate['page_num']}\n{candidate['text']}"
            for index, candidate in enumerate(candidates, start=1)
        )
        content = self._chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Pilih cuplikan yang paling langsung dan paling kuat untuk menjawab "
                        "pertanyaan pengguna. Utamakan bukti yang eksplisit dan hindari cuplikan "
                        "yang hanya memberikan konteks umum jika ada cuplikan yang lebih tepat. "
                        'Keluarkan JSON valid dengan bentuk {"selected":[1,2,3]}.'
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Pertanyaan:\n{question}\n\n"
                        f"Kandidat cuplikan:\n{candidate_blocks}\n\n"
                        f"Pilih paling banyak {limit} cuplikan."
                    ),
                },
            ],
            temperature=0,
            max_tokens=180,
        )
        payload = self._parse_json_object(content)
        raw_selected = payload.get("selected", [])
        if not isinstance(raw_selected, list):
            return []

        selected: list[int] = []
        for item in raw_selected:
            if not isinstance(item, int):
                continue
            if item < 1 or item > len(candidates):
                continue
            selected.append(item)
        return selected[:limit]

    def answer_question(
        self,
        question: str,
        context_blocks: Sequence[str],
        *,
        retrieval_query: str | None = None,
        conversation_history: Sequence[tuple[str, str]] | None = None,
    ) -> str:
        context = "\n\n".join(context_blocks)
        intent_block = ""
        if retrieval_query:
            intent_block = f"Maksud pencarian:\n{retrieval_query}\n\n"
        history_block = ""
        if conversation_history:
            history_lines = []
            for role, content in conversation_history[-6:]:
                normalized = " ".join(content.split()).strip()
                if not normalized:
                    continue
                if len(normalized) > 320:
                    normalized = normalized[:320].rstrip() + "..."
                speaker = "Pengguna" if role == "user" else "Asisten"
                history_lines.append(f"{speaker}: {normalized}")
            if history_lines:
                history_block = "Riwayat percakapan:\n" + "\n".join(history_lines) + "\n\n"
        answer = self._chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Anda adalah asisten retrieval-augmented. Jawab hanya dari konteks yang "
                        "diberikan. Jika konteks tidak cukup, katakan dengan jelas bahwa konteks "
                        "tidak cukup. Selalu jawab dalam Bahasa Indonesia. Jika memakai sumber, "
                        "gunakan citation inline seperti [1]. Jangan menulis placeholder atau "
                        "teks buatan seperti [citasi], [judul], [nomor], [placeholder], atau "
                        "bentuk serupa. Bila nama peraturan atau judul dokumen terlihat di "
                        "konteks, salin apa adanya. Gunakan riwayat percakapan hanya untuk "
                        "memahami referensi seperti ini, itu, atau lanjutan pertanyaan, bukan "
                        "sebagai sumber fakta. Jawab langsung tanpa preamble."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"{history_block}"
                        f"Question:\n{question}\n\n"
                        f"{intent_block}"
                        f"Context:\n{context}\n\n"
                        "Tulis jawaban singkat dalam Bahasa Indonesia dan pertahankan citation."
                    ),
                },
            ],
            temperature=self.settings.nvidia_chat_temperature,
            max_tokens=self.settings.nvidia_chat_max_tokens,
        )
        return self._rewrite_in_indonesian(answer)

    def _rewrite_in_indonesian(self, answer: str) -> str:
        return self._chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Tulis ulang jawaban ke Bahasa Indonesia yang natural. Jika jawaban sudah "
                        "berbahasa Indonesia, rapikan seperlunya tanpa mengubah makna. "
                        "Pertahankan citation seperti [1] apa adanya. Jangan menambah informasi "
                        "baru dan jangan menulis placeholder."
                    ),
                },
                {
                    "role": "user",
                    "content": answer,
                },
            ],
            temperature=0,
            max_tokens=self.settings.nvidia_chat_max_tokens,
        )

    def _chat_completion(
        self,
        *,
        messages: list[dict[str, str]],
        temperature: float,
        max_tokens: int,
    ) -> str:
        response = self.client.post(
            "/chat/completions",
            json={
                "model": self.settings.nvidia_chat_model,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "messages": messages,
            },
        )
        response.raise_for_status()
        body = response.json()
        return body["choices"][0]["message"]["content"].strip()

    @staticmethod
    def _parse_json_object(content: str) -> dict[str, object]:
        cleaned = content.strip()
        if cleaned.startswith("```"):
            lines = cleaned.splitlines()
            if len(lines) >= 3:
                cleaned = "\n".join(lines[1:-1]).strip()

        if not cleaned.startswith("{"):
            start = cleaned.find("{")
            end = cleaned.rfind("}")
            if start != -1 and end != -1 and end > start:
                cleaned = cleaned[start : end + 1]

        return json.loads(cleaned)

    def close(self) -> None:
        self.client.close()
