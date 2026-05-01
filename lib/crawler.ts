import { adminClient } from '@/lib/supabase/admin'

const APIFY_BASE = 'https://api.apify.com/v2'
// Apify URL path uses `~` as separator, not `/`
const ACTOR = 'harshmaur~reddit-scraper'

// HARD LIMIT — never increase
const MAX_RESULTS = 25

// The actor only accepts ONE community via withinCommunity (format r/name).
// For multi-subreddit coverage we fan out one run per subreddit and merge results.
function normalizeSub(s: string): string {
  return s.replace(/^r\//i, '').trim().toLowerCase()
}

function subMaxResults(totalSubs: number): number {
  // Each sub can produce up to ceil(25 / N) items — final list is capped/deduped downstream.
  return Math.max(5, Math.ceil(MAX_RESULTS / Math.max(1, totalSubs)))
}

export async function runApifyCrawl(
  keywords: string[],
  subreddits: string[]
): Promise<string[]> {
  console.log('APIFY TOKEN EXISTS:', !!process.env.APIFY_API_TOKEN)
  console.log('APIFY TOKEN PREFIX:', process.env.APIFY_API_TOKEN?.substring(0, 15))
  console.log('KEYWORDS:', keywords)
  console.log('SUBREDDITS:', subreddits)

  const token = process.env.APIFY_API_TOKEN
  if (!token) {
    throw new Error('APIFY_API_TOKEN is not set in environment')
  }
  if (!keywords || keywords.length === 0) {
    throw new Error('No keywords configured for this workspace')
  }
  if (!subreddits || subreddits.length === 0) {
    throw new Error('No subreddits configured for this workspace')
  }

  const normalizedSubs = subreddits.map(normalizeSub).filter(Boolean)
  const perSub = subMaxResults(normalizedSubs.length)
  console.log('PER-SUB MAX:', perSub, 'across', normalizedSubs.length, 'subs')

  // Kick off one Apify run per subreddit in parallel. The actor rejects
  // multi-community withinCommunity values, so we shard across runs.
  const runIds = await Promise.all(
    normalizedSubs.map(async (sub) => {
      const input = {
        searchTerms: keywords,
        searchPosts: true,
        searchComments: false,
        searchCommunities: false,
        withinCommunity: `r/${sub}`,
        searchSort: 'relevance',
        searchTime: 'week',
        maxResults: perSub,
      }
      const endpoint = `${APIFY_BASE}/acts/${ACTOR}/runs?token=${token}`
      console.log(`[${sub}] APIFY INPUT:`, input)

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })

      console.log(`[${sub}] APIFY RESPONSE STATUS:`, response.status)
      if (!response.ok) {
        const text = await response.text()
        console.error(`[${sub}] APIFY API ERROR BODY:`, text)
        throw new Error(`Apify API ${response.status} for r/${sub}: ${text}`)
      }

      const json = (await response.json()) as { data?: { id?: string } }
      const id = json.data?.id
      if (!id) {
        throw new Error(`Apify returned no run id for r/${sub}: ${JSON.stringify(json)}`)
      }
      console.log(`[${sub}] APIFY RUN STARTED:`, id)
      return id
    })
  )

  console.log('ALL APIFY RUNS STARTED:', runIds)
  return runIds
}

export interface ApifyRunStatus {
  status: 'READY' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED-OUT' | 'ABORTED' | string
  finishedAt: string | null
  defaultDatasetId: string | null
  statusMessage?: string | null
}

// Apify's /actor-runs endpoint occasionally returns 502/503 under load. Retry transparently
// up to MAX_RETRIES with a 3s back-off so a transient gateway hiccup doesn't fail the whole job.
const APIFY_MAX_RETRIES = 3
const APIFY_RETRY_DELAY_MS = 3000

