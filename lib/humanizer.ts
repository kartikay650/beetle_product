// Shared post-processing for any AI-generated text destined for Reddit.
// Strips em/en dashes, common AI vocabulary, and filler patterns so the
// output reads like a human typed it on their phone.
export function humanizeText(input: string): string {
  let text = input

  // Remove em dashes (replace with comma). Em dash is the single biggest AI tell.
  text = text.replace(/\s*—\s*/g, ', ')
  // Remove en dashes too
  text = text.replace(/\s*–\s*/g, ', ')

  // Remove "In today's <noun> landscape," / "In today's world," lead-ins
  text = text.replace(/[Ii]n today's [a-z]+ landscape,?\s*/g, '')
  text = text.replace(/[Ii]n today's world,?\s*/g, '')

  // Remove "It's important to note" / "worth noting" / "worth mentioning" filler
  text = text.replace(/[Ii]t's important to note that\s*/g, '')
  text = text.replace(/[Ii]t's worth noting that\s*/g, '')
  text = text.replace(/[Ii]t's worth mentioning that\s*/g, '')

  // Remove other AI lead-ins
  text = text.replace(/[Aa]t the end of the day,?\s*/g, '')
  text = text.replace(/[Nn]eedless to say,?\s*/g, '')

  // utilize → use (preserves tense)
  text = text.replace(/\butilize[sd]?\b/gi, (m) => {
    const lower = m.toLowerCase()
    if (lower === 'utilize') return 'use'
    if (lower === 'utilized') return 'used'
    if (lower === 'utilizes') return 'uses'
    return 'use'
  })

  // leverage → use
  text = text.replace(/\bleverage[sd]?\b/gi, (m) => {
    const lower = m.toLowerCase()
    if (lower === 'leverage') return 'use'
    if (lower === 'leveraged') return 'used'
    if (lower === 'leverages') return 'uses'
    return 'use'
  })

  // streamline → simplify
  text = text.replace(/\bstreamline[sd]?\b/gi, 'simplify')

  // robust → solid
  text = text.replace(/\brobust\b/gi, 'solid')

  // seamless / seamlessly → smooth / smoothly
  text = text.replace(/\bseamless(ly)?\b/gi, 'smooth$1')

  // comprehensive → complete
  text = text.replace(/\bcomprehensive\b/gi, 'complete')

  // innovative → new
  text = text.replace(/\binnovative\b/gi, 'new')

  // empower → help (preserves tense)
  text = text.replace(/\bempower[sd]?\b/gi, (m) => {
    const lower = m.toLowerCase()
    if (lower === 'empower') return 'help'
    if (lower === 'empowered') return 'helped'
    if (lower === 'empowers') return 'helps'
    return 'help'
  })

  // delve into / delves in / delved → dig into
  text = text.replace(/\bdelve[sd]?\s*(?:into|in)?\b/gi, 'dig into')

  // foster / fosters / fostered → build
  text = text.replace(/\bfoster[sed]*\b/gi, 'build')

  // elevate → improve
  text = text.replace(/\belevate[sd]?\b/gi, 'improve')

  // game-changer / game changer → drop
  text = text.replace(/\bgame[- ]?changer\b/gi, '')

  // groundbreaking → drop
  text = text.replace(/\bgroundbreaking\b/gi, '')

  // cutting-edge / cutting edge → modern
  text = text.replace(/\bcutting[- ]?edge\b/gi, 'modern')

  // revolutionary → drop
  text = text.replace(/\brevolutionary\b/gi, '')

  // "in order to" → "to"
  text = text.replace(/\bin order to\b/gi, 'to')

  // "at its core," → drop
  text = text.replace(/\bat its core,?\s*/gi, '')

  // "when it comes to" → "with"
  text = text.replace(/\bwhen it comes to\b/gi, 'with')

  // "in terms of" → "for"
  text = text.replace(/\bin terms of\b/gi, 'for')

  // Cleanup pass: collapse double spaces, fix orphaned commas/periods left by removals.
  text = text.replace(/\s{2,}/g, ' ')
  text = text.replace(/,\s*,/g, ',')
  text = text.replace(/\.\s*,/g, '.')
  text = text.replace(/,\s*\./g, '.')
  text = text.replace(/\s+([.,!?])/g, '$1')

  return text.trim()
}
