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

  // Always read fresh from DB — Supabase client doesn't cache, so each poll
  // sees the latest threads_scored / status. No cache-control needed for the
  // server side; freshness is guaranteed by the round-trip.
  let job: Record<string, unknown> | null = null

  if (jobId) {
    const { data } = await supabase
      .from('crawl_jobs')
      .select('*')
      .eq('id', jobId)
      .maybeSingle()
    job = data ?? null
  } else {
    const { data: jobs } = await supabase
      .from('crawl_jobs')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('started_at', { ascending: false })
      .limit(1)
    job = jobs?.[0] ?? null
  }

  // Flat shape for the scan screen poller. `job` kept for any other consumers.
  return NextResponse.json({
    status: (job?.status as string | null) ?? null,
    threadsFound: (job?.threads_found as number | null) ?? 0,
    threadsScored: (job?.threads_scored as number | null) ?? 0,
    errorMessage: (job?.error_message as string | null) ?? null,
    job,
    last_synced_at: workspace.last_synced_at ?? null,
  })
}
