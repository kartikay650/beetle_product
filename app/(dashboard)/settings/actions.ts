'use server'

import { createClient } from '@/lib/supabase/server'
import { upsertWorkspace, type WorkspaceData } from '@/lib/workspace'
import { revalidatePath } from 'next/cache'

export async function saveWorkspace(
  userId: string,
  data: WorkspaceData
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  // Verify the caller is authenticated and matches the userId being updated
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }
  if (user.id !== userId) {
    return { success: false, error: 'Unauthorized' }
  }

  const { error } = await upsertWorkspace(userId, data)
  if (error) {
    return { success: false, error }
  }

  revalidatePath('/settings')
  revalidatePath('/dashboard')

  return { success: true }
}
