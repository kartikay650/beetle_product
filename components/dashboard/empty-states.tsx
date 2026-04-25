import { Search, MessageSquare, TrendingUp } from 'lucide-react'
import FirstSyncButton from '@/components/dashboard/first-sync-button'
import SyncNowButton from '@/components/dashboard/sync-now-button'

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

export function CaughtUpState({ lastSyncedAt }: { lastSyncedAt: string | null }) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <circle cx="20" cy="20" r="18" stroke="#E8632A" strokeWidth="1.5" />
        <path d="M13 20.5l5 5 9-11" stroke="#E8632A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <h2 className="font-display font-bold text-xl text-beetle-ink mt-4">You&apos;re caught up</h2>
      <p className="text-sm text-beetle-muted font-body mt-2">No new threads right now.</p>
      <p className="text-xs text-beetle-faint mt-1">Last synced {relativeTime(lastSyncedAt)}</p>
      <div className="mt-6">
        <SyncNowButton />
      </div>
    </div>
  )
}

export function FirstTimeEmptyState() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <path d="M24 30 A6 6 0 0 1 24 18" stroke="#E8632A" strokeWidth="1.5" fill="none" />
        <path d="M24 34 A10 10 0 0 1 24 14" stroke="#E8632A" strokeWidth="1.5" fill="none" />
        <path d="M24 38 A14 14 0 0 1 24 10" stroke="#E8632A" strokeWidth="1.5" fill="none" />
        <circle cx="24" cy="24" r="1.5" fill="#E8632A" />
      </svg>
      <h2 className="font-display font-bold text-2xl text-beetle-ink mt-6">Your feed is setting up</h2>
      <p className="text-sm text-beetle-muted font-body mt-3 max-w-xs">
        Click below to scan Reddit for threads matching your keywords.
      </p>
      <FirstSyncButton />

      {/* Hint cards */}
      <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl w-full">
        <div className="bg-white border border-beetle-border rounded-xl p-5 text-left">
          <Search size={20} className="text-beetle-orange mb-3" />
          <h3 className="font-display font-bold text-sm text-beetle-ink">Find</h3>
          <p className="text-xs text-beetle-muted font-body leading-relaxed mt-1">
            beetle scans your subreddits for threads matching your keywords, scored by intent.
          </p>
        </div>
        <div className="bg-white border border-beetle-border rounded-xl p-5 text-left">
          <MessageSquare size={20} className="text-beetle-orange mb-3" />
          <h3 className="font-display font-bold text-sm text-beetle-ink">Draft</h3>
          <p className="text-xs text-beetle-muted font-body leading-relaxed mt-1">
            Get 3 reply options per thread. Pick one, edit if needed, copy and post manually.
          </p>
        </div>
        <div className="bg-white border border-beetle-border rounded-xl p-5 text-left">
          <TrendingUp size={20} className="text-beetle-orange mb-3" />
          <h3 className="font-display font-bold text-sm text-beetle-ink">Compound</h3>
          <p className="text-xs text-beetle-muted font-body leading-relaxed mt-1">
            Recurring threads become content briefs. One Reddit discussion, one blog post.
          </p>
        </div>
      </div>
    </div>
  )
}
