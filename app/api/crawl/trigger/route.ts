import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find workspace for this user
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id, user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!workspace) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
  }

  // Create a crawl job row (uses admin client to bypass RLS on job table)
  const { data: job, error } = await adminClient
    .from('crawl_jobs')
    .insert({
      workspace_id: workspace.id,
      status: 'pending',
    })
    .select('id, status, apify_run_id')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Fire the processor in the background. We intentionally don't await
  // this — the crawler can run long and the client polls /status.
  const origin = new URL(request.url).origin
  fetch(`${origin}/api/crawl/process`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': process.env.CRAWLER_INTERNAL_TOKEN || '',
    },
    body: JSON.stringify({ jobId: job.id }),
  }).catch(() => {
    // Processor will be retried on next trigger; nothing to do here.
  })

  return NextResponse.json({ jobId: job.id, apifyRunId: job.apify_run_id ?? null })
}
