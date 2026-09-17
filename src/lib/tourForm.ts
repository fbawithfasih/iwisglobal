// Plain-text <textarea> encodings for the admin tour form — keeps the CRM's
// server-rendered-form pattern (no JS islands) instead of a repeatable-field
// React component, consistent with the rest of /admin.

import type { AddOn } from './catalog';
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

// One step per line: "5:30 AM | Pickup from hotel"
export function parseItinerary(text: string): ItineraryStep[] {
  return parseLines(text)
    .map((line) => {
      const [time, ...rest] = line.split('|');
      return { time: (time ?? '').trim(), activity: rest.join('|').trim() };
    })
    .filter((step) => step.time || step.activity);
}

export function formatItinerary(steps: ItineraryStep[]): string {
  return steps.map((s) => `${s.time} | ${s.activity}`).join('\n');
}

function slugAddOnId(name: string, index: number): string {
  const base = name
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/(^_|_$)/g, '');
  return base ? `${base}_${index}` : `ADDON_${index}`;
}

// One add-on per line: "Art gallery & souvenir stop | 500"
export function parseAddOns(text: string): AddOn[] {
  return parseLines(text)
    .map((line, index) => {
      const [name, amountStr] = line.split('|');
      const amount = Number((amountStr ?? '').trim());
      return { id: slugAddOnId((name ?? '').trim(), index), name: (name ?? '').trim(), amount: Number.isFinite(amount) ? amount : 0 };
    })
    .filter((a) => a.name);
}

export function formatAddOns(addOns: AddOn[]): string {
  return addOns.map((a) => `${a.name} | ${a.amount}`).join('\n');
}
