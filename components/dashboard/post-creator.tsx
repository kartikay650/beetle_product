'use client'

import { useState } from 'react'
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  HelpCircle,
  Loader2,
  MessageCircle,
  PenLine,
  RefreshCw,
  Send,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { track } from '@/lib/analytics'

type PostType = 'discussion' | 'experience' | 'problem'
type PostLength = 'short' | 'medium' | 'long'

interface SuggestedSubreddit {
  name: string
  fit: 'best' | 'good' | 'risky'
  reason: string
  warning: string | null
}

interface GeneratedPost {
  title: string
  body: string
  post_type: PostType
  word_count: number
  suggested_subreddits: SuggestedSubreddit[]
  geo_keywords: string[]
  engagement_hook: string
}

interface PostCreatorProps {
  workspaceSubreddits: string[]
}

type Step = 'topic' | 'options' | 'result'
type TopicMode = 'auto' | 'manual'

const BEETLE_PICKS_TOPIC = '__beetle_decides__'

const POST_TYPES: Array<{
  id: PostType
  title: string
  desc: string
  icon: typeof MessageCircle
}> = [
  { id: 'discussion', title: 'Discussion', desc: 'ask a question that sparks debate', icon: MessageCircle },
  { id: 'experience', title: 'Experience share', desc: 'share results or lessons with numbers', icon: TrendingUp },
  { id: 'problem', title: 'Problem', desc: 'describe a challenge, ask for advice', icon: HelpCircle },
]

const POST_LENGTHS: Array<{ id: PostLength; label: string; range: string }> = [
  { id: 'short', label: 'Short', range: '50–80 words' },
  { id: 'medium', label: 'Medium', range: '100–150 words' },
  { id: 'long', label: 'Long', range: '150–200 words' },
]

function postTypePill(type: PostType): string {
  if (type === 'discussion') return 'bg-blue-50 text-blue-700'
  if (type === 'experience') return 'bg-green-50 text-green-700'
  return 'bg-amber-50 text-amber-700'
}

function fitPill(fit: SuggestedSubreddit['fit']): { label: string; className: string } {
  if (fit === 'best')
    return { label: 'Best fit', className: 'bg-green-50 text-green-700 border-green-200' }
  if (fit === 'good')
    return { label: 'Good fit', className: 'bg-blue-50 text-blue-700 border-blue-200' }
  return { label: 'Check rules', className: 'bg-amber-50 text-amber-700 border-amber-200' }
}

