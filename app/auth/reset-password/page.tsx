'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function ResetPasswordPage() {
  const router = useRouter()
  const supabase = createClient()

  const [hasSession, setHasSession] = useState<boolean | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setHasSession(!!session)
    })
  }, [supabase.auth])

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)

    const { error } = await supabase.auth.updateUser({ password: newPassword })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    setSuccess(true)
    setTimeout(() => router.push('/dashboard'), 2000)
  }

  // Loading state
  if (hasSession === null) {
    return (
      <div className="min-h-screen bg-beetle-bg flex items-center justify-center px-4">
        <div className="bg-white border border-beetle-border rounded-xl shadow-sm p-8 w-full max-w-sm">
          <p className="text-beetle-muted text-sm font-body text-center">Loading…</p>
        </div>
      </div>
    )
  }

  // Expired / no session
  if (!hasSession) {
    return (
      <div className="min-h-screen bg-beetle-bg flex items-center justify-center px-4">
        <div className="bg-white border border-beetle-border rounded-xl shadow-sm p-8 w-full max-w-sm text-center">
          <p className="font-display font-black text-2xl text-beetle-ink lowercase">beetle</p>
          <p className="font-body text-xs text-beetle-muted tracking-wide mt-1">reddit gtm copilot</p>
          <h1 className="font-display font-bold text-xl text-beetle-ink mt-6">This reset link has expired.</h1>
          <p className="text-beetle-muted text-sm font-body mt-2">Please request a new password reset.</p>
          <Link
            href="/login"
            className="inline-block mt-4 text-sm text-beetle-orange hover:opacity-90 font-body font-medium"
          >
            ← Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-beetle-bg flex items-center justify-center px-4">
      <div className="bg-white border border-beetle-border rounded-xl shadow-sm p-8 w-full max-w-sm">
        {/* Logo */}
        <div>
          <p className="font-display font-black text-2xl text-beetle-ink lowercase">beetle</p>
          <p className="font-body text-xs text-beetle-muted tracking-wide mt-1">reddit gtm copilot</p>
        </div>

        {success ? (
          <div className="mt-6">
            <h1 className="font-display font-bold text-xl text-beetle-ink">Password updated.</h1>
            <p className="text-beetle-muted text-sm font-body mt-2">Redirecting to dashboard…</p>
          </div>
        ) : (
          <>
            <h1 className="font-display font-bold text-xl text-beetle-ink mt-6">Set a new password</h1>

            <form onSubmit={handleReset} className="mt-4 space-y-4">
              <div>
                <label className="block font-body text-sm text-beetle-ink mb-1.5">New password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full rounded-lg border border-beetle-border bg-white px-3 py-2.5 text-sm text-beetle-ink font-body placeholder:text-beetle-faint focus:outline-none focus:ring-2 focus:ring-beetle-orange focus:border-transparent"
                  placeholder="••••••••"
                />
                <p className="text-beetle-faint text-xs font-body mt-1">minimum 8 characters</p>
              </div>

              <div>
                <label className="block font-body text-sm text-beetle-ink mb-1.5">Confirm new password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="w-full rounded-lg border border-beetle-border bg-white px-3 py-2.5 text-sm text-beetle-ink font-body placeholder:text-beetle-faint focus:outline-none focus:ring-2 focus:ring-beetle-orange focus:border-transparent"
                  placeholder="••••••••"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-beetle-orange text-white font-body font-medium uppercase tracking-wide py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm"
              >
                {loading ? 'Updating…' : 'Update password'}
              </button>

              {error && (
                <p className="text-red-600 text-sm font-body">{error}</p>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  )
}
