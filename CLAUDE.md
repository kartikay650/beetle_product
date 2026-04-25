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
      dashboard/
        page.tsx                — server component, fetches threads+scores, sorts, renders ThreadViewer
        actions.ts              — "use server" dismissThread
      onboarding/page.tsx       — 5-step wizard (client, localStorage persistence)
      settings/
        page.tsx                — server fetch, passes to SettingsForm
        actions.ts              — "use server" saveWorkspace server action
    auth/
      callback/route.ts         — OAuth code exchange + onboarding_complete routing
      reset-password/page.tsx   — new password form
    api/crawl/
      trigger/route.ts          — POST, creates crawl_jobs, fans out N Apify runs
      status/route.ts           — GET, polls job status (?jobId or latest)
      process/route.ts          — POST (internal), polls all Apify runs, merges results, writes threads
    layout.tsx                  — root: fonts, Toaster, PostHogProvider
    page.tsx                    — server component, auth-based redirect
    global-error.tsx            — Sentry wrapper
    globals.css                 — Tailwind + beetle base styles
  components/
    layout/dashboard-layout.tsx — sidebar + top bar + mobile tabs
    dashboard/
      empty-states.tsx          — CaughtUpState + FirstTimeEmptyState (both wired to ScanScreen)
      scan-screen.tsx           — scanning animation + 2s poll, 90s timeout, error inline
      thread-viewer.tsx         — one-thread-at-a-time UI, intent badge, beetle's read, dismiss/generate
      view-all-list.tsx         — compact escape-hatch list of all threads
    settings/settings-form.tsx  — client form, calls saveWorkspace action
    providers/posthog-provider.tsx
    ui/                         — button, input, textarea, card, badge,
                                  separator, avatar, label, toast, toaster,
                                  use-toast, tag-input
  lib/
    analytics.ts                — track() helper
    crawler.ts                  — fan-out crawler: runApifyCrawl (returns runIds[]),
                                  checkApifyRuns, fetchApifyResults, mapApifyToThread,
                                  storeThreads (dedupes by reddit_id, caps at 25)
    workspace.ts                — WorkspaceData type, getWorkspace, upsertWorkspace
    utils.ts                    — cn() helper
    supabase/client.ts          — browser client
    supabase/server.ts          — server client
    supabase/admin.ts           — service-role admin (SERVER ONLY)
  middleware.ts                 — session guard, uses getUser()
  tailwind.config.ts            — beetle color tokens + font families
  instrumentation.ts, sentry.*.config.ts
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
| `CRAWL_SECRET` | Internal shared secret for /api/crawl/process + /api/crawl/score (value: `beetle-crawl-internal`) |
| `NEXT_PUBLIC_SITE_URL` | Base URL the server uses to call its own internal routes (`http://localhost:3000` locally, Vercel URL in prod) |
| `ANTHROPIC_API_KEY` | Claude Haiku thread scoring (batched) + future reply generation |
| `OPENAI_API_KEY` | Fallback (Phase 3, unused) |
| `NEXT_PUBLIC_POSTHOG_KEY` | Analytics, empty locally |
| `SENTRY_DSN` | Error monitoring, empty locally |

---

## Built + Working

### Phase 1 (Auth + Onboarding + Settings)
- Auth: email/password + Google OAuth, signup with validation, reset-password flow
- Onboarding: 5-step wizard with localStorage persistence and partial Supabase upsert each step
- Dashboard: session/profile/workspace edge case routing
- Settings: workspace editor + account management (change email, password reset, sign out) — Server Action
- DashboardLayout: sidebar + mobile bottom tabs + "last synced" label

### Phase 2 (Crawler) — CONFIRMED GREEN 2026-04-21
- Trigger POSTs to `/api/crawl/trigger` → creates crawl_jobs row → fans out one Apify run **per subreddit** in parallel (actor rejects multi-community `withinCommunity`)
- Run IDs stored comma-separated in `crawl_jobs.apify_run_id` (TEXT column)
- `/api/crawl/process` polls all runs, merges dataset items, dedupes by reddit_id, caps at 25 by upvotes
- Schema: writes to threads using **real column names** (`url`, `upvotes`, `comment_count`, `reddit_created_at`) — NOT the ones originally assumed
- Verified: 4 parallel runs → 59 items → 25 uniques → real rows in DB (sample: r/saas 607-up "5 years in, we reached $5M ARR")

### Phase 2 UI — CONFIRMED SHIPPED 2026-04-21
- **ScanScreen** (`components/dashboard/scan-screen.tsx`): spinner + elapsed timer, 2s polling, 90s timeout ("This is taking longer than expected"), inline error state with retry. Calls `router.refresh()` on `status==='complete'`.
- **FirstTimeEmptyState** and **CaughtUpState** ("Sync now") both wired to ScanScreen — coming-soon toasts removed.
- **ThreadViewer** (`components/dashboard/thread-viewer.tsx`): one-thread-at-a-time, spec followed exactly:
  - top bar: "X of Y threads" + back arrow + "View all"
  - intent badge (HIGH / MEDIUM / LOW / SCORING…) + subreddit + relative time + upvotes + comments
  - large title, first 3–4 sentence body preview, "Read full thread ↗" opens Reddit
  - **beetle's read:** summary from thread_scores.summary, skeleton loader while null
  - Dismiss (ghost) + Generate Reply (primary); reply panel shows "Coming in next update" placeholder for Phase 2
  - slide-in animation on navigation; back preserves reply panel state
