// Reading private offers (schema_private_offers.sql) and their paid payments.
//
// Nothing read from the database is trusted as-is: every field is checked,
// and a row that fails any check is treated as missing (getOffer) or as an
// error that stops the payment flow (listPaid). Offers are never edited by
// code; their terms are fixed once a payment exists.

import type { D1Like } from './db';
import type { GuideLanguage, OfferOption, OfferTerms, PaidPayment, PaymentKind } from './offerPricing';

export interface OfferContent {
  title: string;
  summary: string;
  dateLabel: string;
  travellers: number;
  pickup: string;
  hotel: string;
  itinerary: { time: string; title: string; text: string }[];
  includes: string[];
  excludes: string[];
  cancellation: string;
  contactWhatsapp: string;
  pdf?: boolean;
  // The one travel day as YYYY-MM-DD (dateLabel is free text for the guest). Optional: without it the day is read from dateLabel.
  travelDate?: string;
  // An internal test offer: paying it never creates a booking.
  internal?: boolean;
}

export interface OfferRow {
  id: string;
  status: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  currency: 'EUR' | 'USD' | 'INR';
  content: OfferContent;
  terms: OfferTerms;
  createdAt: string;
}

export const OFFER_ID_PATTERN = /^po_[0-9a-f]{32}$/;

const CURRENCIES = ['EUR', 'USD', 'INR'] as const;
const KINDS: PaymentKind[] = ['full', 'deposit', 'balance'];
const LANGUAGES: GuideLanguage[] = ['en', 'de'];

const isStr = (v: unknown): v is string => typeof v === 'string';
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isPosInt = (v: unknown): v is number => isInt(v) && v > 0;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function parseJson(text: unknown): unknown {
  if (!isStr(text)) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readOptions(text: unknown): OfferOption[] | null {
  const raw = parseJson(text);
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const ids = new Set<string>();
  const out: OfferOption[] = [];
  for (const o of raw) {
    if (!isObj(o) || !isStr(o.id) || !o.id || !isStr(o.label) || !isStr(o.vehicle) || !isPosInt(o.totalMinor)) return null;
    if (ids.has(o.id)) return null;
    ids.add(o.id);
    out.push({ id: o.id, label: o.label, vehicle: o.vehicle, totalMinor: o.totalMinor });
  }
  return out;
}

function readContent(text: unknown): OfferContent | null {
  const c = parseJson(text);
  if (!isObj(c)) return null;
  const strings = ['title', 'summary', 'dateLabel', 'pickup', 'hotel', 'cancellation', 'contactWhatsapp'] as const;
  if (!strings.every((k) => isStr(c[k]))) return null;
  if (!isPosInt(c.travellers)) return null;
  if (!Array.isArray(c.itinerary) || !c.itinerary.every((i) => isObj(i) && isStr(i.time) && isStr(i.title) && isStr(i.text))) return null;
  if (!Array.isArray(c.includes) || !c.includes.every(isStr)) return null;
  if (!Array.isArray(c.excludes) || !c.excludes.every(isStr)) return null;
  if (c.pdf !== undefined && typeof c.pdf !== 'boolean') return null;
  if (c.travelDate !== undefined && !isStr(c.travelDate)) return null;
  if (c.internal !== undefined && typeof c.internal !== 'boolean') return null;
  const content: OfferContent = {
    title: c.title as string,
    summary: c.summary as string,
    dateLabel: c.dateLabel as string,
    travellers: c.travellers,
    pickup: c.pickup as string,
    hotel: c.hotel as string,
    itinerary: (c.itinerary as Record<string, string>[]).map((i) => ({ time: i.time, title: i.title, text: i.text })),
    includes: [...(c.includes as string[])],
    excludes: [...(c.excludes as string[])],
    cancellation: c.cancellation as string,
    contactWhatsapp: c.contactWhatsapp as string,
  };
  if (c.pdf !== undefined) content.pdf = c.pdf as boolean;
  if (c.travelDate !== undefined) content.travelDate = c.travelDate as string;
  if (c.internal !== undefined) content.internal = c.internal as boolean;
  return content;
}

interface RawOffer {
  id: unknown;
  status: unknown;
  customer_name: unknown;
  customer_email: unknown;
  customer_phone: unknown;
  currency: unknown;
  content_json: unknown;
  options_json: unknown;
  deposit_percent: unknown;
  german_guide_extra_minor: unknown;
  created_at: unknown;
}

// The offer with every field checked, whatever its status; null for a
// malformed id, an unknown id or any invalid field. Never throws on bad data.
export async function readOffer(db: D1Like, id: unknown): Promise<OfferRow | null> {
  if (!isStr(id) || !OFFER_ID_PATTERN.test(id)) return null;
  const row = await db
    .prepare(
      `SELECT id, status, customer_name, customer_email, customer_phone, currency, content_json, options_json, deposit_percent, german_guide_extra_minor, created_at FROM private_offers WHERE id = ?`
    )
    .bind(id)
    .first<RawOffer>();
  if (!row || row.id !== id || !isStr(row.status)) return null;
  if (!isStr(row.customer_name) || !isStr(row.customer_email) || !isStr(row.customer_phone) || !isStr(row.created_at)) return null;
  const currency = row.currency;
  if (!CURRENCIES.includes(currency as (typeof CURRENCIES)[number])) return null;
  const dp = row.deposit_percent;
  if (!isInt(dp) || dp < 1 || dp > 99) return null;
  const extra = row.german_guide_extra_minor;
  if (!isInt(extra) || extra < 0) return null;
  const options = readOptions(row.options_json);
  if (!options) return null;
  const content = readContent(row.content_json);
  if (!content) return null;
  const cur = currency as OfferRow['currency'];
  return {
    id,
    status: row.status,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    currency: cur,
    content,
    terms: { currency: cur, options, depositPercent: dp, germanGuideExtraMinor: extra },
    createdAt: row.created_at,
  };
}

// An open, valid offer; null for anything else (malformed or unknown id,
// closed, or any invalid field).
export async function getOffer(db: D1Like, id: string): Promise<OfferRow | null> {
  const offer = await readOffer(db, id);
  return offer && offer.status === 'open' ? offer : null;
}

// The paid payments of an offer, in the order they were paid. Throws when a
// paid row is corrupt: a payment we cannot read must stop the flow, never be
// silently skipped (skipping it could let the guest pay again).
export async function listPaid(db: D1Like, offerId: string): Promise<PaidPayment[]> {
  const { results } = await db
    .prepare(`SELECT id, option_id, guide_language, kind, amount_minor FROM offer_payments WHERE offer_id = ? AND status = 'paid' ORDER BY updated_at, id`)
    .bind(offerId)
    .all<{ id: unknown; option_id: unknown; guide_language: unknown; kind: unknown; amount_minor: unknown }>();
  return (results ?? []).map((r) => {
    if (
      !isStr(r.option_id) || !r.option_id ||
      !LANGUAGES.includes(r.guide_language as GuideLanguage) ||
      !KINDS.includes(r.kind as PaymentKind) ||
      !isPosInt(r.amount_minor)
    ) {
      throw new Error(`corrupt paid offer payment ${isStr(r.id) ? r.id : '?'}`);
    }
    return { optionId: r.option_id, guideLanguage: r.guide_language as GuideLanguage, kind: r.kind as PaymentKind, amountMinor: r.amount_minor };
  });
}
