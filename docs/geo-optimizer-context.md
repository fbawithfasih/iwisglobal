# GEO Optimizer — reference notes

Pasted into this repo on 28 September 2026 for reference. This is the
system-prompt/context document for the `geo-optimizer-skill` toolkit
(https://github.com/auriti-labs/geo-optimizer-skill), the same tool that
produced the GEO audit run earlier this session. It's written as a Claude
Project instruction file, not as a task list — kept here so its checklist
and Princeton-methods table are on hand next time a GEO audit comes in,
without re-pasting the whole thing.

**Status on iwisglobal.com as of 28 Sept 2026** (checked against this
document's own checklist):

- `robots.txt` — already allows every AI bot this doc lists (OAI-SearchBot,
  ClaudeBot, anthropic-ai, PerplexityBot, Google-Extended, Bingbot, etc.).
- `/llms.txt` — already present (`src/pages/llms.txt.ts`,
  `src/pages/llms-full.txt.ts`).
- WebSite schema — already in `BaseLayout.astro` (homepage only, per
  Google's own guidance for site-name markup).
- Organization/TravelAgency schema — already in `BaseLayout.astro`.
- FAQPage schema — already on `/help`.
- `dateModified` — added to the homepage's WebSite JSON-LD.

So this toolkit's structural checklist is already satisfied here. What's
still useful from this document is the content-level advice below — it's
about how pages are *written*, not markup, and isn't something a single
sweep fixes; it's worth checking a specific page against when writing or
revising it.

## Princeton GEO citability methods (their claimed impact, KDD 2024)

Apply in priority order when writing or revising a page's copy:

| Priority | Method | Claimed impact | Action |
|---|---|---|---|
| 🔴 | Cite sources | +30–115% | Link to authoritative external sources in body text |
| 🔴 | Add statistics | +40% | Add %, numbers, dates, measurements |
| 🟠 | Quotation addition | +30–40% | Quote experts: "Text" — Name, Role, Source, Year |
| 🟠 | Authoritative tone | +6–12% | Precise terminology, no vague claims |
| 🟡 | Fluency optimization | +15–30% | Clear sentences, logical flow |
| 🟡 | Easy-to-understand | +8–15% | Define terms, use analogies |
| 🟢 | Technical terms | +5–10% | Correct, consistent terminology |
| 🟢 | Unique words | +5–8% | Vary vocabulary, avoid repetition |
| ❌ | Keyword stuffing | ~0% | Do not apply — neutral to negative |

This site's pages already lean this way where the facts support it (ASI
ticket prices with source links, GST/legal details, dated "Last updated"
lines) — worth checking new or revised pages against the table above,
but not a reason to insert statistics or citations that aren't
genuinely there.

## Full original document

The full document is saved verbatim at
[`geo-optimizer-claude-project.md`](geo-optimizer-claude-project.md) (the
"Claude Project context" file, meant for upload at claude.ai → Projects).
This file summarizes it rather than reproducing it in full, since most of
it (robots.txt bot list, llms.txt spec, generic schema snippets) restates
the current state of this site rather than a new recommendation.
