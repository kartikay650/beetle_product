import { createClient } from '@/lib/supabase/server'

export type WorkspaceData = {
  product_name: string
  product_description: string
  icp_description: string
  tone_guide: string
  keywords: string[]
  subreddits: string[]
  competitors: string[]
  website_url?: string
  last_synced_at?: string | null
}

export async function getWorkspace(userId: string): Promise<WorkspaceData | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('workspaces')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !data) return null

  return data as WorkspaceData
}

export async function upsertWorkspace(
  userId: string,
  data: Partial<WorkspaceData>
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('workspaces')
    .upsert({ user_id: userId, ...data }, { onConflict: 'user_id' })

  return { error: error?.message ?? null }
}
