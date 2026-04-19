import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminClient } from '@/lib/supabase/admin'
import { runApifyCrawl } from '@/lib/crawler'

export async function POST() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Load workspace with the fields needed for the crawl
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id, keywords, subreddits')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!workspace) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
  }

  // Create pending job row via admin client (bypasses RLS on jobs table)
  const { data: job, error: insertError } = await adminClient
    .from('crawl_jobs')
    .insert({
      workspace_id: workspace.id,
      status: 'pending',
    })
    .select('id')
    .single()

  if (insertError || !job) {
    console.error('Failed to insert crawl_jobs row:', insertError)
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

    await adminClient
      .from('crawl_jobs')
      .update({
        status: 'running',
        apify_run_id: apifyRunId,
        started_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    return NextResponse.json({ jobId, apifyRunId })
  } catch (error) {
    console.error('Apify call failed:', error)

    await adminClient
      .from('crawl_jobs')
      .update({
        status: 'error',
        error_message: error instanceof Error ? error.message : String(error),
      })
      .eq('id', jobId)

    return NextResponse.json(
      { error: 'Failed to start crawl', details: String(error) },
      { status: 500 }
    )
  }
}
