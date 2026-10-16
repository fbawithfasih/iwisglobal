# PRD: WhatsApp reply agent for IWIS Global

**Status**: draft v1, awaiting approval
**Number**: +91 6399226633 (Meta-verified WhatsApp Business)
**Owner**: IWIS Global (site owner)

## 1. Problem

Guests already reach IWIS Global on WhatsApp: every "WhatsApp us" button on the site, every email and the floating chat button opens a chat with +91 6399226633. Today staff answer each message by hand. Most questions repeat (price, what is included, Friday closure, pickup time, how to book, where to meet), and the answers already exist on the site and in the database. Replies are slow outside working hours, the wording varies between staff, and a wrong answer about a price or a policy is easy to give.

## 2. Goal

An agent that reads each incoming WhatsApp message, understands what the guest wants, and either replies accurately in the guest's language or hands the chat to a person with a ready-made draft. It improves from the site's own data and from staff corrections, through a knowledge base that a person approves.

**Success looks like** (measured after a 4-week pilot):
- 60% or more of incoming guest messages are resolved by the agent without staff.
- Median first reply under 1 minute, 24 hours a day.
- 0 wrong statements about price, availability, refunds or policy that reached a guest (checked by weekly audit of every auto-reply).
- 100% of money, complaint and booking-change messages reach a person.

## 3. Decisions already made

| Question | Decision |
|---|---|
| Autonomy | **Hybrid.** The agent auto-replies to routine questions. Payments, refunds, complaints, booking changes and anything it is unsure about go to staff with a drafted reply. |
| Number setup | The number runs on the **WhatsApp Business app on a phone** today and staff reply there. Plan for Meta's **coexistence** mode so staff keep the app while the agent uses the Cloud API. Eligibility must be confirmed (see section 9). |
| What the agent may do | Check live availability and prices, send the right tour booking link, look up booking status for the phone number that made the booking. **It may not** change or cancel bookings or issue refunds. |
| Learning | A **staff-approved knowledge base** that grows over time. The agent drafts new answers from the site's data and from staff replies; a person approves them before the agent may use them. It never rewrites itself silently. |

Defaults I chose, change them if wrong: reply in the guest's language (English, Spanish, French, German; Hindi if you want it), polite and brief, first reply identifies the sender as IWIS Global's assistant.

## 4. Users

- **Guests and prospects** asking about tours, prices, dates, pickup, tickets, safety, cancellation.
- **Staff** who take over chats, approve knowledge-base entries and review the agent's work.
- **Owner** who sets the rules, sees the numbers and can switch the agent off.

## 5. What the agent does

### 5.1 Understands the message
Classifies intent (tour question, price, availability, how to book, booking status, policy, complaint, payment or refund, change request, other) and language, with the recent chat as context. Handles short and messy WhatsApp text. Voice notes and images in v1: it replies "please type your question" and hands off.

### 5.2 Answers only from trusted sources
Every factual statement must come from one of:
1. **Live tools** (read-only): tour catalogue with INR and USD prices and what is included; availability for a date (the Taj Mahal is closed on Fridays, the booking cutoff is 9 PM India time the night before, capacity per date); booking status for the sender's own phone number.
2. **Approved knowledge-base entries**: question and answer pairs and facts built from the tours, policies, guides, attraction pages and blog, plus staff-approved answers.

If neither source covers the question, the agent says it will check with the team and hands off. It does not guess.

### 5.3 Sends the booking link
Sends the tour page with the date filled in. The guest pays on the website; the agent never takes payment details in chat.

### 5.4 Hands off to a person
Hands off for: refunds, cancellations, changes to a booking, payment problems, complaints, safety or medical issues, anything legal, group or custom requests, an angry guest, low confidence, repeated confusion, and any request to speak to a person. It sends the guest a clear holding message, notifies staff, and attaches a drafted reply.

When staff reply from the WhatsApp Business app, the agent sees it and stops auto-replying in that chat until staff hand it back.

### 5.5 Builds and refreshes its own answer directory
- **Sources the agent reads**: tours and add-ons, pricing and availability rules, policy pages, guides, attractions, blog posts, public reviews, FAQ and help content. Scoped booking data is read only through the status tool for that guest.
- **A weekly job, and a job on any change**, turns changes in those sources into proposed knowledge-base entries.
- **Staff replies** that resolved a chat become proposed question and answer pairs (names, phone numbers and booking IDs removed).
- **Gaps**: questions the agent could not answer are logged and shown as "needs an answer", most frequent first.
- **Approval queue** in the admin: approve, edit or reject. Only approved entries are used. Retiring an entry takes effect immediately.
- Each reply stores which entries and tool results it used, so any answer can be traced and corrected.

