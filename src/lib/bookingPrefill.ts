// Booking links with a date and group size filled in (the WhatsApp agent sends
// them): /tours/<slug>?date=2026-11-14&travelers=4. The tour page runs the
// query through here and hands the booking widget only values the date picker
// itself would accept; anything else is ignored and the widget keeps its
// defaults.
import { MAX_TRAVELERS_PER_DATE } from './db';
import { isValidDateString, isTajClosedStart } from './availability';

export interface Prefill {
  date?: string;
  travelers?: number;
}

export function prefillFromQuery(
  params: URLSearchParams,
  opts: { minDate: string; tajOffset: number; allowedDates?: string[] }
): Prefill {
  const out: Prefill = {};

  const date = params.get('date') ?? '';
  if (isValidDateString(date) && date >= opts.minDate && !isTajClosedStart(date, opts.tajOffset)) {
    if (!opts.allowedDates || opts.allowedDates.includes(date)) out.date = date;
  }

  const raw = params.get('travelers') ?? '';
  const travelers = /^\d{1,2}$/.test(raw) ? Number(raw) : 0;
  if (travelers >= 1 && travelers <= MAX_TRAVELERS_PER_DATE) out.travelers = travelers;

  return out;
}
