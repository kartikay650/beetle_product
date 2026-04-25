'use client'

import { X, ArrowUp, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ThreadForViewer } from '@/components/dashboard/thread-viewer'

interface ViewAllListProps {
  threads: ThreadForViewer[]
  currentId: string
  onSelect: (id: string) => void
  onClose: () => void
}

function scorePill(score: number | null | undefined) {
  if (score == null) return { label: '•', className: 'bg-white text-beetle-faint border-beetle-border' }
  if (score >= 8) return { label: String(score), className: 'bg-green-50 text-green-700 border-green-200' }
  if (score >= 5) return { label: String(score), className: 'bg-amber-50 text-amber-700 border-amber-200' }
  return { label: String(score), className: 'bg-slate-100 text-slate-600 border-slate-200' }
}

export default function ViewAllList({ threads, currentId, onSelect, onClose }: ViewAllListProps) {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-display font-bold text-lg text-beetle-ink">All threads today</h2>
          <p className="text-xs text-beetle-muted font-body">{threads.length} ready to review</p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-beetle-muted hover:text-beetle-ink hover:bg-white transition-colors"
          aria-label="Close list"
        >
          <X size={18} />
        </button>
      </div>

      <div className="bg-white border border-beetle-border rounded-2xl divide-y divide-beetle-border overflow-hidden">
        {threads.map((t) => {
          const pill = scorePill(t.score?.relevance_score)
          const isCurrent = t.id === currentId
          const oneLine = t.score?.summary ?? t.title
          return (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              className={cn(
                'w-full text-left px-4 py-3 flex items-start gap-3 transition-colors',
                isCurrent ? 'bg-beetle-bg' : 'hover:bg-beetle-bg'
              )}
            >
              <span
                className={cn(
                  'inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-body font-medium tracking-wide shrink-0 mt-0.5',
                  pill.className
                )}
              >
                {pill.label}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-body text-beetle-ink line-clamp-1">{t.title}</p>
                <p className="text-xs text-beetle-muted font-body mt-0.5 line-clamp-1">{oneLine}</p>
                <div className="mt-1 flex items-center gap-3 text-[11px] text-beetle-faint font-body">
                  <span>r/{t.subreddit}</span>
                  <span className="inline-flex items-center gap-0.5">
                    <ArrowUp size={10} /> {t.upvotes}
                  </span>
                  <span className="inline-flex items-center gap-0.5">
                    <MessageCircle size={10} /> {t.comment_count}
                  </span>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
