# IWIS Global: database changes and how they are made

Status: 27 Oct 2026 (milestone M6). Production database `iwisglobal-bookings` was checked read-only against these files on 27 Oct 2026: **all 62 tables and all 70 columns added with ALTER exist in production**, and nothing exists in production that the files do not define.

## The rules we follow

1. **Additive only.** A change creates a table, adds a column (with a default so old rows stay valid) or adds an index. Nothing is dropped, renamed or rewritten, so the previous version of the code keeps working against the new structure. That is what makes a code rollback safe (see `IWIS_RELEASE_AND_ROLLBACK.md`).
2. **Structure first, code second.** A schema change is applied to production before the code that needs it is merged, and only after you say yes. Code that writes a new column would fail until the column exists.
3. **One statement at a time, with a check before and after.** Before: a read-only look that the change is not already there. After: a read-only look that it is.
4. **Every change lives in a `schema_*.sql` file in this repo** and is used to rebuild a database from a backup (`scripts/backup/d1-restore.mjs` re-creates every index and trigger from these files).
5. **Local rehearsal.** Tests build an in-memory database from these files, so a file that does not apply cleanly fails before it reaches production.

## Order matters

The files depend on one another (for example `schema_crm.sql` alters `bookings`, which `schema.sql` creates). Apply `schema.sql` first, then the others in the order their tables are needed; the restore tool and the tests do this. A column that already exists makes `ALTER TABLE ... ADD COLUMN` fail, which is why each change is checked first.

## Files

