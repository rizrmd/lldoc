import {
  FileStack,
  LogOut,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'

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
}

export function Sidebar({
  activeView,
  onNavigate,
  collapsed,
  onToggleCollapse,
  stats,
}: SidebarProps) {
  const hasPassword = hasPasswordProtection()

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
            LLDoc
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

      <nav className="flex-1 space-y-1 p-3">
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
      </nav>

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
