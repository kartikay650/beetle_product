import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminClient } from '@/lib/supabase/admin'
import { runApifyCrawl } from '@/lib/crawler'

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id, keywords, subreddits')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!workspace) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
  }

  // Insert pending crawl_jobs row (admin client, bypasses RLS)
  const { data: job, error: insertError } = await adminClient
    .from('crawl_jobs')
    .insert({ workspace_id: workspace.id, status: 'pending' })
    .select('id')
    .single()

  if (insertError || !job) {
    console.error('crawl_jobs insert failed:', insertError)
    return NextResponse.json(
      { error: 'Could not create crawl job', details: insertError?.message },
      { status: 500 }
    )
  }

  const jobId = job.id

  try {
    const apifyRunId = await runApifyCrawl(
      workspace.keywords ?? [],
      workspace.subreddits ?? []
    )

    const { error: updateError } = await adminClient
      .from('crawl_jobs')
      .update({
        status: 'running',
        apify_run_id: apifyRunId,
        started_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    if (updateError) {
      console.error('crawl_jobs update (running) failed:', updateError)
      return NextResponse.json(
        { error: 'Apify run started but job status update failed', details: updateError.message, jobId, apifyRunId },
        { status: 500 }
      )
    }

    // Fire-and-forget processor. Never await.
    const origin = new URL(request.url).origin
    fetch(`${origin}/api/crawl/process`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-crawl-secret': process.env.CRAWL_SECRET ?? '',
      },
      body: JSON.stringify({ jobId }),
    }).catch((err) => {
      console.error('process fire-and-forget failed:', err)
    })

    return NextResponse.json({ jobId, apifyRunId })
  } catch (error) {
    console.error('Apify call failed:', error)

    const message = error instanceof Error ? error.message : String(error)
    const { error: updateError } = await adminClient
      .from('crawl_jobs')
      .update({
        status: 'error',
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    if (updateError) {
      console.error('crawl_jobs update (error) failed:', updateError)
    }

    return NextResponse.json(
      { error: 'Failed to start crawl', details: message, jobId },
      { status: 500 }
    )
  }
}
