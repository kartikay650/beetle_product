import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
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

  const jobId = request.nextUrl.searchParams.get('jobId')

  if (jobId) {
    const { data: job } = await supabase
      .from('crawl_jobs')
      .select('*')
      .eq('id', jobId)
      .maybeSingle()

    return NextResponse.json({
      job,
      last_synced_at: workspace.last_synced_at ?? null,
    })
  }

  // No jobId: return the most recent job for this workspace
  const { data: jobs } = await supabase
    .from('crawl_jobs')
    .select('*')
    .eq('workspace_id', workspace.id)
    .order('started_at', { ascending: false })
    .limit(1)

  return NextResponse.json({
    job: jobs?.[0] ?? null,
    last_synced_at: workspace.last_synced_at ?? null,
  })
}
