'use client'

import { useMemo, useState, useTransition } from 'react'
import { ArrowLeft, ExternalLink, List, MessageCircle, ArrowUp } from 'lucide-react'
import { dismissThread } from '@/app/(dashboard)/dashboard/actions'
import { track } from '@/lib/analytics'
import { cn } from '@/lib/utils'
import ViewAllList from '@/components/dashboard/view-all-list'

export interface ThreadForViewer {
  id: string
  title: string
  subreddit: string
  body: string | null
  url: string
  author: string | null
  upvotes: number
  comment_count: number
  reddit_created_at: string
  score: {
    relevance_score: number | null
    summary: string | null
  } | null
}

interface ThreadViewerProps {
  threads: ThreadForViewer[]
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}

function truncateBody(body: string | null): { preview: string; truncated: boolean } {
  if (!body) return { preview: '', truncated: false }
  const trimmed = body.trim()
  // Split on sentence-ending punctuation followed by space or newline. Take first ~3-4 sentences.
  const sentences = trimmed.match(/[^.!?\n]+[.!?\n]+/g) ?? [trimmed]
  const preview = sentences.slice(0, 4).join('').trim()
  const truncated = preview.length < trimmed.length
  return { preview: preview || trimmed.slice(0, 280), truncated }
}

function scoreStyles(score: number | null | undefined): { label: string; className: string } {
  if (score == null) {
    return { label: 'SCORING…', className: 'bg-white text-beetle-faint border-beetle-border' }
  }
  if (score >= 8)
    return { label: `${score}/10 · HIGH`, className: 'bg-green-50 text-green-700 border-green-200' }
  if (score >= 5)
    return { label: `${score}/10 · MED`, className: 'bg-amber-50 text-amber-700 border-amber-200' }
  return { label: `${score}/10 · LOW`, className: 'bg-slate-100 text-slate-600 border-slate-200' }
}

