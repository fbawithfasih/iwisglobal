import type { D1Like } from './db';
import { recordLead, normaliseEmail, type IdentifierInput } from './contacts';
import { notifyNewLead } from './leadsAdmin';

// Enquiry emails forwarded by the inbound-email Worker (workers/inbound-email) become leads.
// The Gmail mailbox still receives its own copy, so anything ignored or mis-parsed here is not lost.

export interface InboundEmail {
  from: { address: string; name?: string };
  to?: string;
  subject?: string;
  text?: string;
  messageId?: string;
  date?: string;
  // Lower-cased header values the Worker passes along.
  headers?: Record<string, string>;
}

// Marketplaces send enquiries and bookings from masked relay addresses: the traveller's real email
// is never visible, so the relay address is stored as a SHARED identifier (never matched, never marketed to).
const MARKETPLACES: [string, string][] = [
  ['getyourguide.com', 'GetYourGuide'],
  ['viator.com', 'Viator'],
  ['tripadvisor.com', 'Tripadvisor'],
  ['airbnb.com', 'Airbnb Experiences'],
  ['klook.com', 'Klook'],
  ['civitatis.com', 'Civitatis'],
];

const OWN_DOMAINS = ['iwisglobal.com', 'leads.iwisglobal.com'];
const AUTOMATED_LOCAL = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce[s]?|notifications?|alerts?|auto(mated)?|newsletter|mailer)\b/i;
const AUTOMATED_SUBJECT = /^(auto(matic)? ?reply|out of office|undeliverable|delivery status notification|mail delivery failed|returned mail)/i;

export function domainOf(address: string): string {
  return address.toLowerCase().split('@')[1] ?? '';
}

export function marketplaceOf(address: string): string | null {
  const d = domainOf(address);
  return MARKETPLACES.find(([root]) => d === root || d.endsWith(`.${root}`))?.[1] ?? null;
}

// Why a message should not become a lead, or null when it should.
export function ignoreReason(m: InboundEmail): string | null {
  const addr = (m.from?.address ?? '').trim().toLowerCase();
  if (!addr || !normaliseEmail(addr)) return 'no valid sender';
  const domain = domainOf(addr);
  if (OWN_DOMAINS.includes(domain)) return 'from our own domain';
  const h = m.headers ?? {};
  if (h['auto-submitted'] && h['auto-submitted'] !== 'no') return 'automatic message';
  if (/bulk|junk|list/i.test(h['precedence'] ?? '') || h['list-unsubscribe'] || h['x-autoreply'] || h['x-autorespond']) return 'bulk or automatic message';
  if (AUTOMATED_LOCAL.test(addr.split('@')[0]) && !marketplaceOf(addr)) return 'automated sender';
  if (AUTOMATED_SUBJECT.test((m.subject ?? '').trim())) return 'automatic reply or bounce';
  return null;
}

// A booking or enquiry reference in a marketplace email, for the lead's note.
export function bookingRef(text: string): string {
  return (
    /\b(GYG[A-Z0-9]{6,})\b/.exec(text)?.[1] ??
    /\b(BR-?\d{6,})\b/.exec(text)?.[1] ??
    /(?:booking|reference|confirmation)(?:\s+(?:number|no\.?|ref(?:erence)?|code|id))?\s*[:#]\s*([A-Z0-9-]{6,})/i.exec(text)?.[1] ??
    ''
  );
}

export interface InboundResult {
  status: 'lead' | 'ignored';
  reason?: string;
  leadId?: string;
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, max) : '');

export async function handleInboundEmail(env: Record<string, any>, db: D1Like, input: InboundEmail): Promise<InboundResult> {
  const reason = ignoreReason(input);
  if (reason) return { status: 'ignored', reason };

  const address = clean(input.from.address, 200);
  const name = clean(input.from.name, 120);
  const subject = clean(input.subject, 200);
  const body = clean(input.text, 4000);
  const market = marketplaceOf(address);
  const ref = market ? bookingRef(`${subject}\n${body}`) : '';

  const identifiers: IdentifierInput[] = [{ type: 'email', value: address, shared: !!market, source: market ? 'marketplace_relay' : 'email' }];
  const message = [subject && `Subject: ${subject}`, market && `Via ${market}${ref ? `, reference ${ref}` : ''}`, body].filter(Boolean).join('\n').slice(0, 4000);
  const res = await recordLead(db, {
    channel: market ? 'marketplace' : 'email',
    identifiers,
    name: name || undefined,
    message,
    type: 'email',
    externalRef: clean(input.messageId, 300) || `email:${address}:${subject}:${input.date ?? ''}`,
    occurredAt: input.date && !Number.isNaN(Date.parse(input.date)) ? new Date(input.date).toISOString() : undefined,
    attribution: { source: market ? market.toLowerCase().replace(/\W+/g, '_') : 'email', medium: market ? 'marketplace' : 'email' },
  });
  if (res.createdLead) {
    await notifyNewLead(env, db, { id: res.leadId, name: name || address, channel: market ?? 'Email', detail: subject });
  }
  return { status: 'lead', leadId: res.leadId };
}
