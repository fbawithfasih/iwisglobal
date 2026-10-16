# Plan: WhatsApp reply agent, milestone 4 (hand-off and inbox)

**Source PRD**: `.claude/prds/whatsapp-reply-agent.prd.md`
**Selected Milestone**: 4, Hand-off and admin inbox: rules, alerts, take-over and give-back, takes over from app replies (milestones 1 to 3 are deployed)
**Complexity**: Medium

## Summary

Today every chat looks the same in the admin and nobody is told when a guest needs a person. This milestone gives each conversation a clear owner and makes sure staff hear about the chats that need them. A message that needs a person puts the chat in "needs a person" and sends an email alert. When staff reply, whether from the WhatsApp Business app or from the admin, the chat moves to "staff handling" and the agent stops drafting for it until staff give it back. A guest who writes STOP stops all agent activity for their number. The agent still only drafts; nothing is sent automatically (that is milestone 5).

## Conversation states

`wa_conversations.state` already exists. Its values and how a chat moves between them:

| State | Meaning | Enters when | Leaves when |
|---|---|---|---|
| `agent` | Agent drafts replies; staff review and send | Default; staff press Give back; staff chat expires | A draft needs a person, staff reply, or the guest opts out |
| `handed_off` | Waiting for a person; agent still drafts a holding or suggested reply | A new guest message produces a draft with `needs_person` | Staff reply (becomes `staff`) or staff press Give back |
| `staff` | A person is handling it; no new drafts | Staff reply from the Business app (echo) or from the admin, or Take over | Staff press Give back, or 12 hours after the last staff message |
| `opted_out` | Guest asked us to stop; no drafts, no alerts | Guest message is exactly STOP, UNSUBSCRIBE or similar | Guest writes START |

## Design decisions

1. **One place owns the rules.** A new `src/lib/waInbox.ts` holds the transitions (`routeIncoming`, `onStaffReply`, `markHandedOff`, `takeOver`, `giveBack`, `expireStaff`) and the inbox queries. The webhook, `sendDraft` and the admin pages call it; none of them set `state` themselves.
2. **Staff replies are detected two ways.** Echoes from the Business app already arrive as `direction = 'echo'` (milestone 1). `sendDraft` already stores `out` messages. Both call `onStaffReply`. If coexistence is not on and echoes never arrive, Take over and the 12-hour expiry still work.
3. **No drafts while staff handle a chat.** `generateDraft` is skipped when the chat is in `staff` and the last staff message is under 12 hours old. This saves model cost and avoids stale suggestions. After 12 hours the chat quietly returns to `agent`, so a forgotten chat does not stay silent for ever.
4. **Alerts by email, on the transition.** `generateDraft` returns what it decided (needs a person, reason, draft). When that is true and the chat was not already `handed_off`, the chat becomes `handed_off` and one email goes to `ADMIN_NOTIFICATION_EMAIL` (already used for booking alerts). A further guest message in a chat that is still `handed_off` re-alerts only if the last alert is over 2 hours old, so a guest typing five lines sends one email, not five. The email shows guest name and number, why, their last messages, the drafted reply, and a link to the chat.
5. **Holding message stays a draft.** The PRD's holding message to the guest is an automatic send, so it belongs to milestone 5 behind the kill switch. For now the draft already contains it and staff can send it in one tap.
6. **STOP is exact-match.** Only a message that is entirely STOP, UNSUBSCRIBE, or an agreed short phrase sets `opted_out`; the word inside a sentence does not. START (exact) reverses it.
7. **The inbox shows what needs doing.** Filter tabs: Needs a person, Staff handling, All. The list sorts waiting chats first and shows how long the guest has waited and how long is left in WhatsApp's 24-hour reply window (amber after 30 minutes waiting, red when the window has under 2 hours left). Buttons: Take over, Give back.
8. **Migration is additive.** New columns on `wa_conversations`: `handoff_reason`, `handed_off_at`, `last_alert_at`, `staff_active_at`.

## Files to Change

| File | Action | Why |
|---|---|---|
| `schema_whatsapp_inbox.sql` | CREATE | Four `ALTER TABLE wa_conversations ADD COLUMN` lines and an index on `state` |
| `src/lib/waInbox.ts` | CREATE | State transitions, alert throttle, opt-out detection, inbox queries |
| `src/lib/waDraft.ts` | UPDATE | `generateDraft` returns a small outcome (needs person, reason, draft body); `sendDraft` calls `onStaffReply` after a successful send |
| `src/lib/email.ts` | UPDATE | `sendWhatsappHandoffEmail`, copying the admin booking alert (English, best effort, never throws) |
| `src/pages/api/webhooks/whatsapp.ts` | UPDATE | Route each stored message: echo, opt-out, skip-draft, draft then hand-off and alert |
| `src/pages/admin/whatsapp/index.astro` | UPDATE | Filter tabs, state badges, waiting and window timers, Take over and Give back forms |
| `.env.example` | UPDATE | Note that `ADMIN_NOTIFICATION_EMAIL` also receives WhatsApp alerts |

