# AI Guide (YourGuide) — Design

## Context

The hero section currently has a search pill ("Search tours in Agra" →
navigates to `/tours`). The user wants to replace it with an AI-backed
question box — "YourGuide, ask me anything about your travel" — answered by
Claude Haiku, so visitors can ask real travel questions (best time to
visit, what to pack, tour pricing) and get an answer inline instead of
being dumped on a search results page. Approved via brainstorming on
2026-09-21; see the four-part request that also covered the weather card
glass effect, trust-bullet alignment, and animated hero clouds (all three
already shipped in commit `dae06e2` — out of scope for this doc).

This is the fourth item, split out because it's a new subsystem: a new
server API route, a new secret (`ANTHROPIC_API_KEY`), real per-request
cost, and abuse/rate-limit surface — unlike the other three, which were
pure CSS/markup tweaks to existing pages.

## Goals

- A hero input that answers real travel/tour questions using Claude Haiku,
  grounded in the site's actual live tour catalog (never invented prices).
- Hard caps on request volume so a burst of traffic (or abuse) can't run
  up an unbounded API bill.
- No regression to the existing "go straight to /tours" path.

## Non-goals (explicit)

- No streaming responses (SSE) — plain request/response is enough for a
  2-4 sentence answer.
- No server-persisted conversation history — only the last Q&A pair is
  kept client-side (in React state) and resent as context; lost on
  refresh.
- No moderation/abuse-detection beyond the rate caps and the system
  prompt's scope guardrail. The guide has no tool access and touches no
  user data beyond the typed question, so the worst case of a prompt
  injection attempt is an off-topic or unhelpful answer — not a data or
  security exposure. Acceptable for v1.
- No multi-language engineering — Haiku answers natively in whatever
  language the visitor writes in; the site's separate i18n dictionary
  system is untouched.

## Architecture

**New API route** — `src/pages/api/ai-guide.ts`, `POST`, `prerender =
false`. Follows the exact pattern already used by
`src/pages/api/create-order.ts`: `resolveEnv(locals)` for secrets, a
try/catch returning `{ error }` JSON on failure, 200 on success.

**New secret** — `ANTHROPIC_API_KEY`, added to the dual-lookup list in
`src/lib/env.ts` (same pattern as `RESEND_API_KEY`, `GA4_API_SECRET`,
etc.): `runtimeEnv.ANTHROPIC_API_KEY ?? import.meta.env.ANTHROPIC_API_KEY`.
Must be set in Cloudflare Pages' dashboard env vars — binds on the *next*
deploy after being set, per this repo's known Cloudflare Pages quirk
(documented in `SESSION_HANDOFF.md`).

**New lib file** — `src/lib/aiGuide.ts`:
- `hashIp(ip: string): Promise<string>` — SHA-256 via Web Crypto
  (`crypto.subtle.digest`), same primitive already used for PBKDF2
  hashing in `passwordHash.ts`. Privacy-only (avoids storing raw IPs in
  D1), not a security boundary.
- `checkRateLimit(db, ipHash): Promise<{ allowed: boolean }>` — two D1
  count queries against `ai_guide_requests` (per-IP in last 24h, and
  site-wide in last 24h), against the caps below.
- `recordRequest(db, ipHash): Promise<void>` — inserts one row. Called
  *before* the Anthropic call, not after, so a burst of concurrent
  requests can't all race past the cap in the time it takes Claude to
  respond. Trade-off: a request that fails after this insert still
  "spends" its slot — acceptable, simpler than a two-phase reserve/commit.
- `buildSystemPrompt(tours: TourSummary[]): string` — the persona +
  guardrails + live catalog block (see below).
- `askYourGuide(message, history, env): Promise<string>` — the actual
  `fetch()` to `https://api.anthropic.com/v1/messages`, `model:
  "claude-haiku-4-5-20251001"`, `max_tokens: 300`. Returns the answer
  text, or throws on any non-2xx/network error (caught by the route,
  which converts it to the same fallback text a rate-limit hit gets).

**New D1 migration** — `schema_ai_guide_usage.sql`:
```sql
CREATE TABLE ai_guide_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_ai_guide_requests_created_at ON ai_guide_requests(created_at);
CREATE INDEX idx_ai_guide_requests_ip_hash ON ai_guide_requests(ip_hash, created_at);
```
Applied both `--local` and to production via the D1 MCP tool, same
process as every other migration this session.

**New component** — `src/components/AiGuideBox.tsx` (React island,
`client:load`), replacing the `<a href="/tours">` pill currently in
`src/pages/index.astro`'s hero section.

## Request flow

