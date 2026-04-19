import { NextResponse } from 'next/server'
import { adminClient } from '@/lib/supabase/admin'
import { checkApifyRun, fetchApifyResults, storeThreads } from '@/lib/crawler'

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

  try {
    // Move to 'processing' so concurrent calls bail
    await adminClient
      .from('crawl_jobs')
      .update({ status: 'processing' })
      .eq('id', jobId)

    // Poll Apify until the run reaches a terminal state or we hit the cap
    const start = Date.now()
    let apifyStatus = await checkApifyRun(job.apify_run_id)
    while (
      apifyStatus.status !== 'SUCCEEDED' &&
      apifyStatus.status !== 'FAILED' &&
      apifyStatus.status !== 'ABORTED' &&
      apifyStatus.status !== 'TIMED-OUT' &&
      (Date.now() - start) / 1000 < MAX_POLL_SECONDS
    ) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      apifyStatus = await checkApifyRun(job.apify_run_id)
    }

    if (apifyStatus.status !== 'SUCCEEDED') {
      const msg = `Apify run ended with status ${apifyStatus.status}`
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

    // Fetch items + store
    const items = await fetchApifyResults(job.apify_run_id)
    const { inserted } = await storeThreads(job.workspace_id, items)

    // Complete the job
    const { error: completeError } = await adminClient
      .from('crawl_jobs')
      .update({
        status: 'complete',
        threads_found: inserted,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    if (completeError) {
      console.error('crawl_jobs complete update failed:', completeError)
    }

    const { error: workspaceError } = await adminClient
      .from('workspaces')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', job.workspace_id)

    if (workspaceError) {
      console.error('workspace last_synced_at update failed:', workspaceError)
    }

    return NextResponse.json({ ok: true, threadsFound: inserted })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('process error:', err)

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
