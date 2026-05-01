// Multi-page website analysis. Scrapes homepage + /pricing + /features + /about,
// combines into a single corpus for Haiku, returns structured suggestions tuned
// for Reddit reply context (problem/comparison/use-case keywords, real subreddits
// where buyers hang out, etc.).
import Anthropic from '@anthropic-ai/sdk'

export type WebsiteAnalysis = {
  product_name: string
  product_description: string
  icp_description: string
  tone_guide: string
  suggested_keywords: string[]
  suggested_competitors: string[]
  suggested_subreddits: string[]
}

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 1500
const PAGE_FETCH_TIMEOUT_MS = 5_000
const COMBINED_TEXT_LIMIT = 5_000
const PER_PAGE_USER_AGENT = 'Mozilla/5.0 (compatible; BeetleAnalyzer/1.0)'

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function scrapeMultiplePages(baseUrl: string): Promise<string> {
  // Use only the origin so /pricing etc. resolve cleanly even if the user
  // pasted a deep link like https://linear.app/blog/post.
  let origin: string
  try {
    origin = new URL(baseUrl).origin
  } catch {
    return ''
  }

  const pages = [
    origin,
    `${origin}/pricing`,
    `${origin}/features`,
    `${origin}/about`,
  ]

  let combinedText = ''

  for (const pageUrl of pages) {
    try {
      const res = await fetch(pageUrl, {
        headers: { 'User-Agent': PER_PAGE_USER_AGENT },
        signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
        redirect: 'follow',
      })
      if (!res.ok) continue
      const html = await res.text()
      const stripped = stripHtml(html)
      if (!stripped) continue
      combinedText += `\n--- PAGE: ${pageUrl} ---\n${stripped}\n`
    } catch {
      // skip failed pages silently — homepage is usually enough
    }
  }

  return combinedText.slice(0, COMBINED_TEXT_LIMIT)
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
    : []
}

// If `text` is over the limit, prefer truncating at the last sentence boundary
// (., !, or ?) within the limit. Falls back to a hard slice only if we'd lose
// more than half the budget — that prevents a description with a single huge
// sentence from being chopped to nothing.
function truncateToSentence(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  const truncated = text.slice(0, maxLen)
  const lastPeriod = truncated.lastIndexOf('.')
  const lastExcl = truncated.lastIndexOf('!')
  const lastQ = truncated.lastIndexOf('?')
  const lastSentenceEnd = Math.max(lastPeriod, lastExcl, lastQ)
  if (lastSentenceEnd > maxLen * 0.5) {
    return truncated.slice(0, lastSentenceEnd + 1).trim()
  }
  return truncated.trim()
}

function dedupeLower(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const key = raw.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

function dedupeCaseSensitive(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const key = raw.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(raw)
  }
  return out
}

