import {
  type ChangeEvent,
  type DragEvent,
  useDeferredValue,
  useRef,
  useState,
} from 'react'
import {
  Download,
  FileClock,
  FileStack,
  LoaderCircle,
  RefreshCcw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'

import {
  buildApiUrl,
  deleteDocument,
  startDocumentIngestion,
  uploadDocument,
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

interface FilesPageProps {
  documents: DocumentDetail[]
  jobs: IngestionJob[]
  selectedDocumentIds: string[]
  onToggleDocument: (documentId: string) => void
  onWorkspaceSync: () => Promise<void>
  onDocumentsUploaded: (documentIds: string[]) => void
}

export function FilesPage({
  documents,
  jobs,
  selectedDocumentIds,
  onToggleDocument,
  onWorkspaceSync,
  onDocumentsUploaded,
}: FilesPageProps) {
  const [libraryQuery, setLibraryQuery] = useState('')
  const [dashboardError, setDashboardError] = useState<string | null>(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const deferredLibraryQuery = useDeferredValue(libraryQuery)

  const filteredDocuments = documents.filter((item) => {
    const query = deferredLibraryQuery.trim().toLowerCase()
    if (!query) return true
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

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    if (!files.length) return

    setUploadingFiles(files.map((f) => f.name))
    setDashboardError(null)

    try {
      const responses = await Promise.all(files.map((f) => uploadDocument(f)))
      onDocumentsUploaded(responses.map((r) => r.document.document_id))
      await onWorkspaceSync()
    } catch (error) {
      setDashboardError(getErrorMessage(error))
    } finally {
      setUploadingFiles([])
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleReingest(documentId: string) {
    try {
      await startDocumentIngestion(documentId)
      await onWorkspaceSync()
    } catch (error) {
      setDashboardError(getErrorMessage(error))
    }
  }

  async function handleDelete(documentId: string) {
    const doc = documents.find(
      (d) => d.document.document_id === documentId,
    )
    if (!doc) return

    const shouldDelete = window.confirm(
      `Hapus ${getDocumentTitle(doc.document)} dari library dan index?`,
    )
    if (!shouldDelete) return

    try {
      await deleteDocument(documentId)
      await onWorkspaceSync()
    } catch (error) {
      setDashboardError(getErrorMessage(error))
    }
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault()
    setIsDraggingFiles(false)
    if (event.dataTransfer.files.length) void handleFiles(event.dataTransfer.files)
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void handleFiles(event.target.files)
  }

  return (
    <div className="h-full overflow-y-auto">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        onChange={handleFileInputChange}
      />

      <div className="mx-auto max-w-[1400px] space-y-6 p-5 md:p-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="font-display text-3xl md:text-4xl">Files</h2>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button size="lg" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              Upload dokumen
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => void onWorkspaceSync()}
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid gap-6 2xl:grid-cols-[420px,minmax(0,1fr)]">
          {/* Left column: Upload + Jobs */}
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
                  onClick={() => fileInputRef.current?.click()}
                  onDragEnter={() => setIsDraggingFiles(true)}
                  onDragLeave={() => setIsDraggingFiles(false)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                >
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                    <Upload
                      className={cn(
                        'h-6 w-6',
                        isDraggingFiles && 'animate-pulse-soft',
                      )}
                    />
                  </div>
                  <h3 className="font-display text-2xl">
                    Drop file atau klik upload
                  </h3>
                </button>

                {uploadingFiles.length > 0 && (
                  <div className="rounded-[1.5rem] border border-border/70 bg-background/80 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                      <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                      Mengunggah file
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {uploadingFiles.map((name) => (
                        <Badge key={name} variant="secondary">
                          {name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={libraryQuery}
                      onChange={(e) => setLibraryQuery(e.target.value)}
                      placeholder="Cari file, document id, atau status"
                      className="pl-11"
                    />
                  </div>

                  {dashboardError && (
                    <div className="rounded-[1.4rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {dashboardError}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="glass-panel border-white/60">
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <CardTitle>Recent Jobs</CardTitle>
                <Badge variant="secondary">{jobs.length}</Badge>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {jobs.length === 0 ? (
                    <EmptyState icon={FileClock} title="Belum ada job" />
                  ) : (
                    jobs.slice(0, 6).map((job) => {
                      const linkedDoc = documents.find(
                        (d) => d.document.document_id === job.document_id,
                      )
                      return (
                        <div
                          key={job.job_id}
                          className="rounded-[1.5rem] border border-border/70 bg-background/80 p-4"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-foreground">
                                {linkedDoc
                                  ? getDocumentTitle(linkedDoc.document)
                                  : job.document_id}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                                {linkedDoc && (
                                  <span>
                                    {linkedDoc.document.file_name}
                                  </span>
                                )}
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
                          {isActiveJob(job) && (
                            <ProgressMeter
                              className="mt-4"
                              label={job.progress_label}
                              percent={job.progress_percent}
                            />
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right column: Document Library */}
          <Card className="glass-panel border-white/60">
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <CardTitle>Document Library</CardTitle>
              <Badge variant="outline">{filteredDocuments.length} item</Badge>
            </CardHeader>
            <CardContent>
              <div className="max-h-[980px] space-y-3 overflow-y-auto pr-1">
                {documents.length === 0 ? (
                  <EmptyState icon={FileStack} title="Belum ada dokumen" />
                ) : filteredDocuments.length === 0 ? (
                  <EmptyState
                    icon={Search}
                    title="Tidak ditemukan"
                    description="Coba kata kunci lain"
                  />
                ) : (
                  filteredDocuments.map((item) => {
                    const { document, latest_job: latestJob } = item
                    const isSelected = selectedDocumentIds.includes(
                      document.document_id,
                    )

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
                            onCheckedChange={() =>
                              onToggleDocument(document.document_id)
                            }
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
                                progressPercent={
                                  latestJob?.progress_percent
                                }
                              />
                            </div>

                            <p className="mt-3 text-sm leading-7 text-muted-foreground">
                              {describeDocument(item)}
                            </p>

                            {document.status === 'ingesting' &&
                              latestJob && (
                                <ProgressMeter
                                  className="mt-4"
                                  label={latestJob.progress_label}
                                  percent={latestJob.progress_percent}
                                />
                              )}

                            {document.last_error && (
                              <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                                {document.last_error}
                              </p>
                            )}

                            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span>{formatBytes(document.size_bytes)}</span>
                              <span className="text-border">|</span>
                              <span>
                                {formatDateTime(document.updated_at)}
                              </span>
                              {latestJob && (
                                <>
                                  <span className="text-border">|</span>
                                  <span>Job {latestJob.status}</span>
                                </>
                              )}
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
                                onClick={() =>
                                  void handleReingest(
                                    document.document_id,
                                  )
                                }
                                disabled={
                                  document.status === 'ingesting'
                                }
                              >
                                <RefreshCcw className="h-3.5 w-3.5" />
                                Re-ingest
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                                onClick={() =>
                                  void handleDelete(document.document_id)
                                }
                                disabled={
                                  document.status === 'ingesting'
                                }
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
      <h3 className="font-display text-xl">{title}</h3>
      {description && (
        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  )
}

function StatusBadge(props: {
  status: string
  kind?: 'document' | 'job'
  progressPercent?: number
}) {
  if (props.status === 'ready' || props.status === 'completed')
    return <Badge variant="success">Ready</Badge>
  if (props.status === 'failed')
    return <Badge variant="destructive">Failed</Badge>
  if (props.status === 'queued')
    return (
      <Badge variant="secondary">
        {props.progressPercent != null
          ? `Queued ${norm(props.progressPercent)}%`
          : 'Queued'}
      </Badge>
    )
  if (props.status === 'ingesting' || props.status === 'running')
    return (
      <Badge variant="default">
        {(props.kind === 'job' ? 'Running' : 'Ingesting') +
          ` ${norm(props.progressPercent ?? 0)}%`}
      </Badge>
    )
  return <Badge variant="secondary">{props.status}</Badge>
}

function ProgressMeter(props: {
  className?: string
  label: string
  percent: number
}) {
  const percent = norm(props.percent)
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

function describeDocument(item: DocumentDetail) {
  const { document, latest_job: latestJob } = item
  if (document.status === 'ready')
    return `${document.pages_indexed} halaman dan ${document.chunks_indexed} chunk sudah terindeks di ${document.collection_name}.`
  if (document.status === 'failed')
    return (
      latestJob?.error_message ??
      'Job ingest terakhir gagal. Dokumen bisa di-ingest ulang.'
    )
  if (document.status === 'ingesting')
    return latestJob?.progress_label ?? 'Sedang ingest.'
  return 'Dokumen tersimpan, tetapi belum siap di-query.'
}

function describeJob(job: IngestionJob) {
  if (job.status === 'completed' && job.result)
    return `${job.result.pages_indexed} halaman dan ${job.result.chunks_indexed} chunk berhasil diindeks.`
  if (job.status === 'failed')
    return job.error_message ?? 'Job selesai dengan kegagalan yang tidak diketahui.'
  if (job.status === 'running' || job.status === 'queued')
    return job.progress_label
  return 'Job masuk antrean dan akan dijalankan oleh backend.'
}

function getDocumentTitle(document: DocumentSummary) {
  const title = document.title?.trim()
  if (title) {
    let cleaned = title.replace(/\.$/, '')
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
      [
        /Kegiatan Usaha Pertambangan Mineral dan Batubara/gi,
        'Usaha Pertambangan Minerba',
      ],
      [/\bNomor\s+(\d+)\s+Tahun\s+(\d{4})\b/gi, '$1/$2'],
    ]
    for (const [pattern, replacement] of replacements) {
      cleaned = cleaned.replace(pattern, replacement)
    }
    cleaned = cleaned.replace(/\btentang\b/i, ': ')
    cleaned = cleaned.replace(/\s*:\s*/g, ': ')
    cleaned = cleaned.replace(/\s+/g, ' ').trim().replace(/[,:;]+$/, '')
    if (cleaned.length <= 96) return cleaned
    const trimmed = cleaned.slice(0, 96)
    const splitAt = trimmed.lastIndexOf(' ')
    return `${(splitAt > 64 ? trimmed.slice(0, splitAt) : trimmed).replace(/[,:;]+$/, '')}…`
  }
  if (document.status === 'ingesting') return 'Menerka judul dokumen'
  return 'Judul belum tersedia'
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB']
  let size = value / 1024
  let i = 0
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i += 1
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[i]}`
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Terjadi kesalahan yang tidak dikenal.'
}

function isActiveJob(job: IngestionJob) {
  return job.status === 'queued' || job.status === 'running'
}

function norm(v: number) {
  return Math.max(0, Math.min(Math.round(v), 100))
}
