import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import {
  ArrowRight,
  Bot,
  Download,
  FileClock,
  FileStack,
  LoaderCircle,
  MessageSquareText,
  RefreshCcw,
  Search,
  Send,
  Trash2,
  Upload,
} from 'lucide-react'

import {
  buildApiUrl,
  chat,
  deleteDocument,
  listDocuments,
  listJobs,
  startDocumentIngestion,
  uploadDocument,
  type Citation,
  type DocumentDetail,
  type DocumentSummary,
  type IngestionJob,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type ComposerRole = 'user' | 'assistant'
type WorkspaceView = 'files' | 'chat'

interface ConversationMessage {
  id: string
  role: ComposerRole
  content: string
  citations: Citation[]
  contextCount: number
  pending?: boolean
}

function App() {
  const [activeView, setActiveView] = useState<WorkspaceView>(() =>
    getViewFromPathname(typeof window === 'undefined' ? '/chat' : window.location.pathname),
  )
  const [documents, setDocuments] = useState<DocumentDetail[]>([])
  const [jobs, setJobs] = useState<IngestionJob[]>([])
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([])
  const [libraryQuery, setLibraryQuery] = useState('')
  const [composer, setComposer] = useState('')
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [dashboardError, setDashboardError] = useState<string | null>(null)
  const [chatError, setChatError] = useState<string | null>(null)
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([])

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const isFirstLoadRef = useRef(true)
  const deferredLibraryQuery = useDeferredValue(libraryQuery)

  const totalDocuments = documents.length
  const readyDocuments = documents.filter(
    (item) => item.document.status === 'ready',
  ).length
  const activeJobs = jobs.filter(isActiveJob).length
  const selectedDocuments = documents.filter((item) =>
    selectedDocumentIds.includes(item.document.document_id),
  )
  const selectedReadyIds = selectedDocuments
    .filter((item) => item.document.status === 'ready')
    .map((item) => item.document.document_id)
  const filteredDocuments = documents.filter((item) => {
    const query = deferredLibraryQuery.trim().toLowerCase()
    if (!query) {
      return true
    }

    const haystack = [
      item.document.title ?? '',
      item.document.file_name,
      item.document.document_id,
      item.document.status,
      item.document.collection_name ?? '',
    ]
      .join(' ')
      .toLowerCase()

    return haystack.includes(query)
  })
  const isChatView = activeView === 'chat'

  function navigateToView(view: WorkspaceView, options?: { replace?: boolean }) {
    setActiveView(view)

    if (typeof window === 'undefined') {
      return
    }

    const nextPath = getPathForView(view)
    if (normalizePathname(window.location.pathname) === nextPath) {
      return
    }

    if (options?.replace) {
      window.history.replaceState(null, '', nextPath)
      return
    }

    window.history.pushState(null, '', nextPath)
  }

  async function syncWorkspace(silent: boolean) {
    if (!silent && isFirstLoadRef.current) {
      setIsLoadingDashboard(true)
    }

    try {
      const [nextDocuments, nextJobs] = await Promise.all([listDocuments(), listJobs()])
      startTransition(() => {
        setDocuments(nextDocuments)
        setJobs(nextJobs)
        setSelectedDocumentIds((current) =>
          current.filter((documentId) =>
            nextDocuments.some((item) => item.document.document_id === documentId),
          ),
        )
      })
      setDashboardError(null)
    } catch (error) {
      setDashboardError(getErrorMessage(error))
    } finally {
      if (isFirstLoadRef.current) {
        setIsLoadingDashboard(false)
        isFirstLoadRef.current = false
      }
    }
  }

  const loadWorkspace = useEffectEvent((silent: boolean) => {
    void syncWorkspace(silent)
  })

  useEffect(() => {
    loadWorkspace(false)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const syncRoute = () => {
      setActiveView(getViewFromPathname(window.location.pathname))
    }

    const normalizedPath = normalizePathname(window.location.pathname)
    const nextView = getViewFromPathname(normalizedPath)
    if (normalizedPath !== getPathForView(nextView)) {
      window.history.replaceState(null, '', getPathForView(nextView))
    }

    window.addEventListener('popstate', syncRoute)
    return () => window.removeEventListener('popstate', syncRoute)
  }, [])

  useEffect(() => {
    if (!activeJobs) {
      return
    }

    const intervalId = window.setInterval(() => {
      loadWorkspace(true)
    }, 2500)

    return () => window.clearInterval(intervalId)
  }, [activeJobs])

  useEffect(() => {
    const viewport = chatScrollRef.current
    if (!viewport) {
      return
    }

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages])

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    if (!files.length) {
      return
    }

    setUploadingFiles(files.map((file) => file.name))
    setDashboardError(null)
    navigateToView('files')

    try {
      const responses = await Promise.all(files.map((file) => uploadDocument(file)))
      startTransition(() => {
        setSelectedDocumentIds((current) =>
          uniqueIds([
            ...current,
            ...responses.map((response) => response.document.document_id),
          ]),
        )
      })
      await syncWorkspace(true)
    } catch (error) {
      setDashboardError(getErrorMessage(error))
    } finally {
      setUploadingFiles([])
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  async function handleReingest(documentId: string) {
    try {
      await startDocumentIngestion(documentId)
      await syncWorkspace(true)
    } catch (error) {
      setDashboardError(getErrorMessage(error))
    }
  }

  async function handleDelete(documentId: string) {
    const document = documents.find((item) => item.document.document_id === documentId)
    if (!document) {
      return
    }

    const shouldDelete = window.confirm(
      `Hapus ${getDocumentTitle(document.document)} dari library dan index?`,
    )
    if (!shouldDelete) {
      return
    }

    try {
      await deleteDocument(documentId)
      startTransition(() => {
        setSelectedDocumentIds((current) =>
          current.filter((item) => item !== documentId),
        )
      })
      await syncWorkspace(true)
    } catch (error) {
      setDashboardError(getErrorMessage(error))
    }
  }

  function handleToggleDocument(documentId: string) {
    startTransition(() => {
      setSelectedDocumentIds((current) =>
        current.includes(documentId)
          ? current.filter((item) => item !== documentId)
          : [...current, documentId],
      )
    })
  }

  async function handleSendMessage() {
    const nextPrompt = composer.trim()
    if (!nextPrompt || isSending) {
      return
    }

    if (selectedDocumentIds.length > 0 && selectedReadyIds.length === 0) {
      setChatError('Dokumen terpilih belum siap di-query. Tunggu ingest selesai dahulu.')
      return
    }

    if (selectedDocumentIds.length === 0 && readyDocuments === 0) {
      setChatError('Belum ada dokumen ready. Masuk ke menu Files untuk upload atau ingest.')
      return
    }

    const userMessage: ConversationMessage = {
      id: createId(),
      role: 'user',
      content: nextPrompt,
      citations: [],
      contextCount: 0,
    }
    const pendingAssistantId = createId()

    const nextConversation = [...messages, userMessage]
    setMessages([
      ...nextConversation,
      {
        id: pendingAssistantId,
        role: 'assistant',
        content: '',
        citations: [],
        contextCount: 0,
        pending: true,
      },
    ])
    setComposer('')
    setChatError(null)
    setIsSending(true)
    navigateToView('chat')

    try {
      const response = await chat({
        messages: nextConversation.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        document_ids:
          selectedDocumentIds.length > 0 ? selectedReadyIds : undefined,
      })

      setMessages((current) =>
        current.map((message) =>
          message.id === pendingAssistantId
            ? {
                id: pendingAssistantId,
                role: 'assistant',
                content: response.answer,
                citations: response.citations,
                contextCount: response.context_count,
              }
            : message,
        ),
      )
    } catch (error) {
      const message = getErrorMessage(error)
      setChatError(message)
      setMessages((current) =>
        current.map((item) =>
          item.id === pendingAssistantId
            ? {
                id: pendingAssistantId,
                role: 'assistant',
                content: message,
                citations: [],
                contextCount: 0,
              }
            : item,
        ),
      )
    } finally {
      setIsSending(false)
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSendMessage()
    }
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files
    if (!files) {
      return
    }

    void handleFiles(files)
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault()
    setIsDraggingFiles(false)
    const files = event.dataTransfer.files
    if (!files.length) {
      return
    }

    void handleFiles(files)
  }

  return (
    <div className={cn('relative overflow-hidden', isChatView && 'h-[100dvh]')}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[18rem] bg-[radial-gradient(circle_at_top_left,rgba(244,143,48,0.23),transparent_42%),radial-gradient(circle_at_top_right,rgba(22,110,136,0.2),transparent_36%)]" />

      <main
        className={cn(
          'relative mx-auto w-full max-w-[1600px] px-4 py-4 md:px-8 md:py-8',
          isChatView ? 'h-full overflow-hidden' : 'min-h-screen',
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          onChange={handleFileInputChange}
        />

        <div
          className={
            activeView === 'files'
              ? 'grid gap-6 xl:grid-cols-[320px,minmax(0,1fr)]'
              : 'h-full min-h-0 min-w-0'
          }
        >
          {activeView === 'files' ? (
            <aside className="space-y-6">
              <Card className="glass-panel overflow-hidden border-white/60">
                <CardContent className="surface-grid relative space-y-4 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <Badge variant="outline" className="bg-white/60 text-primary">
                      LLDoc Workspace
                    </Badge>
                    <Badge variant="secondary">Files</Badge>
                  </div>

                  <nav className="grid gap-3">
                    <WorkspaceNavButton
                      active
                      icon={FileStack}
                      title="Files"
                      description={`${totalDocuments} dokumen • ${activeJobs} job aktif`}
                      badgeLabel={uploadingFiles.length > 0 ? 'Uploading' : 'Library'}
                      onClick={() => navigateToView('files')}
                    />
                    <WorkspaceNavButton
                      active={false}
                      icon={MessageSquareText}
                      title="Chat"
                      description={
                        selectedDocumentIds.length > 0
                          ? `${selectedReadyIds.length} dokumen ready terpilih`
                          : `${readyDocuments} dokumen ready tersedia`
                      }
                      badgeLabel="Conversation"
                      onClick={() => navigateToView('chat')}
                    />
                  </nav>

                  <div className="flex flex-col gap-3">
                    <Button size="lg" onClick={() => fileInputRef.current?.click()}>
                      <Upload className="h-4 w-4" />
                      Upload dokumen
                    </Button>
                    <Button
                      size="lg"
                      variant="outline"
                      onClick={() => void syncWorkspace(false)}
                    >
                      <RefreshCcw className="h-4 w-4" />
                      Refresh
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <MetricCard
                  label="Documents"
                  value={totalDocuments}
                  detail={`${readyDocuments} siap dipakai chat`}
                />
                <MetricCard
                  label="Jobs aktif"
                  value={activeJobs}
                  detail="Polling otomatis saat ingest berjalan"
                />
                <MetricCard
                  label="Selection"
                  value={selectedDocumentIds.length}
                  detail="Corpus aktif lintas menu"
                />
                <MetricCard
                  label="Backend"
                  value="API"
                  detail={buildApiUrl('/health').replace(/https?:\/\//, '')}
                />
              </div>
            </aside>
          ) : null}

          <section className={cn('min-w-0', isChatView && 'h-full')}>
            {activeView === 'files' ? (
              <FilesWorkspace
                dashboardError={dashboardError}
                documents={documents}
                filteredDocuments={filteredDocuments}
                isDraggingFiles={isDraggingFiles}
                isLoadingDashboard={isLoadingDashboard}
                jobs={jobs}
                libraryQuery={libraryQuery}
                onDelete={handleDelete}
                onDragEnter={() => setIsDraggingFiles(true)}
                onDragLeave={() => setIsDraggingFiles(false)}
                onDrop={handleDrop}
                onLibraryQueryChange={setLibraryQuery}
                onOpenChat={() => navigateToView('chat')}
                onOpenFilePicker={() => fileInputRef.current?.click()}
                onRefresh={() => void syncWorkspace(false)}
                onReingest={handleReingest}
                onToggleDocument={handleToggleDocument}
                selectedDocumentIds={selectedDocumentIds}
                uploadingFiles={uploadingFiles}
              />
            ) : (
              <ChatWorkspace
                chatError={chatError}
                chatScrollRef={chatScrollRef}
                composer={composer}
                documents={documents}
                isSending={isSending}
                messages={messages}
                onComposerChange={setComposer}
                onComposerKeyDown={handleComposerKeyDown}
                onOpenFiles={() => navigateToView('files')}
                onSendMessage={() => void handleSendMessage()}
                readyDocuments={readyDocuments}
                selectedDocumentIds={selectedDocumentIds}
                selectedDocuments={selectedDocuments}
                selectedReadyIds={selectedReadyIds}
              />
            )}
          </section>
        </div>
      </main>
    </div>
  )
}

function FilesWorkspace({
  dashboardError,
  documents,
  filteredDocuments,
  isDraggingFiles,
  isLoadingDashboard,
  jobs,
  libraryQuery,
  onDelete,
  onDragEnter,
  onDragLeave,
  onDrop,
  onLibraryQueryChange,
  onOpenChat,
  onOpenFilePicker,
  onRefresh,
  onReingest,
  onToggleDocument,
  selectedDocumentIds,
  uploadingFiles,
}: {
  dashboardError: string | null
  documents: DocumentDetail[]
  filteredDocuments: DocumentDetail[]
  isDraggingFiles: boolean
  isLoadingDashboard: boolean
  jobs: IngestionJob[]
  libraryQuery: string
  onDelete: (documentId: string) => Promise<void>
  onDragEnter: () => void
  onDragLeave: () => void
  onDrop: (event: DragEvent<HTMLButtonElement>) => void
  onLibraryQueryChange: (value: string) => void
  onOpenChat: () => void
  onOpenFilePicker: () => void
  onRefresh: () => void
  onReingest: (documentId: string) => Promise<void>
  onToggleDocument: (documentId: string) => void
  selectedDocumentIds: string[]
  uploadingFiles: string[]
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="text-3xl md:text-4xl">Files</h2>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="lg" onClick={onOpenFilePicker}>
            <Upload className="h-4 w-4" />
            Upload dokumen
          </Button>
          <Button size="lg" variant="outline" onClick={onRefresh}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
          <Button size="lg" variant="secondary" onClick={onOpenChat}>
            <MessageSquareText className="h-4 w-4" />
            Buka chat
          </Button>
        </div>
      </div>

      <div className="grid gap-6 2xl:grid-cols-[420px,minmax(0,1fr)]">
        <div className="space-y-6">
          <Card className="glass-panel border-white/60">
            <CardHeader>
              <CardTitle>Ingestion Pipeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <button
                type="button"
                className={cn(
                  'w-full rounded-[1.75rem] border border-dashed px-5 py-8 text-left transition-all',
                  isDraggingFiles
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-background/70 hover:border-primary/40 hover:bg-white/80',
                )}
                onClick={onOpenFilePicker}
                onDragEnter={onDragEnter}
                onDragLeave={onDragLeave}
                onDragOver={(event) => event.preventDefault()}
                onDrop={onDrop}
              >
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                  <Upload className={cn('h-6 w-6', isDraggingFiles && 'animate-pulse-soft')} />
                </div>
                <h3 className="text-2xl">Drop file atau klik upload</h3>
              </button>

              {uploadingFiles.length > 0 ? (
                <div className="rounded-[1.5rem] border border-border/70 bg-background/80 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                    Mengunggah file
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {uploadingFiles.map((fileName) => (
                      <Badge key={fileName} variant="secondary">
                        {fileName}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={libraryQuery}
                    onChange={(event) => onLibraryQueryChange(event.target.value)}
                    placeholder="Cari file, document id, atau status"
                    className="pl-11"
                  />
                </div>

                {dashboardError ? (
                  <div className="rounded-[1.4rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {dashboardError}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card className="glass-panel border-white/60">
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>Recent Jobs</CardTitle>
              </div>
              <Badge variant="secondary">{jobs.length}</Badge>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {jobs.length === 0 ? (
                  <EmptyState icon={FileClock} title="Belum ada job" />
                ) : (
                  jobs.slice(0, 6).map((job) => {
                    const linkedDocument = documents.find(
                      (item) => item.document.document_id === job.document_id,
                    )

                    return (
                      <div
                        key={job.job_id}
                        className="rounded-[1.5rem] border border-border/70 bg-background/80 p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              {linkedDocument
                                ? getDocumentTitle(linkedDocument.document)
                                : job.document_id}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                              {linkedDocument ? <span>{linkedDocument.document.file_name}</span> : null}
                              <span>{job.job_id}</span>
                            </div>
                          </div>
                          <StatusBadge
                            status={job.status}
                            kind="job"
                            progressPercent={job.progress_percent}
                          />
                        </div>
                        <p className="mt-3 text-sm text-muted-foreground">
                          {describeJob(job)}
                        </p>
                        {isActiveJob(job) ? (
                          <ProgressMeter
                            className="mt-4"
                            label={job.progress_label}
                            percent={job.progress_percent}
                          />
                        ) : null}
                      </div>
                    )
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="glass-panel border-white/60">
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <CardTitle>Document Library</CardTitle>
            <Badge variant="outline">{filteredDocuments.length} item</Badge>
          </CardHeader>
          <CardContent>
            <div className="max-h-[980px] space-y-3 overflow-y-auto pr-1">
              {isLoadingDashboard ? (
                <LibraryPlaceholder />
              ) : filteredDocuments.length === 0 ? (
                <EmptyState icon={FileStack} title="Belum ada dokumen" />
              ) : (
                filteredDocuments.map((item) => {
                  const { document, latest_job: latestJob } = item
                  const isSelected = selectedDocumentIds.includes(document.document_id)

                  return (
                    <article
                      key={document.document_id}
                      className={cn(
                        'rounded-[1.6rem] border p-4 transition-all',
                        isSelected
                          ? 'border-primary/40 bg-primary/5'
                          : 'border-border/70 bg-background/75',
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => onToggleDocument(document.document_id)}
                          aria-label={`Select ${getDocumentTitle(document)}`}
                          className="mt-1"
                        />

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-foreground">
                                {getDocumentTitle(document)}
                              </p>
                              <p className="mt-1 text-xs tracking-[0.08em] text-muted-foreground">
                                {document.file_name}
                              </p>
                              <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                                {document.document_id}
                              </p>
                            </div>
                            <StatusBadge
                              status={document.status}
                              progressPercent={latestJob?.progress_percent}
                            />
                          </div>

                          <p className="mt-3 text-sm leading-7 text-muted-foreground">
                            {describeDocument(item)}
                          </p>
                          {document.status === 'ingesting' && latestJob ? (
                            <ProgressMeter
                              className="mt-4"
                              label={latestJob.progress_label}
                              percent={latestJob.progress_percent}
                            />
                          ) : null}

                          {document.last_error ? (
                            <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                              {document.last_error}
                            </p>
                          ) : null}

                          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>{formatBytes(document.size_bytes)}</span>
                            <span className="text-border">•</span>
                            <span>{formatDateTime(document.updated_at)}</span>
                            {latestJob ? (
                              <>
                                <span className="text-border">•</span>
                                <span>Job {latestJob.status}</span>
                              </>
                            ) : null}
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" asChild>
                              <a
                                href={buildApiUrl(
                                  document.download_url ??
                                    `/documents/${document.document_id}/download`,
                                )}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <Download className="h-3.5 w-3.5" />
                                Download
                              </a>
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void onReingest(document.document_id)}
                              disabled={document.status === 'ingesting'}
                            >
                              <RefreshCcw className="h-3.5 w-3.5" />
                              Re-ingest
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                              onClick={() => void onDelete(document.document_id)}
                              disabled={document.status === 'ingesting'}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                    </article>
                  )
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function ChatWorkspace({
  chatError,
  chatScrollRef,
  composer,
  documents,
  isSending,
  messages,
  onComposerChange,
  onComposerKeyDown,
  onOpenFiles,
  onSendMessage,
  readyDocuments,
  selectedDocumentIds,
  selectedDocuments,
  selectedReadyIds,
}: {
  chatError: string | null
  chatScrollRef: RefObject<HTMLDivElement | null>
  composer: string
  documents: DocumentDetail[]
  isSending: boolean
  messages: ConversationMessage[]
  onComposerChange: (value: string) => void
  onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onOpenFiles: () => void
  onSendMessage: () => void
  readyDocuments: number
  selectedDocumentIds: string[]
  selectedDocuments: DocumentDetail[]
  selectedReadyIds: string[]
}) {
  const hasReadyCorpus =
    selectedDocumentIds.length > 0 ? selectedReadyIds.length > 0 : readyDocuments > 0

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto,minmax(0,1fr)] gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="text-3xl md:text-4xl">Chat</h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
          <div className="flex flex-wrap gap-2">
            {selectedDocuments.length === 0 ? (
              <Badge variant="outline">{readyDocuments} dokumen ready</Badge>
            ) : (
              selectedDocuments.map((item) => (
                <Badge
                  key={item.document.document_id}
                  variant={item.document.status === 'ready' ? 'default' : 'secondary'}
                >
                  {getDocumentTitle(item.document)}
                </Badge>
              ))
            )}
          </div>
          <Button size="lg" variant="outline" onClick={onOpenFiles}>
            <FileStack className="h-4 w-4" />
            Buka files
          </Button>
        </div>
      </div>

      <Card className="glass-panel h-full min-h-0 border-white/60">
        <div className="flex h-full min-h-0 flex-col">
          <CardHeader className="border-b border-border/80 pb-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <CardTitle>LLM Chat</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  {selectedDocumentIds.length > 0
                    ? `${selectedReadyIds.length} dokumen ready terpilih`
                    : `${readyDocuments} dokumen ready global`}
                </Badge>
                {!hasReadyCorpus ? (
                  <Badge variant="secondary">Belum ada corpus ready</Badge>
                ) : null}
              </div>
            </div>
          </CardHeader>

          <div
            ref={chatScrollRef}
            className="flex-1 space-y-5 overflow-y-auto px-5 py-6 md:px-7"
          >
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  'animate-rise',
                  message.role === 'user' ? 'flex justify-end' : 'flex justify-start',
                )}
              >
                <div
                  className={cn(
                    'space-y-3',
                    message.role === 'user' ? 'w-full max-w-[38rem]' : 'w-full max-w-[72rem]',
                  )}
                >
                  {message.pending ? (
                    <div className="inline-flex w-fit items-center justify-center rounded-full border border-border/80 bg-white/90 px-5 py-4 shadow-soft">
                      <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
                    </div>
                  ) : (
                    <div
                      className={cn(
                        'rounded-[1.9rem] border',
                        message.role === 'user'
                          ? 'border-primary/30 bg-primary px-5 py-4 text-primary-foreground shadow-soft'
                          : 'border-border/80 bg-white/92 px-6 py-5 shadow-[0_24px_60px_-36px_rgba(20,42,74,0.35)]',
                      )}
                    >
                      {message.role === 'assistant' ? (
                        <div className="mb-4 flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                            <Bot className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              Assistant
                            </p>
                            <p className="text-sm font-semibold text-foreground">Jawaban</p>
                          </div>
                        </div>
                      ) : null}
                      <p
                        className={cn(
                          'whitespace-pre-wrap text-[15px] leading-7',
                          message.role === 'user'
                            ? 'text-primary-foreground'
                            : 'text-foreground',
                        )}
                      >
                        {message.content}
                      </p>
                    </div>
                  )}

                  {message.role === 'assistant' && message.citations.length > 0 ? (
                    <div className="grid gap-3 xl:grid-cols-2">
                      {message.citations.map((citation) => (
                        <div
                          key={citation.chunk_id}
                          className="rounded-[1.5rem] border border-border/70 bg-background/85 p-4"
                        >
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-foreground">
                              {getDocumentLabel(documents, citation.document_id)}
                            </p>
                            <Badge variant="outline">p.{citation.page_num}</Badge>
                          </div>
                          <p className="line-clamp-5 text-sm leading-7 text-muted-foreground">
                            {citation.text}
                          </p>
                          <p className="mt-3 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                            context {message.contextCount} • score {citation.score.toFixed(3)}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-border/80 px-5 py-5 md:px-7">
            {chatError ? (
              <div className="mb-4 rounded-[1.4rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {chatError}
              </div>
            ) : null}

            {!hasReadyCorpus ? (
              <div className="mb-4 rounded-[1.5rem] border border-dashed border-border/80 bg-background/70 p-5">
                <p className="text-sm leading-7 text-muted-foreground">Belum ada dokumen ready.</p>
                <Button className="mt-4" variant="secondary" onClick={onOpenFiles}>
                  <ArrowRight className="h-4 w-4" />
                  Buka files
                </Button>
              </div>
            ) : null}

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr),auto] lg:items-end">
              <Textarea
                value={composer}
                onChange={(event) => onComposerChange(event.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder="Tulis pertanyaan. Enter untuk kirim."
                disabled={!hasReadyCorpus}
                rows={2}
                className="min-h-[72px] resize-none rounded-[1.4rem] px-4 py-2.5"
              />
              <Button
                size="default"
                onClick={onSendMessage}
                disabled={isSending || !composer.trim() || !hasReadyCorpus}
                className="self-end px-5"
              >
                {isSending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Kirim pertanyaan
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

function WorkspaceNavButton({
  active,
  badgeLabel,
  description,
  icon,
  onClick,
  title,
}: {
  active: boolean
  badgeLabel: string
  description: string
  icon: typeof FileStack
  onClick: () => void
  title: string
}) {
  const Icon = icon

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-[1.6rem] border px-5 py-4 text-left transition-all',
        active
          ? 'border-primary/40 bg-primary/10 shadow-soft'
          : 'border-border/70 bg-background/75 hover:border-primary/30 hover:bg-white/85',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'mt-1 flex h-11 w-11 items-center justify-center rounded-2xl',
              active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground',
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>
        </div>
        <Badge variant={active ? 'default' : 'outline'}>{badgeLabel}</Badge>
      </div>
    </button>
  )
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string
  value: number | string
  detail: string
}) {
  return (
    <div className="rounded-[1.7rem] border border-white/80 bg-white/85 p-5 shadow-soft">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-4 font-display text-4xl text-foreground">{value}</p>
      <p className="mt-2 text-sm leading-7 text-muted-foreground">{detail}</p>
    </div>
  )
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: typeof FileStack
  title: string
  description?: string
}) {
  const Icon = icon

  return (
    <div className="rounded-[1.5rem] border border-dashed border-border/80 bg-background/75 px-5 py-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-xl">{title}</h3>
      {description ? (
        <p className="mt-2 text-sm leading-7 text-muted-foreground">{description}</p>
      ) : null}
    </div>
  )
}

function LibraryPlaceholder() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="animate-pulse rounded-[1.5rem] border border-border/60 bg-background/70 p-4"
        >
          <div className="h-4 w-2/3 rounded-full bg-secondary" />
          <div className="mt-3 h-3 w-full rounded-full bg-secondary/80" />
          <div className="mt-2 h-3 w-4/5 rounded-full bg-secondary/60" />
        </div>
      ))}
    </div>
  )
}

function StatusBadge(props: {
  status: string
  kind?: 'document' | 'job'
  progressPercent?: number
}) {
  if (props.status === 'ready' || props.status === 'completed') {
    return <Badge variant="success">Ready</Badge>
  }

  if (props.status === 'failed') {
    return <Badge variant="destructive">Failed</Badge>
  }

  if (props.status === 'queued') {
    return (
      <Badge variant="secondary">
        {props.progressPercent != null
          ? `Queued ${normalizeProgressPercent(props.progressPercent)}%`
          : 'Queued'}
      </Badge>
    )
  }

  if (props.status === 'ingesting' || props.status === 'running') {
    return (
      <Badge variant="default">
        {(props.kind === 'job' ? 'Running' : 'Ingesting') +
          ` ${normalizeProgressPercent(props.progressPercent ?? 0)}%`}
      </Badge>
    )
  }

  return <Badge variant="secondary">{props.status}</Badge>
}

function describeDocument(item: DocumentDetail) {
  const { document, latest_job: latestJob } = item

  if (document.status === 'ready') {
    return `${document.pages_indexed} halaman dan ${document.chunks_indexed} chunk sudah terindeks di ${document.collection_name}.`
  }

  if (document.status === 'failed') {
    return latestJob?.error_message ?? 'Job ingest terakhir gagal. Dokumen bisa di-ingest ulang.'
  }

  if (document.status === 'ingesting') {
    return latestJob?.progress_label ?? 'Sedang ingest.'
  }

  return 'Dokumen tersimpan, tetapi belum siap di-query.'
}

function describeJob(job: IngestionJob) {
  if (job.status === 'completed' && job.result) {
    return `${job.result.pages_indexed} halaman dan ${job.result.chunks_indexed} chunk berhasil diindeks.`
  }

  if (job.status === 'failed') {
    return job.error_message ?? 'Job selesai dengan kegagalan yang tidak diketahui.'
  }

  if (job.status === 'running') {
    return job.progress_label
  }

  if (job.status === 'queued') {
    return job.progress_label
  }

  return 'Job masuk antrean dan akan dijalankan oleh backend.'
}

function ProgressMeter(props: { className?: string; label: string; percent: number }) {
  const percent = normalizeProgressPercent(props.percent)

  return (
    <div className={cn('space-y-2', props.className)}>
      <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <span>{props.label}</span>
        <span>{percent}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary/80">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

function getDocumentLabel(documents: DocumentDetail[], documentId: string) {
  const match = documents.find((item) => item.document.document_id === documentId)
  return match ? getDocumentTitle(match.document) : documentId
}

function getDocumentTitle(document: DocumentSummary) {
  const title = document.title?.trim()
  if (title) {
    return formatDocumentTitle(title)
  }

  if (document.status === 'ingesting') {
    return 'Menerka judul dokumen'
  }

  return 'Judul belum tersedia'
}

function formatDocumentTitle(title: string) {
  let cleaned = title.trim().replace(/\.$/, '')
  cleaned = cleaned.replace(
    /^(dokumen (ini|tersebut|dimaksud) (adalah|berjudul)\s+)/i,
    '',
  )
  cleaned = cleaned.replace(
    /^(judul (dokumen\s*)?(resmi\s*)?(adalah\s*)?)/i,
    '',
  )

  const replacements: Array<[RegExp, string]> = [
    [/Peraturan Menteri Energi dan Sumber Daya Mineral/gi, 'Permen ESDM'],
    [/Peraturan Menteri/gi, 'Permen'],
    [/Peraturan Pemerintah/gi, 'PP'],
    [/Keputusan Menteri/gi, 'Kepmen'],
    [/Peraturan Presiden/gi, 'Perpres'],
    [/Undang-Undang/gi, 'UU'],
    [/Peraturan Daerah/gi, 'Perda'],
    [/Peraturan Gubernur/gi, 'Pergub'],
    [/Peraturan Bupati/gi, 'Perbup'],
    [/Peraturan Wali Kota/gi, 'Perwali'],
    [/Peraturan Walikota/gi, 'Perwali'],
    [/Peraturan Pelaksanaan/gi, 'Pelaksanaan'],
    [/Kegiatan Usaha Pertambangan Mineral dan Batubara/gi, 'Usaha Pertambangan Minerba'],
    [/\bNomor\s+(\d+)\s+Tahun\s+(\d{4})\b/gi, '$1/$2'],
  ]
  for (const [pattern, replacement] of replacements) {
    cleaned = cleaned.replace(pattern, replacement)
  }

  cleaned = cleaned.replace(/\btentang\b/i, ': ')
  cleaned = cleaned.replace(/\s*:\s*/g, ': ')
  cleaned = cleaned.replace(/\s+/g, ' ').trim().replace(/[,:;]+$/, '')

  if (cleaned.length <= 96) {
    return cleaned
  }

  const trimmed = cleaned.slice(0, 96)
  const splitAt = trimmed.lastIndexOf(' ')
  return `${(splitAt > 64 ? trimmed.slice(0, splitAt) : trimmed).replace(/[,:;]+$/, '')}…`
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`
  }

  const units = ['KB', 'MB', 'GB']
  let size = value / 1024
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'Terjadi kesalahan yang tidak dikenal.'
}

function uniqueIds(values: string[]) {
  return Array.from(new Set(values))
}

function createId() {
  return `msg-${Math.random().toString(36).slice(2, 10)}`
}

function isActiveJob(job: IngestionJob) {
  return job.status === 'queued' || job.status === 'running'
}

function normalizePathname(pathname: string) {
  const normalized = pathname.replace(/\/+$/, '')
  return normalized || '/'
}

function getViewFromPathname(pathname: string): WorkspaceView {
  return normalizePathname(pathname) === '/files' ? 'files' : 'chat'
}

function getPathForView(view: WorkspaceView) {
  return view === 'files' ? '/files' : '/chat'
}

function normalizeProgressPercent(value: number) {
  return Math.max(0, Math.min(Math.round(value), 100))
}

export default App
