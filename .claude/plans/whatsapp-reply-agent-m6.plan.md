# Plan: WhatsApp reply agent, milestone 6 (learning loop)

**Source PRD**: `.claude/prds/whatsapp-reply-agent.prd.md`
**Selected Milestone**: 6, Learning loop: proposed entries from site changes, staff replies and gaps; approval queue (milestones 1 to 5 are deployed)
**Complexity**: Large

## Summary

The agent answers only from entries a person approved, so its accuracy is only as good as that knowledge base. Today the knowledge base grows by hand: you press Build from site and type answers. This milestone makes it grow from three feedback sources while keeping the rule that nothing is used until a person approves it: changes to the site, what your staff actually write back to guests, and the questions the agent could not answer. It also closes the loop on mistakes (a message marked Wrong points to the entries it used) and flags entries whose source has gone. The agent never rewrites itself silently.

## There is no scheduler, so this is on-demand

The site runs on Cloudflare Pages, which has no cron jobs. The "weekly job" in the PRD becomes a **Find suggestions** button on the knowledge page, plus a banner that appears without any button press when the site's text has changed since the last build ("12 sources changed"). Every proposal is keyed to its source, so pressing the button twice never creates duplicates. A retention clean-up (below) runs opportunistically, at most once a day, when a webhook arrives.

## Where proposals come from