async function checkSingleRun(
  runId: string,
  token: string,
  attempt = 0
): Promise<ApifyRunStatus> {
  const response = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${token}`)
  if (!response.ok) {
    if ((response.status === 502 || response.status === 503) && attempt < APIFY_MAX_RETRIES) {
      console.warn(
        `checkApifyRun ${response.status} for ${runId}, retrying in ${APIFY_RETRY_DELAY_MS}ms (attempt ${attempt + 1}/${APIFY_MAX_RETRIES})`
      )
      await new Promise((r) => setTimeout(r, APIFY_RETRY_DELAY_MS))
      return checkSingleRun(runId, token, attempt + 1)
    }
    const text = await response.text()
    throw new Error(`checkApifyRun ${response.status}: ${text}`)
  }
  const json = (await response.json()) as {
    data?: { status?: string; finishedAt?: string; defaultDatasetId?: string; statusMessage?: string }
  }
  const data = json.data ?? {}
  return {
    status: data.status ?? 'UNKNOWN',
    finishedAt: data.finishedAt ?? null,
    defaultDatasetId: data.defaultDatasetId ?? null,
    statusMessage: data.statusMessage ?? null,
  }
}

// Aggregate status across N parallel runs. Overall is SUCCEEDED when every
// run has reached a terminal state AND at least one SUCCEEDED. If all terminal
// runs are FAILED/ABORTED/TIMED-OUT we report FAILED.
export async function checkApifyRuns(runIds: string[]): Promise<{
  overall: 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  perRun: Array<{ runId: string } & ApifyRunStatus>
}> {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw new Error('APIFY_API_TOKEN is not set')

  const perRun = await Promise.all(
    runIds.map(async (runId) => ({ runId, ...(await checkSingleRun(runId, token)) }))
  )

  const terminal = perRun.every((r) =>
    ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(r.status)
  )
  if (!terminal) return { overall: 'RUNNING', perRun }

  const anySuccess = perRun.some((r) => r.status === 'SUCCEEDED')
  return { overall: anySuccess ? 'SUCCEEDED' : 'FAILED', perRun }
}

export async function fetchApifyResults(runIds: string[]): Promise<unknown[]> {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw new Error('APIFY_API_TOKEN is not set')

  // Sequential fetch with a decreasing budget so the total merged item count
  // never exceeds MAX_RESULTS. If run 1 returns 18, runs 2-4 share the remaining 7.
  // Once the budget hits zero we skip the remaining dataset fetches entirely.
  const merged: unknown[] = []

  for (const runId of runIds) {
    const remaining = MAX_RESULTS - merged.length
    if (remaining <= 0) {
      console.log(`fetchApifyResults: budget exhausted, skipping run ${runId}`)
      continue
    }

    const runResp = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${token}`)
    if (!runResp.ok) {
      console.error(`fetchApifyResults run fetch ${runResp.status} for ${runId}`)
      continue
    }
    const runJson = (await runResp.json()) as { data?: { defaultDatasetId?: string; status?: string } }
    const datasetId = runJson.data?.defaultDatasetId
    const status = runJson.data?.status
    if (status !== 'SUCCEEDED' || !datasetId) {
      console.log(`skipping ${runId}: status=${status}, datasetId=${datasetId}`)
      continue
    }

    const dsResp = await fetch(
      `${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&clean=true&limit=${remaining}`
    )
    if (!dsResp.ok) {
      console.error(`dataset fetch ${dsResp.status} for ${datasetId}`)
      continue
    }
    const items = (await dsResp.json()) as unknown[]
    console.log(`run ${runId}: fetched ${items.length} items (budget was ${remaining})`)
    merged.push(...items)
  }

  console.log('TOTAL MERGED ITEMS:', merged.length, '/ cap', MAX_RESULTS)
  return merged
}

export interface ThreadRow {
  workspace_id: string
  reddit_id: string
  title: string
  body: string | null
  subreddit: string
  url: string
  author: string | null
  upvotes: number
  comment_count: number
  reddit_created_at: string
  status: 'new'
}

// Actor field names (confirmed from a live run of harshmaur/reddit-scraper):
//   id: 't3_xxxx' (reddit fullname)       parsedId: 'xxxx' (bare id)
//   title, body, bodyHtml
//   authorName, authorId
//   communityName: 'r/saas' · parsedCommunityName: 'saas'
//   postUrl, contentUrl
//   upVotes, commentsCount
//   createdAt: ISO string
type ApifyRedditItem = {
  id?: string
  parsedId?: string
  postId?: string
  title?: string
  body?: string
  selftext?: string
  subreddit?: string
  community?: string
  communityName?: string
  parsedCommunityName?: string
  url?: string
  postUrl?: string
  contentUrl?: string
  permalink?: string
  author?: string
  authorName?: string
  username?: string
  score?: number | string
  upVotes?: number | string
  ups?: number | string
  commentsCount?: number | string
  numComments?: number | string
  num_comments?: number | string
  createdAt?: string | number
  created?: string | number
}