- **ViewAllList**: compact list with intent pill + one-line summary, taps jump to thread.
- **dismissThread** server action: sets threads.status = 'dismissed' scoped to user's workspace.
- **Ordering**: `thread_scores.relevance_score DESC NULLS LAST, upvotes DESC`. Computed client-side in dashboard page after fetch (25 rows max, trivial).

### Phase 2 Prompt 2 — Claude Haiku scoring (2026-04-24)
- Pipeline split 3 ways: `/api/crawl/trigger` → `/api/crawl/process` (fetch+store) → `/api/crawl/score` (scoring). Each has its own 60s serverless budget.
- Scoring uses **Claude Haiku** (`claude-haiku-4-5-20251001`) in **one batched API call** for the top 10 threads (ordered by upvotes DESC, status='new'). Not Sonnet, not Opus.
- `lib/scorer.ts` exposes `batchScoreThreads(threads, workspace)` (single Claude call, parses JSON array response, strips any stray markdown fences) and `scoreAndStore(threads, workspace, jobId)` (dedupes against `thread_scores.thread_id`, upserts in one go).
- Fire-and-forget uses `process.env.NEXT_PUBLIC_SITE_URL` to call `/api/crawl/score` (localhost:3000 locally; Vercel URL in prod).
- `crawl_jobs.status` has a new `'scoring'` state between `'complete'` and `'processing'`. See Supabase migration note below.
- `intent_level` fully removed. UI pill now derived from `relevance_score` buckets (8–10 HIGH/green, 5–7 MED/amber, 1–4 LOW/gray).

## Not Yet Started

- **Scoring for threads 11–25**: only top 10 are scored. If user wants more, we'd add a second batched call.
- **Populate `threads.top_comments`**: crawler currently leaves it empty; the scorer handles null gracefully.
- **Phase 3 — Reply generation**: on-demand (NOT pre-generated) when user clicks "Generate Reply". 3 options tuned to workspace tone + ICP, user copies and posts manually.

---

## Supabase Tables (real schema — discovered 2026-04-21 via OpenAPI)

### `threads`
| col | type | notes |
|-----|------|-------|
| `id` | uuid | primary key |
| `reddit_id` | text | **UNIQUE globally** (not composite with workspace_id) |
| `workspace_id` | uuid | FK → workspaces.id |
| `subreddit` | text | lowercase, no `r/` prefix |
| `title` | text | |
| `body` | text | may be empty for link posts |
| `url` | text | full reddit.com URL |
| `author` | text | |
| `upvotes` | integer | |
| `comment_count` | integer | |
| `top_comments` | jsonb | (not populated yet) |
| `status` | text | `new` / `dismissed` / `replied` (expected values) |
| `reddit_created_at` | timestamptz | original post time |
| `crawled_at` | timestamptz | |

### `thread_scores` (Phase 2 scoring writes here)
| col | type | notes |
|-----|------|-------|
| `id` | uuid | pk |
| `thread_id` | uuid | FK → threads.id (UNIQUE — upsert conflict target) |
| `relevance_score` | integer | 1–10 |
| `summary` | text | 2–3 sentence "beetle's read" |
| `key_insight` | text | |
| `competitor_mentioned` | boolean | |
| `scored_at` | timestamptz | null until Claude has scored |

**Migration 2026-04-24**: `intent_level` column was dropped (`ALTER TABLE thread_scores DROP COLUMN IF EXISTS intent_level`). If a session sees `intent_level` references, the migration has not been run yet.

### `crawl_jobs`
| col | type | notes |
|-----|------|-------|
| `id`, `workspace_id`, `status`, `apify_run_id`, `threads_found`, `threads_scored`, `error_message`, `started_at`, `completed_at` | | `apify_run_id` is TEXT; we store comma-separated run IDs for multi-sub runs |

**Status check constraint** allows exactly: `'pending'`, `'running'`, `'processing'`, `'scoring'`, `'complete'`, `'error'`. (Migration 2026-04-24 added `'scoring'`.)

### `workspaces`
`id, user_id, product_name, product_description, icp_description, tone_guide, keywords, subreddits, competitors, last_synced_at, created_at, updated_at`.

### `profiles`
`id, email, onboarding_complete, ...` — one row per auth user.

---

## Key Constraints & Decisions