1. Visitor types a question in `AiGuideBox`, submits (Enter or button).
2. `POST /api/ai-guide` with `{ message: string, history?: [{q, a}] }`
   (`history` capped to the single most recent exchange, sent from React
   state — never persisted server-side).
3. Route reads `request.headers.get('cf-connecting-ip')`, hashes it,
   calls `checkRateLimit`.
4. If either cap is hit: skip Claude entirely, return `200 { answer:
   FALLBACK_TEXT }` — never a 4xx/5xx for a rate-limit hit, so the
   frontend doesn't need special-case error handling; a capped visitor
   just gets a helpful redirect instead of an answer.
5. If under cap: `recordRequest`, then `listTours(db, {status:
   'published'})` (existing function, already used by `index.astro`
   itself) to build the live catalog block, then `buildSystemPrompt` +
   `askYourGuide`.
6. Any Anthropic-side failure (network, timeout, non-2xx) is caught and
   converted to the same `FALLBACK_TEXT` — the visitor never sees a raw
   error, consistent with how `WeatherCard` never renders a broken state.
7. `AiGuideBox` renders the returned answer inline below the input in a
   frosted card (same `bg-white/40 backdrop-blur-md` visual language as
   the weather card), with a loading state while the request is in
   flight, and keeps the input available for a follow-up question.

## System prompt

Built fresh per request from the live catalog (`buildSystemPrompt`):

```
You are YourGuide, a friendly travel assistant for IWIS Global, a
private Taj Mahal & Agra tour operator based in Agra, India.

Answer questions about visiting Agra and the Taj Mahal, and about IWIS
Global's tours, using ONLY:
1. The CURRENT TOURS data below (this is live, accurate data).
2. Safe, general, widely-known travel knowledge (dress modestly at
   religious/heritage sites, mornings are best for photos and cooler
   weather, etc.).

Never state a specific ticket price, monument entry fee, or timing that
is not in the CURRENT TOURS data below. If asked for a figure you don't
have verified data for, say so plainly and point to /tours, /guides, or
WhatsApp (+91 6399226633) instead of guessing.

Keep answers to 2-4 sentences. If asked something unrelated to travel,
Agra, or IWIS Global's tours, politely decline and redirect to travel
questions.

CURRENT TOURS:
- <title> — <price> <currency> per traveler, <durationLabel>
- ...
```

`FALLBACK_TEXT` (rate-limited or on any failure): "I couldn't get you an
answer just now — you're welcome to browse our tours, or WhatsApp us at
+91 6399226633 and we'll help directly."

## Rate limits (v1 defaults, per the approved brainstorming answer)

- **10 requests / IP / 24h.**
- **300 requests / site-wide / 24h.**
- **300 max output tokens** per answer (bounds per-call cost regardless
  of caps above).

These are deliberately conservative and easy to raise later once real
usage is visible — not meant to be the final tuned values.

## Frontend details

- Visual: same pill shape/sizing as today's search bar (`bg-white
  rounded-full`), text input replaces the link, submit icon swaps the
  magnifying glass for a chat/sparkle icon.
- A small secondary text link ("Browse tours →") sits just below the
  pill, preserving the direct-nav-to-/tours path that existed before.
- Fires a `dataLayer` push (`{ event: 'ai_guide_asked' }`, no PII) on
  submit, matching the existing analytics pattern (backlog 2.8/2.9 in
  `SESSION_HANDOFF.md`).
- Client-side guard: reject/trim input over ~300 characters before
  sending, so no one can paste a huge block of text into a single
  request (cost control layered on top of the server-side caps).

## Testing / verification

1. `npx astro check` — 0 errors.
2. Apply the D1 migration `--local` and to production (same process as
   prior migrations this session).
3. Set `ANTHROPIC_API_KEY` in Cloudflare Pages env vars (production) —
   binds on next deploy.
4. Local dev (`import.meta.env.ANTHROPIC_API_KEY` in `.env`): ask a real
   question in the browser, confirm the answer correctly cites an actual
   tour title/price from D1, not an invented one.
5. `curl` the route directly 11 times in a row from the same origin,
   confirm the 11th returns `FALLBACK_TEXT` instead of calling Claude.
6. Temporarily unset `ANTHROPIC_API_KEY` locally, confirm the route
   still returns `200 { answer: FALLBACK_TEXT }`, never a 500.
7. Browser check: submit a question, confirm loading state, confirm
   answer renders, confirm "Browse tours →" link still navigates to
   `/tours`, confirm `dataLayer` gets the `ai_guide_asked` push.
8. Mobile-width check on the new pill/card layout.
