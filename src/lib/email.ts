// Transactional email via Resend's HTTP API — a single fetch call, no SDK
// dependency, consistent with this app's Web-Crypto-only approach elsewhere
// (adminAuth.ts, customerAuth.ts). Booking confirmations only, matching the
// original intent documented in .env.example for BOOKING_EMAIL_API_KEY/FROM.
//
// Best-effort: by the time this runs, the booking is already paid/created,
// so a failed or unconfigured email must never surface as a booking
// failure. Every exported function here swallows its own errors and logs.

import { formatTravelDate, formatMoneyMinor } from './format';

export interface BookingEmailDetails {
  to: string;
  travelerName: string;
  tourTitle: string;
  travelDate: string;
  travelers: number;
  amountPaid: number; // smallest currency subunit (paise/cents), matches bookings.amount_paid
  currency: string;
  bookingId: string;
  totalAmount: number; // backlog 0.4 — full tour price; equals amountPaid unless paymentType is 'deposit'
  paymentType: 'full' | 'deposit';
  // Online bookings only: links the "View your booking" button to
  // /booking/confirmation, which looks the booking up by payment id.
  paymentId?: string | null;
  discountLabel?: string | null; // src/lib/offers.ts — the one discount applied
  discountAmount?: number | null; // smallest currency subunit
}

// "Mon, 12 Oct 2026" — travel dates arrive as YYYY-MM-DD.
function displayDate(ymd: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? formatTravelDate(ymd) : ymd;
}

const SITE = 'https://www.iwisglobal.com';
const PHONE_DISPLAY = '+91 6399226633';
const PHONE_TEL = 'tel:+916399226633';
const EMAIL = 'info@iwisglobal.com';
const whatsappHref = (text: string) => `https://wa.me/916399226633?text=${encodeURIComponent(text)}`;