export default function ThreadViewer({ threads }: ThreadViewerProps) {
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [replyOpen, setReplyOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [pending, startTransition] = useTransition()

  const total = threads.length
  const current = threads[index]

  const truncated = useMemo(() => truncateBody(current?.body ?? null), [current])
  const intent = useMemo(() => scoreStyles(current?.score?.relevance_score ?? null), [current])

  if (!current) {
    // Shouldn't render — parent decides empty states. Defensive.
    return null
  }

  if (showAll) {
    return (
      <ViewAllList
        threads={threads}
        currentId={current.id}
        onSelect={(id) => {
          const i = threads.findIndex((t) => t.id === id)
          if (i >= 0) {
            setDirection('forward')
            setIndex(i)
            setReplyOpen(false)
          }
          setShowAll(false)
        }}
        onClose={() => setShowAll(false)}
      />
    )
  }

  function handleDismiss() {
    const t = threads[index]
    if (!t) return
    track('thread_dismissed', { thread_id: t.id, subreddit: t.subreddit })
    startTransition(async () => {
      await dismissThread(t.id)
      // Advance locally. Server refresh happens on next interaction / refresh.
      setDirection('forward')
      setReplyOpen(false)
      setIndex((i) => Math.min(i + 1, total - 1))
    })
  }

  function handleBack() {
    if (index === 0) return
    setDirection('back')
    setIndex((i) => i - 1)
  }

  function handleGenerateReply() {
    track('reply_generate_clicked', { thread_id: current.id })
    setReplyOpen(true)
  }

  const atLast = index >= total - 1

  return (
    <div className="max-w-2xl mx-auto">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            disabled={index === 0}
            className={cn(
              'p-1.5 rounded-md transition-colors',
              index === 0
                ? 'text-beetle-faint cursor-not-allowed'
                : 'text-beetle-muted hover:text-beetle-ink hover:bg-white'
            )}
            aria-label="Previous thread"
          >
            <ArrowLeft size={16} />
          </button>
          <p className="text-xs font-body text-beetle-muted">
            {index + 1} of {total} threads
          </p>
        </div>
        <button
          onClick={() => setShowAll(true)}
          className="inline-flex items-center gap-1.5 text-xs font-body text-beetle-muted hover:text-beetle-ink transition-colors"
        >
          <List size={14} />
          View all
        </button>
      </div>

      {/* Card */}
      <div
        key={current.id}
        className={cn(
          'bg-white border border-beetle-border rounded-2xl p-6 md:p-8',
          direction === 'forward' ? 'animate-in slide-in-from-right-4' : 'animate-in slide-in-from-left-4',
          'fade-in duration-200'
        )}
      >
        {/* Intent badge row */}
        <div className="flex items-center gap-3 text-xs font-body flex-wrap">
          <span
            className={cn(
              'inline-flex items-center px-2 py-0.5 rounded-md border font-medium tracking-wide',
              intent.className
            )}
          >
            {intent.label}
          </span>
          <span className="text-beetle-muted">r/{current.subreddit}</span>
          <span className="text-beetle-faint">·</span>
          <span className="text-beetle-muted">{relativeTime(current.reddit_created_at)}</span>
          <span className="text-beetle-faint">·</span>
          <span className="inline-flex items-center gap-1 text-beetle-muted">
            <ArrowUp size={12} /> {current.upvotes}
          </span>
          <span className="inline-flex items-center gap-1 text-beetle-muted">
            <MessageCircle size={12} /> {current.comment_count}
          </span>
        </div>

        {/* Title */}
        <h2 className="font-display font-bold text-xl md:text-2xl text-beetle-ink mt-4 leading-snug">
          {current.title}
        </h2>

        {/* Body preview */}
        {truncated.preview && (
          <p className="text-sm font-body text-beetle-ink mt-4 leading-relaxed whitespace-pre-line">
            {truncated.preview}
            {truncated.truncated ? '…' : ''}
          </p>
        )}
        <a
          href={current.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm font-body text-beetle-orange hover:opacity-80 mt-3"
        >
          Read full thread <ExternalLink size={12} />
        </a>

        {/* beetle's read */}
        <div className="mt-6 pt-5 border-t border-beetle-border">
          <p className="text-xs font-body font-medium text-beetle-muted uppercase tracking-wide mb-2">
            beetle&apos;s read:
          </p>
          {current.score?.summary ? (
            <p className="text-sm font-body text-beetle-ink leading-relaxed">
              {current.score.summary}
            </p>
          ) : (
            <div className="space-y-2" aria-label="Scoring in progress">
              <div className="h-3 bg-beetle-bg rounded-sm animate-pulse w-11/12" />
              <div className="h-3 bg-beetle-bg rounded-sm animate-pulse w-10/12" />
              <div className="h-3 bg-beetle-bg rounded-sm animate-pulse w-8/12" />
            </div>
          )}
        </div>

        {/* Reply panel */}
        {replyOpen && (
          <div className="mt-6 pt-5 border-t border-beetle-border">
            <p className="text-xs font-body font-medium text-beetle-muted uppercase tracking-wide mb-2">
              Drafted reply
            </p>
            <div className="rounded-lg bg-beetle-bg border border-beetle-border p-4 text-sm font-body text-beetle-muted">
              Coming in next update — Claude will draft 3 reply options tuned to your tone + ICP,
              ready to copy and post manually.
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-7 flex items-center justify-between gap-3">
          <button
            onClick={handleDismiss}
            disabled={pending || atLast}
            className="text-sm font-body text-beetle-muted hover:text-beetle-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Dismiss →
          </button>
          <button
            type="button"
            onClick={handleGenerateReply}
            disabled={replyOpen}
            className="bg-beetle-orange text-white font-body font-medium px-6 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-60 text-sm"
          >
            Generate Reply
          </button>
        </div>
      </div>
    </div>
  )
}
