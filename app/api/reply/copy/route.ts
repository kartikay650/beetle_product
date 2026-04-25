import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  // 1. Auth
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Parse body
  const body = (await request.json().catch(() => ({}))) as { replyId?: string }
  const replyId = body.replyId
  if (!replyId) {
    return NextResponse.json({ error: 'replyId required' }, { status: 400 })
  }

  // 3. Workspace ownership check
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!workspace) {
    return NextResponse.json({ error: 'No workspace' }, { status: 404 })
  }

  // 4. Look up the reply to get its thread_id and ensure workspace match
  const { data: reply, error: replyErr } = await adminClient
    .from('reply_drafts')
    .select('id, thread_id, workspace_id')
    .eq('id', replyId)
    .maybeSingle()

  if (replyErr || !reply) {
    return NextResponse.json({ error: 'Reply not found' }, { status: 404 })
  }
  if (reply.workspace_id !== workspace.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 5. Mark copied_at on the reply
  const now = new Date().toISOString()
  const { error: copyUpdateErr } = await adminClient
    .from('reply_drafts')
    .update({ copied_at: now })
    .eq('id', replyId)

  if (copyUpdateErr) {
    console.error('reply.copy: update copied_at failed:', copyUpdateErr)
  }

  // 6. Mark the thread as replied
  const { error: threadUpdateErr } = await adminClient
    .from('threads')
    .update({ status: 'replied' })
    .eq('id', reply.thread_id)

  if (threadUpdateErr) {
    console.error('reply.copy: thread status update failed:', threadUpdateErr)
  }

  return NextResponse.json({ success: true })
}
