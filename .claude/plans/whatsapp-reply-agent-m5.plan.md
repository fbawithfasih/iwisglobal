# Plan: WhatsApp reply agent, milestone 5 (auto-reply for routine questions)

**Source PRD**: `.claude/prds/whatsapp-reply-agent.prd.md`
**Selected Milestone**: 5, Auto-reply for routine intents: switch on behind the kill switch, starting with a few intents (milestones 1 to 4 are deployed)
**Complexity**: Large

## Summary

This is the first milestone where the agent sends a message without a person pressing Send, so it is built to be switched on slowly and switched off instantly. Every draft gets an "auto-send decision" recorded from day one, even while auto-reply is off (shadow mode), so you can see what the agent would have sent before it sends anything. Auto-send is allowed only for intents you have enabled one by one, only when the draft is clean, grounded and confident, and only after your own review history proves it is ready. A master switch stops everything at once. Anything you mark wrong in the audit list turns that intent off by itself.

## What "eligible to auto-send" means

A draft is sent automatically only when every one of these holds. The first failure is recorded as the reason, so the admin can show why a draft was held back.

1. Master switch is on, and the intent is on its enabled list.
2. The chat is with the agent: not needs-a-person, not staff handling, not opted out.
3. The draft needs no person: no flag of any kind, confidence at or above the threshold (default 0.8).
4. The reply is not empty and is at most 700 characters.
5. A **grounding check** passes: a second, small-model call is given the draft and exactly the sources the draft was allowed to use (approved entries, catalogue, tool results) and must answer that every factual statement is supported. Any doubt, error or timeout counts as a fail (fail closed).
6. Limits hold: at most 3 automatic messages per chat per hour, at most 100 per day in total (both settable), and the hourly runaway breaker below.
7. Nobody has replied since the guest's message (checked again just before sending, so a staff reply that lands first wins).
8. The guest is inside WhatsApp's 24-hour window (always true for an immediate reply, checked anyway).

The one exception is the **holding message** for hand-offs, covered below.

## Design decisions

1. **Shadow mode first.** `wa_drafts.auto_decision` is written for every draft: `eligible` or `blocked:<reason>`, whether or not the master switch is on. The settings page shows, per intent, how many drafts were eligible, how many staff then sent unchanged, edited or discarded. This is the evidence for switching anything on.
2. **Readiness gates are enforced in code, not just shown.** The master switch cannot be turned on until you have reviewed at least 50 real drafts (sent or discarded by staff). An intent cannot be enabled until at least 10 drafts of that intent were reviewed and at least 90% were sent unedited. `sendDraft` records `edited` by comparing the sent text with the draft. These numbers are constants in one file.
3. **Intents start narrow.** Recommended first set: greeting, tour_info, price, how_to_book, policy. Availability and booking status stay manual until you have watched them in shadow mode. Money, complaint, change, group and medical intents can never be enabled (they are not in the list the admin offers and the decision function rejects them).
4. **Kill switch and breakers.** One master switch on the settings page, checked on every message, so turning it off takes effect for the very next message. A runaway breaker turns the master switch off by itself and emails you if more than 30 automatic messages go out in an hour, which also stops two bots replying to each other.
5. **Audit loop.** The settings page lists every automatic message with the guest's message beside it and two buttons, OK and Wrong. Marking one Wrong turns that intent off at once and emails you. This is also the raw material for the learning loop in milestone 6.
6. **Holding message.** When a guest message needs a person for a money or complaint reason (reason `handoff`), a separate switch lets the agent send the draft's short acknowledgement ("a team member will reply personally soon") automatically, at most once per six hours per chat. It never answers the substance. Off by default.
7. **Sending reuses `sendDraft`.** One new argument says who sent it (`staff` or `auto`). Automatic sends do not change the chat's state, so a staff chat or a needs-a-person chat is not disturbed. The 24-hour check, the double-send claim and the stored message all stay as they are.
8. **Disclosure.** The first reply already says it is IWIS Global's assistant. The privacy page currently says staff check each reply before it is sent; that becomes untrue for enabled intents, so it is updated in all four languages before launch.

## Files to Change

| File | Action | Why |
|---|---|---|
| `schema_whatsapp_auto.sql` | CREATE | `wa_drafts`: `sent_by`, `edited`, `audit`, `auto_decision`; default rows in `wa_settings` |
| `src/lib/waAuto.ts` | CREATE | Settings read/write with the readiness gates, `decideAutoSend`, the grounding check, limits and breaker, audit actions, readiness stats |
| `src/lib/waDraft.ts` | UPDATE | Record `auto_decision` on every draft; `sendDraft(..., by)` sets `sent_by` and `edited` and skips the state change for automatic sends |
| `src/pages/api/webhooks/whatsapp.ts` | UPDATE | After drafting and hand-off handling, call the decision and send when allowed; holding message rule |
| `src/pages/admin/whatsapp/auto.astro` | CREATE | Master switch, intent switches, thresholds, readiness table, audit list |
| `src/pages/admin/whatsapp/index.astro` | UPDATE | "Auto-sent" and "Held back: reason" badges on drafts and messages; link to the settings page; show the switch state |
| `src/lib/email.ts` | UPDATE | One small alert email for breaker trips and Wrong marks |
| `src/pages/privacy.astro`, `src/i18n/{en,es,fr,de}.ts` | UPDATE | Say that routine replies may be sent automatically |
| `scripts/wa-eval/` | UPDATE | Adversarial drafts for the grounding check; auto-send simulation over the existing questions |

## Tasks

