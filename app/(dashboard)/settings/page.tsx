import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DashboardLayout from '@/components/layout/dashboard-layout'
import SettingsForm from '@/components/settings/settings-form'

export default async function SettingsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  const initialWorkspace = {
    product_name: workspace?.product_name || '',
    product_description: workspace?.product_description || '',
    icp_description: workspace?.icp_description || '',
    tone_guide: workspace?.tone_guide || '',
    keywords: workspace?.keywords || [],
    competitors: workspace?.competitors || [],
    subreddits: workspace?.subreddits || [],
  }

  return (
    <DashboardLayout
      pageTitle="Settings"
      lastSyncedAt={workspace?.last_synced_at}
      userEmail={user.email}
    >
      <SettingsForm
        userId={user.id}
        userEmail={user.email || ''}
        initialWorkspace={initialWorkspace}
      />
    </DashboardLayout>
  )
}