| File | What it is for | What it adds |
|---|---|---|
| `schema.sql` | — | tables: `bookings`; 1 index(es) |
| `schema_addon_per_traveler.sql` | An add-on can now be per-traveler. | columns: `tour_addons.per_traveler` |
| `schema_admin_push.sql` | Phone alerts for the admin (Web Push). | tables: `admin_push_subscriptions` |
| `schema_agra_highlights.sql` | Moves the homepage "Top things to do in Agra" carousel from a hardcoded array in index.astro into D1, manageable from… | tables: `agra_highlights` |
| `schema_ai_guide_usage.sql` | Backs the AI Guide's rate limiter (src/lib/aiGuide.ts). | tables: `ai_guide_requests`; 2 index(es) |
| `schema_analytics.sql` | Backlog 2.8: server-side `purchase` event via a Razorpay webhook (src/pages/api/webhooks/razorpay.ts), instead of… | tables: `analytics_events_sent` |
| `schema_audit.sql` | Admin audit log (M2, audit log only). | tables: `admin_audit_log`; 2 index(es); 2 trigger(s) |
| `schema_balance_links.sql` | Pay-the-balance links for tour bookings that paid a deposit (src/lib/balancePayment.ts). | tables: `booking_balance_links`; 2 index(es) |
| `schema_blog_illustration.sql` | Marks a blog cover that is an illustration (AI-generated or artwork), not a photo, so the site labels it "Illustration"… | columns: `blog_posts.image_is_illustration` |
| `schema_blog_posts.sql` | D1-backed blog, managed from /admin/blog — mirrors the tours.ts pattern (id = machine key, slug = URL slug, status =… | tables: `blog_posts`; 1 index(es) |
| `schema_blog_thumbs.sql` | Small (800px) copy of a blog cover for the /blog list, so phones don't download the full 1200px cover for a ~330px-wide card. | columns: `blog_posts.image_thumb` |
| `schema_booking_locale.sql` | The language the guest used when booking (es, fr, de; NULL or en = English), so later emails (entry tickets, review request) are sent in it. | columns: `bookings.locale` |
| `schema_booking_note_author.sql` | Booking notes: who wrote each note (M4). | columns: `booking_notes.author` |
| `schema_campaigns.sql` | Email campaigns (src/lib/campaigns.ts). | tables: `campaigns`, `campaign_content`, `campaign_sends`; 2 index(es) |
| `schema_contacts.sql` | Unified contacts and lead management (src/lib/contacts.ts). | tables: `people`, `person_identifiers`, `touchpoints`, `lead_activities`, `person_tags`, `duplicate_suggestions`, `merge_log`, `consent_events`, `consent_texts`, `suppressions`, `marketing_spend`, `lead_form_requests`; columns: `leads.person_id`, `leads.channel`, `leads.campaign`, `leads.lost_reason`, `leads.score`, `leads.score_reason`, `leads.owner`, `leads.first_response_at`, `leads.last_activity_at`, `leads.next_action_at`, `leads.travel_start`, `leads.party_size`, `leads.language`, `leads.country`, `leads.booking_id`, `leads.updated_at`; 16 index(es) |
| `schema_crm.sql` | Phase 2 (CRM) additions: | tables: `booking_notes`, `leads`; columns: `bookings.status`, `bookings.source`, `bookings.pickup_time`, `bookings.guide_assigned`, `bookings.vehicle`; 2 index(es) |
| `schema_currency.sql` | Optional USD pricing alongside the existing INR amount. | columns: `tours.usd_amount`, `tour_addons.usd_amount` |
| `schema_custom_trips.sql` | "Customise your Agra tour" (phase 1). | tables: `custom_vehicles`, `custom_settings`, `custom_stops`, `custom_stop_fees`, `custom_trips`; 2 index(es) |
| `schema_customer_email_auth.sql` | Adds email/password sign-in for customer accounts, alongside the existing Google/Apple SSO (schema_customers.sql). | tables: `customer_login_attempts`; columns: `customers.password_hash`, `customers.password_salt` |
| `schema_customer_phone.sql` | Optional phone number saved on a customer account, stored as "+<code> <digits>" (the PhoneInput format). | columns: `customers.phone` |
| `schema_customers.sql` | Customer accounts (Google/Apple SSO — see src/lib/customerAuth.ts and src/lib/oauth/*.ts). | tables: `customers`; columns: `bookings.customer_id`; 2 index(es) |
| `schema_deposit_payments.sql` | Backlog 0.4: 25% deposit option, balance on pickup. | columns: `bookings.total_amount`, `bookings.payment_type` |
| `schema_email_verification.sql` | Confirmed account emails (src/lib/emailVerification.ts). | tables: `email_verifications`; columns: `customers.email_verified_at`; 2 index(es) |
| `schema_entry_tickets.sql` | Monument entry-ticket fulfilment (admin "Tickets to buy" panel). | columns: `tours.entry_tickets_in_price`, `bookings.tickets_purchased_at`, `bookings.ticket_file_key`, `bookings.ticket_emailed_at` |
| `schema_events.sql` | Email delivery events and aggregate click counts (src/lib/resendEvents.ts, src/pages/r/[code].ts). | tables: `email_events`, `campaign_links`, `campaign_clicks`; 2 index(es) |
| `schema_group_pricing.sql` | Backlog 0.2 + 0.3 (docs/execution-backlog.md, provided by the user). | tables: `tour_pricing_tiers`; columns: `tour_addons.included_by_default`; 1 index(es) |
| `schema_hotels.sql` | Agra hotel booking (Hotelbeds). | tables: `hotel_settings`, `hotel_content`, `hotel_sync`, `hotel_bookings`, `hotel_rate_cache`; 2 index(es) |
| `schema_login_attempts.sql` | Tracks failed /admin/login attempts per IP so the login route can lock out an IP after repeated failures instead of… | tables: `admin_login_attempts` |
| `schema_marketing.sql` | Double opt-in for marketing email (src/lib/marketing.ts). | tables: `email_confirmations`; 2 index(es) |
| `schema_meta.sql` | Meta (Facebook/Instagram) inbox for src/lib/meta.ts. | tables: `meta_events`; 1 index(es) |
| `schema_offer_window.sql` | Countdown offers (src/lib/offers.ts, src/lib/offerTimer.ts): | columns: `offers.window_minutes` |
| `schema_offers.sql` | Offers and coupon codes (admin: | tables: `offers`; columns: `bookings.offer_id`, `bookings.discount_label`, `bookings.discount_amount`, `tours.price_changed_at` |
| `schema_password_resets.sql` | One-time "forgot password" links for email/password accounts (src/lib/passwordReset.ts). | tables: `password_resets`; 1 index(es) |
| `schema_private_offers.sql` | Private offer pages (one secret link per customer). | tables: `private_offers`, `offer_payments`; 2 index(es) |
| `schema_review_requests.sql` | Backlog 1.2: WhatsApp review request to every guest within 24h of drop-off. | columns: `bookings.review_requested_at` |
| `schema_staff.sql` | Staff accounts (M3): people other than the owner who use the admin, signed in with Google. | tables: `staff_users`, `staff_sessions`; 3 index(es) |
| `schema_tour_reviews.sql` | Guest ratings for a tour (src/lib/reviews.ts). | tables: `tour_reviews`; columns: `bookings.review_token`; 2 index(es) |
| `schema_tours.sql` | Moves the tour catalog from build-time Markdown content collections into D1, so tours can be created/edited from the admin CRM without a redeploy. | tables: `tours`, `tour_addons`; 1 index(es) |
| `schema_translations.sql` | Translated versions of database-held content (tours, add-ons, blog posts, Agra highlights). | tables: `content_translations` |
| `schema_trust_fields.sql` | Adds real, per-tour trust facts (not fabricated) used by the redesigned tour cards/detail page: | columns: `tours.guide_language`, `tours.pickup_included`, `tours.private_tour` |
| `schema_whatsapp.sql` | WhatsApp reply agent, milestone 1 (.claude/plans/whatsapp-reply-agent.plan.md): | tables: `wa_conversations`, `wa_messages`, `wa_settings`; 2 index(es) |
| `schema_whatsapp_auto.sql` | WhatsApp reply agent, milestone 5 (.claude/plans/whatsapp-reply-agent-m5.plan.md): | columns: `wa_drafts.sent_by`, `wa_drafts.edited`, `wa_drafts.audit`, `wa_drafts.auto_decision` |
| `schema_whatsapp_handler.sql` | WhatsApp inbox: which person is handling a chat, and who sent each reply (M4). | columns: `wa_conversations.handled_by`, `wa_messages.sent_by` |
| `schema_whatsapp_inbox.sql` | WhatsApp reply agent, milestone 4 (.claude/plans/whatsapp-reply-agent-m4.plan.md): | columns: `wa_conversations.handoff_reason`, `wa_conversations.handed_off_at`, `wa_conversations.last_alert_at`, `wa_conversations.staff_active_at`; 1 index(es) |
| `schema_whatsapp_kb.sql` | WhatsApp reply agent, milestone 2 (.claude/plans/whatsapp-reply-agent-m2.plan.md): | tables: `wa_kb_entries`, `wa_kb_fts`, `wa_drafts`, `wa_ai_usage`; 2 index(es) |
| `schema_whatsapp_learning.sql` | WhatsApp reply agent, milestone 6 (.claude/plans/whatsapp-reply-agent-m6.plan.md): | columns: `wa_kb_entries.prev_question`, `wa_kb_entries.prev_answer`, `wa_kb_entries.flag`, `wa_kb_entries.evidence`, `wa_drafts.original_body` |
| `schema_whatsapp_media.sql` | Photos, voice notes, videos, documents and stickers on WhatsApp, plus the details Meta sends for locations, contact… | columns: `wa_messages.media_id`, `wa_messages.media_mime`, `wa_messages.meta_json` |
| `schema_whatsapp_tools.sql` | WhatsApp reply agent, milestone 3 (.claude/plans/whatsapp-reply-agent-m3.plan.md): | columns: `wa_drafts.tools` |

## Totals

Production: 62 tables defined (67 counting the five internal tables SQLite keeps for the WhatsApp answer search), 56 indexes, 2 triggers (the audit log is append-only).

## If a change has to be undone

Do not drop anything. Deploy the previous code (it ignores the new column or table). If data was written wrongly, use Time Travel to restore the database to a moment before, as described in `IWIS_BACKUP_AND_RECOVERY.md`; that rewinds everything written since, so use it deliberately.