## 6. Guardrails

- Prices, dates, inclusions and policy wording come from tools and approved entries, never from the model's memory.
- Customer text is treated as data, not instructions. The agent has no write tools, so a manipulated chat cannot change a booking, price or refund.
- Never shares another guest's information. Booking status is returned only when the sender's WhatsApp number matches the booking's phone, and shows limited fields.
- Never asks for or accepts card numbers, passwords or one-time codes in chat; says so if a guest sends them.
- Opt-out: "stop" ends automatic replies for that number.
- Per-sender and global rate limits, a daily cost cap, and a **kill switch** (the owner can turn auto-replies off, and the agent falls back to hand-off only).
- Follows Meta's rules: free-form replies only within 24 hours of the guest's last message; outside that window only approved templates (not in v1).

## 7. Architecture (fits the current site)

- **Webhook** route on the Astro site (Cloudflare Pages Function): verifies Meta's signature on every request, answers quickly, stores the message, and processes it in the background. De-duplicates by Meta's message ID.
- **Send** via the WhatsApp Cloud API with a permanent token held as a Cloudflare secret.
- **Model**: Claude via the existing `ANTHROPIC_API_KEY` pattern (as in `src/lib/aiGuide.ts`), with a small model for intent routing and a stronger one for composing answers, both set in one place.
- **Retrieval**: the knowledge base in D1 with full-text search first; add embeddings only if measured accuracy needs it.
- **Tools** read the same D1 data the website uses (`tours.ts`, `availability.ts`, `crm.ts`), so the agent and the site cannot disagree.
- **Admin**: new pages under `/admin/whatsapp` for the inbox, knowledge base and gaps, using the existing admin sign-in.
- **Staff alerts** by email through the existing Resend setup, and in the admin inbox.

## 8. Data

New D1 tables (names indicative): `wa_conversations` (sender hash and phone, state: agent / staff / handed-off / opted-out, last message time, language), `wa_messages` (direction, text, Meta message ID, timestamps, tool and knowledge-base IDs used, model, cost), `wa_kb_entries` (question, answer, language, source, status: proposed / approved / retired, who approved), `wa_gaps` (unanswered question text, count), `wa_settings` (auto-reply on/off, business rules). Retention: message text kept 12 months unless you choose otherwise, then removed. Phone numbers are stored normalised and shown in the admin only to signed-in staff.

## 9. Meta and WhatsApp requirements

- A Meta developer app with the WhatsApp product, linked to your verified business portfolio and WhatsApp Business account.
- **Coexistence**: Meta lets a number keep the Business app and also use the Cloud API, if the account is eligible. Some app features are limited in coexistence, and the rules change, so confirm in Meta Business Suite before build. If the number is not eligible, the choice is to move it fully to the API (staff then answer from the new admin inbox, not the app) or to use a second number for the agent.
- Webhook subscription for incoming messages and delivery status, and for messages sent from the app so the agent can detect a staff reply. Exact field names to be checked in Meta's current documentation at build time.
- Messaging limits and quality rating apply. Replies within 24 hours of a guest's message are free-form; Meta's pricing for message types should be rechecked at launch.

## 10. Out of scope for v1

Taking payments or changing bookings in chat, outbound marketing or reminder templates, voice calls, handling voice notes and images beyond a polite hand-off, and any other channel (Instagram, email).

## 11. Delivery milestones

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 0 | Meta setup (owner, no code) | Coexistence confirmed, Cloud API token, phone number ID, app secret and verify token ready | pending | |
| 1 | Webhook and send | Messages are received, verified, stored and a test reply can be sent. No AI yet. | done (deployed 2026-10-13) | `.claude/plans/whatsapp-reply-agent.plan.md` |
| 2 | Knowledge base and answers, **draft-only** | Agent drafts replies for every chat; staff approve and send. Build the evaluation set. | done (deployed 2026-10-13) | `.claude/plans/whatsapp-reply-agent-m2.plan.md` |
| 3 | Tools | Live prices, availability, booking link and own-booking status in drafts | done (deployed 2026-10-13) | `.claude/plans/whatsapp-reply-agent-m3.plan.md` |
| 4 | Hand-off and admin inbox | Rules, alerts, take-over and give-back, takes over from app replies | done (deployed 2026-10-13) | `.claude/plans/whatsapp-reply-agent-m4.plan.md` |
| 5 | Auto-reply for routine intents | Switch on behind the kill switch, starting with a few intents | done (deployed 2026-10-13, switched off) | `.claude/plans/whatsapp-reply-agent-m5.plan.md` |
| 6 | Learning loop | Proposed entries from site changes, staff replies and gaps; approval queue | done (deployed 2026-10-13) | `.claude/plans/whatsapp-reply-agent-m6.plan.md` |
| 7 | Launch gates and review | Accuracy and hand-off targets met on the evaluation set, weekly audit running | in-progress | `.claude/plans/whatsapp-reply-agent-m7.plan.md` |

