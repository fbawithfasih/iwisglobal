// "Add to calendar" (Apple Calendar, Outlook and others) for the booking on
// /booking/confirmation. An all-day event on the travel date; the pickup time
// is free text set in admin, so it goes in the notes rather than as a start
// time. Looked up by payment id like the confirmation page, and carries the
// same details it shows: tour, date, booking id — no name or contact details.
import type { APIRoute } from 'astro';
import { resolveEnv } from '../../lib/env';
import { getBookingByPaymentId } from '../../lib/crm';
import { getTourById } from '../../lib/tours';

export const prerender = false;

const SITE = 'https://www.iwisglobal.com';

// RFC 5545 text escaping, and lines folded at 75 octets.
const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  for (const ch of line) {
    const limit = parts.length === 0 ? 75 : 74;
    if (new TextEncoder().encode(current + ch).length > limit) {
      parts.push(current);
      current = '';
    }
    current += ch;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export const GET: APIRoute = async ({ url, locals }) => {
  const env = resolveEnv(locals);
  const paymentId = url.searchParams.get('payment_id');
  const booking = paymentId && env.DB ? await getBookingByPaymentId(env.DB, paymentId) : null;
  if (!booking || booking.status === 'cancelled' || !/^\d{4}-\d{2}-\d{2}$/.test(booking.travel_date)) {
    return new Response('Booking not found', { status: 404 });
  }
  const tour = await getTourById(env.DB, booking.tour_id);
  const title = `${tour?.title ?? 'Your tour'} (IWIS Global)`;

  const start = booking.travel_date.replace(/-/g, '');
  const next = new Date(`${booking.travel_date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const end = next.toISOString().slice(0, 10).replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const pageUrl = `${SITE}/booking/confirmation?payment_id=${encodeURIComponent(booking.payment_id)}`;
  const notes = [
    ...(booking.pickup_time ? [`Pickup: ${booking.pickup_time}`] : []),
    `Booking ID: ${booking.id}`,
    `Booking details: ${pageUrl}`,
    'Questions: WhatsApp +91 6399226633',
  ].join('\n');

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//IWIS Global//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${booking.id}@iwisglobal.com`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${escapeText(title)}`,
    `DESCRIPTION:${escapeText(notes)}`,
    'LOCATION:Agra\\, India',
    `URL:${pageUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .map(fold)
    .join('\r\n');

  return new Response(ics + '\r\n', {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="iwis-global-tour.ics"',
      'Cache-Control': 'private, no-store',
    },
  });
};
