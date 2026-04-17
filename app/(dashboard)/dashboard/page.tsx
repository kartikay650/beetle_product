import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DashboardLayout from '@/components/layout/dashboard-layout'
import { CaughtUpState, FirstTimeEmptyState } from '@/components/dashboard/empty-states'

type Thread = {
  id: string
  title: string
  subreddit: string
  created_at: string
}

export default async function DashboardPage() {
  const supabase = await createClient()

  // 1. Session check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // 2. Load profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarding_complete')
    .eq('id', user.id)
    .maybeSingle()

  // 3. Handle missing profile — create it and send to onboarding
  if (!profile) {
    await supabase
      .from('profiles')
      .upsert(
        { id: user.id, email: user.email, onboarding_complete: false },
        { onConflict: 'id', ignoreDuplicates: true }
      )
    redirect('/onboarding')
  }

  if (!profile.onboarding_complete) {
    redirect('/onboarding')
  }

  // 4. Load workspace
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  // Edge case: onboarding_complete but no workspace — reset
  if (!workspace) {
    await supabase
      .from('profiles')
      .update({ onboarding_complete: false })
      .eq('id', user.id)
    redirect('/onboarding')
  }

  // 5. Load threads
  const { data: threads } = await supabase
    .from('threads')
    .select('id, title, subreddit, created_at, thread_scores(relevance_score)')
    .eq('workspace_id', workspace.id)
    .eq('status', 'new')
    .order('created_at', { ascending: false })
    .limit(20)

  const threadList = (threads || []) as Thread[]

  return (
    <DashboardLayout
      pageTitle="Threads"
      lastSyncedAt={workspace.last_synced_at}
      userEmail={user.email}
    >
      {threadList.length > 0 ? (
        <div>
          <h2 className="font-display font-bold text-lg text-beetle-ink mb-4">
            {threadList.length} threads ready
          </h2>
          {/* TODO Phase 2: replace with one-thread-at-a-time UI */}
          <div>
            {threadList.map((t) => (
              <div
                key={t.id}
                className="bg-white border border-beetle-border rounded-xl p-4 mb-3"
              >
                <p className="text-sm font-body font-medium text-beetle-ink">{t.title}</p>
                <p className="text-xs text-beetle-muted mt-1">
                  r/{t.subreddit} · {new Date(t.created_at).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : workspace.last_synced_at ? (
        <CaughtUpState lastSyncedAt={workspace.last_synced_at} />
      ) : (
        <FirstTimeEmptyState />
      )}
    </DashboardLayout>
  )
}
