import { startTransition, useEffect, useEffectEvent, useRef, useState } from 'react'

import { listDocuments, listJobs, type DocumentDetail, type IngestionJob } from '@/lib/api'
import { PasswordGate } from '@/components/password-gate'
import { Sidebar, type View } from '@/components/sidebar'
import { ChatPage } from '@/components/chat-page'
import { FilesPage } from '@/components/files-page'

function isActiveJob(job: IngestionJob) {
  return job.status === 'queued' || job.status === 'running'
}

function App() {
  const [activeView, setActiveView] = useState<View>('chat')
  const [documents, setDocuments] = useState<DocumentDetail[]>([])
  const [jobs, setJobs] = useState<IngestionJob[]>([])
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const isFirstLoadRef = useRef(true)

  const readyDocuments = documents.filter((d) => d.document.status === 'ready').length
  const totalDocuments = documents.length
  const activeJobs = jobs.filter(isActiveJob).length

  async function syncWorkspace() {
    try {
      const [nextDocuments, nextJobs] = await Promise.all([listDocuments(), listJobs()])
      startTransition(() => {
        setDocuments(nextDocuments)
        setJobs(nextJobs)
        setSelectedDocumentIds((current) =>
          current.filter((id) =>
            nextDocuments.some((d) => d.document.document_id === id),
          ),
        )
      })
    } catch {
      // silently ignore sync errors
    } finally {
      if (isFirstLoadRef.current) {
        isFirstLoadRef.current = false
      }
    }
  }

  const loadWorkspace = useEffectEvent(() => {
    void syncWorkspace()
  })

  useEffect(() => {
    loadWorkspace()
  }, [])

  useEffect(() => {
    if (!activeJobs) return
    const id = window.setInterval(loadWorkspace, 2500)
    return () => window.clearInterval(id)
  }, [activeJobs])

  function handleToggleDocument(documentId: string) {
    startTransition(() => {
      setSelectedDocumentIds((current) =>
        current.includes(documentId)
          ? current.filter((id) => id !== documentId)
          : [...current, documentId],
      )
    })
  }

  function handleDocumentsUploaded(documentIds: string[]) {
    startTransition(() => {
      setSelectedDocumentIds((current) => [
        ...new Set([...current, ...documentIds]),
      ])
    })
  }

  return (
    <PasswordGate>
      <div className="flex h-[100dvh] overflow-hidden bg-background">
        <Sidebar
          activeView={activeView}
          onNavigate={setActiveView}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          stats={{ readyDocuments, totalDocuments, activeJobs }}
        />
        <main className="relative flex-1 overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[18rem] bg-[radial-gradient(circle_at_top_left,rgba(244,143,48,0.18),transparent_42%),radial-gradient(circle_at_top_right,rgba(22,110,136,0.15),transparent_36%)]" />
          <div className="relative h-full">
            {activeView === 'chat' ? (
              <ChatPage
                documents={documents}
                selectedDocumentIds={selectedDocumentIds}
                onToggleDocument={handleToggleDocument}
                onOpenFiles={() => setActiveView('files')}
              />
            ) : (
              <FilesPage
                documents={documents}
                jobs={jobs}
                selectedDocumentIds={selectedDocumentIds}
                onToggleDocument={handleToggleDocument}
                onWorkspaceSync={syncWorkspace}
                onDocumentsUploaded={handleDocumentsUploaded}
              />
            )}
          </div>
        </main>
      </div>
    </PasswordGate>
  )
}

export default App
