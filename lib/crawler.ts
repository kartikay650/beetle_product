import { adminClient } from '@/lib/supabase/admin'

const APIFY_BASE = 'https://api.apify.com/v2'
// Apify URL path uses `~` as separator, not `/`
const ACTOR = 'harshmaur~reddit-scraper'

// HARD LIMIT — never increase
const MAX_RESULTS = 25

export async function runApifyCrawl(
  keywords: string[],
  subreddits: string[]
): Promise<string> {
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

  const normalizedSubs = subreddits.map((s) => s.replace(/^r\//i, '').trim()).filter(Boolean)

  const input = {
    searchTerms: keywords,
    searchPosts: true,
    searchComments: false,
    searchCommunities: false,
    withinCommunity: normalizedSubs.join(' OR r/'),
    searchSort: 'relevance',
    searchTime: 'week',
    maxResults: MAX_RESULTS,
  }

  console.log('APIFY INPUT:', input)

  const endpoint = `${APIFY_BASE}/acts/${ACTOR}/runs?token=${token}`
  console.log('APIFY ENDPOINT:', endpoint.replace(token, 'REDACTED'))

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })

  console.log('APIFY RESPONSE STATUS:', response.status)

  if (!response.ok) {
    const text = await response.text()
    console.error('APIFY API ERROR BODY:', text)
    throw new Error(`Apify API ${response.status}: ${text}`)
  }

  const json = (await response.json()) as { data?: { id?: string; status?: string } }
  console.log('APIFY RUN RESPONSE:', json)

  const run = json.data
  if (!run?.id) {
    throw new Error(`Apify returned unexpected payload: ${JSON.stringify(json)}`)
  }

  console.log('APIFY RUN STARTED:', run.id)
  return run.id
}

export interface ApifyRunStatus {
  status: 'READY' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED-OUT' | 'ABORTED' | string
  finishedAt: string | null
  defaultDatasetId: string | null
}

export async function checkApifyRun(runId: string): Promise<ApifyRunStatus> {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw new Error('APIFY_API_TOKEN is not set')

  const response = await fetch(
    `${APIFY_BASE}/actor-runs/${runId}?token=${token}`
  )
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`checkApifyRun ${response.status}: ${text}`)
  }

  const json = (await response.json()) as {
    data?: { status?: string; finishedAt?: string; defaultDatasetId?: string }
  }
  const data = json.data ?? {}

  return {
    status: data.status ?? 'UNKNOWN',
    finishedAt: data.finishedAt ?? null,
    defaultDatasetId: data.defaultDatasetId ?? null,
  }
}

export async function fetchApifyResults(runId: string): Promise<unknown[]> {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw new Error('APIFY_API_TOKEN is not set')

  const runResp = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${token}`)
  if (!runResp.ok) {
    throw new Error(`fetchApifyResults run fetch ${runResp.status}`)
  }
  const runJson = (await runResp.json()) as { data?: { defaultDatasetId?: string } }
  const datasetId = runJson.data?.defaultDatasetId
  if (!datasetId) {
    throw new Error('Apify run has no defaultDatasetId')
  }

  const dsResp = await fetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&clean=true&limit=${MAX_RESULTS}`
  )
  if (!dsResp.ok) {
    throw new Error(`fetchApifyResults dataset fetch ${dsResp.status}`)
  }

  const items = (await dsResp.json()) as unknown[]
  console.log('APIFY RESULT COUNT:', items.length)
  return items
}

export interface ThreadRow {
  workspace_id: string
  reddit_id: string
  title: string
  body: string | null
  subreddit: string
  permalink: string
  author: string | null
  score: number
  num_comments: number
  created_at: string
  status: 'new'
}

type ApifyRedditItem = {
  id?: string
  postId?: string
  title?: string
  body?: string
  selftext?: string
  subreddit?: string
  community?: string
  url?: string
  permalink?: string
  author?: string
  username?: string
  score?: number | string
  ups?: number | string
  numComments?: number | string
  num_comments?: number | string
  createdAt?: string
  created?: string | number
}

export function mapApifyToThread(
  item: unknown,
  workspaceId: string
): ThreadRow | null {
  const raw = item as ApifyRedditItem
  const redditId = raw.id ?? raw.postId
  const title = raw.title
  if (!redditId || !title) return null

  const subreddit = String(raw.subreddit ?? raw.community ?? '')
    .replace(/^r\//i, '')
    .toLowerCase()

  const permalink = raw.permalink
    ? (raw.permalink.startsWith('http')
        ? raw.permalink
        : `https://www.reddit.com${raw.permalink}`)
    : (raw.url ?? '')

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
    permalink,
    author: raw.author ?? raw.username ?? null,
    score: Number(raw.score ?? raw.ups ?? 0),
    num_comments: Number(raw.numComments ?? raw.num_comments ?? 0),
    created_at: createdAtIso,
    status: 'new',
  }
}

export async function storeThreads(
  workspaceId: string,
  items: unknown[]
): Promise<{ inserted: number }> {
  const rows = items
    .map((item) => mapApifyToThread(item, workspaceId))
    .filter((r): r is ThreadRow => r !== null)

  if (rows.length === 0) {
    console.log('storeThreads: no valid rows to insert')
    return { inserted: 0 }
  }

  const { data, error } = await adminClient
    .from('threads')
    .upsert(rows, { onConflict: 'workspace_id,reddit_id' })
    .select('id')

  if (error) {
    console.error('storeThreads error:', error)
    throw new Error(`storeThreads: ${error.message}`)
  }

  console.log('storeThreads inserted:', data?.length ?? 0)
  return { inserted: data?.length ?? 0 }
}
