# Beetle AI — Claude Code Session Context

Keep this file up-to-date at the end of every task so future sessions can resume with full context.

---

## Project

**Beetle AI** is a Reddit GTM copilot. It finds high-intent Reddit threads matching a user's product + keywords, drafts reply options, and lets the user post manually (no bots, no automation). Target users: founder-led B2B SaaS teams.

Repo: `kartikay650/beetle_product`
Local path: `C:\Users\Admin\Beetle Product\beetle-ai`

---

## Tech Stack

- **Framework:** Next.js 14.2.35 (App Router, TypeScript strict)
- **Styling:** Tailwind CSS 3.4.19 + `tailwindcss-animate` + `autoprefixer`
- **UI:** shadcn/ui new-york style, stone base color — components under `components/ui/`
- **Fonts:** Barlow Condensed (display) + Barlow (body) via `next/font/google`
- **Auth + DB:** Supabase (`@supabase/ssr` 0.10.x, `@supabase/supabase-js` 2.103.x)
- **Crawler:** Apify actor `harshmaur/reddit-scraper`
- **AI (Phase 3, not wired):** `@anthropic-ai/sdk` + `openai`
- **Analytics:** PostHog (`posthog-js`)
- **Error monitoring:** Sentry (`@sentry/nextjs`) — client, server, edge configs
- **Icons:** `lucide-react@0.469.0` (⚠️ not `^1.8.0` — that's a different unrelated package)

---

## Folder Structure

```
beetle-ai/
  app/
    (auth)/layout.tsx, login/page.tsx, signup/page.tsx
    (dashboard)/
      layout.tsx                — pass-through layout
      dashboard/page.tsx        — server component, threads list + empty states
      onboarding/page.tsx       — 5-step wizard (client, localStorage persistence)
      settings/
        page.tsx                — server fetch, passes to SettingsForm
        actions.ts              — "use server" saveWorkspace server action
    auth/
      callback/route.ts         — OAuth code exchange + onboarding_complete routing
      reset-password/page.tsx   — new password form
    api/crawl/
      trigger/route.ts          — POST, starts crawl, creates crawl_jobs row
      status/route.ts           — GET, polls job status
      process/route.ts          — POST (internal), consumes Apify results
    layout.tsx                  — root: fonts, Toaster, PostHogProvider
    page.tsx                    — server component, auth-based redirect
    global-error.tsx            — Sentry wrapper
    globals.css                 — Tailwind + beetle base styles
  components/
    layout/dashboard-layout.tsx — sidebar + top bar + mobile tabs
    dashboard/empty-states.tsx  — CaughtUpState, FirstTimeEmptyState (client)
    settings/settings-form.tsx  — client form, calls saveWorkspace action
    providers/posthog-provider.tsx
    ui/                         — button, input, textarea, card, badge,
                                  separator, avatar, label, toast, toaster,
                                  use-toast, tag-input
  lib/
    analytics.ts                — track() helper
    crawler.ts                  — runApifyCrawl, checkApifyRun,
                                  fetchApifyResults, mapApifyToThread,
                                  storeThreads
    workspace.ts                — WorkspaceData type, getWorkspace,
                                  upsertWorkspace (server-side)
    utils.ts                    — cn() helper (clsx + tailwind-merge)
    supabase/client.ts          — browser client (createBrowserClient)
    supabase/server.ts          — server client (createServerClient + cookies)
    supabase/admin.ts           — service-role admin client (SERVER ONLY)
  middleware.ts                 — session guard, uses getUser() not getSession()
  tailwind.config.ts            — beetle color tokens + font families
  instrumentation.ts            — Sentry node/edge bootstrap
  sentry.{client,server,edge}.config.ts
  .env.local                    — see ENV VARS below
```

---

## Environment Variables

| Key | Purpose |
|-----|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key for browser client |
| `SUPABASE_SERVICE_ROLE_KEY` | Server admin writes, bypass RLS |
| `APIFY_API_TOKEN` | Apify account token (harshmaur/reddit-scraper) |
| `CRAWL_SECRET` | Internal shared secret for /api/crawl/process (value: `beetle-crawl-internal`) |
| `ANTHROPIC_API_KEY` | Reply generation (Phase 3, unused) |
| `OPENAI_API_KEY` | Reply generation fallback (Phase 3, unused) |
| `NEXT_PUBLIC_POSTHOG_KEY` | Analytics, empty locally |
| `SENTRY_DSN` | Error monitoring, empty locally |

---

## Built + Working (Phase 1)

- Auth: email/password + Google OAuth, signup with validation, reset-password flow
- Onboarding: 5-step wizard (product, ICP, tone, keywords+competitors, subreddits) with localStorage persistence and partial Supabase upsert after each step
- Dashboard: session/profile/workspace edge case routing, thread list, FirstTimeEmptyState + CaughtUpState
- Settings: workspace editor (all fields) + account management (change email, password reset, sign out) — uses Server Action for saves
- DashboardLayout: sidebar (desktop) + bottom tabs (mobile), relative "last synced" time

## In Progress — Phase 2 (Crawler)

Three routes exist:
- `/api/crawl/trigger` — POST, creates crawl_jobs row + calls `runApifyCrawl`
- `/api/crawl/status` — GET, returns latest or `?jobId=...` crawl_jobs row + workspace.last_synced_at
- `/api/crawl/process` — POST, internal consumer that polls Apify → stores threads → marks job complete

## Next After Crawler Is Green

- Wire "Find my first Reddit threads →" button on dashboard FirstTimeEmptyState to POST `/api/crawl/trigger`, then poll `/api/crawl/status`
- Replace thread list placeholder with one-thread-at-a-time UI
- Phase 3: AI reply drafting via Anthropic

---

## Supabase Tables

| Table | Purpose |
|-------|---------|
| `profiles` | One row per auth user; `onboarding_complete` boolean drives redirect logic |
| `workspaces` | One row per user: product/ICP/tone text, keyword/subreddit/competitor arrays, `last_synced_at` |
| `crawl_jobs` | One row per crawl invocation: `id`, `workspace_id`, `apify_run_id`, `status`, `threads_found`, `threads_scored`, `error_message`, `started_at`, `completed_at`. **Status check constraint allows exactly**: `'pending'`, `'running'`, `'processing'`, `'complete'`, `'error'` |
| `threads` | Reddit posts surfaced by crawl: `workspace_id`, `reddit_id`, `title`, `body`, `subreddit`, `permalink`, `author`, `score`, `num_comments`, `created_at`, `status` |
| `thread_scores` | (future) Relevance scores per thread per workspace |

---

## Key Constraints & Decisions

- **Max 25 threads per crawl** — hard-coded in `runApifyCrawl`, never increase
- **Crawler is on-demand only** — no scheduled jobs, no cron
- **Server writes use `adminClient`** (service role) to bypass RLS on system tables like `crawl_jobs`
- **`crawl_jobs.status`** must be exactly one of the 5 values listed above — the DB has a check constraint
- **`/api/crawl/process`** is fire-and-forget — never `await` it from trigger
- **Middleware** uses `supabase.auth.getUser()`, never `getSession()` — validates JWT server-side
- **TagInput lives at `components/ui/tag-input.tsx`** — one definition, settings + onboarding both import it

---

## Gotchas Discovered

1. **`lucide-react@^1.8.0`** resolves to a stub icon package, not the real Lucide library. Always pin to `0.469.0` or similar `0.x`.
2. **shadcn CLI `npx shadcn@latest init --defaults`** writes a v4-style `@import "shadcn/tailwind.css"` that breaks Tailwind v3. Globals.css must use the plain `@tailwind base/components/utilities` directives instead.
3. **Apify actor URLs use `~` not `/`** — `harshmaur/reddit-scraper` is POST'd at `api.apify.com/v2/acts/harshmaur~reddit-scraper/runs`.
4. **Settings save must go through a Server Action**, not the browser supabase client. Browser writes can silently drop under RLS policies.
5. **Supabase `.update()` doesn't throw on error** — returns `{ error }`. Always destructure and log or the failure is invisible.
6. **`crawl_jobs.status` check constraint is strict** — `'queued'`, `'completed'`, `'failed'` will silently violate. Use `'pending'`, `'complete'`, `'error'`.
7. **Next.js dev server breaks when Supabase DNS fails** (`EAI_AGAIN`) — all `/_next/static/*` requests start returning 404 HTML. Fix: kill port, delete `.next`, restart.

---

## Last Session — 2026-04-20

**Completed:** Crawler silent-failure fix.

Changes shipped (commit `3a65ca7`):
- `lib/crawler.ts` rewritten with correct actor `harshmaur~reddit-scraper` and its input schema (`searchTerms`, `searchPosts`, `withinCommunity`, `searchSort='relevance'`, `searchTime='week'`, `maxResults=25`). Added helpers: `checkApifyRun`, `fetchApifyResults`, `mapApifyToThread`, `storeThreads`. Console.log diagnostics on every step (token presence + prefix, keywords, subreddits, full input, endpoint, response status, run id).
- `app/api/crawl/trigger/route.ts`: every `adminClient.update()` now destructures `{ error }` and logs — the root cause of the silent failure was that Supabase updates don't throw, so a schema mismatch stayed invisible. Trigger now writes `error_message` + `completed_at` on failure, `apify_run_id` + `started_at` on success.
- `app/api/crawl/process/route.ts`: wired to new crawler helpers. Polls Apify every 3s up to 55s, then fetches dataset items, `storeThreads` upserts into `threads`, completes the job + stamps `workspaces.last_synced_at`.
- `.env.local`: renamed `CRAWLER_INTERNAL_TOKEN` → `CRAWL_SECRET=beetle-crawl-internal`.

**Verify on next run:**
1. `POST /api/crawl/trigger` → response `{ jobId, apifyRunId: "<real id>" }` (not null)
2. `crawl_jobs` row: `status='running'` then `'processing'` then `'complete'`, `threads_found > 0`
3. `threads` table gets up to 25 new rows per crawl
4. `workspaces.last_synced_at` updates

**Next task:** wire the "Find my first Reddit threads →" button on the dashboard `FirstTimeEmptyState` to call `POST /api/crawl/trigger` then poll `/api/crawl/status` every 3s until `status==='complete'`, then trigger `router.refresh()` so the thread list renders. Replace the current placeholder thread list with the one-thread-at-a-time UI (Phase 2 continuation).
