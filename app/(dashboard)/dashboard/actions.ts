'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function dismissThread(
  threadId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  // RLS + workspace_id ownership gate: only update a thread whose workspace belongs to this user.
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!workspace) return { success: false, error: 'No workspace' }

  const { error } = await supabase
    .from('threads')
    .update({ status: 'dismissed' })
    .eq('id', threadId)
    .eq('workspace_id', workspace.id)

  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard')
  return { success: true }
}
