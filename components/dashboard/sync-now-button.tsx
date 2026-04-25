'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from '@/components/ui/use-toast'
import { track } from '@/lib/analytics'

const POLL_INTERVAL_MS = 3000
const TIMEOUT_MS = 120_000

export default function SyncNowButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearTimers() {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    intervalRef.current = null
    timeoutRef.current = null
  }

  useEffect(() => clearTimers, [])

  async function handleClick() {
    if (loading) return
    setLoading(true)
    track('sync_attempted_caught_up')

    let jobId: string | undefined
    try {
      const res = await fetch('/api/crawl/trigger', { method: 'POST' })
      if (!res.ok) throw new Error(`trigger ${res.status}`)
      const data = (await res.json()) as { jobId?: string }
      jobId = data.jobId
      if (!jobId) throw new Error('no jobId in response')
    } catch (err) {
      console.error('SyncNowButton trigger failed:', err)
      toast({
        title: 'Sync failed',
        description: 'Try again',
        variant: 'destructive',
      })
      setLoading(false)
      return
    }

    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/crawl/status?jobId=${jobId}`)
        const data = await res.json()

        if (data.status === 'complete') {
          clearTimers()
          setLoading(false)
          track('crawl_completed')
          router.refresh()
          return
        }

        if (data.status === 'error') {
          clearTimers()
          setLoading(false)
          toast({
            title: 'Sync failed',
            description: 'Try again',
            variant: 'destructive',
          })
          return
        }
      } catch (err) {
        console.error('SyncNowButton poll error:', err)
      }
    }, POLL_INTERVAL_MS)

    timeoutRef.current = setTimeout(() => {
      clearTimers()
      setLoading(false)
      router.refresh()
    }, TIMEOUT_MS)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="border border-beetle-border text-beetle-muted text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-beetle-bg hover:text-beetle-ink transition-colors cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
    >
      {loading ? (
        <>
          <Loader2 size={12} className="animate-spin" />
          Syncing…
        </>
      ) : (
        <>
          <RefreshCw size={12} />
          Sync
        </>
      )}
    </button>
  )
}
