# Plan: WhatsApp reply agent, milestone 7 (launch gates and review)

**Source PRD**: `.claude/prds/whatsapp-reply-agent.prd.md`
**Selected Milestone**: 7, Launch gates and review: accuracy and hand-off targets met on the evaluation set, weekly audit running (milestones 1 to 6 are deployed)
**Complexity**: Medium

## Summary

Everything the agent does is built. This milestone is about deciding, with evidence, when it is safe to let it send on its own, and about keeping it safe afterwards. It adds one admin page, **Launch readiness**, that shows every launch gate from the PRD as pass or fail with the live numbers behind it, runs the safety self-checks that today need a developer (forged webhook request, kill switch, Meta connection, whether the AI service still has credit), and measures the four pilot targets from real traffic. It also gives you a written runbook for daily and weekly use and for what to do when something goes wrong. Building this is quick; *passing* it takes real traffic and a four-week pilot, so the PRD cannot be marked done on the day the code ships.

## The gates (from the PRD) and how each is checked

| # | Gate | How it is checked |
|---|---|---|
| 1 | Evaluation set has at least 100 questions and at least 95% of automatic replies are factually correct, with no wrong price, date or refund rule | Latest recorded evaluation: question count, pass rate, forbidden-text count, and the fact check's accept and reject rates. Must be no older than 14 days |
| 2 | Every money, complaint and booking-change test message is handed off | Same evaluation: hand-off misses must be 0. Live: any such message ever sent automatically (other than the holding note) is shown |
| 3 | Kill switch tested | Self-check: with the switch off, a synthetic eligible draft is refused. Re-run after every deploy |
| 4 | Forged webhook request tested | Self-check: the live webhook rejects a wrongly signed and an unsigned request |
| 5 | Owner has reviewed 50 real drafts | Live count of drafts staff sent or discarded |
| 6 | Meta is connected | Self-check: the four secrets are set, the Graph API answers for the phone number ID and the number matches +91 6399226633, and at least one real message has arrived |
| 7 | The AI service is reachable | Self-check: one tiny model call. This would have caught the empty Anthropic balance |

All seven must pass before the master switch is turned on. The settings page keeps its own 50-draft and per-kind gates; this page adds the rest and shows them in one place.

## The pilot targets and how they are measured (last 28 days of real traffic)

| Target from the PRD | Measure |
|---|---|
| 60% or more of guest messages resolved without staff | Guest text messages answered by an automatic reply, as a share of all guest text messages (and, separately, drafts staff sent unedited) |
| Median first reply under 1 minute, 24 hours a day | For each guest message, the time to the first reply (automatic, site, or Business app). Median, share within 1 minute, and the same split by hour of day |
| Zero wrong statements reached a guest | Automatic messages marked Wrong in the audit, and the share of automatic messages audited at all |
| 100% of money, complaint and booking-change messages reach a person | For those intents: the share that ended in needs-a-person or staff handling, and the count that were answered automatically other than by the holding note (must be 0) |

Cost is shown beside them as model tokens used per day, from the existing usage table.

## Design decisions

1. **Gates are computed, not ticked.** Each gate reads live data or a recorded result; the page shows the number, the target, the date it was measured, and what to do if it fails. The only attested item is the evaluation, because the evaluation runs on a developer machine with the AI key.
2. **Evaluation results are recorded, not uploaded.** After a run, the numbers (date, question count, passed, hand-off misses, forbidden text, fact-check accept and reject rates, redaction and gap results) are stored in one settings row. The page shows them and goes amber after 14 days. This avoids opening an upload endpoint.
3. **Self-checks are explicit and cheap.** One button runs them, each takes a second, and the results (with the time) are stored. They make exactly two outside calls: one small model call and one Meta read. Neither sends anything.
4. **Real questions join the evaluation.** An export button turns reviewed drafts into test cases (guest question redacted, whether a person was needed, and the final reply staff approved as the reference). The runner scores these with the fact check plus a small-model "same facts as the reference?" comparison, so the set can grow past 100 with your own chats and stay honest.
5. **The weekly audit gets a nudge.** There is no scheduler, so the inbox and settings pages show a banner when automatic messages older than 7 days have not been audited, and a button emails you the week's report (counts, wrong marks, targets).
6. **A runbook ships with it.** `docs/whatsapp-agent-runbook.md` covers the daily check, the Monday audit, adding knowledge, switching off, what to do after a wrong message, rotating secrets, topping up credit, and re-running the evaluation.
7. **No new tables.** Settings rows hold the evaluation and self-check results.

## Files to Change

| File | Action | Why |
|---|---|---|
| `src/lib/waLaunch.ts` | CREATE | Gate evaluation, pilot metrics, self-checks, evaluation record, weekly report text |
| `src/pages/admin/whatsapp/launch.astro` | CREATE | The readiness page: gates, self-check button, pilot targets, report button |
| `src/pages/admin/whatsapp/test-questions.json.ts` | CREATE | Download of reviewed drafts as evaluation cases (admin only) |
| `src/lib/email.ts` | UPDATE | One more small report email, same pattern as the other alerts |
| `src/pages/admin/whatsapp/index.astro`, `auto.astro` | UPDATE | Audit-overdue banner and a link to Launch readiness |
| `scripts/wa-eval/run.ts`, `real-questions.json` | UPDATE, CREATE | Real cases with the reference comparison; print a line ready to record |
| `docs/whatsapp-agent-runbook.md` | CREATE | The operating guide |
| `.claude/prds/whatsapp-reply-agent.prd.md` | UPDATE | Mark milestones, record the baseline numbers, add the pilot results table to fill in |

## Tasks

