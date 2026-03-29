export type DocumentStatus = 'uploaded' | 'ingesting' | 'ready' | 'failed'
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed'
export type ChatRole = 'system' | 'user' | 'assistant'

export interface IngestResponse {
  document_id: string
  source_path: string
  document_title: string | null
  pages_indexed: number
  chunks_indexed: number
  collection_name: string
}

export interface Citation {
  chunk_id: string
  document_id: string
  source_path: string
  page_num: number
  score: number
  text: string
}

export interface QueryResponse {
  answer: string
  citations: Citation[]
  context_count: number
}

export interface ChatMessagePayload {
  role: ChatRole
  content: string
}

export interface DocumentSummary {
  document_id: string
  file_name: string
  title: string | null
  source_path: string
  size_bytes: number
  content_type: string | null
  status: DocumentStatus
  created_at: string
  updated_at: string
  pages_indexed: number
  chunks_indexed: number
  collection_name: string | null
  metadata: Record<string, unknown>
  last_error: string | null
  latest_job_id: string | null
  download_url: string | null
}

export interface IngestionJob {
  job_id: string
  document_id: string
  status: JobStatus
  progress_percent: number
  progress_label: string
  created_at: string
  updated_at: string
  started_at: string | null
  finished_at: string | null
  error_message: string | null
  result: IngestResponse | null
}

export interface DocumentDetail {
  document: DocumentSummary
  latest_job: IngestionJob | null
}

export interface UploadDocumentResponse {
  document: DocumentSummary
  job: IngestionJob
}

function getApiBaseUrl() {
  const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
  if (configuredBaseUrl) {
    return configuredBaseUrl
  }
  if (import.meta.env.DEV) {
    return 'http://127.0.0.1:8000'
  }
  return '/api'
}

export function buildApiUrl(path: string) {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${getApiBaseUrl()}${normalizedPath}`
}

async function request<T>(
  path: string,
  init?: RequestInit,
  options: { expectJson?: boolean } = {},
) {
  const { expectJson = true } = options
  const response = await fetch(buildApiUrl(path), {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  })

  if (!response.ok) {
    const message = await readErrorMessage(response)
    throw new Error(message)
  }

  if (!expectJson || response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

async function readErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { detail?: string }
    if (payload.detail) {
      return payload.detail
    }
  } catch {
    return `Request failed with status ${response.status}`
  }

  return `Request failed with status ${response.status}`
}

export function listDocuments() {
  return request<DocumentDetail[]>('/documents')
}

export function listJobs() {
  return request<IngestionJob[]>('/jobs')
}

export function uploadDocument(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  return request<UploadDocumentResponse>('/documents/upload', {
    method: 'POST',
    body: formData,
  })
}

export function startDocumentIngestion(documentId: string) {
  return request<UploadDocumentResponse>(`/documents/${documentId}/ingest`, {
    method: 'POST',
  })
}

export function deleteDocument(documentId: string) {
  return request<void>(
    `/documents/${documentId}`,
    {
      method: 'DELETE',
    },
    {
      expectJson: false,
    },
  )
}

export function chat(payload: {
  messages: ChatMessagePayload[]
  document_ids?: string[]
  top_k?: number
}) {
  return request<QueryResponse>('/chat', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
