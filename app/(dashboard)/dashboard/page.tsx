import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DashboardLayout from '@/components/layout/dashboard-layout'
import { CaughtUpState, FirstTimeEmptyState } from '@/components/dashboard/empty-states'
import ThreadViewer, { type ThreadForViewer } from '@/components/dashboard/thread-viewer'

type ThreadRow = {
  id: string
  reddit_id: string
  title: string
  subreddit: string
  body: string | null
  url: string
  author: string | null
  upvotes: number | null
  comment_count: number | null
  reddit_created_at: string
  thread_scores:
    | { relevance_score: number | null; summary: string | null; key_insight: string | null }[]
    | null
}

const FRESHNESS_HOURS: Record<string, number> = {
  '24h': 24,
  '48h': 48,
  '7d': 168,
}

const THREAD_SELECT =
  'id, reddit_id, title, subreddit, body, url, author, upvotes, comment_count, reddit_created_at, thread_scores(relevance_score, summary, key_insight)'

function toViewer(r: ThreadRow): ThreadForViewer {
  return {
    id: r.id,
    title: r.title,
    subreddit: r.subreddit,
    body: r.body,
    url: r.url,
    author: r.author,
    upvotes: r.upvotes ?? 0,
    comment_count: r.comment_count ?? 0,
    reddit_created_at: r.reddit_created_at,
    score: r.thread_scores?.[0]
      ? {
          relevance_score: r.thread_scores[0].relevance_score,
          summary: r.thread_scores[0].summary,
        }
      : null,
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: { threadId?: string }
}) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarding_complete')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) {
    await supabase
      .from('profiles')
      .upsert(
        { id: user.id, email: user.email, onboarding_complete: false },
        { onConflict: 'id', ignoreDuplicates: true }
      )
    redirect('/onboarding')
  }

  if (!profile.onboarding_complete) redirect('/onboarding')

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!workspace) {
    await supabase
      .from('profiles')
      .update({ onboarding_complete: false })
      .eq('id', user.id)
    redirect('/onboarding')
  }

  // Freshness window. Defaults to 48h if column/value absent.
  const freshnessKey = (workspace.freshness_filter as string | null | undefined) || '48h'
  const freshnessHours = FRESHNESS_HOURS[freshnessKey] ?? 48
  const freshnessDate = new Date(Date.now() - freshnessHours * 60 * 60 * 1000).toISOString()

  // Reply-worthy bucket: fresh, low-competition, relevant or unscored.
  const { data: rawThreads } = await supabase
    .from('threads')
    .select(THREAD_SELECT)
    .eq('workspace_id', workspace.id)
    .eq('status', 'new')
    .gte('reddit_created_at', freshnessDate)
    .lt('comment_count', 50)
    .limit(50)

  const allRows = (rawThreads ?? []) as ThreadRow[]

  // Pinned thread support — when ?threadId=<reddit_id> is in the URL (e.g. from
  // a Search result click) we surface that thread first, even if it would have
  // been filtered out by freshness/comment_count/relevance.
  const threadIdParam = searchParams?.threadId?.trim()
  let pinnedRow: ThreadRow | null = null
  let listRows = allRows

  if (threadIdParam) {
    const inListIdx = allRows.findIndex((r) => r.reddit_id === threadIdParam)
    if (inListIdx >= 0) {
      pinnedRow = allRows[inListIdx]
      listRows = allRows.filter((_, i) => i !== inListIdx)
    } else {
      const { data: extra } = await supabase
        .from('threads')
        .select(THREAD_SELECT)
        .eq('workspace_id', workspace.id)
        .eq('reddit_id', threadIdParam)
        .maybeSingle()
      if (extra) pinnedRow = extra as ThreadRow
    }
  }

  // Apply relevance gate + sort to non-pinned rows. Pinned thread bypasses these.
  const filtered: ThreadForViewer[] = listRows
    .map(toViewer)
    .filter((t) => {
      const rel = t.score?.relevance_score
      return rel == null || rel >= 6
    })
    .sort((a, b) => {
      const ar = a.score?.relevance_score ?? -1
      const br = b.score?.relevance_score ?? -1
      if (ar !== br) return br - ar
      return b.upvotes - a.upvotes
    })

  const threads: ThreadForViewer[] = pinnedRow
    ? [toViewer(pinnedRow), ...filtered].slice(0, 20)
    : filtered.slice(0, 20)

  return (
    <DashboardLayout
      pageTitle="Threads"
      lastSyncedAt={workspace.last_synced_at}
      userEmail={user.email}
    >
      {threads.length > 0 ? (
        <ThreadViewer threads={threads} />
      ) : workspace.last_synced_at ? (
        <CaughtUpState lastSyncedAt={workspace.last_synced_at} />
      ) : (
        <FirstTimeEmptyState />
      )}
    </DashboardLayout>
  )
}
