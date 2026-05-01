'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUp, Loader2, MessageCircle, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { track } from '@/lib/analytics'

interface SearchViewProps {
  workspaceSubreddits: string[]
}

interface SearchResult {
  id: string
  reddit_id: string
  title: string
  subreddit: string
  body: string | null
  upvotes: number | null
  comment_count: number | null
  url: string
  reddit_created_at: string
}

const MAX_FILTER_SUBS = 3

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

function bodyPreview(body: string | null): string {
  if (!body) return ''
  const trimmed = body.trim()
  if (trimmed.length <= 150) return trimmed
  return trimmed.slice(0, 150).trim() + '…'
}

export default function SearchView({ workspaceSubreddits }: SearchViewProps) {
  const router = useRouter()

  const [query, setQuery] = useState('')
  const [selectedSubreddits, setSelectedSubreddits] = useState<string[]>([])
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function selectAllOfReddit() {
    setSelectedSubreddits([])
  }

  function toggleSubreddit(sub: string) {
    setSelectedSubreddits((prev) => {
      if (prev.includes(sub)) {
        return prev.filter((s) => s !== sub)
      }
      // Cap at MAX_FILTER_SUBS — silently drop the click if at max
      if (prev.length >= MAX_FILTER_SUBS) return prev
      return [...prev, sub]
    })
  }

  async function handleSearch() {
    const q = query.trim()
    if (!q || loading) return

    setLoading(true)
    setError(null)
    setSearched(true)
    track('search_executed', {
      query_length: q.length,
      sub_count: selectedSubreddits.length,
    })

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: q,
          subreddits: selectedSubreddits.slice(0, MAX_FILTER_SUBS),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `Search failed (${res.status})`)
      }
      const data = (await res.json()) as { threads: SearchResult[]; total: number }
      setResults(data.threads ?? [])
    } catch (err) {
      console.error('search failed:', err)
      setError(err instanceof Error ? err.message : 'Search failed')
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  function handleResultClick(result: SearchResult) {
    track('search_result_opened', { reddit_id: result.reddit_id })
    router.push(`/dashboard?threadId=${result.reddit_id}`)
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Search input row */}
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSearch()
            }
          }}
          disabled={loading}
          placeholder="search reddit for anything... e.g. 'people frustrated with Hootsuite pricing'"
          className="flex-1 border border-beetle-border rounded-xl px-4 py-3 text-sm font-body text-beetle-ink bg-white placeholder:text-beetle-faint focus:outline-none focus:ring-2 focus:ring-beetle-orange disabled:opacity-60"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="bg-beetle-orange text-white rounded-xl px-5 py-3 text-sm font-body font-medium hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Search size={16} />
          )}
          Search
        </button>
      </div>

      {/* Subreddit filter chips */}
      {workspaceSubreddits.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-beetle-muted font-body">Search in:</p>
          <div className="flex flex-wrap gap-2 mt-1">
            <button
              type="button"
              onClick={selectAllOfReddit}
              className={cn(
                'text-xs font-body px-3 py-1 rounded-full transition-colors',
                selectedSubreddits.length === 0
                  ? 'bg-beetle-orange text-white'
                  : 'border border-beetle-border text-beetle-muted bg-white hover:bg-beetle-bg cursor-pointer'
              )}
            >
              All of Reddit
            </button>
            {workspaceSubreddits.map((sub) => {
              const selected = selectedSubreddits.includes(sub)
              const atCap = !selected && selectedSubreddits.length >= MAX_FILTER_SUBS
              return (
                <button
                  key={sub}
                  type="button"
                  onClick={() => toggleSubreddit(sub)}
                  disabled={atCap}
                  className={cn(
                    'text-xs font-body px-3 py-1 rounded-full transition-colors',
                    selected
                      ? 'bg-beetle-orange text-white'
                      : 'border border-beetle-border text-beetle-muted bg-white hover:bg-beetle-bg cursor-pointer',
                    atCap && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  r/{sub}
                </button>
              )
            })}
          </div>
          {selectedSubreddits.length >= MAX_FILTER_SUBS && (
            <p className="text-[10px] text-beetle-faint font-body mt-1.5">
              Limit of {MAX_FILTER_SUBS} subreddits per search.
            </p>
          )}
        </div>
      )}

      {/* Results */}
      <div className="mt-6">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm font-body text-red-700 mb-3">
            {error}
          </div>
        )}

        {!searched && !loading && !error && (
          <div className="min-h-[40vh] flex flex-col items-center justify-center text-center">
            <Search size={32} className="text-beetle-muted" />
            <h2 className="font-display font-bold text-base text-beetle-ink mt-3">
              Search Reddit for any topic
            </h2>
            <p className="text-sm text-beetle-muted font-body mt-2 max-w-sm">
              Find threads about competitors, pain points, product comparisons,
              or anything else.
            </p>
          </div>
        )}

        {loading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="bg-white border border-beetle-border rounded-xl p-4 space-y-2"
                aria-label="Searching"
              >
                <div className="h-3 bg-beetle-bg rounded animate-pulse w-1/3" />
                <div className="h-4 bg-beetle-bg rounded animate-pulse w-11/12 mt-3" />
                <div className="h-3 bg-beetle-bg rounded animate-pulse w-10/12 mt-2" />
                <div className="h-3 bg-beetle-bg rounded animate-pulse w-8/12" />
              </div>
            ))}
          </div>
        )}

        {searched && !loading && !error && results.length === 0 && (
          <div className="min-h-[40vh] flex flex-col items-center justify-center text-center">
            <p className="text-sm font-body font-medium text-beetle-ink">
              No threads found for this search
            </p>
            <p className="text-sm text-beetle-muted font-body mt-1">
              Try different keywords or broaden your search.
            </p>
          </div>
        )}

        {!loading && results.length > 0 && (
          <div>
            <p className="text-xs text-beetle-muted font-body mb-3">
              {results.length} result{results.length === 1 ? '' : 's'}
            </p>
            {results.map((r) => (
              <div
                key={r.id}
                onClick={() => handleResultClick(r)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleResultClick(r)
                  }
                }}
                className="bg-white border border-beetle-border rounded-xl p-4 mb-3 cursor-pointer hover:border-beetle-orange transition-colors"
              >
                <div className="flex items-center gap-2 text-xs text-beetle-muted font-body flex-wrap">
                  <span>r/{r.subreddit}</span>
                  <span className="text-beetle-faint">·</span>
                  <span>{relativeTime(r.reddit_created_at)}</span>
                  <span className="text-beetle-faint">·</span>
                  <span className="inline-flex items-center gap-1">
                    <ArrowUp size={11} /> {r.upvotes ?? 0}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MessageCircle size={11} /> {r.comment_count ?? 0}
                  </span>
                </div>

                <p className="text-sm font-body font-medium text-beetle-ink mt-2 line-clamp-2">
                  {r.title}
                </p>

                {bodyPreview(r.body) && (
                  <p className="text-xs text-beetle-muted font-body mt-1 line-clamp-2">
                    {bodyPreview(r.body)}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
