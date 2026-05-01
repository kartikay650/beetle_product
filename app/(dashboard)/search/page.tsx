import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DashboardLayout from '@/components/layout/dashboard-layout'
import SearchView from '@/components/dashboard/search-view'

export default async function SearchPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarding_complete')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.onboarding_complete) redirect('/onboarding')

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('subreddits, last_synced_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!workspace) redirect('/onboarding')

  const subreddits = (workspace.subreddits ?? []) as string[]

  return (
    <DashboardLayout
      pageTitle="Search"
      lastSyncedAt={workspace.last_synced_at}
      userEmail={user.email}
    >
      <SearchView workspaceSubreddits={subreddits} />
    </DashboardLayout>
  )
}
