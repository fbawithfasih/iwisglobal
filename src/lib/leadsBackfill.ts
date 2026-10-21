import type { D1Like } from './db';
import { advanceLead, recordLead, refreshLeadScore, upsertPerson, type Channel, type LeadStage } from './contacts';

// One-off, repeatable import of what the business already knows (old leads, bookings, quotes, hotel
// and offer payments, WhatsApp chats, account holders) into the unified people and leads tables.
// Safe to run again: every row is recorded under a "backfill:..." reference, so it is done once.
// Nobody is marked as agreeing to marketing email.

export const BACKFILL_BATCH = 40;

interface Source {
  key: string;
  label: string;
  // Rows not yet carried over.
  where: string;
  from: string;
}

const noTouch = (channel: string, prefix: string, idCol: string, alias: string) =>
  `NOT EXISTS (SELECT 1 FROM touchpoints t WHERE t.channel = '${channel}' AND t.external_ref IN ('backfill:${prefix}:' || ${alias}.${idCol}, '${prefix}:' || ${alias}.${idCol}))`;

export const SOURCES: Source[] = [
  { key: 'leads', label: 'Existing leads', from: 'leads x', where: `x.person_id IS NULL` },
  { key: 'bookings', label: 'Bookings', from: 'bookings x', where: `x.traveler_email != '' AND ${noTouch('booking', 'booking', 'id', 'x')}` },
  { key: 'custom_trips', label: 'Custom trips', from: 'custom_trips x', where: `x.email != '' AND x.status IN ('quoted','deposit_paid','confirmed') AND ${noTouch('custom_trip', 'custom', 'id', 'x')}` },
  { key: 'hotels', label: 'Hotel bookings', from: 'hotel_bookings x', where: `x.email != '' AND x.status IN ('quoted','paid','booked') AND ${noTouch('hotel', 'hotel', 'id', 'x')}` },
  { key: 'offers', label: 'Private offer payments', from: 'offer_payments x', where: `(x.payer_email != '' OR x.payer_phone != '') AND ${noTouch('offer', 'offer', 'id', 'x')}` },
  { key: 'whatsapp', label: 'WhatsApp chats', from: 'wa_conversations x', where: `NOT EXISTS (SELECT 1 FROM person_identifiers i WHERE i.type = 'wa_id' AND i.value_norm = x.id)` },
  { key: 'accounts', label: 'Account holders (people only, no lead)', from: 'customers x', where: noTouch('website', 'account', 'id', 'x') },
];

