from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

from app.config import Settings


@dataclass(frozen=True)
class ParsedPage:
    page_num: int
    width: float
    height: float
    text: str


@dataclass(frozen=True)
class ParsedDocument:
    source_path: str
    text: str
    pages: list[ParsedPage]


class LiteParseClient:
    def __init__(self, settings: Settings, project_root: Path | None = None) -> None:
        self.settings = settings
        self.project_root = project_root or Path(__file__).resolve().parent.parent
        self.script_path = self.project_root / "scripts" / "liteparse_parse.mjs"

    def parse_document(self, source_path: str) -> ParsedDocument:
        resolved = Path(source_path).expanduser().resolve()
        if not resolved.exists():
            raise FileNotFoundError(f"Document not found: {resolved}")

        env = os.environ.copy()
        env["LITEPARSE_OCR_ENABLED"] = "true" if self.settings.liteparse_ocr_enabled else "false"
        env["LITEPARSE_OCR_LANGUAGE"] = self.settings.liteparse_ocr_language
        env["LITEPARSE_MAX_PAGES"] = str(self.settings.liteparse_max_pages)
        env["LITEPARSE_DPI"] = str(self.settings.liteparse_dpi)
        if self.settings.liteparse_target_pages:
            env["LITEPARSE_TARGET_PAGES"] = self.settings.liteparse_target_pages

        command = ["node", str(self.script_path), str(resolved)]
        result = subprocess.run(
            command,
            cwd=self.project_root,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            detail = result.stderr.strip() or result.stdout.strip()
            raise RuntimeError(f"LiteParse failed: {detail}")

        payload = json.loads(result.stdout)
        pages = [
            ParsedPage(
                page_num=int(page["pageNum"]),
                width=float(page["width"]),
                height=float(page["height"]),
                text=page["text"],
            )
            for page in payload["pages"]
        ]
        return ParsedDocument(
            source_path=payload["sourcePath"],
            text=payload["text"],
            pages=pages,
        )
