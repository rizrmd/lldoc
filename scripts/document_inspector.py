from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def extract_title(first_page_text: str) -> str | None:
    lines = [normalize(line) for line in first_page_text.splitlines()]
    lines = [line for line in lines if line]

    started = False
    collected: list[str] = []
    stop_markers = ("DENGAN RAHMAT", "Menimbang", "MEMUTUSKAN")

    for line in lines:
        if any(marker in line for marker in stop_markers):
            break
        if not started and "PERATURAN" in line:
            started = True
        if started:
            collected.append(line)

    if not collected:
        return None
    return normalize(" ".join(collected))


def inspect_document(source_path: str) -> dict[str, Any]:
    from app.config import get_settings
    from app.liteparse_client import LiteParseClient

    parsed = LiteParseClient(get_settings()).parse_document(source_path)
    pasal_headings: list[dict[str, Any]] = []

    for page in parsed.pages:
        for line in page.text.splitlines():
            match = re.match(r"^\s*Pasal\s+(\d+)\s*$", line)
            if not match:
                continue
            pasal_number = int(match.group(1))
            pasal_headings.append(
                {
                    "number": pasal_number,
                    "page_num": page.page_num,
                    "page_excerpt": normalize(page.text)[:500],
                }
            )

    unique_pasal = []
    seen_numbers: set[int] = set()
    for heading in pasal_headings:
        if heading["number"] in seen_numbers:
            continue
        seen_numbers.add(heading["number"])
        unique_pasal.append(heading)

    first_pasal = unique_pasal[0] if unique_pasal else None
    last_pasal = unique_pasal[-1] if unique_pasal else None
    first_page = parsed.pages[0] if parsed.pages else None

    return {
        "source_path": str(Path(source_path).resolve()),
        "page_count": len(parsed.pages),
        "title": extract_title(first_page.text if first_page else ""),
        "title_page_num": first_page.page_num if first_page else None,
        "title_page_excerpt": normalize(first_page.text)[:500] if first_page else "",
        "pasal_count": len(unique_pasal),
        "pasal_first": first_pasal,
        "pasal_last": last_pasal,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect a document and emit structured stats")
    parser.add_argument("source_path")
    args = parser.parse_args()
    print(json.dumps(inspect_document(args.source_path)))


if __name__ == "__main__":
    main()
