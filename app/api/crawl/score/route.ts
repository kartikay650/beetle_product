import { NextResponse } from 'next/server'
import { adminClient } from '@/lib/supabase/admin'
import { scoreAndStore, type ThreadToScore, type ScoringWorkspace } from '@/lib/scorer'

export const maxDuration = 60

export async function POST(request: Request) {
  console.log('SCORE ROUTE CALLED', new Date().toISOString())

  // 1. Internal auth
  const token = request.headers.get('x-crawl-secret')
  if (!process.env.CRAWL_SECRET || token !== process.env.CRAWL_SECRET) {
    console.error('SCORE ROUTE: unauthorized — secret match:', token === process.env.CRAWL_SECRET)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Parse body
  const { jobId } = (await request.json().catch(() => ({}))) as { jobId?: string }
  if (!jobId) {
    return NextResponse.json({ error: 'jobId required' }, { status: 400 })
  }

  // 3. Fetch crawl_job
  const { data: job, error: jobError } = await adminClient
    .from('crawl_jobs')
    .select('id, workspace_id, status')
    .eq('id', jobId)
    .maybeSingle()

  if (jobError || !job) {
    console.log('SCORE ROUTE: job not found, skipping', { jobId, error: jobError?.message })
    return NextResponse.json(
      { skipped: true, reason: 'job not found' },
      { status: 200 }
    )
  }

  // 4. Fetch workspace
  const { data: workspace, error: wsError } = await adminClient
    .from('workspaces')
    .select('id, product_name, product_description, icp_description, keywords, competitors')
    .eq('id', job.workspace_id)
    .maybeSingle()

  if (wsError || !workspace) {
    console.error('score: workspace lookup failed:', wsError)
    return NextResponse.json({ error: 'Workspace not found' }, { status: 400 })
  }

  try {
    // 5. Mark job 'scoring'
    await adminClient.from('crawl_jobs').update({ status: 'scoring' }).eq('id', jobId)

    // 6. Top 10 UNSCORED threads by upvotes DESC, status='new'.
    // LEFT JOIN trick done in two queries: fetch existing thread_scores.thread_id set,
    // then exclude those via .not('id', 'in', ...). Keeps the logic readable and the
    // exclusion set small (max ~25-50 scored threads per workspace).
    const { data: scoredRows } = await adminClient
      .from('thread_scores')
      .select('thread_id')

    const scoredIds = (scoredRows ?? [])
      .map((r) => r.thread_id as string | null)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)

    let threadsQuery = adminClient
      .from('threads')
      .select('id, reddit_id, title, body, subreddit, upvotes, top_comments')
      .eq('workspace_id', workspace.id)
      .eq('status', 'new')
      .order('upvotes', { ascending: false })
      .limit(10)

    if (scoredIds.length > 0) {
      threadsQuery = threadsQuery.not('id', 'in', `(${scoredIds.join(',')})`)
    }

    const { data: threadRows, error: threadsErr } = await threadsQuery

    if (threadsErr) {
      throw new Error(`threads fetch failed: ${threadsErr.message}`)
    }

    console.log('SCORE ROUTE: unscored candidates:', threadRows?.length ?? 0, 'of', scoredIds.length, 'already scored')

    const threads: ThreadToScore[] = (threadRows ?? []).map((r) => ({
      id: r.id as string,
      reddit_id: String(r.reddit_id ?? ''),
      title: String(r.title ?? ''),
      body: String(r.body ?? ''),
      subreddit: String(r.subreddit ?? ''),
      upvotes: Number(r.upvotes ?? 0),
      top_comments: Array.isArray(r.top_comments) ? r.top_comments : [],
    }))

    // 7. Batch score (single Claude call)
    const scoringWorkspace: ScoringWorkspace = {
      product_name: workspace.product_name ?? '',
      product_description: workspace.product_description ?? '',
      icp_description: workspace.icp_description ?? '',
      keywords: workspace.keywords ?? [],
      competitors: workspace.competitors ?? [],
    }
    const threadsScored = await scoreAndStore(threads, scoringWorkspace, jobId)
    console.log('SCORING COMPLETE', { count: threadsScored, jobId, candidates: threads.length })

    // 8. Complete the job — write threads_scored, status, completed_at in one update
    // so the status route reads the latest count atomically.
    const { error: completeErr } = await adminClient
      .from('crawl_jobs')
      .update({
        threads_scored: threadsScored,
        status: 'complete',
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    if (completeErr) {
      console.error('score: complete update failed:', completeErr)
    }

    // 9. Done
    return NextResponse.json({ success: true, threadsScored })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('score route error:', err)

    await adminClient
      .from('crawl_jobs')
      .update({
        status: 'error',
        error_message: `scoring: ${message}`,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