## 12. Launch gates

- On the evaluation set (at least 100 questions, built from your real chats and the site), 95% or more of auto-replies are factually correct, and **none** state a wrong price, date or refund rule.
- Every money, complaint and booking-change test message is handed off.
- Kill switch tested. Webhook signature check tested with a forged request.
- Owner has reviewed 50 real drafts before auto-reply is switched on.

## 13. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Wrong price or policy sent | Disputes, lost trust | Answers only from tools and approved entries; weekly audit; kill switch |
| Coexistence not available for the number | Plan changes | Confirm first (milestone 0); fall back to API-only or a second number |
| Agent talks over staff | Confusing guest | Detects app replies and pauses; staff take-over button |
| Learning from a bad chat | Wrong knowledge | Staff approval before any entry is used |
| Personal data in chats | Privacy | Scoped lookups, limited retention, redaction before learning |
| Cost growth | Unexpected bills | Small model for routing, per-sender and daily caps |
| Prompt injection | Manipulated replies | Read-only tools; customer text treated as data |

## 14. Inputs needed from you

1. Access to Meta Business Suite to confirm coexistence, and, when we reach milestone 1, the WhatsApp business account ID, phone number ID, a permanent system-user token and the app secret, entered as Cloudflare secrets (never pasted in chat).
2. Who gets hand-off alerts and when (hours, which email or number).
3. Whether to include Hindi.
4. An export of past WhatsApp chats, if you have one, to seed answers (names and numbers will be removed).
5. Confirmation that the policy pages on the site (cancellation, refund, terms) are the source of truth for the agent.
6. Retention period for chat text (default 12 months).

## 15. Decisions recorded (2026-10-13 to 2026-10-14)

Hindi in scope; staff may send drafts from the admin; policy pages are the source of truth for refunds and cancellations. Alerts go to `ADMIN_NOTIFICATION_EMAIL` (default info@iwisglobal.com) at any hour; staff-handled chats return to the agent after 12 hours; opt-out words are STOP, UNSUBSCRIBE, "opt out" and "band karo". First automatic kinds: greeting, tour information, price, how to book, policy (one at a time). Limits: 3 automatic messages per chat per hour, 100 a day, 30 an hour stops everything; confidence 0.8. Readiness gates: 50 reviewed drafts, then 10 per kind at 90% unedited. Learning uses anonymised staff replies; message text is deleted after 12 months. Pilot: four weeks, greeting first. Weekly audit and report: Mondays.

## 16. Baseline (before any real traffic)

Measured on the synthetic evaluation set, which the prompts were tuned against, so it shows "no known failures", not real-world accuracy. Anthropic credit ran out on 2026-10-13 and no model-based run has been possible since.

| Measure | Result |
|---|---|
| Evaluation questions passed | 144 of 144 (first run 80 of 106; 136 of 144 after tools were added) |
| Hand-off misses / forbidden text | 0 / 0 |
| Fact check: good drafts accepted | 89 of 92 (97%) in the best run; 88 of 92 (96%) in the last |
| Fact check: wrong drafts rejected | 40 of 40 and 39 of 40 in the two runs |
| Redaction cases clean | 30 of 30 |
| Unanswered questions: answerable answered / unanswerable invented | 10 of 10 / 0 of 15 |
| Scripted checks (database, webhook, tools, inbox, auto-reply, learning, launch) | 41 + 47 + 65 + 77 + 62 + 70 passing |

## 17. Pilot results (fill in after four weeks of real traffic)

Source: Launch readiness page, "Pilot targets", plus the Monday reports. Milestone 7 and this PRD are complete only when this table is filled in and each target is met or its shortfall explained with a decision.

| Target | Goal | Week 1 | Week 2 | Week 3 | Week 4 | Decision |
|---|---|---|---|---|---|---|
| Resolved without staff (automatic + unedited drafts) | 60% or more | | | | | |
| Median first reply, 24 hours a day | Under 1 minute | | | | | |
| Wrong statements that reached a guest | 0 | | | | | |
| Refund, complaint and booking-change messages reaching a person | 100%, none answered automatically | | | | | |
| Kinds of message enabled | Greeting first | | | | | |