### Task 1: Owner decisions (before build)
- (a) Pilot length: four weeks of real traffic, with auto-reply on for greeting only in week 1, then adding a kind a week if the audit is clean?
- (b) "Resolved without staff" counts automatic replies only. Should drafts you sent unedited also count as "resolved by the agent"? (The PRD target reads either way; I suggest reporting both and judging the 60% on both together.)
- (c) Weekly report: which email address, and Monday?
- (d) May I record evaluation results into the settings row after each run (so the page can show them)?
- (e) May the self-check make one tiny model call and one read-only Meta call?
- (f) May reviewed drafts, redacted, be exported as new evaluation cases?
- **Validate**: Answers recorded in the PRD section 14.

### Task 2: Gates, metrics and self-checks (`waLaunch.ts`)
- **Action**: Pure functions over the database plus a self-check runner that takes the site origin and environment. Each gate returns pass, fail or unknown, the measured value, the target and a plain-English next step. Metrics use the last 28 days.
- **Mirror**: `waAuto.ts` (readiness and counts), `waInbox.ts` (inbox queries)
- **Validate**: esbuild + node script with synthetic data: each gate flips when its input crosses the threshold; median reply time and the within-one-minute share match a hand calculation; a money-intent message answered automatically is counted as a breach while the holding note is not; the audit-overdue count matches; self-checks pass against a correct stub and fail for a forged request that gets through, a missing secret, a wrong phone number, and an out-of-credit model reply.

### Task 3: Launch readiness page
- **Action**: Gate table with pass, fail, unknown and the reason; Run self-checks button; pilot targets with traffic-light status; Email this week's report button; links to the settings, audit and runbook.
- **Mirror**: `admin/whatsapp/auto.astro`
- **Validate**: Signed-out access redirects; self-check results persist across reload; failing gates show what to do.

### Task 4: Test-question export and evaluation upgrade
- **Action**: Admin-only JSON download of reviewed drafts as cases: redacted question, whether a person was needed, and the approved reply as reference. The runner reads `real-questions.json` if present, scores hand-off labels, runs the fact check on each draft, and compares facts to the reference with the small model. The runner prints a one-line summary to record.
- **Mirror**: `scripts/wa-eval/run.ts`
- **Validate**: Export contains no unredacted identifiers (the 30 redaction cases plus a check over the export); the runner handles an empty or missing real set; adding 40 synthetic real-style cases takes the total past 100 and the report shows it.

### Task 5: Audit nudge and report email
- **Action**: Banner on the inbox and settings pages when automatic messages older than 7 days are unaudited; report email with the week's counts and the four targets.
- **Validate**: Banner appears and clears as messages are audited; email contains the figures and escapes all text.

### Task 6: Runbook
- **Action**: Write `docs/whatsapp-agent-runbook.md` in plain language: daily check (inbox, needs-a-person tab), Monday audit, knowledge queue, how to switch off, wrong-message response, credit top-up, secret rotation, evaluation re-run, who to contact at Meta.
- **Validate**: Every page and button it names exists; read-through with the owner.

### Task 7: Review and release
- **Action**: Security and code review agents on the export route, the self-check (it calls the site's own webhook and Meta) and the report email. Run all earlier scripts and the evaluation (needs credit). Push; no schema change this time.
- **Validate**: 0 type errors; build passes; evaluation still has zero hand-off misses; the page shows sensible values on an empty database.

### Task 8: The pilot (calendar time, not code)
- **Action**: With Meta connected, the knowledge base approved and the page's gates green: week 1 greeting only; weeks 2 to 4 add kinds one at a time if the audit is clean. At the end, fill in the pilot results table in the PRD from the page.
- **Validate**: The four PRD targets met, or the shortfall written down with a decision. Only then is milestone 7, and the PRD, marked done.

## Validation

```bash
export PATH=/Users/fasihuddinahmer/.nvm/versions/node/v22.22.1/bin:$PATH
npx astro check          # 0 errors
npm run build            # passes
npx esbuild <script>.ts --bundle --platform=node --format=esm --outfile=<script>.mjs && node <script>.mjs
export $(grep ANTHROPIC_API_KEY .env) && sh scripts/wa-eval/run.sh   # needs Anthropic credit
```

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Switching on before the evidence exists | Medium | Seven computed gates on one page; the master switch already refuses without 50 reviewed drafts; stale evaluation turns the gate amber |
| The recorded evaluation is out of date or never re-run after a code change | Medium | 14-day freshness rule; the runbook says to re-run after any change to prompts or rules |
| Metrics flatter the agent (counting easy greetings as resolved) | Medium | Report by kind of message and the unedited-draft share beside the automatic share; the audit samples what was actually sent |
| The self-check calls the live webhook and the AI service | Low | Two read-only calls with a forged request and a one-word prompt; no message is stored or sent |
| The AI credit runs out again unnoticed | Medium | The AI-service gate and an alert line on the readiness page; the runbook step to top up |
| Evaluation overfits the 100 questions | Medium | Real questions from reviewed drafts join the set; the report states plainly that tuned sets show "no known failures", not real-world accuracy |
| The pilot is skipped because the code is done | Medium | The PRD is marked done only after the results table is filled in |

## Acceptance

- [ ] Owner decisions in Task 1 recorded
- [ ] The readiness page shows all seven gates with live values and the reason for any failure, and is empty-safe
- [ ] The self-check detects a forged request that is accepted, a missing secret, a wrong phone number and an out-of-credit AI service (all covered by scripts)
- [ ] The four pilot measures are computed from real data and match hand calculations on test data
- [ ] Reviewed drafts export as redacted evaluation cases; the evaluation can exceed 100 questions including real ones
- [ ] The audit banner and report email work; the runbook exists and matches the pages
- [ ] `astro check` and build pass; the evaluation still has zero hand-off misses
- [ ] After the four-week pilot: the targets met or the shortfall explained, then the PRD is marked complete
