import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useMessage,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  type ChatModelAdapter,
} from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowUp, FileStack } from 'lucide-react'

import { chat, type Citation, type DocumentDetail } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'

interface ChatPageProps {
  documents: DocumentDetail[]
  selectedDocumentIds: string[]
  onToggleDocument: (documentId: string) => void
  onOpenFiles: () => void
}

interface StoredCitations {
  citations: Citation[]
  contextCount: number
}

export function ChatPage({
  documents,
  selectedDocumentIds,
  onToggleDocument,
  onOpenFiles,
}: ChatPageProps) {
  const readyDocuments = documents.filter(
    (d) => d.document.status === 'ready',
  )
  const selectedReadyIds = documents
    .filter(
      (d) =>
        selectedDocumentIds.includes(d.document.document_id) &&
        d.document.status === 'ready',
    )
    .map((d) => d.document.document_id)

  const selectedIdsRef = useRef(selectedDocumentIds)
  const selectedReadyIdsRef = useRef(selectedReadyIds)
  useEffect(() => {
    selectedIdsRef.current = selectedDocumentIds
    selectedReadyIdsRef.current = selectedReadyIds
  }, [selectedDocumentIds, selectedReadyIds])

  // Store citations keyed by assistant message content hash
  const [citationsMap, setCitationsMap] = useState<Map<string, StoredCitations>>(
    () => new Map(),
  )
  const documentsRef = useRef(documents)
  useEffect(() => {
    documentsRef.current = documents
  }, [documents])

  const adapter: ChatModelAdapter = useMemo(
    () => ({
      async run({ messages, abortSignal }) {
        const currentSelectedIds = selectedIdsRef.current
        const currentReadyIds = selectedReadyIdsRef.current

        const payload = {
          messages: messages.map((msg) => ({
            role: msg.role as 'user' | 'assistant' | 'system',
            content: msg.content
              .map((part) => (part.type === 'text' ? part.text : ''))
              .join(''),
          })),
          document_ids:
            currentSelectedIds.length > 0 ? currentReadyIds : undefined,
        }

        const controller = new AbortController()
        const handleAbort = () => controller.abort()
        abortSignal.addEventListener('abort', handleAbort)

        try {
          const response = await chat(payload)

          // Store citations for this response
          if (response.citations.length > 0) {
            setCitationsMap((prev) => {
              const next = new Map(prev)
              next.set(response.answer, {
                citations: response.citations,
                contextCount: response.context_count,
              })
              return next
            })
          }

          return {
            content: [{ type: 'text' as const, text: response.answer }],
          }
        } finally {
          abortSignal.removeEventListener('abort', handleAbort)
        }
      },
    }),
    [],
  )

  const runtime = useLocalRuntime(adapter)

  const hasReadyCorpus =
    selectedDocumentIds.length > 0
      ? selectedReadyIds.length > 0
      : readyDocuments.length > 0

  const getCitations = useCallback(
    (text: string) => citationsMap.get(text),
    [citationsMap],
  )

  const getDocLabel = useCallback(
    (documentId: string) => {
      const match = documentsRef.current.find(
        (d) => d.document.document_id === documentId,
      )
      if (!match) return documentId
      return getDocumentTitle(match.document)
    },
    [],
  )

  return (
    <div className="flex h-full flex-col">
      {/* Document selector bar */}
      <div className="flex items-center gap-3 border-b border-border/60 px-5 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Corpus
        </span>
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {readyDocuments.length === 0 ? (
            <Badge variant="secondary">Belum ada dokumen ready</Badge>
          ) : selectedDocumentIds.length === 0 ? (
            <Badge variant="outline">
              Semua {readyDocuments.length} dokumen ready
            </Badge>
          ) : (
            readyDocuments.map((item) => {
              const isSelected = selectedDocumentIds.includes(
                item.document.document_id,
              )
              return (
                <label
                  key={item.document.document_id}
                  className={cn(
                    'flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    isSelected
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border/60 bg-background/60 text-muted-foreground hover:border-primary/30',
                  )}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() =>
                      onToggleDocument(item.document.document_id)
                    }
                    className="h-3 w-3"
                  />
                  {getDocumentTitle(item.document)}
                </label>
              )
            })
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={onOpenFiles}>
          <FileStack className="h-4 w-4" />
          Files
        </Button>
      </div>

      {/* Chat area */}
      <div className="relative flex-1 overflow-hidden">
        {!hasReadyCorpus ? (
          <div className="flex h-full items-center justify-center p-8">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
                <FileStack className="h-6 w-6" />
              </div>
              <h3 className="font-display text-xl">Belum ada dokumen ready</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Upload dan ingest dokumen terlebih dahulu.
              </p>
              <Button className="mt-4" variant="secondary" onClick={onOpenFiles}>
                Buka Files
              </Button>
            </div>
          </div>
        ) : (
          <AssistantRuntimeProvider runtime={runtime}>
            <ThreadPrimitive.Root className="flex h-full flex-col">
              <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-3xl px-4 py-8">
                  <ThreadPrimitive.Empty>
                    <div className="flex flex-col items-center gap-3 py-16 text-center">
                      <h3 className="font-display text-2xl text-foreground">
                        LLDoc Chat
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Tanya seputar dokumen yang sudah diindeks.
                      </p>
                    </div>
                  </ThreadPrimitive.Empty>

                  <ThreadPrimitive.Messages
                    components={{
                      UserMessage,
                      AssistantMessage: () => (
                        <AssistantMessage
                          getCitations={getCitations}
                          getDocLabel={getDocLabel}
                        />
                      ),
                    }}
                  />
                </div>
              </ThreadPrimitive.Viewport>

              <div className="border-t border-border/60 bg-card/40 backdrop-blur-sm">
                <div className="mx-auto w-full max-w-3xl px-4 py-4">
                  <ComposerPrimitive.Root className="flex items-end gap-3 rounded-[1.4rem] border border-border/80 bg-card/90 px-4 py-3 shadow-soft focus-within:ring-2 focus-within:ring-ring">
                    <ComposerPrimitive.Input
                      placeholder="Tulis pertanyaan..."
                      rows={1}
                      autoFocus
                      className="min-h-[36px] flex-1 resize-none border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                    />
                    <ComposerPrimitive.Send className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40">
                      <ArrowUp className="h-4 w-4" />
                    </ComposerPrimitive.Send>
                  </ComposerPrimitive.Root>
                </div>
              </div>
            </ThreadPrimitive.Root>
          </AssistantRuntimeProvider>
        )}
      </div>
    </div>
  )
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="mb-4 flex justify-end">
      <div className="max-w-[38rem] rounded-[1.6rem] border border-primary/30 bg-primary px-5 py-4 text-primary-foreground shadow-soft">
        <MessagePrimitive.Content
          components={{
            Text: ({ text }) => (
              <p className="whitespace-pre-wrap text-[15px] leading-7">
                {text}
              </p>
            ),
          }}
        />
      </div>
    </MessagePrimitive.Root>
  )
}

