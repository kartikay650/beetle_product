import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  generatePost,
  type PostType,
  type PostLength,
} from '@/lib/post-generator'

export const maxDuration = 30

const VALID_TYPES: readonly PostType[] = ['discussion', 'experience', 'problem']
const VALID_LENGTHS: readonly PostLength[] = ['short', 'medium', 'long']

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
    topic?: string
    postType?: string
    postLength?: string
    targetSubreddit?: string | null
    refinement?: string
  }

  const topic = (body.topic ?? '').trim()
  if (!topic) {
    return NextResponse.json({ error: 'topic required' }, { status: 400 })
  }

  const postType = (body.postType ?? '').toLowerCase() as PostType
  if (!VALID_TYPES.includes(postType)) {
    return NextResponse.json(
      { error: `postType must be one of: ${VALID_TYPES.join(', ')}` },
      { status: 400 }
    )
  }

  const postLength = (body.postLength ?? '').toLowerCase() as PostLength
  if (!VALID_LENGTHS.includes(postLength)) {
    return NextResponse.json(
      { error: `postLength must be one of: ${VALID_LENGTHS.join(', ')}` },
      { status: 400 }
    )
  }

  const targetSubreddit =
    typeof body.targetSubreddit === 'string' && body.targetSubreddit.trim().length > 0
      ? body.targetSubreddit.replace(/^r\//i, '').trim().toLowerCase()
      : null

  const refinement =
    typeof body.refinement === 'string' && body.refinement.trim().length > 0
      ? body.refinement.trim()
      : undefined

  // 3. Workspace lookup
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('product_name, product_description, icp_description, tone_guide, competitors, subreddits')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!workspace) {
    return NextResponse.json({ error: 'No workspace' }, { status: 404 })
  }

  // 4. Generate
  try {
    const post = await generatePost(
      {
        product_name: workspace.product_name ?? '',
        product_description: workspace.product_description ?? '',
        icp_description: workspace.icp_description ?? '',
        tone_guide: workspace.tone_guide ?? '',
        competitors: workspace.competitors ?? [],
        subreddits: workspace.subreddits ?? [],
      },
      {
        topic,
        postType,
        postLength,
        targetSubreddit,
        refinement,
      }
    )
    return NextResponse.json({ post })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Post generation failed'
    console.error('post.generate route error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