// "₹13,258" / "$419", same formatting as the website.
function formatAmount(amountMinor: number, currency: string): string {
  return formatMoneyMinor(amountMinor, currency);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export async function sendBookingConfirmationEmail(env: Record<string, any>, details: BookingEmailDetails): Promise<void> {
  const apiKey = env.RESEND_API_KEY;
  // Not configured yet, or this booking has no email on file (e.g. a
  // phone-only manual entry) — either way, silently skip. Never throw.
  if (!apiKey || !details.to) return;

  const from = env.BOOKING_EMAIL_FROM || 'IWIS Global <info@iwisglobal.com>';
  const amount = formatAmount(details.amountPaid, details.currency);
  const name = escapeHtml(details.travelerName || 'there');
  const isDeposit = details.paymentType === 'deposit';
  const balanceDue = details.totalAmount - details.amountPaid;
  const date = displayDate(details.travelDate);
  const hasDiscount = !!(details.discountLabel && details.discountAmount);
  const tourPrice = details.totalAmount + (hasDiscount ? details.discountAmount! : 0);
  const viewUrl = details.paymentId ? `${SITE}/booking/confirmation?payment_id=${encodeURIComponent(details.paymentId)}` : null;
  const waUrl = whatsappHref(`Hi! Question about my booking ${details.bookingId}. (ref: EMAIL-CONFIRMATION)`);

  // [label, value, value style]
  const rows: [string, string, string?][] = [
    ['Tour', details.tourTitle],
    ['Date', date],
    ['Travelers', String(details.travelers)],
    ...(hasDiscount
      ? ([
          ['Tour price', formatAmount(tourPrice, details.currency)],
          [details.discountLabel!, `−${formatAmount(details.discountAmount!, details.currency)}`, 'color:#15803d;'],
        ] as [string, string, string?][])
      : []),
    [isDeposit ? 'Deposit paid' : 'Amount paid', amount, 'font-weight:600;'],
    ...(isDeposit ? ([['Balance due on pickup', formatAmount(balanceDue, details.currency), 'font-weight:600;']] as [string, string, string?][]) : []),
    ['Booking ID', details.bookingId, 'word-break:break-all;'],
  ];
  const cell = 'padding:6px 0; vertical-align:top;';
  const depositNote = isDeposit
    ? `You've paid a 25% deposit to secure this booking; the remaining ${formatAmount(balanceDue, details.currency)} is due on pickup. If you cancel less than 24 hours before your tour, 50% of the deposit is refunded.`
    : '';
  const cancelNote = 'Free cancellation up to 24 hours before your tour starts (50% refund after that; no refund for no-shows).';
  const button = 'display:inline-block; padding:12px 20px; border-radius:999px; text-decoration:none; font-weight:600;';

  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1c1917;">
      <h2 style="color:#5b21b6; margin-bottom: 4px;">Booking confirmed</h2>
      <p>Hi ${name},</p>
      <p>Your booking with IWIS Global is confirmed. Here are the details:</p>
      <table style="width:100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        ${rows
          .map(
            ([label, value, style]) =>
              `<tr><td style="${cell} color:#78716c; padding-right:12px;">${escapeHtml(label)}</td><td style="${cell} text-align:right; ${style ?? ''}">${escapeHtml(value)}</td></tr>`
          )
          .join('')}
      </table>
      ${viewUrl ? `<p style="margin:20px 0;"><a href="${viewUrl}" style="${button} background:#5b21b6; color:#ffffff;">View your booking</a></p>` : ''}
      ${depositNote ? `<p>${depositNote}</p>` : ''}
      <p>${cancelNote}</p>
      <p style="margin-bottom:8px;">Questions? Just reply to this email, or:</p>
      <p style="margin-top:0; line-height:2;">
        <a href="${waUrl}" style="color:#15803d; font-weight:600;">WhatsApp us</a><br />
        <a href="${PHONE_TEL}" style="color:#5b21b6;">Call ${PHONE_DISPLAY}</a><br />
        <a href="mailto:${EMAIL}" style="color:#5b21b6;">${EMAIL}</a>
      </p>
      <p style="color:#a8a29e; font-size:12px; margin-top:24px;">IWIS Global &middot; <a href="${SITE}" style="color:#a8a29e;">www.iwisglobal.com</a></p>
    </div>
  `;

  // Plain-text version, for text-only mail apps and spam filters.
  const text = [
    `Booking confirmed`,
    ``,
    `Hi ${details.travelerName || 'there'},`,
    `Your booking with IWIS Global is confirmed.`,
    ``,
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(viewUrl ? [``, `View your booking: ${viewUrl}`] : []),
    ...(depositNote ? [``, depositNote] : []),
    ``,
    cancelNote,
    ``,
    `Questions? Reply to this email, WhatsApp us (${waUrl}), call ${PHONE_DISPLAY} or email ${EMAIL}.`,
    ``,
    `IWIS Global · ${SITE}`,
  ].join('\n');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: details.to,
        subject: `Booking confirmed — ${details.tourTitle}`,
        html,
        text,
      }),
    });
    if (!res.ok) {
      console.error('sendBookingConfirmationEmail: Resend API error', res.status, await res.text());
    }
  } catch (err) {
    console.error('sendBookingConfirmationEmail: request failed', err);
  }
}

export interface EntryTicketEmailDetails {
  to: string;
  travelerName: string;
  tourTitle: string;
  travelDate: string;
  bookingId: string;
  fileName: string;
  fileBytes: ArrayBuffer;
  // What's attached, from computeTicketsToBuy (src/lib/entryTickets.ts).
  tickets?: { name: string; quantity: number }[];
}

function toBase64(bytes: ArrayBuffer): string {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Emails the monument e-ticket(s) staff bought on ASI's site. Unlike the
// confirmation email this returns whether it was sent, so the admin page can
// record it (ticket_emailed_at) and show a clear result. Still never throws.
export async function sendEntryTicketEmail(env: Record<string, any>, details: EntryTicketEmailDetails): Promise<boolean> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !details.to) return false;

  const from = env.BOOKING_EMAIL_FROM || 'IWIS Global <info@iwisglobal.com>';
  const name = escapeHtml(details.travelerName || 'there');
  const date = displayDate(details.travelDate);
  // "Taj Mahal entry ticket (foreign visitor) × 2"
  const ticketLines = (details.tickets ?? []).map((t) => `${t.name} × ${t.quantity}`);
  const waUrl = whatsappHref(`Hi! Question about my entry tickets, booking ${details.bookingId}. (ref: EMAIL-TICKETS)`);
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1c1917;">
      <h2 style="color:#5b21b6; margin-bottom: 4px;">Your monument entry tickets</h2>
      <p>Hi ${name},</p>
      <p>We've booked the monument entry tickets for your <strong>${escapeHtml(details.tourTitle)}</strong> on <strong>${escapeHtml(date)}</strong>. They're attached to this email.</p>
      ${
        ticketLines.length
          ? `<p style="margin-bottom:4px;">Attached:</p><ul style="margin-top:0; padding-left:20px;">${ticketLines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
          : ''
      }
      <p>Please keep this email handy on the day of your tour.</p>
      <p style="color:#78716c; font-size:13px;">Booking ID: ${escapeHtml(details.bookingId)}</p>
      <p style="margin-bottom:8px;">Questions? Just reply to this email, or:</p>
      <p style="margin-top:0; line-height:2;">
        <a href="${waUrl}" style="color:#15803d; font-weight:600;">WhatsApp us</a><br />
        <a href="${PHONE_TEL}" style="color:#5b21b6;">Call ${PHONE_DISPLAY}</a><br />
        <a href="mailto:${EMAIL}" style="color:#5b21b6;">${EMAIL}</a>
      </p>
      <p style="color:#a8a29e; font-size:12px; margin-top:24px;">IWIS Global &middot; <a href="${SITE}" style="color:#a8a29e;">www.iwisglobal.com</a></p>
    </div>
  `;
  const text = [
    `Your monument entry tickets`,
    ``,
    `Hi ${details.travelerName || 'there'},`,
    `We've booked the monument entry tickets for your ${details.tourTitle} on ${date}. They're attached to this email.`,
    ...(ticketLines.length ? [``, `Attached:`, ...ticketLines.map((l) => `- ${l}`)] : []),
    ``,
    `Please keep this email handy on the day of your tour.`,
    `Booking ID: ${details.bookingId}`,
    ``,
    `Questions? Reply to this email, WhatsApp us (${waUrl}), call ${PHONE_DISPLAY} or email ${EMAIL}.`,
    ``,
    `IWIS Global · ${SITE}`,
  ].join('\n');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: details.to,
        // Date first: phone inboxes cut long subjects off after ~40 characters.
        subject: `Your entry tickets for ${displayDate(details.travelDate)} — ${details.tourTitle}`,
        html,
        text,
        attachments: [{ filename: details.fileName, content: toBase64(details.fileBytes) }],
      }),
    });
    if (!res.ok) {
      console.error('sendEntryTicketEmail: Resend API error', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('sendEntryTicketEmail: request failed', err);
    return false;
  }
}
