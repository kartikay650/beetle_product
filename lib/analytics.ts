export function track(event: string, props?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ph = (window as any).posthog
  if (!ph) return
  ph.capture(event, props)
}