export default function PostCreator({ workspaceSubreddits }: PostCreatorProps) {
  const [step, setStep] = useState<Step>('topic')
  const [topicMode, setTopicMode] = useState<TopicMode>('auto')
  const [topic, setTopic] = useState('')
  const [postType, setPostType] = useState<PostType | null>(null)
  const [postLength, setPostLength] = useState<PostLength | null>(null)
  const [targetSubreddit, setTargetSubreddit] = useState<string | null>(null)
  const [generatedPost, setGeneratedPost] = useState<GeneratedPost | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refinementText, setRefinementText] = useState('')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  function flashCopied(key: string) {
    setCopiedKey(key)
    setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000)
  }

  async function copyToClipboard(text: string, key: string, eventName: string) {
    try {
      await navigator.clipboard.writeText(text)
      flashCopied(key)
      track(eventName, { topic_length: topic.length })
    } catch (err) {
      console.error('clipboard write failed:', err)
      setError('Could not copy to clipboard')
    }
  }

  function startOver() {
    setStep('topic')
    setTopicMode('auto')
    setTopic('')
    setPostType(null)
    setPostLength(null)
    setTargetSubreddit(null)
    setGeneratedPost(null)
    setError(null)
    setRefinementText('')
  }

  async function callGenerate(refinement?: string) {
    if (!postType || !postLength) return
    const topicValue = topicMode === 'auto' ? BEETLE_PICKS_TOPIC : topic.trim()
    if (!topicValue) return
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch('/api/post/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topicValue,
          postType,
          postLength,
          targetSubreddit,
          ...(refinement ? { refinement } : {}),
        }),
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}))
        throw new Error(body?.error || `Generation failed (${resp.status})`)
      }
      const data = (await resp.json()) as { post: GeneratedPost }
      setGeneratedPost(data.post)
      setStep('result')
      track(refinement ? 'post_refined' : 'post_generated', {
        post_type: postType,
        post_length: postLength,
        target_subreddit: targetSubreddit,
        ...(refinement ? { refinement_length: refinement.length } : {}),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleRefine() {
    const text = refinementText.trim()
    if (!text || loading) return
    await callGenerate(text)
    setRefinementText('')
  }

  // ─── Step 1: Topic ───────────────────────────────────────────
  if (step === 'topic') {
    const canAdvance = topicMode === 'auto' || topic.trim().length > 0

    const handleTopicNext = () => {
      if (!canAdvance) return
      setStep('options')
      track('post_topic_set', {
        topic_mode: topicMode,
        topic_length: topicMode === 'manual' ? topic.length : 0,
      })
    }

    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="font-display font-bold text-xl text-beetle-ink">
          what do you want to post about?
        </h1>
        <p className="text-sm text-beetle-muted font-body mt-2 leading-relaxed">
          describe the topic or idea. beetle will craft a reddit-native post that drives
          engagement without getting flagged.
        </p>

        {/* Mode picker */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-6">
          <button
            type="button"
            onClick={() => setTopicMode('auto')}
            className={cn(
              'border rounded-xl p-4 cursor-pointer text-center hover:border-beetle-orange transition-colors',
              topicMode === 'auto'
                ? 'border-beetle-orange bg-orange-50'
                : 'border-beetle-border bg-white'
            )}
          >
            <Sparkles
              size={20}
              className={cn(
                'mx-auto',
                topicMode === 'auto' ? 'text-beetle-orange' : 'text-beetle-muted'
              )}
            />
            <p className="font-display font-bold text-sm text-beetle-ink mt-2">
              beetle decides
            </p>
            <p className="text-xs text-beetle-muted font-body mt-1 leading-snug">
              beetle will analyze your product and pick the best topic to post about right now
            </p>
          </button>

          <button
            type="button"
            onClick={() => setTopicMode('manual')}
            className={cn(
              'border rounded-xl p-4 cursor-pointer text-center hover:border-beetle-orange transition-colors',
              topicMode === 'manual'
                ? 'border-beetle-orange bg-orange-50'
                : 'border-beetle-border bg-white'
            )}
          >
            <PenLine
              size={20}
              className={cn(
                'mx-auto',
                topicMode === 'manual' ? 'text-beetle-orange' : 'text-beetle-muted'
              )}
            />
            <p className="font-display font-bold text-sm text-beetle-ink mt-2">
              I&apos;ll choose
            </p>
            <p className="text-xs text-beetle-muted font-body mt-1 leading-snug">
              enter your own topic or idea for the post
            </p>
          </button>
        </div>

        {/* Auto-mode caption / Manual-mode textarea */}
        {topicMode === 'auto' ? (
          <p className="text-xs text-beetle-faint font-body mt-4 italic">
            beetle will choose the best topic based on your product, ICP, and current Reddit trends.
          </p>
        ) : (
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={3}
            placeholder="e.g. 'the challenge of monitoring reddit for brand mentions when you're a small team' or 'why most saas founders underestimate reddit as a channel'"
            className="mt-4 w-full border border-beetle-border rounded-xl px-4 py-3 text-sm font-body text-beetle-ink bg-white placeholder:text-beetle-faint focus:outline-none focus:ring-2 focus:ring-beetle-orange resize-none"
          />
        )}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={handleTopicNext}
            disabled={!canAdvance}
            className="bg-beetle-orange text-white rounded-xl px-6 py-2.5 text-sm font-body font-medium hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      </div>
    )
  }

  // ─── Step 2: Options ─────────────────────────────────────────
  if (step === 'options') {
    const canGenerate = !!postType && !!postLength && !loading

    return (
      <div className="max-w-2xl mx-auto">
        <button
          type="button"
          onClick={() => setStep('topic')}
          className="inline-flex items-center gap-1.5 text-xs font-body text-beetle-muted hover:text-beetle-ink transition-colors mb-5"
        >
          <ArrowLeft size={12} /> Back
        </button>

        <p className="text-xs text-beetle-muted font-body mb-1">your topic</p>
        <p className="text-sm text-beetle-ink font-body italic mb-6">
          {topicMode === 'auto' ? 'beetle will pick a topic for you' : `“${topic}”`}
        </p>

        {/* Post type */}
        <div>
          <label className="block text-sm font-body font-medium text-beetle-ink">
            what kind of post?
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            {POST_TYPES.map((opt) => {
              const Icon = opt.icon
              const selected = postType === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPostType(opt.id)}
                  className={cn(
                    'border rounded-xl p-4 cursor-pointer text-center hover:border-beetle-orange transition-colors',
                    selected
                      ? 'border-beetle-orange bg-orange-50'
                      : 'border-beetle-border bg-white'
                  )}
                >
                  <Icon size={20} className={cn('mx-auto', selected ? 'text-beetle-orange' : 'text-beetle-muted')} />
                  <p className="font-display font-bold text-sm text-beetle-ink mt-2">{opt.title}</p>
                  <p className="text-xs text-beetle-muted font-body mt-1 leading-snug">{opt.desc}</p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Length */}
        <div className="mt-6">
          <label className="block text-sm font-body font-medium text-beetle-ink">how long?</label>
          <div className="flex gap-2 mt-3 flex-wrap">
            {POST_LENGTHS.map((opt) => {
              const selected = postLength === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPostLength(opt.id)}
                  className={cn(
                    'px-4 py-2 rounded-full text-sm font-body cursor-pointer border transition-colors',
                    selected
                      ? 'bg-beetle-orange text-white border-beetle-orange'
                      : 'border-beetle-border text-beetle-muted bg-white hover:bg-beetle-bg'
                  )}
                >
                  {opt.label}
                  <span className={cn('ml-2 text-xs', selected ? 'opacity-90' : 'text-beetle-faint')}>
                    {opt.range}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Target subreddit */}
        <div className="mt-6">
          <label className="block text-sm font-body font-medium text-beetle-ink">
            post to a specific subreddit?
          </label>
          <div className="flex gap-2 flex-wrap mt-3">
            <button
              type="button"
              onClick={() => setTargetSubreddit(null)}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-body cursor-pointer border transition-colors',
                targetSubreddit === null
                  ? 'bg-beetle-orange text-white border-beetle-orange'
                  : 'border-beetle-border text-beetle-muted bg-white hover:bg-beetle-bg'
              )}
            >
              Let beetle suggest
            </button>
            {workspaceSubreddits.map((sub) => {
              const selected = targetSubreddit === sub
              return (
                <button
                  key={sub}
                  type="button"
                  onClick={() => setTargetSubreddit(selected ? null : sub)}
                  className={cn(
                    'px-4 py-2 rounded-full text-sm font-body cursor-pointer border transition-colors',
                    selected
                      ? 'bg-beetle-orange text-white border-beetle-orange'
                      : 'border-beetle-border text-beetle-muted bg-white hover:bg-beetle-bg'
                  )}
                >
                  r/{sub}
                </button>
              )
            })}
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm font-body text-red-700">
            {error}
          </div>
        )}

        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={() => callGenerate()}
            disabled={!canGenerate}
            className="bg-beetle-orange text-white rounded-xl px-8 py-3 text-sm font-body font-medium hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Generating…
              </>
            ) : (
              'Generate post →'
            )}
          </button>
        </div>
      </div>
    )
  }

  // ─── Step 3: Result ──────────────────────────────────────────
  if (!generatedPost) {
    return (
      <div className="max-w-2xl mx-auto text-center">
        <p className="text-sm text-beetle-muted font-body">No post generated yet.</p>
        <button
          type="button"
          onClick={startOver}
          className="mt-4 text-xs font-body text-beetle-muted hover:text-beetle-ink"
        >
          Start over
        </button>
      </div>
    )
  }

  const post = generatedPost
  const fullPost = `${post.title}\n\n${post.body}`
  const firstBest =
    post.suggested_subreddits.find((s) => s.fit === 'best') ?? post.suggested_subreddits[0] ?? null
  const redditSubmitUrl = firstBest
    ? `https://www.reddit.com/r/${firstBest.name}/submit`
    : 'https://www.reddit.com/submit'

  return (
    <div className="max-w-2xl mx-auto">
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm font-body text-red-700">
          {error}
        </div>
      )}

      {/* Post preview card */}
      <div
        className={cn(
          'bg-white border border-beetle-border rounded-2xl p-6 transition-opacity',
          loading && 'opacity-50 pointer-events-none animate-pulse'
        )}
      >
        <span
          className={cn(
            'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-body font-medium tracking-wide',
            postTypePill(post.post_type)
          )}
        >
          {post.post_type.toUpperCase()}
        </span>

        <h2 className="font-display font-bold text-lg text-beetle-ink mt-3 leading-snug">
          {post.title}
        </h2>

        <p className="text-sm text-beetle-ink font-body leading-relaxed whitespace-pre-wrap mt-3">
          {post.body}
        </p>

        <div className="my-4 border-t border-beetle-border" />

        <p className="text-xs text-beetle-muted font-body font-medium uppercase tracking-wider">
          Ending question:
        </p>
        <p className="text-sm text-beetle-ink font-body italic mt-1">
          {post.engagement_hook || '(no explicit hook returned)'}
        </p>

        <p className="text-xs text-beetle-faint font-body mt-3">~{post.word_count} words</p>
      </div>

      {/* Refinement (moved up so it sits right under the post card) */}
      <div className="mt-6">
        <p className="text-xs text-beetle-muted font-body font-medium uppercase tracking-wider mb-2">
          Tweak it
        </p>
        <div className="flex gap-2">
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
            disabled={loading}
            placeholder="make it shorter, change the angle, make it more controversial..."
            className="flex-1 border border-beetle-border rounded-lg px-3 py-2 text-sm font-body text-beetle-ink bg-white focus:outline-none focus:ring-2 focus:ring-beetle-orange disabled:opacity-60"
          />
          <button
            type="button"
            onClick={handleRefine}
            disabled={loading || !refinementText.trim()}
            className="bg-beetle-orange text-white rounded-lg px-4 py-2 text-sm font-body hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Refine
          </button>
        </div>
      </div>

      {/* Suggested subreddits */}
      {post.suggested_subreddits.length > 0 && (
        <div className="mt-6">
          <p className="text-xs text-beetle-muted font-body font-medium uppercase tracking-wider">
            Best subreddits for this post
          </p>
          <div className="mt-3 space-y-2">
            {post.suggested_subreddits.map((s) => {
              const pill = fitPill(s.fit)
              return (
                <div
                  key={s.name}
                  className="bg-white border border-beetle-border rounded-xl p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-body font-medium text-beetle-ink">
                        r/{s.name}
                      </p>
                      {s.reason && (
                        <p className="text-xs text-beetle-muted font-body mt-0.5">{s.reason}</p>
                      )}
                    </div>
                    <span
                      className={cn(
                        'shrink-0 inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-body font-medium tracking-wide',
                        pill.className
                      )}
                    >
                      {pill.label}
                    </span>
                  </div>
                  {s.warning && (
                    <p className="text-xs text-amber-600 font-body italic mt-1">{s.warning}</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* GEO keywords */}
      {post.geo_keywords.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-beetle-muted font-body font-medium uppercase tracking-wider">
            GEO keywords this post targets
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {post.geo_keywords.map((kw) => (
              <span
                key={kw}
                className="text-xs bg-beetle-bg text-beetle-ink px-2 py-1 rounded-md font-body"
              >
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => copyToClipboard(post.title, 'title', 'post_title_copied')}
          className="inline-flex items-center gap-1.5 text-sm border border-beetle-border rounded-lg px-4 py-2 text-beetle-muted hover:text-beetle-ink transition-colors font-body"
        >
          <Copy size={14} />
          {copiedKey === 'title' ? 'Copied ✓' : 'Copy title'}
        </button>
        <button
          type="button"
          onClick={() => copyToClipboard(fullPost, 'full', 'post_full_copied')}
          className="inline-flex items-center gap-1.5 text-sm bg-beetle-orange text-white rounded-lg px-4 py-2 hover:opacity-90 transition-opacity font-body font-medium"
        >
          <Copy size={14} />
          {copiedKey === 'full' ? 'Copied ✓' : 'Copy full post'}
        </button>
        <button
          type="button"
          onClick={() => window.open(redditSubmitUrl, '_blank', 'noopener,noreferrer')}
          className="inline-flex items-center gap-1.5 text-sm border border-beetle-border rounded-lg px-4 py-2 text-beetle-muted hover:text-beetle-ink transition-colors font-body"
        >
          <ExternalLink size={14} />
          Open Reddit{firstBest ? ` (r/${firstBest.name})` : ''}
        </button>
      </div>

      {/* Start over */}
      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={startOver}
          className="inline-flex items-center gap-1.5 text-xs font-body text-beetle-muted hover:text-beetle-ink transition-colors"
        >
          <RefreshCw size={12} />
          Start over
        </button>
      </div>
    </div>
  )
}
