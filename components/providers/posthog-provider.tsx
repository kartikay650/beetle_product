'use client'

import posthog from 'posthog-js'
import { useEffect } from 'react'

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
    if (!key) return

    posthog.init(key, {
      api_host: 'https://us.i.posthog.com',
      capture_pageview: true,
    })
  }, [])

  return <>{children}</>
}
