// Plain-text <textarea> encodings for the admin tour form — keeps the CRM's
// server-rendered-form pattern (no JS islands) instead of a repeatable-field
// React component, consistent with the rest of /admin.

import type { AddOn, PricingTier } from './catalog';
import type { ItineraryStep } from './tours';

export function parseLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

export function formatLines(items: string[]): string {
  return items.join('\n');
}

// One step per line: "5:30 AM | Pickup from hotel | optional details".
// The third segment is the expandable text on the tour page; anything past
// it is kept as part of the details, so a "|" inside details survives.
export function parseItinerary(text: string): ItineraryStep[] {
  return parseLines(text)
    .map((line) => {
      const [time, activity, ...rest] = line.split('|');
      const details = rest.join('|').trim();
      return {
        time: (time ?? '').trim(),
        activity: (activity ?? '').trim(),
        ...(details ? { details } : {}),
      };
    })
    .filter((step) => step.time || step.activity);
}

export function formatItinerary(steps: ItineraryStep[]): string {
  return steps
    .map((s) => (s.details ? `${s.time} | ${s.activity} | ${s.details}` : `${s.time} | ${s.activity}`))
    .join('\n');
}

function slugAddOnId(name: string, index: number): string {
  const base = name
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/(^_|_$)/g, '');
  return base ? `${base}_${index}` : `ADDON_${index}`;
}

// One add-on per line: "Art gallery & souvenir stop | 500 | 6" (USD segment
// optional). A 4th segment marks it included-by-default (backlog 0.3) —
// bundled into the price, with the booking widget pre-checking it so the
// customer opts OUT rather than in: "Monument entry | 1300 | | yes"
// A 5th segment marks it per-traveler (backlog 0.3) — its amount is charged
// × the traveler count instead of once per booking, for costs like a
// monument ticket that scale with group size: "Monument entry | 1300 | | yes | each"
const INCLUDED_MARKERS = /^(yes|included|default)$/i;
const PER_TRAVELER_MARKERS = /^(yes|each|per-traveler|per traveler|pertraveler)$/i;

export function parseAddOns(text: string): AddOn[] {
  return parseLines(text)
    .map((line, index) => {
      const [name, amountStr, usdStr, includedStr, perTravelerStr] = line.split('|');
      const amount = Number((amountStr ?? '').trim());
      const usdAmount = usdStr != null && usdStr.trim() !== '' ? Number(usdStr.trim()) : null;
      return {
        id: slugAddOnId((name ?? '').trim(), index),
        name: (name ?? '').trim(),
        amount: Number.isFinite(amount) ? amount : 0,
        usdAmount: usdAmount != null && Number.isFinite(usdAmount) ? usdAmount : null,
        includedByDefault: INCLUDED_MARKERS.test((includedStr ?? '').trim()),
        perTraveler: PER_TRAVELER_MARKERS.test((perTravelerStr ?? '').trim()),
      };
    })
    .filter((a) => a.name);
}

export function formatAddOns(addOns: AddOn[]): string {
  return addOns
    .map((a) => {
      const parts = [a.name, String(a.amount), a.usdAmount != null ? String(a.usdAmount) : ''];
      if (a.includedByDefault || a.perTraveler) parts.push(a.includedByDefault ? 'yes' : '');
      if (a.perTraveler) parts.push('each');
      return parts.join(' | ').replace(/(\s\|\s)+$/, ''); // trim trailing empty segments
    })
    .join('\n');
}

// One tier per line: "1 | 11999" or "1 | 11999 | 179" (USD segment optional)
// — travelers | price PER TRAVELER at that group size | USD price (optional)
export function parsePricingTiers(text: string): PricingTier[] {
  return parseLines(text)
    .map((line) => {
      const [travelersStr, amountStr, usdStr] = line.split('|');
      const travelers = Number((travelersStr ?? '').trim());
      const amount = Number((amountStr ?? '').trim());
      const usdAmount = usdStr != null && usdStr.trim() !== '' ? Number(usdStr.trim()) : null;
      return {
        travelers,
        amount,
        usdAmount: usdAmount != null && Number.isFinite(usdAmount) ? usdAmount : null,
      };
    })
    .filter((t) => Number.isInteger(t.travelers) && t.travelers > 0 && Number.isFinite(t.amount) && t.amount > 0)
    .sort((a, b) => a.travelers - b.travelers);
}

export function formatPricingTiers(tiers: PricingTier[]): string {
  return [...tiers]
    .sort((a, b) => a.travelers - b.travelers)
    .map((t) => `${t.travelers} | ${t.amount}${t.usdAmount != null ? ` | ${t.usdAmount}` : ''}`)
    .join('\n');
}