export async function backfillCounts(db: D1Like): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const s of SOURCES) {
    try {
      const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${s.from} WHERE ${s.where}`).bind().first<{ n: number }>();
      out[s.key] = row?.n ?? 0;
    } catch {
      out[s.key] = -1; // table missing: nothing to carry over
    }
  }
  return out;
}

const since = (iso: string | null | undefined) => (iso && !Number.isNaN(Date.parse(iso)) ? iso : undefined);

async function lead(db: D1Like, a: { waId?: string; channel: Channel; ref: string; email?: string; phone?: string; name?: string; at?: string; language?: string; stage: LeadStage; bookingId?: string; tour?: string; source?: string; note: string }) {
  const identifiers = [
    ...(a.waId ? [{ type: 'wa_id' as const, value: a.waId, source: 'backfill' }] : []),
    ...(a.email ? [{ type: 'email' as const, value: a.email, source: 'backfill' }] : []),
    ...(a.phone ? [{ type: 'phone' as const, value: a.phone, source: 'backfill' }] : []),
  ];
  if (identifiers.length === 0) return;
  const r = await recordLead(db, {
    channel: a.channel, identifiers, name: a.name, language: a.language, tourInterest: a.tour, type: 'backfill', externalRef: `backfill:${a.ref}`, occurredAt: since(a.at),
    attribution: { source: a.source }, createdBy: 'backfill', stage: a.stage, reuseWindowDays: 365,
  });
  await advanceLead(db, r.leadId, a.stage, { bookingId: a.bookingId ?? null, note: a.note, by: 'backfill' });
  await refreshLeadScore(db, r.leadId);
}

type Row = Record<string, any>;

// Carries over the next batch of every source. Returns how many rows each handled.
export async function runBackfill(db: D1Like): Promise<Record<string, number>> {
  const done: Record<string, number> = {};
  for (const s of SOURCES) {
    let rows: Row[] = [];
    try {
      rows = (await db.prepare(`SELECT x.* FROM ${s.from} WHERE ${s.where} ORDER BY x.created_at LIMIT ${BACKFILL_BATCH}`).bind().all<Row>()).results;
    } catch {
      continue;
    }
    let n = 0;
    for (const r of rows) {
      try {
        if (s.key === 'leads') {
          const up = await upsertPerson(db, [
            ...(r.email ? [{ type: 'email' as const, value: r.email, source: 'backfill' }] : []),
            ...(r.phone ? [{ type: 'phone' as const, value: r.phone, source: 'backfill' }] : []),
          ], { name: r.name });
          await db.prepare(`UPDATE leads SET person_id = ?, last_activity_at = COALESCE(last_activity_at, created_at) WHERE id = ?`).bind(up.personId, r.id).run();
        } else if (s.key === 'bookings') {
          await lead(db, {
            channel: 'booking', ref: `booking:${r.id}`, email: r.traveler_email, phone: r.traveler_phone, name: r.traveler_name, at: r.created_at, language: r.locale ?? undefined,
            stage: r.payment_type === 'deposit' ? 'deposit_paid' : 'booked', bookingId: r.id, source: r.source, note: 'Imported from an existing booking',
          });
        } else if (s.key === 'custom_trips') {
          await lead(db, {
            channel: 'custom_trip', ref: `custom:${r.id}`, email: r.email, phone: r.phone, name: r.name, at: r.created_at,
            stage: r.status === 'quoted' ? 'quote_sent' : 'deposit_paid', bookingId: r.booking_id || undefined, note: 'Imported from an existing custom trip',
          });
        } else if (s.key === 'hotels') {
          await lead(db, {
            channel: 'hotel', ref: `hotel:${r.id}`, email: r.email, phone: r.phone, name: r.holder_name, at: r.created_at, language: r.locale,
            stage: r.status === 'quoted' ? 'quote_sent' : 'booked', note: 'Imported from an existing hotel booking',
          });
        } else if (s.key === 'offers') {
          await lead(db, {
            channel: 'offer', ref: `offer:${r.id}`, email: r.payer_email, phone: r.payer_phone, name: r.payer_name, at: r.created_at,
            stage: r.status === 'paid' ? (r.kind === 'balance' ? 'booked' : 'deposit_paid') : 'quote_sent', note: 'Imported from an existing private offer payment',
          });
        } else if (s.key === 'whatsapp') {
          await lead(db, {
            channel: 'whatsapp', ref: `wa:${r.id}`, waId: r.id, name: r.profile_name ?? undefined, at: r.created_at, language: r.language ?? undefined,
            stage: 'contacted', note: 'Imported from an existing WhatsApp chat',
          });
        } else if (s.key === 'accounts') {
          const up = await upsertPerson(db, [{ type: 'email', value: r.email, source: 'account' }], { name: r.name });
          await db
            .prepare(`INSERT OR IGNORE INTO touchpoints (person_id, lead_id, occurred_at, channel, type, external_ref) VALUES (?, NULL, ?, 'website', 'account', ?)`)
            .bind(up.personId, since(r.created_at) ?? new Date().toISOString(), `backfill:account:${r.id}`)
            .run();
        }
        n++;
      } catch (err) {
        console.error('backfill row failed', s.key, err instanceof Error ? err.message : 'error');
      }
    }
    done[s.key] = n;
  }
  return done;
}
