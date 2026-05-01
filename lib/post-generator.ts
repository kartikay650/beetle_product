// Reddit post generation. Loads the long-form skill from disk + appends product
// context, asks Claude Haiku for a single post, validates the JSON shape, and
// runs the result through the humanizer to strip AI tells.
import { readFileSync } from 'fs'
import { join } from 'path'
import Anthropic from '@anthropic-ai/sdk'
import { humanizeText } from '@/lib/humanizer'

export const BEETLE_PICKS_TOPIC = '__beetle_decides__'

export type PostType = 'discussion' | 'experience' | 'problem'
export type PostLength = 'short' | 'medium' | 'long'

export type SuggestedSubreddit = {
  name: string
  fit: 'best' | 'good' | 'risky'
  reason: string
  warning: string | null
}

export type GeneratedPost = {
  title: string
  body: string
  post_type: PostType
  word_count: number
  suggested_subreddits: SuggestedSubreddit[]
  geo_keywords: string[]
  engagement_hook: string
}

interface PostWorkspace {
  product_name: string
  product_description: string
  icp_description: string
  tone_guide: string
  competitors: string[]
  subreddits: string[]
}

interface PostOptions {
  topic: string
  postType: PostType
  postLength: PostLength
  targetSubreddit?: string | null
  refinement?: string
}

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 1000

function buildUserPrompt(workspace: PostWorkspace, options: PostOptions): string {
  const typeNudge =
    options.postType === 'discussion'
      ? 'Create a question that sparks genuine community debate around this topic.'
      : options.postType === 'experience'
        ? 'Share a specific experience with numbers and results related to this topic.'
        : 'Describe a real challenge related to this topic and ask for genuine advice.'

  const lengthNudge =
    options.postLength === 'short'
      ? '50-80 words body. Quick and punchy.'
      : options.postLength === 'medium'
        ? '100-150 words body. Some context included.'
        : '150-200 words body MAX. Detailed but never exceeds 200 words.'

  const subredditLine = options.targetSubreddit
    ? `Target subreddit: r/${options.targetSubreddit}. Tailor the tone and content specifically for this community.`
    : 'No specific subreddit targeted. Suggest the best fitting ones.'

  const refinementBlock = options.refinement?.trim()
    ? `\n\nUSER REFINEMENT: ${options.refinement.trim()}\nApply this feedback. Keep all skill file rules.`
    : ''

  // Topic block: when the user picks "beetle decides", swap in a richer brief
  // that asks Claude to choose the topic itself based on product context.
  const topicBlock =
    options.topic === BEETLE_PICKS_TOPIC
      ? `Topic: Choose the best topic to post about right now.

Based on this product context, pick a topic that:
1. Relates to a problem the target customer faces
2. Would naturally generate discussion on Reddit
3. Creates opportunities for the product to be discovered through replies (without mentioning it in the post)
4. Targets search queries that improve GEO rankings
5. Has not been overdone on Reddit recently

Pick something specific and opinionated, not generic.`
      : `Topic: ${options.topic}`

  return `Generate a Reddit post with these parameters:

${topicBlock}
Post type: ${options.postType}
${typeNudge}

Length: ${options.postLength}
${lengthNudge}

${subredditLine}${refinementBlock}

Remember:
- NEVER mention ${workspace.product_name || 'the product'} in the title or body
- The post must create a conversation around the PROBLEM, not the solution
- End with a specific question that invites genuine replies
- Match the target subreddit's tone exactly
- Title must be lowercase reddit-style`
}

function humanizePost(post: GeneratedPost): GeneratedPost {
  return {
    ...post,
    title: humanizeText(post.title),
    body: humanizeText(post.body),
  }
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
    : []
}

function coerceSuggestedSubreddit(raw: unknown): SuggestedSubreddit | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = typeof r.name === 'string' ? r.name.replace(/^r\//i, '').trim() : ''
  if (!name) return null
  const rawFit = typeof r.fit === 'string' ? r.fit.toLowerCase() : 'good'
  const fit: SuggestedSubreddit['fit'] =
    rawFit === 'best' || rawFit === 'risky' ? rawFit : 'good'
  const reason = typeof r.reason === 'string' ? r.reason.trim() : ''
  const warningRaw = r.warning
  const warning =
    typeof warningRaw === 'string' && warningRaw.trim().length > 0 ? warningRaw.trim() : null
  return { name, fit, reason, warning }
}

function coercePost(parsed: unknown): GeneratedPost | null {
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>

  const title = typeof p.title === 'string' ? p.title.trim() : ''
  const body = typeof p.body === 'string' ? p.body.trim() : ''
  if (!title || !body) return null

  const rawType = typeof p.post_type === 'string' ? p.post_type.toLowerCase() : ''
  const post_type: PostType =
    rawType === 'discussion' || rawType === 'experience' || rawType === 'problem'
      ? rawType
      : 'discussion'

  // Trust the model's word_count, but compute from body as a fallback / sanity check.
  const computed = body.split(/\s+/).filter(Boolean).length
  const word_count =
    typeof p.word_count === 'number' && Number.isFinite(p.word_count) && p.word_count > 0
      ? Math.round(p.word_count)
      : computed

  const subs = Array.isArray(p.suggested_subreddits)
    ? (p.suggested_subreddits as unknown[])
        .map(coerceSuggestedSubreddit)
        .filter((s): s is SuggestedSubreddit => s !== null)
        .slice(0, 4)
    : []

  const engagement_hook =
    typeof p.engagement_hook === 'string' && p.engagement_hook.trim().length > 0
      ? p.engagement_hook.trim()
      : ''

  return {
    title,
    body,
    post_type,
    word_count,
    suggested_subreddits: subs,
    geo_keywords: asStringArray(p.geo_keywords).slice(0, 8),
    engagement_hook,
  }
}

export async function generatePost(
  workspace: PostWorkspace,
  options: PostOptions
): Promise<GeneratedPost> {
  // Load the long-form Reddit post skill from disk every call. Fast on local
  // FS; in production Next.js' tracer keeps the file alongside the bundle.
  const skillPath = join(process.cwd(), 'lib/prompts/reddit-post-skill.md')
  const skill = readFileSync(skillPath, 'utf-8')

  const systemPrompt = `${skill}

PRODUCT CONTEXT:
Product: ${workspace.product_name}
Description: ${workspace.product_description}
Target customer: ${workspace.icp_description}
Tone: ${workspace.tone_guide}
Competitors: ${workspace.competitors.join(', ') || 'none'}
Monitored subreddits: ${workspace.subreddits.join(', ')}`

  const userPrompt = buildUserPrompt(workspace, options)

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const block = response.content[0]
  const text = block && block.type === 'text' ? block.text : ''
  const clean = text.replace(/```json|```/g, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(clean)
  } catch (err) {
    console.error('generatePost: JSON parse failed:', err)
    console.error('raw:', text.substring(0, 1500))
    throw new Error('Could not parse post response. Try again.')
  }

  const post = coercePost(parsed)
  if (!post) {
    console.error('generatePost: validation failed, raw:', clean.substring(0, 1500))
    throw new Error('Generated post was malformed. Try again.')
  }
  return humanizePost(post)
}
