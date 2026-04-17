'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import TagInput from '@/components/ui/tag-input'
import { toast } from '@/components/ui/use-toast'
import { track } from '@/lib/analytics'
import { createClient } from '@/lib/supabase/client'

interface WorkspaceData {
  product_name: string
  product_description: string
  icp_description: string
  tone_guide: string
  keywords: string[]
  competitors: string[]
  subreddits: string[]
}

interface SettingsFormProps {
  userId: string
  userEmail: string
  initialWorkspace: WorkspaceData
}

function CharCount({ current, max }: { current: number; max: number }) {
  return (
    <p className={`text-right text-xs font-body mt-1 ${current > max - 20 ? 'text-red-500' : 'text-beetle-muted'}`}>
      {current} / {max}
    </p>
  )
}

export default function SettingsForm({ userId, userEmail, initialWorkspace }: SettingsFormProps) {
  const router = useRouter()
  const supabase = createClient()

  const [data, setData] = useState<WorkspaceData>(initialWorkspace)
  const [saving, setSaving] = useState(false)

  // Account section state
  const [newEmail, setNewEmail] = useState('')
  const [emailUpdating, setEmailUpdating] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [resetSending, setResetSending] = useState(false)

  function updateField<K extends keyof WorkspaceData>(field: K, value: WorkspaceData[K]) {
    setData((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSave() {
    setSaving(true)
    const { error } = await supabase
      .from('workspaces')
      .upsert({ user_id: userId, ...data }, { onConflict: 'user_id' })

    setSaving(false)

    if (error) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      })
      return
    }

    toast({
      title: 'Saved',
      description: 'Workspace settings updated.',
    })
    track('settings_updated')
  }

  async function handleUpdateEmail() {
    setEmailError('')
    if (!newEmail.trim()) {
      setEmailError('Enter a new email address')
      return
    }

    setEmailUpdating(true)
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() })
    setEmailUpdating(false)

    if (error) {
      setEmailError(error.message)
      return
    }

    toast({
      title: 'Confirmation sent',
      description: 'Confirmation sent to your new email address.',
    })
    setNewEmail('')
  }

  async function handleSendReset() {
    setResetSending(true)
    const { error } = await supabase.auth.resetPasswordForEmail(userEmail, {
      redirectTo: window.location.origin + '/auth/reset-password',
    })
    setResetSending(false)

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
      return
    }

    toast({
      title: 'Reset link sent',
      description: `Reset link sent to ${userEmail}`,
    })
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="max-w-2xl space-y-8">
      {/* Workspace section */}
      <div className="bg-white border border-beetle-border rounded-2xl p-6">
        <h2 className="font-display font-bold text-base text-beetle-ink mb-5">Workspace</h2>

        <div className="space-y-5">
          <div>
            <label className="block font-body text-sm text-beetle-ink mb-1.5">Product name</label>
            <input
              type="text"
              value={data.product_name}
              onChange={(e) => updateField('product_name', e.target.value)}
              className="w-full rounded-lg border border-beetle-border bg-white px-3 py-2.5 text-sm text-beetle-ink font-body placeholder:text-beetle-faint focus:outline-none focus:ring-2 focus:ring-beetle-orange focus:border-transparent"
            />
          </div>

          <div>
            <label className="block font-body text-sm text-beetle-ink mb-1.5">What does it do?</label>
            <textarea
              value={data.product_description}
              onChange={(e) => updateField('product_description', e.target.value)}
              maxLength={200}
              rows={3}
              className="w-full rounded-lg border border-beetle-border bg-white px-3 py-2.5 text-sm text-beetle-ink font-body placeholder:text-beetle-faint focus:outline-none focus:ring-2 focus:ring-beetle-orange focus:border-transparent resize-none"
            />
            <CharCount current={data.product_description.length} max={200} />
          </div>

          <div>
            <label className="block font-body text-sm text-beetle-ink mb-1.5">Ideal customer</label>
            <textarea
              value={data.icp_description}
              onChange={(e) => updateField('icp_description', e.target.value)}
              maxLength={200}
              rows={3}
              className="w-full rounded-lg border border-beetle-border bg-white px-3 py-2.5 text-sm text-beetle-ink font-body placeholder:text-beetle-faint focus:outline-none focus:ring-2 focus:ring-beetle-orange focus:border-transparent resize-none"
            />
            <CharCount current={data.icp_description.length} max={200} />
          </div>

          <div>
            <label className="block font-body text-sm text-beetle-ink mb-1.5">Reply tone</label>
            <textarea
              value={data.tone_guide}
              onChange={(e) => updateField('tone_guide', e.target.value)}
              maxLength={150}
              rows={3}
              className="w-full rounded-lg border border-beetle-border bg-white px-3 py-2.5 text-sm text-beetle-ink font-body placeholder:text-beetle-faint focus:outline-none focus:ring-2 focus:ring-beetle-orange focus:border-transparent resize-none"
            />
            <CharCount current={data.tone_guide.length} max={150} />
          </div>

          <div>
            <label className="block font-body text-sm text-beetle-ink mb-1.5">Keywords</label>
            <TagInput
              value={data.keywords}
              onChange={(tags) => updateField('keywords', tags)}
              placeholder="Type a keyword and press Enter"
            />
          </div>

          <div>
            <label className="block font-body text-sm text-beetle-ink mb-1.5">Competitors</label>
            <TagInput
              value={data.competitors}
              onChange={(tags) => updateField('competitors', tags)}
              placeholder="Type a competitor and press Enter"
            />
          </div>

          <div>
            <label className="block font-body text-sm text-beetle-ink mb-1.5">Subreddits</label>
            <TagInput
              value={data.subreddits}
              onChange={(tags) => updateField('subreddits', tags)}
              placeholder="Type a subreddit and press Enter"
            />
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-beetle-orange text-white font-body font-medium px-6 py-2.5 rounded-lg hover:opacity-90 mt-6 text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      {/* Account section */}
      <div className="bg-white border border-beetle-border rounded-2xl p-6 mt-6">
        <h2 className="font-display font-bold text-base text-beetle-ink mb-5">Account</h2>

        {/* Email */}
        <div>
          <label className="block text-sm font-body font-medium text-beetle-ink">Email address</label>
          <p className="text-sm text-beetle-muted mb-3 font-body">{userEmail}</p>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="New email address"
            className="w-full rounded-lg border border-beetle-border bg-white px-3 py-2.5 text-sm text-beetle-ink font-body placeholder:text-beetle-faint focus:outline-none focus:ring-2 focus:ring-beetle-orange focus:border-transparent"
          />
          {emailError && <p className="text-red-600 text-sm font-body mt-2">{emailError}</p>}
          <button
            onClick={handleUpdateEmail}
            disabled={emailUpdating}
            className="mt-3 border border-beetle-orange text-beetle-orange font-body font-medium px-5 py-2 rounded-lg hover:bg-beetle-orange hover:text-white transition-colors text-sm disabled:opacity-50"
          >
            {emailUpdating ? 'Updating…' : 'Update email'}
          </button>
        </div>

        <div className="border-t border-beetle-border my-5" />

        {/* Password */}
        <div>
          <p className="text-sm font-body font-medium text-beetle-ink mb-1">Password</p>
          <p className="text-xs text-beetle-muted mb-3 font-body">
            We&apos;ll send a reset link to your current email address.
          </p>
          <button
            onClick={handleSendReset}
            disabled={resetSending}
            className="border border-beetle-orange text-beetle-orange font-body font-medium px-5 py-2 rounded-lg hover:bg-beetle-orange hover:text-white transition-colors text-sm disabled:opacity-50"
          >
            {resetSending ? 'Sending…' : 'Send reset link'}
          </button>
        </div>

        <div className="border-t border-beetle-border my-5" />

        {/* Danger zone */}
        <div>
          <p className="text-sm font-body font-medium text-beetle-ink mb-1">Sign out</p>
          <p className="text-xs text-beetle-muted mb-3 font-body">End your session on this device.</p>
          <button
            onClick={handleSignOut}
            className="border border-red-200 text-red-500 font-body font-medium px-5 py-2 rounded-lg hover:bg-red-500 hover:text-white hover:border-red-500 transition-colors text-sm"
          >
            Sign out of beetle
          </button>
        </div>
      </div>
    </div>
  )
}
