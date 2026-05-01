import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminClient } from '@/lib/supabase/admin'
import { mapApifyToThread, searchReddit, type ThreadRow } from '@/lib/crawler'

export const maxDuration = 60

const SEARCH_FINAL_CAP = 15

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
    query?: string
    subreddits?: string[]
  }
  const query = (body.query ?? '').trim()
  if (!query) {
    return NextResponse.json({ error: 'query required' }, { status: 400 })
  }
  const subreddits = Array.isArray(body.subreddits) ? body.subreddits.slice(0, 3) : []

  // 3. Workspace lookup
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!workspace) {
    return NextResponse.json({ error: 'No workspace' }, { status: 404 })
  }

  try {
    // 4. Apify search (synchronous from the route's POV)
    const items = await searchReddit(query, subreddits)

    // 5. Map + dedupe by reddit_id + sort by upvotes desc + cap final list at 15
    const mapped = items
      .map((item) => mapApifyToThread(item, workspace.id))
      .filter((r): r is ThreadRow => r !== null)

    const uniq = new Map<string, ThreadRow>()
    for (const row of mapped) {
      const prev = uniq.get(row.reddit_id)
      if (!prev || row.upvotes > prev.upvotes) uniq.set(row.reddit_id, row)
    }
    const rows = Array.from(uniq.values())
      .sort((a, b) => b.upvotes - a.upvotes)
      .slice(0, SEARCH_FINAL_CAP)

    if (rows.length === 0) {
      return NextResponse.json({ threads: [], total: 0 })
    }

    // 6. Upsert and select back so the client gets DB ids alongside reddit_ids.
    // onConflict: 'reddit_id' matches the unique constraint — duplicates merge into
    // the existing row instead of erroring.
    const { data: inserted, error: upsertErr } = await adminClient
      .from('threads')
      .upsert(rows, { onConflict: 'reddit_id' })
      .select('id, reddit_id, title, subreddit, body, url, upvotes, comment_count, reddit_created_at')

    if (upsertErr) {
      console.error('search: upsert failed:', upsertErr)
      return NextResponse.json({ error: upsertErr.message }, { status: 500 })
    }

    const responseThreads = (inserted ?? [])
      .slice()
      .sort((a, b) => Number(b.upvotes ?? 0) - Number(a.upvotes ?? 0))

    return NextResponse.json({
      threads: responseThreads,
      total: responseThreads.length,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('search route error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
