'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.0 24.0 0 0 0 0 21.56l7.98-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  )
}

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Forgot password state
  const [showForgot, setShowForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotError, setForgotError] = useState('')
  const [forgotSuccess, setForgotSuccess] = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/dashboard')
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    setForgotError('')
    setForgotLoading(true)

    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: window.location.origin + '/auth/reset-password',
    })

    setForgotLoading(false)

    if (error) {
      setForgotError(error.message)
      return
    }

    setForgotSuccess(true)
  }

  async function handleGoogleLogin() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/auth/callback' },
    })
  }

  return (
    <div className="bg-white border border-beetle-border rounded-xl shadow-sm p-8 w-full max-w-sm">
      {/* Logo */}
      <div>
        <p className="font-display font-black text-2xl text-beetle-ink lowercase">beetle</p>
        <p className="font-body text-xs text-beetle-muted tracking-wide mt-1">reddit gtm copilot</p>
      </div>

      {showForgot ? (
        /* ─── Forgot Password View ─── */
        <div className="mt-6">
          <h1 className="font-display font-bold text-xl text-beetle-ink">Reset your password</h1>

          {forgotSuccess ? (
            <div className="mt-4">
              <p className="text-sm text-beetle-ink">Check your email for a reset link.</p>
              <button
                onClick={() => { setShowForgot(false); setForgotSuccess(false) }}
                className="mt-3 text-xs text-beetle-muted hover:text-beetle-ink font-body"
              >
                ← Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className="mt-4 space-y-4">
              <div>
                <label className="block font-body text-sm text-beetle-ink mb-1.5">Email</label>
                <input
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                  className="w-full rounded-lg border border-beetle-border bg-white px-3 py-2.5 text-sm text-beetle-ink font-body placeholder:text-beetle-faint focus:outline-none focus:ring-2 focus:ring-beetle-orange focus:border-transparent"
                  placeholder="you@company.com"
                />
              </div>

              <button
                type="submit"
                disabled={forgotLoading}
                className="w-full bg-beetle-orange text-white font-body font-medium uppercase tracking-wide py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm"
              >
                {forgotLoading ? 'Sending…' : 'Send reset link'}
              </button>

              {forgotError && (
                <p className="text-red-600 text-sm font-body">{forgotError}</p>
              )}

              <button
                type="button"
                onClick={() => setShowForgot(false)}
                className="text-xs text-beetle-muted hover:text-beetle-ink font-body"
              >
                ← Back to sign in
              </button>
            </form>
          )}
        </div>
      ) : (
        /* ─── Login View ─── */
        <>
          <h1 className="font-display font-bold text-xl text-beetle-ink mt-6">Welcome back</h1>

          <form onSubmit={handleLogin} className="mt-4 space-y-4">
            <div>
              <label className="block font-body text-sm text-beetle-ink mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-lg border border-beetle-border bg-white px-3 py-2.5 text-sm text-beetle-ink font-body placeholder:text-beetle-faint focus:outline-none focus:ring-2 focus:ring-beetle-orange focus:border-transparent"
                placeholder="you@company.com"
              />
            </div>

            <div>
              <label className="block font-body text-sm text-beetle-ink mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
              {loading ? 'Signing in…' : 'Sign in'}
            </button>

            {error && (
              <p className="text-red-600 text-sm font-body">{error}</p>
            )}
          </form>

          <div className="mt-3">
            <button
              onClick={() => { setShowForgot(true); setForgotEmail(email) }}
              className="text-xs text-beetle-muted hover:text-beetle-ink font-body"
            >
              Forgot password?
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-beetle-border" />
            <span className="text-beetle-faint text-xs font-body">or</span>
            <div className="flex-1 h-px bg-beetle-border" />
          </div>

          {/* Google OAuth */}
          <button
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-2.5 bg-white border border-beetle-border rounded-lg py-2.5 text-sm text-beetle-ink font-body hover:bg-beetle-bg transition-colors"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          {/* Bottom link */}
          <p className="mt-6 text-center font-body text-xs text-beetle-muted">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="text-beetle-ink hover:text-beetle-orange font-medium">
              Sign up →
            </Link>
          </p>
        </>
      )}
    </div>
  )
}
