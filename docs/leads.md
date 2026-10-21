# Leads inbox

Every contact lands in `/admin/leads`, resolved to one person (`src/lib/contacts.ts`).

## Where leads come from today
- Website enquiry form (`/contact`) -> `/api/leads`
- WhatsApp messages (webhook), with the `(ref: ...)` button tag and click-to-WhatsApp ad data
- Custom trip quotes and deposits, private offers, hotel orders, paid bookings and online balance payments
- Added by hand (call, walk-in, email, Instagram/Facebook DM, marketplace) and CSV import
- Next (Release 2): Facebook/Instagram lead ads and DMs, inbound email

## Rules the code enforces
- Two records are never merged automatically; the lead page shows "Possible duplicate" and a person decides. Merges can be undone.
- Nobody is treated as agreeing to marketing email unless they ticked the unticked form box (recorded with the exact wording, still "pending" until double opt-in in Release 3). Imports and hand-added people carry no consent.
- Capture is wrapped so a failure never affects a payment or the WhatsApp reply agent.

## Going live (once)
1. Apply `schema_contacts.sql` to the live database (it must be applied before the code that reads it is deployed; the ALTER lines run only once).
2. Deploy.
3. Open `/admin/leads/backfill`, press the button until every line reads 0.

## Test
`sh scripts/contacts-test/run.sh` runs the library, admin queries, CSV and backfill against an in-memory SQLite database built from the schema files.
