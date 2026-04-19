export async function runApifyCrawl(
  keywords: string[],
  subreddits: string[]
): Promise<string> {
  console.log('Starting Apify run with:', { keywords, subreddits })
  console.log('Apify token exists:', !!process.env.APIFY_API_TOKEN)

  const token = process.env.APIFY_API_TOKEN
  if (!token) {
    throw new Error('APIFY_API_TOKEN is not set in environment')
  }

  if (subreddits.length === 0) {
    throw new Error('No subreddits configured for this workspace')
  }

  const actorId = process.env.APIFY_ACTOR_ID || 'trudax~reddit-scraper-lite'

  // Reddit search URL per subreddit, filtered by keywords (OR-joined)
  const query = keywords.length > 0 ? keywords.join(' OR ') : ''
  const startUrls = subreddits.map((sub) => ({
    url: query
      ? `https://www.reddit.com/r/${sub}/search/?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new`
      : `https://www.reddit.com/r/${sub}/new/`,
  }))

  const input = {
    startUrls,
    maxItems: 50,
    searches: keywords,
  }

  const endpoint = `https://api.apify.com/v2/acts/${actorId}/runs?token=${token}`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Apify API ${response.status}: ${text}`)
  }

  const json = (await response.json()) as { data?: { id?: string } }
  const run = json.data

  if (!run?.id) {
    throw new Error(`Apify API returned unexpected payload: ${JSON.stringify(json)}`)
  }

  console.log('Apify run started:', run.id)

  return run.id
}
