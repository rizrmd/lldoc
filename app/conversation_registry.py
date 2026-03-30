from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock

from pydantic import BaseModel, Field

from app.schemas import ConversationDetail, ConversationMessage, ConversationSummary


class ConversationRecord(BaseModel):
    conversation_id: str
    title: str
    document_ids: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    messages: list[ConversationMessage] = Field(default_factory=list)


class ConversationState(BaseModel):
    conversations: dict[str, ConversationRecord] = Field(default_factory=dict)


class ConversationRegistry:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.registry_path = self.data_dir / "conversations.json"
        self._lock = Lock()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._state = self._load_state()

    def list_conversations(self, *, limit: int | None = 50) -> list[ConversationSummary]:
        with self._lock:
            conversations = sorted(
                self._state.conversations.values(),
                key=lambda item: item.updated_at,
                reverse=True,
            )
            if limit is not None:
                conversations = conversations[:limit]
            return [self._build_summary(record) for record in conversations]

    def get_conversation(self, conversation_id: str) -> ConversationDetail | None:
        with self._lock:
            record = self._state.conversations.get(conversation_id)
            if record is None:
                return None
            return self._build_detail(record)

    def sync_conversation(
        self,
        *,
        conversation_id: str | None,
        messages: list[ConversationMessage],
        document_ids: list[str] | None = None,
    ) -> ConversationDetail:
        now = self._utc_now()
        cleaned_messages = [
            message.model_copy(deep=True) for message in messages if message.content.strip()
        ]
        normalized_document_ids = list(dict.fromkeys(document_ids or []))

        with self._lock:
            existing = (
                self._state.conversations.get(conversation_id)
                if conversation_id is not None
                else None
            )
            next_id = conversation_id or f"conv-{uuid.uuid4().hex[:12]}"
            title = self._make_title(cleaned_messages)
            if existing is not None and not title:
                title = existing.title

            record = ConversationRecord(
                conversation_id=next_id,
                title=title or "Percakapan baru",
                document_ids=normalized_document_ids,
                created_at=existing.created_at if existing is not None else now,
                updated_at=now,
                messages=cleaned_messages,
            )
            self._state.conversations[next_id] = record
            self._persist_locked()
            return self._build_detail(record)

    def delete_conversation(self, conversation_id: str) -> ConversationDetail:
        with self._lock:
            record = self._state.conversations.pop(conversation_id, None)
            if record is None:
                raise KeyError(conversation_id)
            self._persist_locked()
            return self._build_detail(record)

    def _load_state(self) -> ConversationState:
        if not self.registry_path.exists():
            return ConversationState()
        return ConversationState.model_validate_json(self.registry_path.read_text(encoding="utf-8"))

    def _persist_locked(self) -> None:
        self.registry_path.write_text(
            self._state.model_dump_json(indent=2),
            encoding="utf-8",
        )

    def _build_detail(self, record: ConversationRecord) -> ConversationDetail:
        return ConversationDetail(
            conversation=self._build_summary(record),
            messages=[message.model_copy(deep=True) for message in record.messages],
        )

    def _build_summary(self, record: ConversationRecord) -> ConversationSummary:
        last_message = record.messages[-1] if record.messages else None
        return ConversationSummary(
            conversation_id=record.conversation_id,
            title=record.title,
            document_ids=list(record.document_ids),
            created_at=record.created_at,
            updated_at=record.updated_at,
            message_count=len(record.messages),
            last_message_preview=(
                self._make_preview(last_message.content) if last_message is not None else None
            ),
        )

    @classmethod
    def _make_title(cls, messages: list[ConversationMessage]) -> str | None:
        for message in messages:
            if message.role != "user":
                continue
            preview = cls._make_preview(message.content, max_chars=72)
            if preview:
                return preview
        return None

    @staticmethod
    def _make_preview(content: str, *, max_chars: int = 96) -> str:
        normalized = " ".join(content.split()).strip()
        if len(normalized) <= max_chars:
            return normalized
        trimmed = normalized[:max_chars]
        split_at = trimmed.rfind(" ")
        if split_at > max_chars // 2:
            trimmed = trimmed[:split_at]
        return trimmed.rstrip(" ,;:") + "…"

    @staticmethod
    def _utc_now() -> datetime:
        return datetime.now(UTC)
