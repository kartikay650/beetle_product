import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id, last_synced_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!workspace) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
  }

  const url = new URL(request.url)
  const jobId = url.searchParams.get('job_id')

  let jobQuery = supabase
    .from('crawl_jobs')
    .select('id, status, started_at, completed_at, error, threads_found')
    .eq('workspace_id', workspace.id)
    .order('started_at', { ascending: false })
    .limit(1)

  if (jobId) {
    jobQuery = supabase
      .from('crawl_jobs')
      .select('id, status, started_at, completed_at, error, threads_found')
      .eq('workspace_id', workspace.id)
      .eq('id', jobId)
      .limit(1)
  }

  const { data: jobs } = await jobQuery

  return NextResponse.json({
    job: jobs?.[0] ?? null,
    last_synced_at: workspace.last_synced_at ?? null,
  })
}
