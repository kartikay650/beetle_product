// Claude Haiku reply generation. ONE batched call → 3 variants.
// System prompt is the long-form skill at lib/prompts/reddit-reply-skill.md +
// per-workspace product context appended at the end.
import { readFileSync } from 'fs'
import { join } from 'path'
import Anthropic from '@anthropic-ai/sdk'

export type ReplyVariant = {
  variant: 1 | 2 | 3
  variant_label: 'Helpful' | 'Soft mention' | 'Direct'
  content: string
}

interface ThreadInput {
  title: string
  body: string
  subreddit: string
  top_comments: Array<{ author: string; body: string; upvotes: number }>
}

interface WorkspaceInput {
  product_name: string
  product_description: string
  icp_description: string
  tone_guide: string
  competitors: string[]
}

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 1500

const FALLBACK: ReplyVariant[] = [
  { variant: 1, variant_label: 'Helpful', content: 'Reply generation failed. Please try again.' },
  { variant: 2, variant_label: 'Soft mention', content: 'Reply generation failed. Please try again.' },
  { variant: 3, variant_label: 'Direct', content: 'Reply generation failed. Please try again.' },
]

function buildUserPrompt(thread: ThreadInput, refinement?: string): string {
  const commentsBlock =
    thread.top_comments && thread.top_comments.length > 0
      ? thread.top_comments
          .slice(0, 3)
          .map((c) => `- ${c.author}: ${(c.body ?? '').slice(0, 200)}`)
          .join('\n')
      : '(no comments)'

  const base = `Thread in r/${thread.subreddit}:

Title: ${thread.title}

Body: ${thread.body?.slice(0, 1000) || '(no body)'}

Top comments:
${commentsBlock}

Generate 3 reply variants.`

  const trimmedRefinement = refinement?.trim()
  if (!trimmedRefinement) return base

  return `${base}

USER REFINEMENT REQUEST:
The user wants these changes to the replies: ${trimmedRefinement}

Apply this feedback to all 3 variants. Keep all other rules from the skill file intact. Still return the same JSON format with 3 variants.`
}

function coerceVariants(parsed: unknown): ReplyVariant[] | null {
  if (!Array.isArray(parsed) || parsed.length === 0) return null
  const out: ReplyVariant[] = []
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const variant = Number(r.variant)
    const label = typeof r.variant_label === 'string' ? r.variant_label : ''
    const content = typeof r.content === 'string' ? r.content.trim() : ''
    if (!content || ![1, 2, 3].includes(variant)) continue
    if (label !== 'Helpful' && label !== 'Soft mention' && label !== 'Direct') continue
    out.push({
      variant: variant as 1 | 2 | 3,
      variant_label: label,
      content,
    })
  }
  return out.length === 3 ? out : null
}

export async function generateReplies(
  thread: ThreadInput,
  workspace: WorkspaceInput,
  refinement?: string
): Promise<ReplyVariant[]> {
  // Load the long-form Reddit reply skill from disk on every call.
  // process.cwd() in Next.js dev + prod resolves to the project root.
  const skillPath = join(process.cwd(), 'lib/prompts/reddit-reply-skill.md')
  const skill = readFileSync(skillPath, 'utf-8')

  const systemPrompt = `${skill}

PRODUCT CONTEXT FOR THIS SESSION:
Product name: ${workspace.product_name}
What it does: ${workspace.product_description}
Target customer: ${workspace.icp_description}
Tone guide: ${workspace.tone_guide}
Competitors: ${workspace.competitors.join(', ') || 'none specified'}`

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: buildUserPrompt(thread, refinement) }],
    })

    const block = response.content[0]
    const text = block && block.type === 'text' ? block.text : ''
    const clean = text.replace(/```json|```/g, '').trim()

    let parsed: unknown
    try {
      parsed = JSON.parse(clean)
    } catch (parseErr) {
      console.error('generateReplies: JSON parse failed:', parseErr)
      console.error('raw:', text.substring(0, 1500))
      return FALLBACK
    }

    const variants = coerceVariants(parsed)
    if (!variants) {
      console.error('generateReplies: validation failed, raw:', clean.substring(0, 1500))
      return FALLBACK
    }
    variants.sort((a, b) => a.variant - b.variant)
    return variants
  } catch (err) {
    console.error('generateReplies: Claude call failed:', err)
    return FALLBACK
  }
}
