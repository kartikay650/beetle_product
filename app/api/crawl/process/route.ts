import { NextResponse } from 'next/server'
import { adminClient } from '@/lib/supabase/admin'

export const maxDuration = 60

export async function POST(request: Request) {
  // Internal-only: require a shared secret from the trigger route
  const token = request.headers.get('x-internal-token')
  if (!process.env.CRAWLER_INTERNAL_TOKEN || token !== process.env.CRAWLER_INTERNAL_TOKEN) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { jobId } = (await request.json().catch(() => ({}))) as { jobId?: string }
  if (!jobId) {
    return NextResponse.json({ error: 'jobId required' }, { status: 400 })
  }

  const { data: job, error: jobError } = await adminClient
    .from('crawl_jobs')
    .select('id, workspace_id, status')
    .eq('id', jobId)
    .maybeSingle()

  if (jobError || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  if (job.status !== 'pending') {
    return NextResponse.json({ error: `Job already ${job.status}` }, { status: 409 })
  }

  await adminClient
    .from('crawl_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', job.id)

  try {
    // TODO: real Reddit crawl lives here — fetch subreddit posts, score,
    // dedupe, upsert into threads. For now we mark the run complete so
    // the UI can move out of the queued state.
    const threadsFound = 0

    await adminClient
      .from('crawl_jobs')
      .update({
        status: 'complete',
        completed_at: new Date().toISOString(),
        threads_found: threadsFound,
      })
      .eq('id', job.id)

    await adminClient
      .from('workspaces')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', job.workspace_id)

    return NextResponse.json({ ok: true, threads_found: threadsFound })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    await adminClient
      .from('crawl_jobs')
      .update({
        status: 'error',
        completed_at: new Date().toISOString(),
        error: message,
      })
      .eq('id', job.id)

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
