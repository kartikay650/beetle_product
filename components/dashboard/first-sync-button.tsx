'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from '@/components/ui/use-toast'
import { track } from '@/lib/analytics'

const POLL_INTERVAL_MS = 3000
const TIMEOUT_MS = 120_000

export default function FirstSyncButton() {
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
    track('first_sync_attempted')

    let jobId: string | undefined
    try {
      const res = await fetch('/api/crawl/trigger', { method: 'POST' })
      if (!res.ok) throw new Error(`trigger ${res.status}`)
      const data = (await res.json()) as { jobId?: string }
      jobId = data.jobId
      if (!jobId) throw new Error('no jobId in response')
    } catch (err) {
      console.error('FirstSyncButton trigger failed:', err)
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

        // Treat 'scoring' as ready-to-show: threads are stored, scoring runs in
        // background, BEETLE'S READ polls for its own update once mounted.
        if (data.status === 'complete' || data.status === 'scoring') {
          clearTimers()
          setLoading(false)
          track('crawl_completed', { final_status: data.status })
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
        console.error('FirstSyncButton poll error:', err)
        // transient — keep polling
      }
    }, POLL_INTERVAL_MS)

    // 120s safety net: refresh anyway since threads may already be stored
    // even if scoring is still running.
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
      className="mt-6 bg-beetle-orange text-white font-body font-medium px-8 py-3 rounded-xl text-sm hover:opacity-90 transition-opacity disabled:opacity-70 disabled:cursor-not-allowed inline-flex items-center gap-2 cursor-pointer"
    >
      {loading ? (
        <>
          <Loader2 size={16} className="animate-spin" />
          Syncing…
        </>
      ) : (
        'Find my first Reddit threads →'
      )}
    </button>
  )
}
