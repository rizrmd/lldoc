# LiteParse + Qdrant + NVIDIA NIM RAG

Backend RAG + frontend workspace untuk:

- parsing dokumen dengan `@llamaindex/liteparse`
- vector store dengan `Qdrant`
- embeddings dan jawaban LLM lewat endpoint OpenAI-compatible `NVIDIA`
- chat dokumen via React + shadcn-style UI
- conversation history persisten untuk web chat
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
- `GET /conversations`
- `GET /conversations/{conversation_id}`
- `DELETE /conversations/{conversation_id}`
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

Riwayat chat sekarang disimpan di backend pada `APP_DATA_DIR` yang sama dengan registry dokumen, sehingga percakapan terakhir bisa dimuat ulang setelah refresh atau restart aplikasi.

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
- chat: `microsoft/phi-3-mini-4k-instruct` (production, ~5s response)

Model chat bisa diganti via environment variable `NVIDIA_CHAT_MODEL`. Model yang sudah ditest:

| Model | Speed | Kualitas | Catatan |
|-------|-------|----------|---------|
| `microsoft/phi-3-mini-4k-instruct` | ~4s | Cukup baik | Default production, paling cepat |
| `nvidia/nemotron-mini-4b-instruct` | ~5s | Cukup baik | Alternatif cepat |
| `qwen/qwen2.5-7b-instruct` | ~25s | Baik | Terlalu lambat untuk free tier |
| `moonshotai/kimi-k2-instruct` | Timeout | Sangat baik | Tidak stabil di NIM free tier |

## Deployment

### Docker Compose (Self-hosted)

```bash
# 1. Siapkan environment
cp .env.example .env
# Edit .env, isi NVIDIA_API_KEY

# 2. Build dan jalankan
docker compose up --build -d

# 3. Akses
# Frontend: http://localhost:3000
# API: http://localhost:8000
# Qdrant: http://localhost:6333
```

File `docker-compose.yml` mendefinisikan 3 service:
- **qdrant** — vector database, data persisten di named volume
- **api** — FastAPI backend, membaca `.env` untuk konfigurasi
- **frontend** — React app di-serve oleh Nginx, proxy `/api/` ke backend

### Environment Variables

**Backend (`.env`):**

| Variable | Wajib | Default | Keterangan |
|----------|-------|---------|------------|
| `NVIDIA_API_KEY` | Ya | — | API key dari build.nvidia.com |
| `NVIDIA_CHAT_MODEL` | Tidak | `nvidia/nemotron-mini-4b-instruct` | Model chat LLM |
| `NVIDIA_CHAT_MAX_TOKENS` | Tidak | `300` | Max token jawaban |
| `QDRANT_URL` | Tidak | `http://localhost:6333` | URL Qdrant |
| `APP_DATA_DIR` | Tidak | `data` | Direktori penyimpanan dokumen & metadata |
| `CORS_ORIGINS` | Tidak | `http://localhost:5173,...` | Comma-separated allowed origins |

**Frontend (build-time args):**

| Variable | Default | Keterangan |
|----------|---------|------------|
| `VITE_API_BASE_URL` | `""` (production: `/api`) | Override URL backend |
| `VITE_APP_PASSWORD` | `""` (tanpa password) | Password untuk akses frontend |

### Coolify Deployment

Project ini menggunakan `docker-compose.coolify.yml` untuk deploy di [Coolify](https://coolify.io/).

**Setup di Coolify:**

1. Buat resource baru > Docker Compose
2. Pilih repository GitHub: `rizrmd/lldoc`
3. Set compose file ke `/docker-compose.coolify.yml`
4. Tambahkan environment variables di Coolify dashboard:
   - `NVIDIA_API_KEY` — wajib
   - `VITE_APP_PASSWORD` — password frontend (default: `rahasiakita123`)
   - `CORS_ORIGINS` — domain production (default: `https://aidoc.avolut.com`)
5. Deploy

**Perbedaan `docker-compose.coolify.yml` vs `docker-compose.yml`:**

- Tidak expose port (Coolify/Caddy handle routing)
- `NVIDIA_API_KEY` dibaca dari Coolify environment (`${NVIDIA_API_KEY}`)
- `NVIDIA_CHAT_MODEL` dan `NVIDIA_CHAT_MAX_TOKENS` di-set langsung
- `VITE_APP_PASSWORD` di-pass sebagai build arg dengan default value
- Tidak ada `env_file` (semua via Coolify env)

**Trigger redeploy manual via SSH:**

```bash
ssh user@server "docker exec coolify php artisan tinker --execute=\"
\\\$app = App\\\Models\\\Application::find(APP_ID);
\\\$uuid = (string) new Visus\\\Cuid2\\\Cuid2(7);
queue_application_deployment(
  application: \\\$app,
  deployment_uuid: \\\$uuid,
  force_rebuild: true,
  no_questions_asked: true,
);
echo \\\$uuid;
\""
```

Ganti `APP_ID` dengan ID aplikasi di Coolify (cek di database atau URL dashboard).

**Cek status deploy:**

```bash
ssh user@server "docker exec coolify php artisan tinker --execute=\"
echo App\\\Models\\\ApplicationDeploymentQueue::where('deployment_uuid','DEPLOY_UUID')->first()->status;
\""
```

### Password Protection

Frontend dilindungi password sederhana berbasis `sessionStorage`. Password di-embed ke JavaScript bundle saat build time via `VITE_APP_PASSWORD`.

- Jika `VITE_APP_PASSWORD` kosong atau tidak di-set: tidak ada password gate
- Jika di-set: user harus input password sebelum bisa akses app
- Logout menghapus session, user harus input password lagi
- Password ini **bukan** pengganti autentikasi sesungguhnya — hanya gate sederhana

### Arsitektur Production

```
Browser → Cloudflare/CDN → Caddy (Coolify) → Nginx (frontend container)
                                                  ├── Static files (React SPA)
                                                  └── /api/* → FastAPI (api container)
                                                                  └── Qdrant (vector DB)
                                                                  └── NVIDIA NIM API (embeddings + LLM)
```

Data persisten disimpan di Docker named volumes:
- `qdrant_storage` — vector index
- `app_data` — dokumen upload, metadata JSON, conversation history