1. **Site changes.** The existing builder gains new sources: tour facts (what is included and excluded, where it starts, how long, what the day looks like; never prices, which always come from the live catalogue) and published blog posts. When a source changes, its entry returns to "proposed" and now shows the **old and new text side by side**. When a source disappears (a deleted guide), its entry is flagged "source removed" for you to retire or keep.
2. **Staff replies.** Two cases become candidate question-and-answer pairs: a draft staff **edited** before sending (the guest question plus the corrected text), and a reply typed in the WhatsApp Business app that follows a guest question the agent did not answer well. Every candidate is **redacted** first (phone numbers, emails, booking and payment references, the guest's name, links carrying tokens) and shows its evidence (the original question and the staff text) to the reviewer. Candidates from money, complaint, booking-change, group and medical chats are never proposed. A candidate containing figures is marked "check against the catalogue".
3. **Gaps.** For the questions the agent could not answer, the agent drafts an answer **only from sources** (approved and proposed entries plus the live catalogue). If the sources do not support an answer, it says so and the gap stays "needs a staff answer" with a prefilled form. Drafted answers are proposals, at most five per run to cap cost.
4. **Mistakes.** In the audit list, each automatic message marked Wrong shows the entries it used, with an Edit link for each. Nothing is changed automatically.

## Design decisions

1. **Approval stays the only way in.** Every proposal enters as `proposed`, which retrieval never returns. Approve, edit-then-approve and reject are the only transitions. There is no bulk approve.
2. **Duplicates are suppressed.** A proposal whose question closely matches an existing entry (normalised exact match, or high word overlap) is attached to that entry as extra evidence instead of creating a second one.
3. **Redaction is code, tested, and shown.** One function removes the identifiers listed above. The reviewer sees the redacted text, never the raw chat, and can edit before approving.
4. **Prices stay out of learned entries by rule.** A proposal built from a tour or from a staff reply is flagged if it contains a currency amount, because amounts go stale and are answered by the catalogue and tools. The reviewer can still approve it.
5. **Original text is kept to learn from edits.** `sendDraft` stores the draft's original body in a new column whenever staff change it. That is the evidence for the staff-reply source and costs one column.
6. **Retention is built in.** The PRD default is to keep message text 12 months. A purge deletes messages, drafts and empty conversations older than that, never knowledge entries, run at most once a day when a webhook arrives, plus a button with a count shown first. The privacy page states the period.
7. **Everything is traceable.** Each entry shows where it came from and when it was approved; each draft already records which entries it used.

## Files to Change

| File | Action | Why |
|---|---|---|
| `schema_whatsapp_learning.sql` | CREATE | `wa_kb_entries`: `prev_question`, `prev_answer`, `flag`, `evidence`; `wa_drafts.original_body`; settings row for the last purge |
| `src/lib/waLearning.ts` | CREATE | Redaction, candidate extraction from edits and app replies, gap answer drafting, duplicate suppression, changed and removed source detection, purge |
| `src/lib/waKnowledge.ts` | UPDATE | Keep previous text on re-propose, flags, evidence; tour and blog sources; a read-only "what changed" check |
| `src/lib/waDraft.ts` | UPDATE | Save `original_body` when staff edit a draft before sending |
| `src/pages/api/webhooks/whatsapp.ts` | UPDATE | Opportunistic daily purge |
| `src/pages/admin/whatsapp/knowledge.astro` | UPDATE | Find suggestions button, change banner, source filter, side-by-side diff, evidence panel, flags, Answer-this prefill |
| `src/pages/admin/whatsapp/auto.astro` | UPDATE | Show the entries each automatic message used, with Edit links |
| `src/pages/privacy.astro`, `src/i18n/{en,es,fr,de}.ts` | UPDATE | State the 12-month retention |
| `scripts/wa-eval/` | UPDATE | Redaction cases, gap-answer cases, and a before-and-after learning check |

## Tasks

### Task 1: Owner decisions (before build)
- (a) May anonymised staff replies be used to propose new answers?
- (b) Is 12 months right for deleting message text, and may the purge delete automatically once a day?
- (c) Which extra site sources: tour facts and blog posts (proposed), and not reviews?
- (d) Up to five drafted gap answers per press of Find suggestions: acceptable cost?
- (e) Who reviews the queue, and how often (suggested: the same person who does the Monday audit)?
- (f) Do you have a WhatsApp chat export to import? If so it feeds the same pipeline (Task 8).
- **Validate**: Answers recorded in the PRD section 14.

### Task 2: Schema
- **Action**: `schema_whatsapp_learning.sql` with the new columns and the `last_purge` setting. Apply to production before the push.
- **Mirror**: `schema_whatsapp_auto.sql`
- **Validate**: Existing entries and drafts are unchanged; new columns default empty.

### Task 3: Redaction and candidates (`waLearning.ts`)
- **Action**: `redact(text)` removes phone numbers in any common format, emails, booking and payment references, the guest's profile name, and URLs with query strings or tokens. `candidatesFromEdits` and `candidatesFromAppReplies` build candidates for chats whose intent is not a never-automatic one, with length limits and the figures flag. Duplicate suppression compares the redacted question with existing entries.
- **Mirror**: `waKnowledge.ts` (functions over `D1Like`)
- **Validate**: esbuild + node script: 30 redaction cases (international and local phone formats, spaced and dashed numbers, emails, `IWIS-1234` style references, payment IDs, names, tokenised links) with zero identifiers left; money-intent chats produce no candidate; a second run creates no duplicates; a near-duplicate question attaches evidence instead of a new entry.

### Task 4: Site sources and change detection
- **Action**: Tour facts and blog posts as new source items without prices. A read-only `sourceChanges()` compares current source hashes with the stored ones and returns counts of new, changed and removed. Changed entries keep `prev_*` for the diff; removed ones get the flag.
- **Mirror**: `proposeFromItems` in `waKnowledge.ts`
- **Validate**: Changing one guide shows one changed source and a diff; deleting one flags its entry without changing its status; the banner count matches what Build then creates.

### Task 5: Gap answers
- **Action**: For each of the top gaps not yet handled, one model call with only approved and proposed entries and the catalogue as sources, instructed to decline when unsupported. Store as a proposal with its source entry ids as evidence. Hard cap of five per run.
- **Mirror**: `callAnthropic` use in `waDraft.ts`
- **Validate**: On 25 gap questions, 10 of which the sources do answer and 15 they do not: at least 9 of the 10 answered correctly and none of the 15 invented. Recorded in the PRD.

### Task 6: Original text on edited drafts
- **Action**: `sendDraft` writes `original_body` when the sent text differs from the draft.
- **Validate**: Edited send stores both; unedited send leaves it empty.

### Task 7: Admin queue
- **Action**: Find suggestions button with a result summary, banner, source filter tabs, diff view, evidence panel with the redacted question and staff text, flag badges (figures, source removed), and an Answer-this link from the gaps list that prefills the add form. The audit list on the settings page shows the entries each automatic reply used.
- **Mirror**: Current `knowledge.astro`
- **Validate**: Signed-out access redirects; approving a proposal makes it retrievable at once; a rejected proposal is not offered again for the same source text.

### Task 8: Retention, privacy text, optional chat import
- **Action**: Daily opportunistic purge plus a confirmable button that shows the count first; privacy lines in four languages (flag for proofreading). If an export arrives, a parser for the WhatsApp export format feeds the same redaction and candidate pipeline, one file at a time, with a preview before anything is saved.
- **Validate**: Purge removes only rows older than 12 months and never knowledge entries; a webhook after the first purge of the day does not purge again.

### Task 9: Review and release
- **Action**: Security and code review agents on the redaction and the purge (privacy and deletion are the risk). Run all earlier scripts and the full evaluation. Apply the schema, push, verify.
- **Validate**: 0 type errors; build passes; evaluation still has zero hand-off misses; redaction leaves zero identifiers.

## Validation

```bash
export PATH=/Users/fasihuddinahmer/.nvm/versions/node/v22.22.1/bin:$PATH
npx astro check          # 0 errors
npm run build            # passes
npx esbuild <script>.ts --bundle --platform=node --format=esm --outfile=<script>.mjs && node <script>.mjs
export $(grep ANTHROPIC_API_KEY .env) && sh scripts/wa-eval/run.sh
```

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A guest's personal details end up in the knowledge base | Medium | Redaction in code with tests; reviewer sees only redacted text; approval required; chats about money, complaints and bookings are never used |
| A one-off staff reply becomes a general rule (for example a special favour) | Medium | Evidence shown; approver edits or rejects; figures flagged; no bulk approve |
| The agent invents an answer for a gap | Medium | Sources-only prompt that must decline; 15 unanswerable test cases must all be declined |
| Stale entries keep being used after the site changes | Medium | Changed sources return to proposed with a diff; removed sources are flagged; the banner needs no button press |
| The queue grows faster than anyone reviews it | Medium | Five gap answers per run; duplicate suppression; counts on the page; nothing blocks the agent while proposals wait |
| Retention purge deletes something needed | Low | Never touches knowledge entries; count shown before the manual purge; 12 months matches the PRD; owner confirms in Task 1 |
| Guest text injects instructions into a proposal | Low | Guest text is only ever evidence shown to a person; proposals are plain text; nothing runs from them |

## Acceptance

- [ ] Owner decisions in Task 1 recorded
- [ ] Find suggestions creates proposals from site changes, edited drafts, app replies and gaps, and pressing it twice creates no duplicates
- [ ] No proposal is ever used before approval; rejected proposals are not re-offered for the same text
- [ ] Redaction leaves no phone number, email, reference or name in 30 test cases; money, complaint, change, group and medical chats produce no candidates
- [ ] Gap answers: at least 9 of 10 answerable questions answered correctly, none of 15 unanswerable ones invented
- [ ] Changed sources show a side-by-side diff; removed sources are flagged
- [ ] The Wrong audit view lists the entries the message used
- [ ] Retention purge and privacy text match; schema applied before the push; `astro check` and build pass; the evaluation still has zero hand-off misses
