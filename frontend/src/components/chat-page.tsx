import { useEffect, useMemo, useRef, useState, type FC } from 'react'
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useMessage,
  type ChatModelAdapter,
} from '@assistant-ui/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { FileStack } from 'lucide-react'

import { buildApiUrl, chat, type Citation, type DocumentDetail } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Thread as AssistantThread } from '@/components/assistant-ui/thread'

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

// Context for passing citations data to message components
const CitationsContext = {
  _map: new Map<string, StoredCitations>(),
  _docs: [] as DocumentDetail[],
  set(answer: string, data: StoredCitations) {
    this._map.set(answer, data)
  },
  get(answer: string) {
    return this._map.get(answer)
  },
  setDocs(docs: DocumentDetail[]) {
    this._docs = docs
  },
  getDocLabel(documentId: string) {
    const match = this._docs.find(
      (d) => d.document.document_id === documentId,
    )
    if (!match) return documentId
    const title = match.document.title?.trim()
    if (title) {
      if (title.length <= 60) return title.replace(/\.$/, '')
      const trimmed = title.slice(0, 60)
      const splitAt = trimmed.lastIndexOf(' ')
      return `${(splitAt > 30 ? trimmed.slice(0, splitAt) : trimmed).replace(/[,:;]+$/, '')}…`
    }
    return match.document.file_name
  },
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

  // Keep citations context in sync
  const [, forceUpdate] = useState(0)
  useEffect(() => {
    CitationsContext.setDocs(documents)
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

          if (response.citations.length > 0) {
            CitationsContext.set(response.answer, {
              citations: response.citations,
              contextCount: response.context_count,
            })
            forceUpdate((n) => n + 1)
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
          <TooltipProvider>
            <AssistantRuntimeProvider runtime={runtime}>
              <AssistantThread />
            </AssistantRuntimeProvider>
          </TooltipProvider>
        )}
      </div>
    </div>
  )
}

// Citations component rendered after assistant messages
export const AssistantMessageCitations: FC = () => {
  const message = useMessage()
  const [previewCitation, setPreviewCitation] = useState<Citation | null>(null)
  const textContent = message.content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
  const stored = CitationsContext.get(textContent)

  if (!stored || stored.citations.length === 0) return null

  return (
    <>
      <div className="mx-auto mt-1 grid w-full max-w-[var(--thread-max-width)] gap-3 px-2 pb-3 xl:grid-cols-2">
        {stored.citations.map((citation) => (
          <button
            type="button"
            key={citation.chunk_id}
            className="cursor-pointer rounded-xl border border-border/70 bg-background/85 p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
            onClick={() => setPreviewCitation(citation)}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-foreground">
                {CitationsContext.getDocLabel(citation.document_id)}
              </p>
              <Badge variant="outline">p.{citation.page_num}</Badge>
            </div>
            <p className="line-clamp-4 text-sm leading-relaxed text-muted-foreground">
              {citation.text}
            </p>
            <p className="mt-2 text-xs uppercase tracking-wider text-muted-foreground">
              score {citation.score.toFixed(3)}
            </p>
          </button>
        ))}
      </div>

      <Dialog
        open={previewCitation !== null}
        onOpenChange={(open) => { if (!open) setPreviewCitation(null) }}
      >
        <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-3">
            <DialogTitle className="flex items-center justify-between gap-3">
              <span className="truncate">
                {previewCitation && CitationsContext.getDocLabel(previewCitation.document_id)}
              </span>
              {previewCitation && (
                <Badge variant="outline" className="shrink-0">
                  Halaman {previewCitation.page_num}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden px-6 pb-6">
            {previewCitation && (
              <iframe
                src={`${buildApiUrl(`/documents/${previewCitation.document_id}/download`)}#page=${previewCitation.page_num}`}
                className="h-full w-full rounded-lg border"
                title="PDF Preview"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
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
