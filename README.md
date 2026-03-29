# LiteParse + Qdrant + NVIDIA NIM RAG

Backend RAG + frontend workspace untuk:

- parsing dokumen dengan `@llamaindex/liteparse`
- vector store dengan `Qdrant`
- embeddings dan jawaban LLM lewat endpoint OpenAI-compatible `NVIDIA`
- chat dokumen via React + shadcn-style UI
- file management dengan upload, re-ingest, delete, download
- async document ingestion dengan status polling

## Arsitektur

1. Dokumen diparse lokal oleh LiteParse.
2. Tiap halaman dipecah menjadi chunk teks.
3. Chunk di-embed dengan `nvidia/nv-embedqa-e5-v5` memakai `input_type=passage`.
4. Embedding disimpan ke Qdrant.
5. Pertanyaan user di-embed dengan model yang sama memakai `input_type=query`.
6. Top-k hasil retrieval dipakai sebagai konteks untuk `chat/completions` NVIDIA.

## Prasyarat

- `uv`
- Node.js 18+
- Docker / Docker Compose

Catatan LiteParse:

- PDF berjalan lokal tanpa cloud dependency.
- Untuk `docx`, `pptx`, `xlsx`, dan format Office lain, install LibreOffice.
- Untuk image parsing, install ImageMagick.

## Setup

```bash
cp .env.example .env
npm install
uv sync
docker compose up -d qdrant
```

Untuk frontend:

```bash
cd frontend
npm install
```

Isi `.env` minimal dengan `NVIDIA_API_KEY`.

Jika Docker belum jalan dan Anda tetap ingin test lokal cepat, set:

```bash
QDRANT_URL=:memory:
```

Mode ini tetap memakai `QdrantClient`, tetapi in-memory dan tidak persisten.

Untuk Docker di macOS/OrbStack, project ini memakai named volume Qdrant agar tidak kena warning FUSE dari bind mount host path.

## Menjalankan API

```bash
uv run uvicorn app.main:app --reload
```

Endpoint utama:

- `GET /health`
- `POST /ingest`
- `POST /query`
- `POST /chat`
- `GET /documents`
- `POST /documents/upload`
- `POST /documents/{document_id}/ingest`
- `DELETE /documents/{document_id}`
- `GET /documents/{document_id}/download`
- `GET /jobs`

## Menjalankan Frontend

```bash
cd frontend
npm run dev
```

Secara default frontend memanggil `http://127.0.0.1:8000`. Jika perlu, override dengan:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000
```

## Menjalankan Full Stack Dengan Docker Compose

Setelah `.env` diisi, jalankan:

```bash
docker compose up --build
```

Akses service:

- frontend: `http://localhost:3000`
- API: `http://localhost:8000`
- Qdrant: `http://localhost:6333`

## Menjalankan CLI

```bash
uv run python -m app.cli ingest /path/to/file.pdf
uv run python -m app.cli query "Apa isi dokumen ini?"
uv run python -m app.cli chat
```

## Quality Checks

```bash
uv run ruff format .
uv run ruff check .
uv run ty check
cd frontend && npm run lint
cd frontend && npm run build
```

## Contoh Request

Ingest:

```bash
curl -X POST http://127.0.0.1:8000/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "source_path": "/absolute/path/to/document.pdf"
  }'
```

Query:

```bash
curl -X POST http://127.0.0.1:8000/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Ringkas isi dokumen ini"
  }'
```

## Model NVIDIA

Default project ini memakai:

- embedding: `nvidia/nv-embedqa-e5-v5`
- chat: `nvidia/nemotron-mini-4b-instruct`

Embeddings dipanggil ke:

- `POST https://integrate.api.nvidia.com/v1/embeddings`

Chat dipanggil ke:

- `POST https://integrate.api.nvidia.com/v1/chat/completions`