- **Max 25 threads per crawl** — hard-coded in crawler via per-sub `perSub = ceil(25 / N)` cap + final slice(0, 25). Never increase.
- **Fan out per subreddit** — Apify actor `harshmaur/reddit-scraper` rejects multi-community `withinCommunity`. One run per sub in parallel, results merged and deduped.
- **Reddit posts are unique globally by `reddit_id`** — upsert uses `onConflict: 'reddit_id'`. If multi-tenancy ever matters, a composite unique will need a migration.
- **Server writes use `adminClient`** (service role) to bypass RLS on system tables like `crawl_jobs` and `threads`.
- **`crawl_jobs.status`** must be exactly one of 5 values — DB has a check constraint.
- **`/api/crawl/process`** is fire-and-forget — never `await` from trigger.
- **Middleware** uses `supabase.auth.getUser()`, never `getSession()` — validates JWT server-side.
- **Scan UX**: 2s poll interval, 90s timeout. On timeout: friendly "we'll notify you" message (Apify may still finish). On error: inline retry inside the scan pane. On complete: `router.refresh()`.
- **Reply generation** is on-demand (Phase 3), not pre-generated during crawl — saves Claude cost, replies use latest KB context.

---

## Gotchas Discovered

1. **`lucide-react@^1.8.0`** resolves to a stub icon package. Pin to `0.469.0` or similar `0.x`.
2. **shadcn CLI `npx shadcn@latest init --defaults`** writes a v4-style `@import "shadcn/tailwind.css"` that breaks Tailwind v3. Use plain `@tailwind` directives.
3. **Apify actor URLs use `~` not `/`** — `harshmaur~reddit-scraper`.
4. **Apify actor `withinCommunity` accepts ONE community only**, format `r/name`. Multi-community input silently fails with `statusMessage: "Please enter the community in format \`r/gaming\`..."`. Fix: fan-out, one run per subreddit.
5. **Apify actor output keys are not the obvious ones**: use `parsedId`, `parsedCommunityName`, `upVotes`, `commentsCount`, `postUrl`, `authorName`, `createdAt` (ISO string).
6. **Settings save must go through a Server Action**, not the browser supabase client — RLS can silently drop writes.
7. **Supabase `.update()` doesn't throw on error** — returns `{ error }`. Always destructure and log.
8. **`crawl_jobs.status` check constraint is strict** — `'queued'`, `'completed'`, `'failed'` silently violate. Use `'pending'`, `'complete'`, `'error'`.
9. **Next.js dev server breaks when Supabase DNS fails** (`EAI_AGAIN`) — all `/_next/static/*` go 404. Fix: kill port, delete `.next`, restart.
10. **threads schema differs from what earlier CLAUDE.md claimed** — real columns are `url` / `upvotes` / `comment_count` / `reddit_created_at`, NOT `permalink` / `score` / `num_comments` / `created_at`. Never trust a memoized schema — query Supabase OpenAPI (`GET /rest/v1/`) to confirm.
11. **`threads.reddit_id` has a UNIQUE constraint by itself**, not composite with workspace_id. `onConflict: 'workspace_id,reddit_id'` throws `42P10`. Use `onConflict: 'reddit_id'`.

---

## Last Session — 2026-04-21

**Completed (end-to-end Phase 2):**

Changes shipped:
- `lib/crawler.ts`: rewritten for fan-out — `runApifyCrawl` returns `string[]`, `checkApifyRuns` aggregates statuses, `fetchApifyResults` merges datasets. Fixed actor field mapping (`parsedId`, `parsedCommunityName`, `upVotes`, `commentsCount`, `postUrl`, `authorName`). Fixed DB column mapping (`url`, `upvotes`, `comment_count`, `reddit_created_at`). `storeThreads` dedupes by reddit_id and caps at 25.
- `app/api/crawl/trigger/route.ts`: stores comma-separated run IDs in `apify_run_id`.
- `app/api/crawl/process/route.ts`: polls all runs via `checkApifyRuns`, aggregate-wait until all terminal, fetches merged items, upserts, marks job complete + updates `workspaces.last_synced_at`.
- `app/(dashboard)/dashboard/page.tsx`: correct column selection, nested `thread_scores` join, client-side sort by `relevance_score DESC NULLS LAST, upvotes DESC`, renders `<ThreadViewer>`.
- `app/(dashboard)/dashboard/actions.ts` NEW: `dismissThread` server action, scoped by workspace ownership.
- `components/dashboard/scan-screen.tsx` NEW: scan loop with 2s poll, 90s timeout, inline error.
- `components/dashboard/empty-states.tsx`: both states now open `<ScanScreen>` on click — toasts removed.
- `components/dashboard/thread-viewer.tsx` NEW: full one-thread-at-a-time UI per spec.
- `components/dashboard/view-all-list.tsx` NEW: escape-hatch list.

**Verified:**
1. End-to-end crawler test script (`c:/tmp/test-crawler.mjs`) ran against real workspace `eea01be1-1797-4f9f-80a6-85329930cc5b` ("beeto"): 4 parallel Apify runs, 59 items merged, 25 real Reddit threads upserted, `crawl_jobs` marked `complete`, `workspaces.last_synced_at` updated. Sample thread: r/saas · 607 upvotes · "5 years in, we reached $5M ARR, fully bootstrapped".
2. `npm run build` passes clean.
3. Dev server compiles dashboard/components without TS errors and serves 200.

**Next task:** Phase 3 — reply generation. On user click "Generate Reply", call Claude (model TBD) with the thread + workspace context + `thread_scores.summary/key_insight` and render 3 reply drafts the user can copy/paste. Writes `threads.status = 'replied'` on copy.
