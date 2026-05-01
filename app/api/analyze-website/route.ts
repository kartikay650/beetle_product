import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { analyzeWebsite } from '@/lib/website-analyzer'

export const maxDuration = 30

export async function POST(request: Request) {
  // 1. Auth
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Parse body
  const body = (await request.json().catch(() => ({}))) as { url?: string }
  const rawUrl = (body.url ?? '').trim()
  if (!rawUrl) {
    return NextResponse.json({ error: 'URL required' }, { status: 400 })
  }

  // 3. Normalize URL — prepend https:// if no protocol
  let url = rawUrl
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`
  }
  try {
    new URL(url)
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  // 4. Run analysis
  try {
    const analysis = await analyzeWebsite(url)
    return NextResponse.json({ analysis })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Analysis failed'
    console.error('analyze-website route error:', err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