function AssistantMessage({
  getCitations,
  getDocLabel,
}: {
  getCitations: (text: string) => StoredCitations | undefined
  getDocLabel: (documentId: string) => string
}) {
  const message = useMessage()
  const textContent = message.content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
  const stored = getCitations(textContent)

  return (
    <MessagePrimitive.Root className="mb-6 flex justify-start">
      <div className="w-full max-w-[56rem] space-y-3">
        <div className="rounded-[1.9rem] border border-border/80 bg-white/92 px-6 py-5 shadow-[0_24px_60px_-36px_rgba(20,42,74,0.35)]">
          <MessagePrimitive.If assistant>
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <ArrowUp className="h-3.5 w-3.5 rotate-45" />
              </div>
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Assistant
              </span>
            </div>
          </MessagePrimitive.If>
          <MessagePrimitive.Content
            components={{
              Text: MarkdownText,
            }}
          />
        </div>

        {stored && stored.citations.length > 0 && (
          <div className="grid gap-3 xl:grid-cols-2">
            {stored.citations.map((citation) => (
              <div
                key={citation.chunk_id}
                className="rounded-[1.5rem] border border-border/70 bg-background/85 p-4"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground">
                    {getDocLabel(citation.document_id)}
                  </p>
                  <Badge variant="outline">p.{citation.page_num}</Badge>
                </div>
                <p className="line-clamp-5 text-sm leading-7 text-muted-foreground">
                  {citation.text}
                </p>
                <p className="mt-3 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  context {stored.contextCount} | score{' '}
                  {citation.score.toFixed(3)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </MessagePrimitive.Root>
  )
}

function MarkdownText() {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      className="prose prose-sm max-w-none text-foreground prose-headings:font-display prose-headings:text-foreground prose-p:leading-7 prose-a:text-primary prose-code:rounded prose-code:bg-secondary prose-code:px-1.5 prose-code:py-0.5 prose-code:text-foreground prose-pre:bg-secondary/80 prose-pre:text-foreground"
      smooth
    />
  )
}

function getDocumentTitle(document: {
  title: string | null
  file_name: string
}) {
  const title = document.title?.trim()
  if (title) {
    let cleaned = title.replace(/\.$/, '')
    if (cleaned.length > 60) {
      const trimmed = cleaned.slice(0, 60)
      const splitAt = trimmed.lastIndexOf(' ')
      cleaned = `${(splitAt > 30 ? trimmed.slice(0, splitAt) : trimmed).replace(/[,:;]+$/, '')}…`
    }
    return cleaned
  }
  return document.file_name
}