export function mapApifyToThread(
  item: unknown,
  workspaceId: string
): ThreadRow | null {
  const raw = item as ApifyRedditItem
  const redditId = raw.parsedId ?? raw.postId ?? raw.id
  const title = raw.title
  if (!redditId || !title) return null

  const subredditRaw =
    raw.parsedCommunityName ?? raw.communityName ?? raw.subreddit ?? raw.community ?? ''
  const subreddit = String(subredditRaw).replace(/^r\//i, '').toLowerCase()

  const urlRaw = raw.postUrl ?? raw.permalink ?? raw.url ?? ''
  const url = urlRaw
    ? urlRaw.startsWith('http')
      ? urlRaw
      : `https://www.reddit.com${urlRaw}`
    : ''

  const createdAtIso = (() => {
    const v = raw.createdAt ?? raw.created
    if (!v) return new Date().toISOString()
    if (typeof v === 'number') return new Date(v * 1000).toISOString()
    const d = new Date(v)
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
  })()

  return {
    workspace_id: workspaceId,
    reddit_id: String(redditId),
    title: String(title),
    body: raw.body ?? raw.selftext ?? null,
    subreddit,
    url,
    author: raw.authorName ?? raw.author ?? raw.username ?? null,
    upvotes: Number(raw.upVotes ?? raw.score ?? raw.ups ?? 0),
    comment_count: Number(raw.commentsCount ?? raw.numComments ?? raw.num_comments ?? 0),
    reddit_created_at: createdAtIso,
    status: 'new',
  }
}

export async function storeThreads(
  workspaceId: string,
  items: unknown[]
): Promise<{ inserted: number }> {
  // Dedupe by reddit_id, then sort by score desc, cap at MAX_RESULTS.
  const mapped = items
    .map((item) => mapApifyToThread(item, workspaceId))
    .filter((r): r is ThreadRow => r !== null)

  const uniq = new Map<string, ThreadRow>()
  for (const row of mapped) {
    const prev = uniq.get(row.reddit_id)
    if (!prev || row.upvotes > prev.upvotes) uniq.set(row.reddit_id, row)
  }

  const rows = Array.from(uniq.values())
    .sort((a, b) => b.upvotes - a.upvotes)
    .slice(0, MAX_RESULTS)

  if (rows.length === 0) {
    console.log('storeThreads: no valid rows to insert')
    return { inserted: 0 }
  }

  const { data, error } = await adminClient
    .from('threads')
    .upsert(rows, { onConflict: 'reddit_id' })
    .select('id')

  if (error) {
    console.error('storeThreads error:', error)
    throw new Error(`storeThreads: ${error.message}`)
  }

  console.log('storeThreads inserted:', data?.length ?? 0)
  return { inserted: data?.length ?? 0 }
}

// On-demand search. Used by /api/search to fan out a single user prompt to Apify.
// Synchronous from the caller's perspective: starts run(s), polls until terminal,
// returns raw items. Up to 3 runs (one per subreddit) if subreddits are provided;
// otherwise a single Reddit-wide run with no withinCommunity filter.
const SEARCH_PER_RUN = 15
const SEARCH_MAX_SUBS = 3
const SEARCH_POLL_MS = 3000
const SEARCH_MAX_SECONDS = 50

export async function searchReddit(
  query: string,
  subreddits?: string[]
): Promise<unknown[]> {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw new Error('APIFY_API_TOKEN is not set in environment')

  const trimmedQuery = query.trim()
  if (!trimmedQuery) throw new Error('query is required')

  const subs = (subreddits ?? [])
    .map(normalizeSub)
    .filter(Boolean)
    .slice(0, SEARCH_MAX_SUBS)

  const targets =
    subs.length > 0
      ? subs.map((s) => ({ withinCommunity: `r/${s}`, label: s }))
      : [{ withinCommunity: '', label: 'all-of-reddit' }]

  console.log(`SEARCH: query="${trimmedQuery}" targets=${targets.length}`)

  // Start runs in parallel
  const runIds = await Promise.all(
    targets.map(async ({ withinCommunity, label }) => {
      const input: Record<string, unknown> = {
        searchTerms: [trimmedQuery],
        searchPosts: true,
        searchComments: false,
        searchCommunities: false,
        searchSort: 'relevance',
        searchTime: 'month',
        maxResults: SEARCH_PER_RUN,
      }
      if (withinCommunity) input.withinCommunity = withinCommunity

      const r = await fetch(`${APIFY_BASE}/acts/${ACTOR}/runs?token=${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!r.ok) {
        const text = await r.text()
        console.error(`SEARCH start [${label}] failed:`, r.status, text)
        throw new Error(`Search Apify ${r.status} for ${label}: ${text}`)
      }
      const j = (await r.json()) as { data?: { id?: string } }
      const id = j.data?.id
      if (!id) throw new Error(`Search returned no run id for ${label}`)
      console.log(`SEARCH run started [${label}]: ${id}`)
      return id
    })
  )

  // Poll until all reach a terminal state (50s cap leaves headroom inside route's 60s budget).
  const start = Date.now()
  let aggregate = await checkApifyRuns(runIds)
  while (
    aggregate.overall === 'RUNNING' &&
    (Date.now() - start) / 1000 < SEARCH_MAX_SECONDS
  ) {
    await new Promise((r) => setTimeout(r, SEARCH_POLL_MS))
    aggregate = await checkApifyRuns(runIds)
  }

  if (aggregate.overall === 'FAILED') {
    const msg = aggregate.perRun
      .map((r) => `${r.runId}=${r.status}${r.statusMessage ? ` (${r.statusMessage})` : ''}`)
      .join('; ')
    throw new Error(`All search runs failed: ${msg}`)
  }

  // Reuse the existing fetcher (sequential, capped at MAX_RESULTS=25 total).
  // Final 15-cap is applied by the route after dedupe.
  const items = await fetchApifyResults(runIds)
  console.log(`SEARCH fetched ${items.length} items across ${runIds.length} runs`)
  return items
}
