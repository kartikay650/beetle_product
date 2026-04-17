'use client'

import { ReactNode, useMemo } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Layers, Settings2, LogOut, RefreshCw, type LucideIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

interface DashboardLayoutProps {
  children: ReactNode
  pageTitle: string
  lastSyncedAt?: string | null
  userEmail?: string | null
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'Never synced'
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`
}

function NavItem({
  href,
  icon: Icon,
  label,
  active,
}: {
  href: string
  icon: LucideIcon
  label: string
  active: boolean
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 text-sm font-body transition-colors',
        active
          ? 'bg-beetle-bg text-beetle-ink font-medium border-l-2 border-beetle-orange rounded-r-lg'
          : 'text-beetle-muted hover:bg-beetle-bg hover:text-beetle-ink rounded-lg'
      )}
    >
      <Icon size={16} />
      {label}
    </Link>
  )
}

export default function DashboardLayout({
  children,
  pageTitle,
  lastSyncedAt,
  userEmail,
}: DashboardLayoutProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  const syncedLabel = useMemo(() => {
    if (!lastSyncedAt) return 'Never synced'
    return `Last synced ${relativeTime(lastSyncedAt)}`
  }, [lastSyncedAt])

  const avatarLetter = (userEmail || '?').charAt(0).toUpperCase()
  const isThreads = pathname === '/dashboard'
  const isSettings = pathname === '/settings'

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="flex flex-row min-h-screen">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-[220px] flex-shrink-0 bg-white border-r border-beetle-border flex-col">
        {/* Logo */}
        <div className="p-5">
          <p className="font-display font-black text-xl text-beetle-ink lowercase tracking-tight">
            beetle
          </p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-2 space-y-1">
          <NavItem href="/dashboard" icon={Layers} label="Threads" active={isThreads} />
          <NavItem href="/settings" icon={Settings2} label="Settings" active={isSettings} />
        </nav>

        {/* User info */}
        <div className="p-4 border-t border-beetle-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-beetle-orange flex items-center justify-center text-white text-xs font-display font-bold">
              {avatarLetter}
            </div>
            <p className="text-xs text-beetle-muted truncate max-w-[120px] font-body">
              {userEmail || 'No email'}
            </p>
          </div>
          <button
            onClick={handleSignOut}
            className="mt-2 text-xs text-beetle-muted hover:text-beetle-ink font-body flex items-center gap-1.5"
          >
            <LogOut size={12} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-14 border-b border-beetle-border bg-white flex items-center justify-between px-6 flex-shrink-0">
          <h1 className="font-display font-bold text-lg text-beetle-ink">{pageTitle}</h1>
          <div className="text-xs text-beetle-muted font-body flex items-center gap-1.5">
            <RefreshCw size={12} />
            {syncedLabel}
          </div>
        </header>

        {/* Main scroll area */}
        <main className="flex-1 overflow-y-auto bg-beetle-bg p-6 pb-20 md:pb-6">
          {children}
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-beetle-border flex justify-around py-2 px-4 z-50">
        <Link
          href="/dashboard"
          className={cn(
            'flex flex-col items-center gap-0.5',
            isThreads ? 'text-beetle-orange' : 'text-beetle-muted'
          )}
        >
          <Layers size={20} />
          <span className="text-[10px] font-body">Threads</span>
        </Link>
        <Link
          href="/settings"
          className={cn(
            'flex flex-col items-center gap-0.5',
            isSettings ? 'text-beetle-orange' : 'text-beetle-muted'
          )}
        >
          <Settings2 size={20} />
          <span className="text-[10px] font-body">Settings</span>
        </Link>
      </nav>
    </div>
  )
}
