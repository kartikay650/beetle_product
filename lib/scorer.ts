// Batched Claude Haiku scoring. ONE API call per crawl, up to 10 threads.
// Writes to thread_scores. Skips threads that already have a score row.
import Anthropic from '@anthropic-ai/sdk'
import { adminClient } from '@/lib/supabase/admin'

export interface ThreadToScore {
  id: string // our DB uuid
  reddit_id: string
  title: string
  body: string
  subreddit: string
  upvotes: number
  top_comments: Array<{ author: string; body: string; upvotes: number }>
}

export interface ScoreResult {
  thread_id: string // our DB uuid
  relevance_score: number // 1-10
  summary: string // 2-3 sentences max
  key_insight: string // 1 sentence
  competitor_mentioned: boolean
}

export interface ScoringWorkspace {
  product_name: string
  product_description: string
  icp_description: string
  keywords: string[]
  competitors: string[]
}

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 2000

export async function batchScoreThreads(
  threads: ThreadToScore[],
  workspace: ScoringWorkspace
): Promise<ScoreResult[]> {
  if (threads.length === 0) return []

  const systemPrompt = `You are a relevance scoring assistant for ${workspace.product_name}.
Product: ${workspace.product_description}
ICP: ${workspace.icp_description}
Keywords being tracked: ${workspace.keywords.join(', ')}
Competitors: ${workspace.competitors.join(', ') || 'none specified'}

Score each Reddit thread for relevance to this product and ICP.
Return ONLY a valid JSON array. No markdown. No explanation. No preamble.
Just the raw JSON array.`

  const userPrompt = `Score these ${threads.length} Reddit threads.

${threads
  .map(
    (t, i) => `
THREAD ${i + 1}
ID: ${t.id}
Subreddit: r/${t.subreddit}
Title: ${t.title}
Body: ${t.body?.slice(0, 500) || '(no body)'}
Top comment: ${t.top_comments?.[0]?.body?.slice(0, 200) || '(none)'}
Upvotes: ${t.upvotes}
`
  )
  .join('\n---\n')}

Return a JSON array with exactly ${threads.length} objects.
Each object must have these exact fields:
{
  "thread_id": "(the ID field from above)",
  "relevance_score": (integer 1-10, where 10 = highly relevant to the product/ICP),
  "summary": "(2-3 sentences: what this thread is about and why someone posted it)",
  "key_insight": "(1 sentence: the core pain, question, or opportunity in this thread)",
  "competitor_mentioned": (true if any competitor from the list appears in title/body, else false)
}

Scoring guide:
9-10: Thread is directly about the problem this product solves, high buyer intent
7-8: Thread is relevant to the ICP and touches on related pain points
5-6: Loosely related, could be relevant with the right reply
3-4: Tangentially related, low relevance
1-2: Not relevant to this product or ICP at all`

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const firstBlock = response.content[0]
    const text = firstBlock && firstBlock.type === 'text' ? firstBlock.text : ''
    const clean = text.replace(/```json|```/g, '').trim()

    try {
      const results = JSON.parse(clean) as ScoreResult[]
      if (!Array.isArray(results)) {
        console.error('batchScoreThreads: parsed value is not an array. raw:', clean.substring(0, 500))
        return []
      }
      return results
    } catch (parseErr) {
      console.error('batchScoreThreads: JSON parse failed:', parseErr)
      console.error('batchScoreThreads raw response:', text.substring(0, 1500))
      return []
    }
  } catch (err) {
    console.error('batchScoreThreads: Claude call failed:', err)
    return []
  }
}

export async function scoreAndStore(
  threads: ThreadToScore[],
  workspace: ScoringWorkspace,
  jobId: string
): Promise<number> {
  if (threads.length === 0) return 0

  // Skip threads that already have a score row
  const { data: existing } = await adminClient
    .from('thread_scores')
    .select('thread_id')
    .in('thread_id', threads.map((t) => t.id))

  const alreadyScored = new Set((existing ?? []).map((r) => r.thread_id as string))
  const toScore = threads.filter((t) => !alreadyScored.has(t.id))

  if (toScore.length === 0) {
    console.log('scoreAndStore: all threads already scored, skipping')
    return 0
  }

  const results = await batchScoreThreads(toScore, workspace)

  if (results.length === 0) {
    console.error('scoreAndStore: no results returned from Claude')
    return 0
  }

  // Upsert all results in one operation, keyed by thread_id
  const rows = results
    .filter((r) => r && typeof r.thread_id === 'string')
    .map((r) => ({
      thread_id: r.thread_id,
      relevance_score: Math.max(1, Math.min(10, Math.round(Number(r.relevance_score)))),
      summary: String(r.summary ?? ''),
      key_insight: String(r.key_insight ?? ''),
      competitor_mentioned: Boolean(r.competitor_mentioned),
      scored_at: new Date().toISOString(),
    }))

  if (rows.length === 0) return 0

  const { error: upsertErr } = await adminClient
    .from('thread_scores')
    .upsert(rows, { onConflict: 'thread_id' })

  if (upsertErr) {
    console.error('scoreAndStore: upsert failed:', upsertErr)
    return 0
  }

  const { error: jobErr } = await adminClient
    .from('crawl_jobs')
    .update({ threads_scored: rows.length })
    .eq('id', jobId)

  if (jobErr) {
    console.error('scoreAndStore: job count update failed:', jobErr)
  }

  console.log(`scoreAndStore: ${rows.length} scored in one batched Claude call for job ${jobId}`)
  return rows.length
}
