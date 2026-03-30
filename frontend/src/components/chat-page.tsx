import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
} from 'react'
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useMessage,
  type ChatModelAdapter,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { FileStack, LoaderCircle } from 'lucide-react'

import {
  buildApiUrl,
  chat,
  getConversation,
  type Citation,
  type ConversationMessage,
  type ConversationSummary,
  type DocumentDetail,
} from '@/lib/api'
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
import { PdfViewer } from '@/components/pdf-viewer'

interface ChatPageProps {
  documents: DocumentDetail[]
  selectedDocumentIds: string[]
  activeConversationId: string | null
  onToggleDocument: (documentId: string) => void
  onOpenFiles: () => void
  onConversationChange: (conversation: ConversationSummary) => void
}

interface StoredCitations {
  citations: Citation[]
  contextCount: number
}

const DocumentsContext = createContext<DocumentDetail[]>([])

export function ChatPage({
  documents,
  selectedDocumentIds,
  activeConversationId,
  onToggleDocument,
  onOpenFiles,
  onConversationChange,
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

  const [conversationLoadState, setConversationLoadState] = useState<
    'idle' | 'loading' | 'error'
  >('idle')

  const selectedIdsRef = useRef(selectedDocumentIds)
  const selectedReadyIdsRef = useRef(selectedReadyIds)
  const activeConversationIdRef = useRef(activeConversationId)
  const skipConversationLoadRef = useRef<string | null>(null)
  selectedIdsRef.current = selectedDocumentIds
  selectedReadyIdsRef.current = selectedReadyIds
  activeConversationIdRef.current = activeConversationId

  const adapter: ChatModelAdapter = useMemo(
    () => ({
      async run({ messages, abortSignal, unstable_assistantMessageId }) {
        const currentSelectedIds = selectedIdsRef.current
        const currentReadyIds = selectedReadyIdsRef.current
        const currentConversationId = activeConversationIdRef.current

        const payload = {
          conversation_id: currentConversationId ?? undefined,
          messages: messages
            .map((message) => ({
              role: message.role as 'user' | 'assistant' | 'system',
              content: getMessageText(message.content),
              message_id: message.id,
              created_at: message.createdAt.toISOString(),
              ...(message.role === 'assistant'
                ? {
                    citations: getStoredCitations(message.metadata.custom)
                      .citations,
                    context_count: getStoredCitations(message.metadata.custom)
                      .contextCount,
                  }
                : {}),
            }))
            .filter((message) => message.content.length > 0),
          document_ids:
            currentSelectedIds.length > 0 ? currentReadyIds : undefined,
        }

        const controller = new AbortController()
        const handleAbort = () => controller.abort()
        abortSignal.addEventListener('abort', handleAbort)

        try {
          const response = await chat(payload, {
            signal: controller.signal,
          })
          skipConversationLoadRef.current = response.conversation.conversation_id
          onConversationChange(response.conversation)

          return {
            content: [{ type: 'text' as const, text: response.answer }],
            metadata: {
              custom: {
                citations: response.citations,
                contextCount: response.context_count,
                conversationId: response.conversation.conversation_id,
                assistantMessageId: unstable_assistantMessageId,
              },
            },
          }
        } finally {
          abortSignal.removeEventListener('abort', handleAbort)
        }
      },
    }),
    [onConversationChange],
  )

  const runtime = useLocalRuntime(adapter)

  useEffect(() => {
    let isCancelled = false

    function safeReset(messages: ThreadMessageLike[]) {
      try {
        runtime.thread.reset(messages)
      } catch {
        // Ignore if thread is not yet initialized (empty thread placeholder)
      }
    }

    async function loadConversationHistory(conversationId: string) {
      setConversationLoadState('loading')
      safeReset([])

      try {
        const detail = await getConversation(conversationId)
        if (isCancelled) return
        safeReset(detail.messages.map(toThreadMessage))
        setConversationLoadState('idle')
      } catch {
        if (isCancelled) return
        safeReset([])
        setConversationLoadState('error')
      }
    }

    if (!activeConversationId) {
      safeReset([])
      setConversationLoadState('idle')
      return () => {
        isCancelled = true
      }
    }

    if (skipConversationLoadRef.current === activeConversationId) {
      skipConversationLoadRef.current = null
      setConversationLoadState('idle')
      return () => {
        isCancelled = true
      }
    }

    void loadConversationHistory(activeConversationId)
    return () => {
      isCancelled = true
    }
  }, [activeConversationId, runtime])

  const hasReadyCorpus =
    selectedDocumentIds.length > 0
      ? selectedReadyIds.length > 0
      : readyDocuments.length > 0
  const canRenderThread = hasReadyCorpus || activeConversationId !== null

  return (
    <div className="flex h-full flex-col">
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

      <div className="relative flex-1 overflow-hidden">
        {!canRenderThread ? (
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
          <DocumentsContext.Provider value={documents}>
            <TooltipProvider>
              <AssistantRuntimeProvider runtime={runtime}>
                <AssistantThread />
              </AssistantRuntimeProvider>
            </TooltipProvider>
          </DocumentsContext.Provider>
        )}

        {conversationLoadState === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card px-4 py-2 text-sm text-muted-foreground shadow-sm">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Memuat percakapan...
            </div>
          </div>
        )}

        {conversationLoadState === 'error' && (
          <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center px-4">
            <div className="rounded-full border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              Gagal memuat conversation history.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export const AssistantMessageCitations: FC = () => {
  const documents = useContext(DocumentsContext)
  const message = useMessage()
  const [previewCitation, setPreviewCitation] = useState<Citation | null>(null)
  const stored = getStoredCitations(message.metadata.custom)

  if (stored.citations.length === 0) return null

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
                {getDocumentLabel(documents, citation.document_id)}
              </p>
              <Badge variant="outline">p.{citation.page_num}</Badge>
            </div>
            <p className="line-clamp-4 text-sm leading-relaxed text-muted-foreground">
              {citation.text}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Relevansi {Math.min(Math.round(citation.score * 100), 100)}%
            </p>
          </button>
        ))}
      </div>

      <Dialog
        open={previewCitation !== null}
        onOpenChange={(open) => { if (!open) setPreviewCitation(null) }}
      >
        <DialogContent className="flex h-[85vh] max-w-4xl flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-3">
            <DialogTitle className="flex items-center justify-between gap-3">
              <span className="truncate">
                {previewCitation &&
                  getDocumentLabel(documents, previewCitation.document_id)}
              </span>
              {previewCitation && (
                <Badge variant="outline" className="shrink-0">
                  Halaman {previewCitation.page_num}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            {previewCitation && (
              <PdfViewer
                url={buildApiUrl(`/documents/${previewCitation.document_id}/download`)}
                initialPage={previewCitation.page_num}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function toThreadMessage(message: ConversationMessage): ThreadMessageLike {
  const storedMetadata = {
    citations: message.citations,
    contextCount: message.context_count,
  }

  if (message.role === 'assistant') {
    return {
      id: message.message_id,
      role: 'assistant',
      content: message.content,
      createdAt: new Date(message.created_at),
      status: { type: 'complete', reason: 'stop' },
      metadata: {
        custom: storedMetadata,
      },
    }
  }

  return {
    id: message.message_id,
    role: 'user',
    content: message.content,
    createdAt: new Date(message.created_at),
  }
}

function getStoredCitations(
  custom: Record<string, unknown> | undefined,
): StoredCitations {
  const citations = Array.isArray(custom?.citations)
    ? (custom.citations as Citation[])
    : []
  const contextCount =
    typeof custom?.contextCount === 'number' ? custom.contextCount : 0
  return {
    citations,
    contextCount,
  }
}

function getMessageText(
  parts: readonly {
    type: string
    text?: string
  }[],
) {
  return parts
    .map((part) => (part.type === 'text' ? (part.text ?? '') : ''))
    .join('')
    .trim()
}

function getDocumentLabel(documents: DocumentDetail[], documentId: string) {
  const match = documents.find((d) => d.document.document_id === documentId)
  if (!match) return documentId
  const title = match.document.title?.trim()
  if (title) {
    if (title.length <= 60) return title.replace(/\.$/, '')
    const trimmed = title.slice(0, 60)
    const splitAt = trimmed.lastIndexOf(' ')
    return `${(splitAt > 30 ? trimmed.slice(0, splitAt) : trimmed).replace(/[,:;]+$/, '')}…`
  }
  return match.document.file_name
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
