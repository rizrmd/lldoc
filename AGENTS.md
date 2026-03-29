# Repository Guidelines

## Project Structure & Module Organization

`app/` contains the Python application code: FastAPI entrypoints in `app/main.py`, CLI commands in `app/cli.py`, and service/client modules for chunking, parsing, Qdrant, and NVIDIA NIM integration. `scripts/` holds local helper scripts, including the LiteParse Node wrapper. `documents/` contains sample input files such as `documents/download.pdf`. Root config lives in `pyproject.toml`, `package.json`, `.env.example`, and `docker-compose.yml`.

There is no dedicated `tests/` directory yet. If you add one, mirror the `app/` layout so test ownership stays obvious.

## Build, Test, and Development Commands

- `npm install`: install Node dependencies for LiteParse support.
- `uv sync`: install Python dependencies and dev tools.
- `docker compose up -d`: start local Qdrant.
- `uv run uvicorn app.main:app --reload`: run the API locally.
- `uv run python -m app.cli ingest documents/download.pdf`: parse and index the sample PDF.
- `uv run python -m app.cli chat`: start the interactive RAG CLI.
- `uv run ruff format .`: format Python code.
- `uv run ruff check .`: run lint checks.
- `uv run ty check`: run static type checks.

## Coding Style & Naming Conventions

Use 4-space indentation, explicit type hints, and small focused modules. Follow Python naming norms: `snake_case` for functions/variables, `PascalCase` for classes, and short descriptive module names. Keep integration boundaries clear: parsing logic in `liteparse_client.py`, retrieval logic in `rag_service.py`, storage in `qdrant_store.py`, and model calls in `nvidia_client.py`.

## Testing Guidelines

Current quality gates are linting, typing, and smoke testing. Before opening a PR, run `uv run ruff check .` and `uv run ty check`, then verify ingest/query behavior against `documents/download.pdf`. For new automated tests, use `test_*.py` naming and place them under `tests/`.

## Commit & Pull Request Guidelines

The existing history uses short imperative subjects, for example `Initial commit`. Keep commits scoped and written in the same style, such as `Add hybrid retrieval reranking`. PRs should include:

- a short summary of behavior changes
- any config or model changes
- verification commands you ran
- sample CLI/API output when retrieval or answer quality changes

## Security & Configuration Tips

Never commit `.env`, live API keys, or local Qdrant data. Use `.env.example` for required variables. For quick local checks without Docker, `QDRANT_URL=:memory:` is acceptable, but persistent testing should use the Docker Qdrant service.
