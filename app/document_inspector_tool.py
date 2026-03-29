from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any


class DocumentInspectorTool:
    def __init__(self, project_root: Path | None = None) -> None:
        self.project_root = project_root or Path(__file__).resolve().parent.parent
        self.script_path = self.project_root / "scripts" / "document_inspector.py"
        self._cache: dict[str, dict[str, Any]] = {}

    def inspect(self, source_path: str) -> dict[str, Any]:
        resolved = str(Path(source_path).expanduser().resolve())
        cached = self._cache.get(resolved)
        if cached is not None:
            return cached

        command = [sys.executable, str(self.script_path), resolved]
        result = subprocess.run(
            command,
            cwd=self.project_root,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            detail = result.stderr.strip() or result.stdout.strip()
            raise RuntimeError(f"Document inspector failed: {detail}")

        payload = json.loads(result.stdout)
        self._cache[resolved] = payload
        return payload
