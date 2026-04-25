import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminClient } from '@/lib/supabase/admin'
import { generateReplies } from '@/lib/reply-generator'

export const maxDuration = 30

type ReplyDraftRow = {
  id: string
  variant: number
  variant_label: string
  content: string
}

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
  const body = (await request.json().catch(() => ({}))) as {
    threadId?: string
    regenerate?: boolean
    refinement?: string
  }
  const threadId = body.threadId
  if (!threadId) {
    return NextResponse.json({ error: 'threadId required' }, { status: 400 })
  }
  const refinement = typeof body.refinement === 'string' ? body.refinement.trim() : ''

  // 3. Workspace ownership check
  const { data: workspace, error: wsErr } = await supabase
    .from('workspaces')
    .select('id, product_name, product_description, icp_description, tone_guide, competitors')
    .eq('user_id', user.id)
    .maybeSingle()

  if (wsErr || !workspace) {
    return NextResponse.json({ error: 'No workspace' }, { status: 404 })
  }

  // 4. Fetch thread (admin client — workspace_id check below enforces ownership)
  const { data: thread, error: threadErr } = await adminClient
    .from('threads')
    .select('id, workspace_id, title, body, subreddit, url, top_comments')
    .eq('id', threadId)
    .maybeSingle()

  if (threadErr || !thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
  }
  if (thread.workspace_id !== workspace.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 5. Regenerate / refine path: wipe existing drafts before generating fresh ones.
  // A non-empty refinement always implies regenerate (you can't refine cached output).
  const forceRegenerate = !!body.regenerate || refinement.length > 0
  if (forceRegenerate) {
    const { error: delErr } = await adminClient
      .from('reply_drafts')
      .delete()
      .eq('thread_id', threadId)
    if (delErr) console.error('reply.generate: delete existing failed:', delErr)
  } else {
    // 5a. Cached path: return existing drafts if present.
    const { data: existing } = await adminClient
      .from('reply_drafts')
      .select('id, variant, variant_label, content')
      .eq('thread_id', threadId)
      .order('variant', { ascending: true })

    if (existing && existing.length > 0) {
      return NextResponse.json({ replies: existing as ReplyDraftRow[], cached: true })
    }
  }

  // 6. Generate via Claude
  const variants = await generateReplies(
    {
      title: String(thread.title ?? ''),
      body: String(thread.body ?? ''),
      subreddit: String(thread.subreddit ?? ''),
      top_comments: Array.isArray(thread.top_comments) ? thread.top_comments : [],
    },
    {
      product_name: workspace.product_name ?? '',
      product_description: workspace.product_description ?? '',
      icp_description: workspace.icp_description ?? '',
      tone_guide: workspace.tone_guide ?? '',
      competitors: workspace.competitors ?? [],
    },
    refinement || undefined
  )

  // 7. Insert all 3 rows, return back with ids
  const rows = variants.map((v) => ({
    thread_id: threadId,
    workspace_id: workspace.id,
    variant: v.variant,
    variant_label: v.variant_label,
    content: v.content,
    kb_chunks_used: [] as string[],
  }))

  const { data: inserted, error: insertErr } = await adminClient
    .from('reply_drafts')
    .insert(rows)
    .select('id, variant, variant_label, content')

  if (insertErr) {
    console.error('reply.generate: insert failed:', insertErr)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  const sorted = (inserted ?? []).slice().sort((a, b) => (a.variant as number) - (b.variant as number))

  return NextResponse.json({ replies: sorted as ReplyDraftRow[], cached: false })
}
