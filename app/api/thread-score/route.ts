import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  // 1. Auth
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. threadId from query
  const threadId = request.nextUrl.searchParams.get('threadId')
  if (!threadId) {
    return NextResponse.json({ error: 'threadId required' }, { status: 400 })
  }

  // 3. Workspace ownership
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!workspace) {
    return NextResponse.json({ error: 'No workspace' }, { status: 404 })
  }

  // 4. Verify thread belongs to user's workspace
  const { data: thread, error: threadErr } = await adminClient
    .from('threads')
    .select('id, workspace_id')
    .eq('id', threadId)
    .maybeSingle()

  if (threadErr || !thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
  }
  if (thread.workspace_id !== workspace.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 5. Fetch score row (may not exist yet — that's fine)
  const { data: score } = await adminClient
    .from('thread_scores')
    .select('relevance_score, summary, key_insight')
    .eq('thread_id', threadId)
    .maybeSingle()

  if (!score) {
    return NextResponse.json({ summary: null, key_insight: null, relevance_score: null })
  }

  return NextResponse.json({
    summary: score.summary ?? null,
    key_insight: score.key_insight ?? null,
    relevance_score: score.relevance_score ?? null,
  })
}
