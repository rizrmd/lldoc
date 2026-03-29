from __future__ import annotations

import argparse
import json

from app.main import build_service


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="LiteParse + Qdrant + NVIDIA RAG CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    ingest_parser = subparsers.add_parser("ingest", help="Parse and index a document")
    ingest_parser.add_argument("source_path")
    ingest_parser.add_argument("--document-id")

    query_parser = subparsers.add_parser("query", help="Ask a question against indexed documents")
    query_parser.add_argument("question")
    query_parser.add_argument("--top-k", type=int)
    query_parser.add_argument("--document-id", action="append", dest="document_ids")

    chat_parser = subparsers.add_parser("chat", help="Start an interactive RAG chat session")
    chat_parser.add_argument("--top-k", type=int)
    chat_parser.add_argument("--document-id", action="append", dest="document_ids")

    subparsers.add_parser("health", help="Check basic startup")
    return parser


def run_chat(*, top_k: int | None, document_ids: list[str] | None) -> None:
    service = build_service()
    print("Interactive RAG chat. Type /quit to exit.")
    if document_ids:
        print(f"Filtering documents: {', '.join(document_ids)}")
    print()

    while True:
        try:
            question = input("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if not question:
            continue
        if question.lower() in {"/quit", "/exit", "quit", "exit"}:
            break
        if question.lower() == "/help":
            print("Commands: /help, /quit, /exit")
            print()
            continue

        result = service.query(
            question,
            top_k=top_k,
            document_ids=document_ids,
        )
        print(f"assistant> {result.answer}")
        if result.citations:
            source_summary = "; ".join(
                f"[{index}] p.{citation.page_num} score={citation.score:.3f}"
                for index, citation in enumerate(result.citations, start=1)
            )
            print(f"sources> {source_summary}")
        print()


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "ingest":
        service = build_service()
        result = service.ingest_document(
            args.source_path,
            document_id=args.document_id,
        )
        print(result.model_dump_json(indent=2))
        return

    if args.command == "query":
        service = build_service()
        result = service.query(
            args.question,
            top_k=args.top_k,
            document_ids=args.document_ids,
        )
        print(result.model_dump_json(indent=2))
        return

    if args.command == "chat":
        run_chat(
            top_k=args.top_k,
            document_ids=args.document_ids,
        )
        return

    if args.command == "health":
        print(json.dumps({"status": "ok"}, indent=2))


if __name__ == "__main__":
    main()
