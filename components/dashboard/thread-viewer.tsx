'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  ArrowLeft,
  ExternalLink,
  List,
  MessageCircle,
  ArrowUp,
  Copy,
  Loader2,
  RefreshCw,
  Send,
} from 'lucide-react'
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

interface ReplyDraft {
  id: string
  variant: number
  variant_label: string
  content: string
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

function variantPillClass(variant: number): string {
  if (variant === 1) return 'bg-green-50 text-green-700'
  if (variant === 2) return 'bg-blue-50 text-blue-700'
  return 'bg-amber-50 text-amber-700'
}

export default function ThreadViewer({ threads }: ThreadViewerProps) {
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [showAll, setShowAll] = useState(false)
  const [pending, startTransition] = useTransition()

  // Reply state — keyed per current thread, reset when thread changes.
  const [replyOpen, setReplyOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [replies, setReplies] = useState<ReplyDraft[]>([])
  const [replyError, setReplyError] = useState<string | null>(null)
  const [copiedIds, setCopiedIds] = useState<Set<string>>(new Set())
  const [refinementText, setRefinementText] = useState('')

  // Score overrides — populated by background polling for threads that arrive
  // unscored. Keyed by thread id so navigating away/back keeps the live data.
  const [scoreOverrides, setScoreOverrides] = useState<
    Map<string, { relevance_score: number | null; summary: string | null }>
  >(new Map())

  const total = threads.length
  const current = threads[index]

  // Effective score = live override (if any) → falls back to server-rendered prop.
  const effectiveScore = current
    ? scoreOverrides.get(current.id) ?? current.score
    : null

  const truncated = useMemo(() => truncateBody(current?.body ?? null), [current])
  const intent = useMemo(
    () => scoreStyles(effectiveScore?.relevance_score ?? null),
    [effectiveScore?.relevance_score]
  )

  // Reset reply UI whenever the user navigates to a different thread.
  useEffect(() => {
    setReplyOpen(false)
    setGenerating(false)
    setReplies([])
    setReplyError(null)
    setCopiedIds(new Set())
    setRefinementText('')
  }, [current?.id])

  // Background poll for thread_scores when this thread has no summary yet.
  // Stops once a summary lands or the user navigates away.
  useEffect(() => {
    if (!current) return
    const initialSummary = current.score?.summary
    const overrideSummary = scoreOverrides.get(current.id)?.summary
    if (initialSummary || overrideSummary) return

    let cancelled = false
    const interval = setInterval(async () => {
      if (cancelled) return
      try {
        const res = await fetch(`/api/thread-score?threadId=${current.id}`)
        if (!res.ok) return
        const data = (await res.json()) as {
          summary: string | null
          relevance_score: number | null
        }
        if (data.summary && !cancelled) {
          setScoreOverrides((prev) => {
            const next = new Map(prev)
            next.set(current.id, {
              relevance_score: data.relevance_score,
              summary: data.summary,
            })
            return next
          })
          clearInterval(interval)
        }
      } catch (err) {
        console.error('thread-score poll failed:', err)
      }
    }, 5000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  if (!current) return null

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
      setDirection('forward')
      setIndex((i) => Math.min(i + 1, total - 1))
    })
  }

  function handleBack() {
    if (index === 0) return
    setDirection('back')
    setIndex((i) => i - 1)
  }

  async function fetchReplies(regenerate: boolean, refinement?: string) {
    setGenerating(true)
    setReplyError(null)
    try {
      const resp = await fetch('/api/reply/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: current.id,
          regenerate,
          ...(refinement ? { refinement } : {}),
        }),
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}))
        throw new Error(body?.error || `generate failed (${resp.status})`)
      }
      const data = (await resp.json()) as { replies: ReplyDraft[]; cached?: boolean }
      setReplies(data.replies ?? [])
      const event = refinement
        ? 'reply_refined'
        : regenerate
          ? 'reply_regenerated'
          : 'reply_generated'
      track(event, {
        thread_id: current.id,
        cached: !!data.cached,
        count: data.replies?.length ?? 0,
        ...(refinement ? { refinement_length: refinement.length } : {}),
      })
    } catch (err) {
      console.error('fetchReplies failed:', err)
      setReplyError(err instanceof Error ? err.message : 'Could not generate replies')
    } finally {
      setGenerating(false)
    }
  }

  async function handleGenerateReply() {
    track('reply_generate_clicked', { thread_id: current.id })
    setReplyOpen(true)
    if (replies.length === 0) {
      await fetchReplies(false)
    }
  }

  async function handleRegenerate() {
    track('reply_regenerate_clicked', { thread_id: current.id })
    // Keep existing cards visible — the dim/pulse overlay signals work in flight.
    await fetchReplies(true)
  }

  async function handleRefine() {
    const text = refinementText.trim()
    if (!text || generating) return
    track('reply_refine_clicked', { thread_id: current.id, length: text.length })
    await fetchReplies(true, text)
    setRefinementText('')
  }

  async function handleCopy(reply: ReplyDraft) {
    try {
      await navigator.clipboard.writeText(reply.content)
    } catch (err) {
      console.error('clipboard write failed:', err)
      setReplyError('Could not copy to clipboard')
      return
    }

    setCopiedIds((prev) => {
      const next = new Set(prev)
      next.add(reply.id)
      return next
    })
    setTimeout(() => {
      setCopiedIds((prev) => {
        const next = new Set(prev)
        next.delete(reply.id)
        return next
      })
    }, 2000)

    track('reply_copied', { thread_id: current.id, variant: reply.variant })

    fetch('/api/reply/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replyId: reply.id }),
    }).catch((e) => console.error('reply.copy fire-and-forget failed:', e))
  }

  const atLast = index >= total - 1

  return (
    <div className="max-w-4xl mx-auto">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
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
          type="button"
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
          {effectiveScore?.summary ? (
            <p className="text-sm font-body text-beetle-ink leading-relaxed">
              {effectiveScore.summary}
            </p>
          ) : (
            <p className="text-sm font-body text-beetle-muted italic">
              beetle is still reading this thread…
            </p>
          )}
        </div>

        {/* Reply panel */}
        {replyOpen && (
          <div className="mt-6 pt-5 border-t border-beetle-border">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-body font-medium text-beetle-muted uppercase tracking-wide">
                Drafted replies
              </p>
              {replies.length > 0 && !generating && (
                <button
                  type="button"
                  onClick={handleRegenerate}
                  className="inline-flex items-center gap-1.5 text-xs font-body text-beetle-muted hover:text-beetle-ink transition-colors"
                >
                  <RefreshCw size={12} />
                  Regenerate replies
                </button>
              )}
            </div>

            {replyError && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs font-body text-red-700 mb-3">
                {replyError}
              </div>
            )}

            {replies.length === 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="bg-white border border-beetle-border rounded-xl p-4 space-y-2"
                    aria-label="Generating reply"
                  >
                    <div className="h-3 bg-beetle-bg rounded animate-pulse w-1/3" />
                    <div className="h-3 bg-beetle-bg rounded animate-pulse w-full mt-3" />
                    <div className="h-3 bg-beetle-bg rounded animate-pulse w-11/12" />
                    <div className="h-3 bg-beetle-bg rounded animate-pulse w-10/12" />
                    <div className="h-3 bg-beetle-bg rounded animate-pulse w-8/12" />
                  </div>
                ))}
              </div>
            ) : (
              <div
                className={cn(
                  'grid grid-cols-1 md:grid-cols-3 gap-3 transition-opacity',
                  generating && 'opacity-50 pointer-events-none animate-pulse'
                )}
              >
                {replies.map((reply) => {
                  const copied = copiedIds.has(reply.id)
                  return (
                    <div
                      key={reply.id}
                      className="bg-white border border-beetle-border rounded-xl p-4 flex flex-col"
                    >
                      <span
                        className={cn(
                          'inline-flex self-start items-center px-2 py-0.5 rounded text-[10px] font-body font-medium tracking-wide',
                          variantPillClass(reply.variant)
                        )}
                      >
                        {reply.variant_label}
                      </span>
                      <p className="text-sm text-beetle-ink font-body leading-relaxed whitespace-pre-wrap mt-3 flex-1">
                        {reply.content}
                      </p>
                      <div className="flex justify-end gap-2 mt-3">
                        <button
                          type="button"
                          onClick={() => handleCopy(reply)}
                          className="inline-flex items-center gap-1.5 text-xs border border-beetle-border rounded-lg px-3 py-1.5 text-beetle-muted hover:text-beetle-ink transition-colors"
                        >
                          <Copy size={14} />
                          {copied ? 'Copied ✓' : 'Copy'}
                        </button>
                        <button
                          type="button"
                          onClick={() => window.open(current.url, '_blank', 'noopener,noreferrer')}
                          className="inline-flex items-center gap-1.5 text-xs bg-beetle-orange text-white rounded-lg px-3 py-1.5 hover:opacity-90 transition-opacity"
                        >
                          <ExternalLink size={14} />
                          Open on Reddit
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Refinement input — only visible once we have replies to refine */}
            {replies.length > 0 && (
              <div className="mt-4 flex gap-2">
                <input
                  type="text"
                  value={refinementText}
                  onChange={(e) => setRefinementText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleRefine()
                    }
                  }}
                  disabled={generating}
                  placeholder="make it shorter, add a hook about X, mention pricing..."
                  className="flex-1 border border-beetle-border rounded-lg px-3 py-2 text-sm font-body text-beetle-ink bg-white focus:outline-none focus:ring-2 focus:ring-beetle-orange disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={handleRefine}
                  disabled={generating || !refinementText.trim()}
                  className="bg-beetle-orange text-white rounded-lg px-4 py-2 text-sm font-body hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                >
                  {generating ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Send size={14} />
                  )}
                  Refine
                </button>
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-7 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleDismiss}
            disabled={pending || atLast}
            className="text-sm font-body text-beetle-muted hover:text-beetle-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Dismiss →
          </button>
          <button
            type="button"
            onClick={handleGenerateReply}
            disabled={generating || (replyOpen && replies.length > 0)}
            className="bg-beetle-orange text-white font-body font-medium px-6 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-60 text-sm inline-flex items-center gap-2"
          >
            {generating ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Generating…
              </>
            ) : (
              'Generate Reply'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
