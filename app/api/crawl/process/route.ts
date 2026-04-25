import { NextResponse } from 'next/server'
import { adminClient } from '@/lib/supabase/admin'
import { checkApifyRuns, fetchApifyResults, storeThreads } from '@/lib/crawler'

export const maxDuration = 60

const POLL_INTERVAL_MS = 3000
const MAX_POLL_SECONDS = 55

export async function POST(request: Request) {
  const token = request.headers.get('x-crawl-secret')
  if (!process.env.CRAWL_SECRET || token !== process.env.CRAWL_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { jobId } = (await request.json().catch(() => ({}))) as { jobId?: string }
  if (!jobId) {
    return NextResponse.json({ error: 'jobId required' }, { status: 400 })
  }

  const { data: job, error: jobError } = await adminClient
    .from('crawl_jobs')
    .select('id, workspace_id, status, apify_run_id')
    .eq('id', jobId)
    .maybeSingle()

  if (jobError || !job) {
    console.error('process: job lookup failed:', jobError)
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  if (!job.apify_run_id) {
    return NextResponse.json({ error: 'Job has no apify_run_id' }, { status: 400 })
  }

  if (job.status !== 'running') {
    return NextResponse.json({ error: `Job already ${job.status}` }, { status: 409 })
  }

  const runIds = String(job.apify_run_id).split(',').filter(Boolean)
  if (runIds.length === 0) {
    return NextResponse.json({ error: 'No run ids to poll' }, { status: 400 })
  }

  try {
    // Move to 'processing' so concurrent calls bail
    await adminClient
      .from('crawl_jobs')
      .update({ status: 'processing' })
      .eq('id', jobId)

    // Poll all runs until all reach a terminal state or we hit the cap
    const start = Date.now()
    let aggregate = await checkApifyRuns(runIds)
    while (
      aggregate.overall === 'RUNNING' &&
      (Date.now() - start) / 1000 < MAX_POLL_SECONDS
    ) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      aggregate = await checkApifyRuns(runIds)
    }

    // At least one must have succeeded. If all failed, hard-fail the job.
    if (aggregate.overall === 'FAILED') {
      const msg = `All Apify runs failed: ${aggregate.perRun
        .map((r) => `${r.runId}=${r.status}${r.statusMessage ? ` (${r.statusMessage})` : ''}`)
        .join('; ')}`
      console.error(msg)
      await adminClient
        .from('crawl_jobs')
        .update({
          status: 'error',
          error_message: msg,
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId)
      return NextResponse.json({ error: msg }, { status: 502 })
    }

    // Fetch + store items from every run that succeeded (partial ok)
    const items = await fetchApifyResults(runIds)
    const { inserted } = await storeThreads(job.workspace_id, items)

    // Hand off to the score route. Status 'scoring' tells the world that
    // threads are stored but scoring hasn't finished yet. Score route will
    // flip to 'complete' + set completed_at when scoring lands.
    const { error: scoringError } = await adminClient
      .from('crawl_jobs')
      .update({ status: 'scoring', threads_found: inserted })
      .eq('id', jobId)

    if (scoringError) {
      console.error('crawl_jobs scoring update failed:', scoringError)
    }

    const { error: workspaceError } = await adminClient
      .from('workspaces')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', job.workspace_id)

    if (workspaceError) {
      console.error('workspace last_synced_at update failed:', workspaceError)
    }

    // Fire-and-forget scoring — separate route so it gets its own 60s budget.
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    console.log('DISPATCHING TO SCORE:', `${baseUrl}/api/crawl/score`)
    fetch(`${baseUrl}/api/crawl/score`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-crawl-secret': process.env.CRAWL_SECRET || '',
      },
      body: JSON.stringify({ jobId }),
    })
      .then((r) => console.log('Score dispatch status:', r.status))
      .catch((e: Error) => console.error('Score dispatch FAILED:', e.message))

    return NextResponse.json({ ok: true, threadsFound: inserted, runs: aggregate.perRun })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('process error:', err)

    // Transient Apify gateway error: revert job to 'running' so polling continues
    // and a future process invocation can pick it up. Do NOT mark error.
    if (message.includes('502') || message.includes('503')) {
      console.warn('process: transient apify error, reverting job to running:', message)
      await adminClient
        .from('crawl_jobs')
        .update({ status: 'running' })
        .eq('id', jobId)
      return NextResponse.json(
        { error: 'temporary_apify_error', retry: true, details: message },
        { status: 500 }
      )
    }

    await adminClient
      .from('crawl_jobs')
      .update({
        status: 'error',
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
