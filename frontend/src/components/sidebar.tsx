import { useState } from 'react'
import {
  FileStack,
  LogOut,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2,
} from 'lucide-react'

import { type ConversationSummary } from '@/lib/api'
import { cn } from '@/lib/utils'
import { hasPasswordProtection, logout } from '@/lib/auth'

export type View = 'chat' | 'files'

interface SidebarProps {
  activeView: View
  onNavigate: (view: View) => void
  collapsed: boolean
  onToggleCollapse: () => void
  stats: {
    readyDocuments: number
    totalDocuments: number
    activeJobs: number
  }
  conversations: ConversationSummary[]
  activeConversationId: string | null
  onSelectConversation: (conversation: ConversationSummary) => void
  onNewConversation: () => void
  onDeleteConversation: (conversationId: string) => Promise<void>
}

export function Sidebar({
  activeView,
  onNavigate,
  collapsed,
  onToggleCollapse,
  stats,
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
}: SidebarProps) {
  const hasPassword = hasPasswordProtection()
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null)

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-border/60 bg-card/60 backdrop-blur-sm transition-[width] duration-200',
        collapsed ? 'w-[68px]' : 'w-[240px]',
      )}
    >
      <div className="flex items-center gap-3 border-b border-border/60 px-4 py-4">
        {!collapsed && (
          <h1 className="flex-1 font-display text-lg font-semibold text-foreground">
            AIDoc
          </h1>
        )}
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        <nav className="space-y-1 p-3">
          <NavItem
            icon={MessageSquareText}
            label="Chat"
            active={activeView === 'chat'}
            collapsed={collapsed}
            onClick={() => onNavigate('chat')}
            badge={stats.readyDocuments > 0 ? `${stats.readyDocuments}` : undefined}
          />
          <NavItem
            icon={FileStack}
            label="Files"
            active={activeView === 'files'}
            collapsed={collapsed}
            onClick={() => onNavigate('files')}
            badge={stats.activeJobs > 0 ? `${stats.activeJobs}` : undefined}
          />
          <NavItem
            icon={Plus}
            label="New Chat"
            active={false}
            collapsed={collapsed}
            onClick={onNewConversation}
          />
        </nav>

        {!collapsed && (
          <div className="flex h-full min-h-0 flex-col px-3 pb-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                History
              </p>
              <span className="text-[11px] text-muted-foreground">
                {conversations.length}
              </span>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              {conversations.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/60 px-3 py-4 text-sm text-muted-foreground">
                  Belum ada percakapan tersimpan.
                </div>
              ) : (
                conversations.map((conversation) => {
                  const isActive =
                    activeView === 'chat' &&
                    activeConversationId === conversation.conversation_id
                  const isDeleting =
                    deletingConversationId === conversation.conversation_id
                  return (
                    <div
                      key={conversation.conversation_id}
                      className={cn(
                        'group flex items-start gap-2 rounded-2xl border px-3 py-3 transition-colors',
                        isActive
                          ? 'border-primary/40 bg-primary/10'
                          : 'border-transparent bg-background/30 hover:border-border/60 hover:bg-secondary/60',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectConversation(conversation)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p
                          className={cn(
                            'line-clamp-2 text-sm font-medium',
                            isActive ? 'text-primary' : 'text-foreground',
                          )}
                        >
                          {conversation.title}
                        </p>
                        {conversation.last_message_preview && (
                          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                            {conversation.last_message_preview}
                          </p>
                        )}
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          {formatConversationTime(conversation.updated_at)}
                          {' · '}
                          {conversation.message_count} pesan
                        </p>
                      </button>
                      <button
                        type="button"
                        disabled={isDeleting}
                        onClick={async () => {
                          setDeletingConversationId(conversation.conversation_id)
                          try {
                            await onDeleteConversation(conversation.conversation_id)
                          } finally {
                            setDeletingConversationId((current) =>
                              current === conversation.conversation_id ? null : current,
                            )
                          }
                        }}
                        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition hover:bg-background/80 hover:text-foreground group-hover:opacity-100 disabled:cursor-wait disabled:opacity-100"
                        aria-label={`Delete ${conversation.title}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border/60 p-3">
        {!collapsed && (
          <div className="mb-3 rounded-xl bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-semibold">{stats.readyDocuments}</span>/{stats.totalDocuments} dokumen ready
            {stats.activeJobs > 0 && (
              <span className="ml-1">| {stats.activeJobs} job aktif</span>
            )}
          </div>
        )}
        {hasPassword && (
          <NavItem
            icon={LogOut}
            label="Logout"
            active={false}
            collapsed={collapsed}
            onClick={() => {
              logout()
              window.location.reload()
            }}
          />
        )}
      </div>
    </aside>
  )
}

function formatConversationTime(value: string) {
  const date = new Date(value)
  const now = new Date()
  const sameDay = now.toDateString() === date.toDateString()
  return new Intl.DateTimeFormat('id-ID', {
    hour: sameDay ? '2-digit' : undefined,
    minute: sameDay ? '2-digit' : undefined,
    day: sameDay ? undefined : '2-digit',
    month: sameDay ? undefined : 'short',
  }).format(date)
}

function NavItem({
  icon,
  label,
  active,
  collapsed,
  onClick,
  badge,
}: {
  icon: typeof FileStack
  label: string
  active: boolean
  collapsed: boolean
  onClick: () => void
  badge?: string
}) {
  const Icon = icon

  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
        collapsed && 'justify-center px-0',
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1 text-left">{label}</span>
          {badge && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/12 px-1.5 text-[10px] font-semibold text-primary">
              {badge}
            </span>
          )}
        </>
      )}
    </button>
  )
}