### Task 1: Owner decisions (before build)
- (a) First intents to allow: greeting, tour_info, price, how_to_book, policy?
- (b) Limits: 3 automatic messages per chat per hour, 100 per day, breaker at 30 per hour, confidence 0.8?
- (c) Readiness gates: 50 reviewed drafts overall, then 10 per intent at 90% unedited?
- (d) Send the automatic holding message for hand-offs (off by default)?
- (e) Accept one extra small-model call per draft for the grounding check?
- (f) Who does the weekly audit of automatic messages, and which day?
- **Validate**: Answers recorded in the PRD section 14.

### Task 2: Schema
- **Action**: `schema_whatsapp_auto.sql`: four new `wa_drafts` columns and default settings rows (`auto_reply = off`, `auto_intents = []`, `auto_hold = off`, `auto_min_confidence = 0.8`, `auto_per_chat_hour = 3`, `auto_daily_cap = 100`). Apply to production before the push.
- **Mirror**: `schema_whatsapp_tools.sql`, `schema_whatsapp_inbox.sql`
- **Validate**: Existing sent drafts read as `sent_by = staff`; defaults leave auto-reply off.

### Task 3: Decision, limits and settings (`waAuto.ts`)
- **Action**: `decideAutoSend` returns `eligible` or the first blocking reason from the list above. Settings functions validate every value and enforce the readiness gates and the never-enable list. `readiness()` returns the per-intent counts. Breaker and per-chat limits count `sent_by = 'auto'` rows.
- **Mirror**: `waInbox.ts` (small functions over `D1Like`)
- **Validate**: Script with an in-memory database: every blocking reason fires on its own; master cannot be enabled below 50 reviewed drafts; an intent cannot be enabled below 10 reviewed or under 90% unedited; money intents are rejected; per-chat and daily limits; the breaker trips at 31 and switches the master off.

### Task 4: Grounding check
- **Action**: A small-model call that receives the guest message, the draft and the sources, and returns supported yes or no with the unsupported claim. Strict output, fail closed on any error, timeout or odd output. Same Anthropic helper as the rest.
- **Mirror**: Classifier call in `waDraft.ts`
- **Validate**: On the evaluation set's good drafts the check passes at least 95%. On 40 deliberately wrong drafts (wrong price, invented inclusion, wrong cutoff time, invented refund rule, a promise the agent cannot keep) it rejects at least 95%. Both numbers are recorded in the PRD; if it misses, the intent list stays empty until the prompt is fixed.

### Task 5: Draft pipeline and webhook
- **Action**: Write `auto_decision` for every draft. Webhook sends via `sendDraft(..., 'auto')` when eligible, re-checking for a staff reply immediately before sending. Holding-message rule with its six-hour guard.
- **Mirror**: Milestone 4 `handleGuestMessage`
- **Validate**: Signed-request script with stubbed model and WhatsApp API: master off sends nothing but records `eligible`; master on sends exactly once, even on webhook replay; a staff reply landing between draft and send cancels the send; a staff chat or opted-out chat never auto-sends; the holding message sends once per six hours and only for reason `handoff`.

### Task 6: Settings and audit page
- **Action**: Master switch with the readiness numbers beside it, intent switches that disable themselves when not ready, thresholds, the audit list with OK and Wrong, and the inbox badges. Wrong turns the intent off and sends the alert.
- **Mirror**: `admin/whatsapp/knowledge.astro`
- **Validate**: Signed-out access redirects; Wrong disables the intent immediately and survives a reload; the switch refuses to turn on while the gate is unmet and says why.

### Task 7: Privacy text
- **Action**: Update the WhatsApp lines in the four languages: some routine replies may be sent automatically, always identified as the assistant, and a person can take over at any time. Flag for native-speaker proofreading.
- **Validate**: `astro check` 0 errors.

### Task 8: Review and release
- **Action**: Security and code review agents on the send path and the settings page. Run all earlier scripts and the full evaluation. Apply the schema, push, verify. Then **release in stages**: shadow mode for at least a week of real traffic, enable one intent (suggest greeting), watch the audit list for a few days, then add the next.
- **Validate**: 0 type errors; build passes; evaluation still has zero hand-off misses; deploy succeeds; with the master switch off, nothing is sent.

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
| A wrong fact reaches a guest | Medium | Narrow intents; grounding check fails closed; price check; audit list with auto-disable; per-chat and daily limits; kill switch |
| The agent replies to a bot or loops | Low | Per-chat hourly limit and the 30-per-hour breaker that turns the master switch off |
| The agent answers over a person | Low | Staff and needs-a-person chats never auto-send; recheck for a staff reply right before sending |
| Readiness gates are gamed or too strict | Low | Constants in one file; numbers shown beside every switch |
| Cost rises (extra grounding call per draft) | Medium | Small model, only for eligible drafts, daily cap already limits volume |
| Guests dislike talking to an automatic assistant | Medium | First reply identifies the assistant; Take over is one tap; STOP works |
| Switching on before there is real traffic | High if rushed | The gate needs 50 real reviewed drafts; shadow mode shows the evidence first |
| Privacy text becomes untrue | Medium | Updated in Task 7 before launch |

## Acceptance

- [ ] Owner decisions in Task 1 recorded
- [ ] With the master switch off, no automatic message is ever sent, and every draft still records its auto decision
- [ ] The master switch cannot be turned on before 50 reviewed drafts; an intent cannot be enabled before 10 reviewed at 90% unedited; money, complaint, change, group and medical intents can never be enabled
- [ ] The grounding check passes at least 95% of good drafts and rejects at least 95% of the wrong ones
- [ ] Limits, the breaker, the staff-reply race and the opt-out rule are covered by passing scripts
- [ ] Marking an automatic message Wrong turns its intent off at once and alerts the owner
- [ ] The privacy page matches how replies are sent; schema applied before the push; `astro check` and build pass; the evaluation still has zero hand-off misses
