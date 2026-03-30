import { startTransition, useEffect, useEffectEvent, useRef, useState } from 'react'

import {
  deleteConversation,
  listConversations,
  listDocuments,
  listJobs,
  type ConversationSummary,
  type DocumentDetail,
  type IngestionJob,
} from '@/lib/api'
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
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const isFirstLoadRef = useRef(true)
  const activeConversationIdRef = useRef<string | null>(null)
  activeConversationIdRef.current = activeConversationId

  const readyDocuments = documents.filter((d) => d.document.status === 'ready').length
  const totalDocuments = documents.length
  const activeJobs = jobs.filter(isActiveJob).length

  function filterValidDocumentIds(
    candidateIds: string[],
    nextDocuments: DocumentDetail[],
  ) {
    return candidateIds.filter((id) =>
      nextDocuments.some((d) => d.document.document_id === id),
    )
  }

  async function syncWorkspace() {
    try {
      const [nextDocuments, nextJobs, nextConversations] = await Promise.all([
        listDocuments(),
        listJobs(),
        listConversations(),
      ])
      startTransition(() => {
        setDocuments(nextDocuments)
        setJobs(nextJobs)
        setConversations(nextConversations)
        setSelectedDocumentIds((current) =>
          isFirstLoadRef.current &&
          activeConversationIdRef.current === null &&
          nextConversations.length > 0
            ? filterValidDocumentIds(nextConversations[0].document_ids, nextDocuments)
            : filterValidDocumentIds(current, nextDocuments),
        )
        setActiveConversationId((current) => {
          if (current && nextConversations.some((item) => item.conversation_id === current)) {
            return current
          }
          if (isFirstLoadRef.current) {
            return nextConversations[0]?.conversation_id ?? null
          }
          return null
        })
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

  function handleSelectConversation(conversation: ConversationSummary) {
    startTransition(() => {
      setActiveView('chat')
      setActiveConversationId(conversation.conversation_id)
      setSelectedDocumentIds(
        filterValidDocumentIds(conversation.document_ids, documents),
      )
    })
  }

  function handleNewConversation() {
    startTransition(() => {
      setActiveView('chat')
      setActiveConversationId(null)
    })
  }

  async function handleDeleteConversation(conversationId: string) {
    try {
      await deleteConversation(conversationId)
      startTransition(() => {
        setConversations((current) =>
          current.filter((item) => item.conversation_id !== conversationId),
        )
        if (activeConversationIdRef.current === conversationId) {
          setActiveConversationId(null)
        }
      })
    } catch {
      // silently ignore delete errors
    }
  }

  function handleConversationChange(conversation: ConversationSummary) {
    startTransition(() => {
      setActiveConversationId(conversation.conversation_id)
      setConversations((current) => [
        conversation,
        ...current.filter(
          (item) => item.conversation_id !== conversation.conversation_id,
        ),
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
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelectConversation={handleSelectConversation}
          onNewConversation={handleNewConversation}
          onDeleteConversation={handleDeleteConversation}
        />
        <main className="relative flex-1 overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[18rem] bg-[radial-gradient(circle_at_top_left,rgba(244,143,48,0.18),transparent_42%),radial-gradient(circle_at_top_right,rgba(22,110,136,0.15),transparent_36%)]" />
          <div className="relative h-full">
            {activeView === 'chat' ? (
              <ChatPage
                documents={documents}
                selectedDocumentIds={selectedDocumentIds}
                activeConversationId={activeConversationId}
                onToggleDocument={handleToggleDocument}
                onOpenFiles={() => setActiveView('files')}
                onConversationChange={handleConversationChange}
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