## Tasks

### Task 1: Owner decisions (before build)
- (a) Which email address gets WhatsApp alerts, and at any hour or only in working hours?
- (b) Is 12 hours the right time before a staff-handled chat returns to the agent?
- (c) Alert once per hand-off and again after 2 hours of further messages: right balance?
- (d) Opt-out words: STOP and UNSUBSCRIBE plus any Hindi or other phrases you want?
- (e) Waiting colours: amber after 30 minutes, red when under 2 hours remain in the reply window: right?
- **Validate**: Answers recorded in the PRD section 14.

### Task 2: Schema
- **Action**: `schema_whatsapp_inbox.sql` with the four columns and `idx_wa_conversations_state`. Apply to production before the push, as before.
- **Mirror**: `schema_whatsapp_tools.sql`
- **Validate**: Column list shows the four new columns; existing rows keep working (all default to empty).

### Task 3: Rules library (`waInbox.ts`)
- **Action**: Implement the table above. `routeIncoming(db, message)` returns `draft` or `skip` and handles opt-out and expiry. `onStaffReply` sets `staff` and `staff_active_at`. `markHandedOff` sets state, reason and time and returns whether an alert is due under the throttle. `takeOver` and `giveBack` are the two staff buttons. `listInbox(filter)` returns chats with waiting time and window time.
- **Mirror**: `waKnowledge.ts` (function-per-action over `D1Like`)
- **Validate**: esbuild + node script with an in-memory database: each transition in the table; an echo during `handed_off` becomes `staff`; a draft is skipped in `staff` and resumes after 12 hours; five guest messages in a row send one alert, a sixth after 2 hours sends another; STOP in a sentence does nothing, exact STOP opts out, START opts back in; opted-out chats never produce a draft or an alert.

### Task 4: Alert email
- **Action**: `sendWhatsappHandoffEmail` with the content in decision 4. Plain, English, escape all guest text, link to `/admin/whatsapp?c=<phone>`.
- **Mirror**: `sendAdminBookingNotificationEmail`
- **Validate**: Script with a stubbed `fetch`: one request to Resend with the right recipient; guest text containing HTML is escaped; a failed request does not throw.

### Task 5: Webhook routing
- **Action**: After storing, for each new message: echo goes to `onStaffReply`; a guest `in` message goes through `routeIncoming`; if it says draft, `generateDraft` runs, then `markHandedOff` and the alert if due. All inside the existing `waitUntil`.
- **Mirror**: Milestone 2 webhook change
- **Validate**: Signed payload tests: guest message then echo leaves the chat in `staff` with no new draft; a refund message creates one alert; replaying the payload creates no second alert.

### Task 6: Admin inbox
- **Action**: Tabs, badges, timers and the two buttons. Sending a draft from the admin moves the chat to `staff` (through `sendDraft`).
- **Mirror**: Current `admin/whatsapp/index.astro`
- **Validate**: Browser check with seeded chats in each state; signed-out access still redirects; Take over and Give back work and survive a reload.

### Task 7: Review and release
- **Action**: Run `astro check`, build, the milestone 2 and 3 scripts and the full evaluation (unchanged cases must still pass), then the security and code review agents on the webhook routing and the email. Apply the schema, push, verify.
- **Validate**: 0 type errors, build passes, evaluation still has zero hand-off misses, deploy succeeds.

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
| Coexistence off, so Business-app replies never arrive as echoes | Medium | Take over button and the 12-hour expiry still work; the inbox shows "no echo seen yet" until the first one arrives |
| Alert fatigue from chatty guests | Medium | Alert on the transition and at most every 2 hours per chat |
| A chat stays "staff handling" after the person forgets it | Medium | 12-hour auto-return; filter tab makes stuck chats visible |
| Agent drafts while a person is mid-conversation (echo arrives after the draft is made) | Low | Existing "someone already replied" handling hides the stale draft; the state flips on the echo |
| STOP typed inside a normal sentence | Low | Exact match only |
| Alert email lands in spam or Resend is down | Low | Best effort and logged; the inbox filter shows every waiting chat regardless |
| Guest text in the alert email | Low | Escaped; plain layout |

## Acceptance

- [ ] Owner decisions in Task 1 recorded
- [ ] A message that needs a person puts the chat in "needs a person" and sends exactly one email
- [ ] A reply from the WhatsApp Business app or the admin moves the chat to "staff handling" and stops drafts for it
- [ ] Give back and the 12-hour expiry return the chat to the agent
- [ ] STOP stops all agent activity for that number; START restores it; STOP inside a sentence does nothing
- [ ] The inbox filters, badges and timers work, and signed-out access still redirects
- [ ] `astro check` and build pass; the evaluation still has zero hand-off misses; schema applied before the push