function coerceAnalysis(parsed: unknown): WebsiteAnalysis | null {
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>

  const productName = typeof p.product_name === 'string' ? p.product_name.trim() : ''
  const productDescription =
    typeof p.product_description === 'string'
      ? truncateToSentence(p.product_description.trim(), 500)
      : ''
  if (!productName && !productDescription) return null

  const icpDescription =
    typeof p.icp_description === 'string'
      ? truncateToSentence(p.icp_description.trim(), 500)
      : ''
  const toneGuide =
    typeof p.tone_guide === 'string'
      ? truncateToSentence(p.tone_guide.trim(), 300)
      : ''

  const keywords = dedupeLower(asStringArray(p.suggested_keywords)).slice(0, 15)
  const competitors = dedupeCaseSensitive(asStringArray(p.suggested_competitors)).slice(0, 10)
  const subreddits = dedupeLower(
    asStringArray(p.suggested_subreddits).map((s) => s.replace(/^r\//i, ''))
  ).slice(0, 12)

  return {
    product_name: productName,
    product_description: productDescription,
    icp_description: icpDescription,
    tone_guide: toneGuide,
    suggested_keywords: keywords,
    suggested_competitors: competitors,
    suggested_subreddits: subreddits,
  }
}

export async function analyzeWebsite(url: string): Promise<WebsiteAnalysis> {
  // 1. Scrape up to 4 pages
  let scrapedText: string
  try {
    scrapedText = await scrapeMultiplePages(url)
  } catch (err) {
    console.error('analyzeWebsite scrape failed:', err)
    throw new Error('Could not reach website. Check the URL and try again.')
  }

  if (!scrapedText) {
    throw new Error('Could not reach website. Check the URL and try again.')
  }

  // 2. Ask Haiku for a deep, Reddit-marketing-aware analysis
  const userPrompt = `You are an expert Reddit marketing strategist analyzing a product website to set up a Reddit monitoring and engagement tool.

Website URL: ${url}

Website content (scraped from multiple pages):
${scrapedText}

Analyze this product deeply and return a JSON object with these fields. Be extremely specific — generic answers are useless.

{
  "product_name": "exact product name as shown on the website",

  "product_description": "MUST be under 490 characters total. Count carefully. Never let a sentence get cut off mid-word. Write it the way a founder would casually describe it to another founder at a bar — not marketing copy. Two to four sentences is ideal. Example: 'we built a tool that monitors reddit for threads where people are asking about problems our product solves, then drafts replies you can post manually. no bots, no automation — the human stays in the loop'",

  "icp_description": "MUST be under 490 characters total. Be specific about: job title, company size, industry, and the trigger event that makes them search for this product. Use shorthand where it helps. Example: 'b2b saas founders, 1-50 employees, post-PMF, struggling with distribution beyond paid ads. usually technical founders who are active on reddit themselves and want a tool that respects how the platform actually works'. Never exceed 490 characters.",

  "tone_guide": "MUST be under 290 characters total. Suggest a Reddit reply tone based on how the website communicates. Be specific. Example: 'casual, direct, slightly opinionated. sounds like a founder who has been in the trenches, not a marketer. lowercase and informal punctuation are fine. never sound like a press release.' Never exceed 290 characters.",

  "suggested_keywords": [
    "Generate exactly 12 keywords across 3 lengths:",

    "Short keywords (4 keywords, 2-3 words each): Simple search terms. Examples: 'reddit marketing', 'saas growth', 'social listening', 'brand monitoring'",

    "Medium keywords (4 keywords, 3-5 words each): More specific queries. Examples: 'reddit monitoring tool for saas', 'find leads on reddit', 'alternative to gummysearch'",

    "Long-tail keywords (4 keywords, 5-8 words each): Very specific Reddit search queries. Examples: 'how to find reddit threads about my product', 'best way to monitor reddit for brand mentions', 'reddit vs twitter for b2b lead generation'"
  ],

  "suggested_competitors": [
    "List 5-7 actual competitors or alternatives that someone evaluating this product would also be looking at. Include both direct competitors and adjacent tools. Be specific — use real product names, not categories."
  ],

  "suggested_subreddits": [
    "List 8-10 subreddits where this product's TARGET BUYERS (not the product's category) actually spend time.",

    "Think about it this way: if the product helps SaaS founders with Reddit marketing, the subreddits are NOT r/redditmarketing (that doesnt exist). They ARE: r/SaaS, r/startups, r/indiehackers, r/entrepreneur because thats where SaaS founders hang out.",

    "Include a mix of: 3-4 primary subreddits (high activity, directly relevant), 3-4 secondary subreddits (medium activity, adjacent), 2-3 niche subreddits (smaller but very targeted).",

    "Only suggest subreddits that actually exist and are active. Do NOT make up subreddit names."
  ]
}

CRITICAL: Return ONLY the JSON object. No markdown fences. No explanation. No preamble. Just the raw JSON.

For suggested_keywords: return an array of 12 strings, not the category descriptions. Just the actual keyword strings.

For suggested_competitors: return an array of 5-7 strings. Just the product names.

For suggested_subreddits: return an array of 8-10 strings. Just the subreddit names without r/ prefix.`

  let responseText: string
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: userPrompt }],
    })
    const block = response.content[0]
    responseText = block && block.type === 'text' ? block.text : ''
  } catch (err) {
    console.error('analyzeWebsite Claude call failed:', err)
    throw new Error('Could not analyze website. Try adding details manually.')
  }

  // 3. Parse + validate
  const clean = responseText.replace(/```json|```/g, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(clean)
  } catch (err) {
    console.error('analyzeWebsite JSON parse failed:', err)
    console.error('raw:', responseText.substring(0, 1500))
    throw new Error('Could not analyze website. Try adding details manually.')
  }

  const analysis = coerceAnalysis(parsed)
  if (!analysis) {
    console.error('analyzeWebsite validation failed, raw:', clean.substring(0, 1500))
    throw new Error('Could not analyze website. Try adding details manually.')
  }
  return analysis
}
