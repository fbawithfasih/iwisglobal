// Transactional email via Resend's HTTP API — a single fetch call, no SDK
// dependency, consistent with this app's Web-Crypto-only approach elsewhere
// (adminAuth.ts, customerAuth.ts).
//
// Customer emails are written in the guest's language (the `locale` in each
// details object; bookings store it in bookings.locale). The business inbox
// notification stays English. Wording lives in the `emails` namespace of the
// dictionaries; this file only lays it out.
//
// Best-effort: by the time this runs, the booking is already paid/created,
// so a failed or unconfigured email must never surface as a booking
// failure. Every exported function here swallows its own errors and logs.

import { formatTravelDate, formatMoneyMinor } from './format';
import { intlLocale, type Locale } from './i18n';
import { getDictionary } from '../i18n/dictionaries';
import { fmt } from '../i18n/fmt';
import type { HotelChoice } from './customTrip';

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
  addOnNames?: string[]; // the add-ons chosen (entryTickets.ts chosenAddOnNames)
  locale?: Locale;
}

// The deposit terms, worded once for the email and the confirmation page.
export function depositTermsNote(balanceLabel: string): string {
  return fmt(getDictionary('en').emails.confirm.depositNote, { balance: balanceLabel });
}

// "Mon, 12 Oct 2026" — travel dates arrive as YYYY-MM-DD.
function displayDate(ymd: string, locale: Locale = 'en'): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? formatTravelDate(ymd, intlLocale(locale)) : ymd;
}

// The words of an HTML snippet, for the plain-text copy of an email.
function plain(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
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

// Shared look for the customer emails (confirmation, reset, changed, confirm): a violet
// header band, the body, and a footer. Inline styles and a solid header colour
// (no gradient) because mail apps ignore stylesheets and most drop gradients.
const EMAIL_BUTTON = 'display:inline-block; padding:14px 28px; border-radius:999px; text-decoration:none; font-weight:600; background:#6d28d9; color:#ffffff;';
const EMAIL_NOTE = 'background:#f5f3ff; border-radius:10px; padding:10px 14px; font-size:13px; color:#44403c;';
function emailHtml(title: string, bodyHtml: string): string {
  return `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1c1917; border:1px solid #ede9fe; border-radius:16px; overflow:hidden;">
      <div style="background:#4c1d95; padding:22px 24px; text-align:center;">
        <p style="margin:0; font-size:12px; letter-spacing:1px; text-transform:uppercase; color:#ddd6fe;">IWIS Global</p>
        <h2 style="margin:6px 0 0; color:#ffffff; font-size:22px;">${title}</h2>
      </div>
      <div style="padding:24px; line-height:1.55;">${bodyHtml}</div>
      <p style="margin:0; padding:14px 24px; background:#faf9ff; color:#a8a29e; font-size:12px; text-align:center;">IWIS Global &middot; <a href="${SITE}" style="color:#7c3aed;">www.iwisglobal.com</a></p>
    </div>
  `;
}

const FROM = (env: Record<string, any>) => env.BOOKING_EMAIL_FROM || 'IWIS Global <info@iwisglobal.com>';
// The site picks the language from ?lang= on pages that have a single URL.
const withLang = (url: string, locale: Locale) => (locale === 'en' ? url : `${url}${url.includes('?') ? '&' : '?'}lang=${locale}`);

async function post(env: Record<string, any>, label: string, payload: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`${label}: Resend API error`, res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error(`${label}: request failed`, err);
    return false;
  }
}

export async function sendBookingConfirmationEmail(env: Record<string, any>, details: BookingEmailDetails): Promise<void> {
  const apiKey = env.RESEND_API_KEY;
  // Not configured yet, or this booking has no email on file (e.g. a
  // phone-only manual entry) — either way, silently skip. Never throw.
  if (!apiKey || !details.to) return;

  const locale = details.locale ?? 'en';
  const E = getDictionary(locale).emails;
  const C = E.confirm;
  const amount = formatAmount(details.amountPaid, details.currency);
  const nameText = details.travelerName || E.there;
  const isDeposit = details.paymentType === 'deposit';
  const balanceDue = details.totalAmount - details.amountPaid;
  const date = displayDate(details.travelDate, locale);
  const hasDiscount = !!(details.discountLabel && details.discountAmount);
  const tourPrice = details.totalAmount + (hasDiscount ? details.discountAmount! : 0);
  const viewUrl = details.paymentId ? withLang(`${SITE}/booking/confirmation?payment_id=${encodeURIComponent(details.paymentId)}`, locale) : null;
  const waUrl = whatsappHref(`Hi! Question about my booking ${details.bookingId}. (ref: EMAIL-CONFIRMATION)`);

  // [label, value, value style]
  const rows: [string, string, string?][] = [
    [C.tour, details.tourTitle],
    [C.date, date],
    [C.travelers, String(details.travelers)],
    ...(details.addOnNames?.length ? ([[C.addons, details.addOnNames.join(', ')]] as [string, string, string?][]) : []),
    ...(hasDiscount
      ? ([
          [C.tourPrice, formatAmount(tourPrice, details.currency)],
          [details.discountLabel!, `−${formatAmount(details.discountAmount!, details.currency)}`, 'color:#15803d;'],
        ] as [string, string, string?][])
      : []),
    [isDeposit ? C.depositPaid : C.amountPaid, amount, 'font-weight:600;'],
    ...(isDeposit ? ([[C.balanceDue, formatAmount(balanceDue, details.currency), 'font-weight:600;']] as [string, string, string?][]) : []),
    [C.bookingId, details.bookingId, 'word-break:break-all;'],
  ];
  const cell = 'padding:6px 0; vertical-align:top;';
  const depositNote = isDeposit ? fmt(C.depositNote, { balance: formatAmount(balanceDue, details.currency) }) : '';
  const html = emailHtml(C.title, `
        <p style="margin-top:0;">${escapeHtml(fmt(E.hi, { name: nameText }))}</p>
        <p>${C.intro}</p>
        <table style="width:100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; background:#faf9ff; border:1px solid #ede9fe; border-radius:12px;">
          ${rows
            .map(
              ([label, value, style]) =>
                `<tr><td style="${cell} color:#78716c; padding-left:14px; padding-right:12px;">${escapeHtml(label)}</td><td style="${cell} text-align:right; padding-right:14px; ${style ?? ''}">${escapeHtml(value)}</td></tr>`
            )
            .join('')}
        </table>
        ${viewUrl ? `<p style="margin:24px 0; text-align:center;"><a href="${viewUrl}" style="${EMAIL_BUTTON}">${C.view}</a></p>` : ''}
        ${depositNote ? `<p style="${EMAIL_NOTE}">${depositNote}</p>` : ''}
        <p style="${EMAIL_NOTE}">${C.cancelNote}</p>
        <p style="margin-bottom:8px;">${C.questions}</p>
        <p style="margin-top:0; line-height:2;">
          <a href="${waUrl}" style="color:#15803d; font-weight:600;">${C.whatsapp}</a><br />
          <a href="${PHONE_TEL}" style="color:#6d28d9;">${fmt(C.call, { phone: PHONE_DISPLAY })}</a><br />
          <a href="mailto:${EMAIL}" style="color:#6d28d9;">${EMAIL}</a>
        </p>`);

  // Plain-text version, for text-only mail apps and spam filters.
  const text = [
    C.title,
    ``,
    fmt(E.hi, { name: nameText }),
    plain(C.intro),
    ``,
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(viewUrl ? [``, `${C.view}: ${viewUrl}`] : []),
    ...(depositNote ? [``, depositNote] : []),
    ``,
    C.cancelNote,
    ``,
    fmt(C.questionsText, { wa: waUrl, phone: PHONE_DISPLAY, email: EMAIL }),
    ``,
    `IWIS Global · ${SITE}`,
  ].join('\n');

  await post(env, 'sendBookingConfirmationEmail', {
    from: FROM(env),
    to: details.to,
    subject: fmt(C.subject, { tour: details.tourTitle }),
    html,
    text,
  });
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
  locale?: Locale;
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

  const locale = details.locale ?? 'en';
  const E = getDictionary(locale).emails;
  const T = E.tickets;
  const nameText = details.travelerName || E.there;
  const date = displayDate(details.travelDate, locale);
  // "Taj Mahal entry ticket (foreign visitor) × 2"
  const ticketLines = (details.tickets ?? []).map((t) => `${t.name} × ${t.quantity}`);
  const waUrl = whatsappHref(`Hi! Question about my entry tickets, booking ${details.bookingId}. (ref: EMAIL-TICKETS)`);
  const intro = fmt(T.intro, { tour: escapeHtml(details.tourTitle), date: escapeHtml(date) });
  const C = E.confirm;
  const html = emailHtml(T.title, `
        <p style="margin-top:0;">${escapeHtml(fmt(E.hi, { name: nameText }))}</p>
        <p>${intro}</p>
        ${
          ticketLines.length
            ? `<div style="background:#faf9ff; border:1px solid #ede9fe; border-radius:12px; padding:12px 16px; margin:16px 0;"><p style="margin:0 0 4px; font-size:12px; letter-spacing:1px; text-transform:uppercase; color:#7c3aed;">${T.attached}</p><ul style="margin:0; padding-left:20px;">${ticketLines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul></div>`
            : ''
        }
        <p style="${EMAIL_NOTE}">${T.keep}</p>
        <p style="color:#78716c; font-size:13px;">${escapeHtml(fmt(T.bookingId, { id: details.bookingId }))}</p>
        <p style="margin-bottom:8px;">${C.questions}</p>
        <p style="margin-top:0; line-height:2;">
          <a href="${waUrl}" style="color:#15803d; font-weight:600;">${C.whatsapp}</a><br />
          <a href="${PHONE_TEL}" style="color:#6d28d9;">${fmt(C.call, { phone: PHONE_DISPLAY })}</a><br />
          <a href="mailto:${EMAIL}" style="color:#6d28d9;">${EMAIL}</a>
        </p>`);
  const text = [
    T.title,
    ``,
    fmt(E.hi, { name: nameText }),
    plain(fmt(T.intro, { tour: details.tourTitle, date })),
    ...(ticketLines.length ? [``, `${T.attached}:`, ...ticketLines.map((l) => `- ${l}`)] : []),
    ``,
    T.keep,
    fmt(T.bookingId, { id: details.bookingId }),
    ``,
    fmt(C.questionsText, { wa: waUrl, phone: PHONE_DISPLAY, email: EMAIL }),
    ``,
    `IWIS Global · ${SITE}`,
  ].join('\n');

  return post(env, 'sendEntryTicketEmail', {
    from: FROM(env),
    to: details.to,
    // Date first: phone inboxes cut long subjects off after ~40 characters.
    subject: fmt(T.subject, { date, tour: details.tourTitle }),
    html,
    text,
    attachments: [{ filename: details.fileName, content: toBase64(details.fileBytes) }],
  });
}

export interface ReviewRequestEmailDetails {
  to: string;
  travelerName: string;
  tourTitle: string;
  travelDate: string;
  // /review?t=<token> (src/lib/reviews.ts); each star adds &rating=N.
  reviewUrl: string;
  googleReviewUrl: string;
  locale?: Locale;
}

// "How was your tour?" — sent from the admin booking or Reviews page after
// the trip. Returns whether it was sent, like sendEntryTicketEmail.
export async function sendReviewRequestEmail(env: Record<string, any>, details: ReviewRequestEmailDetails): Promise<boolean> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !details.to) return false;

  const locale = details.locale ?? 'en';
  const E = getDictionary(locale).emails;
  const R = E.review;
  const first = details.travelerName.trim().split(/\s+/)[0] || E.there;
  const firstName = first.charAt(0).toUpperCase() + first.slice(1);
  const date = displayDate(details.travelDate, locale);
  const reviewLink = withLang(details.reviewUrl, locale);
  const starUrl = (n: number) => `${reviewLink}&rating=${n}`;
  // Five big tappable stars; each opens the review page with that rating picked.
  const stars = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        `<td style="padding:0 2px;"><a href="${starUrl(n)}" title="${fmt(n > 1 ? R.starMany : R.starOne, { n })}" style="display:block; width:48px; line-height:48px; text-align:center; font-size:34px; color:#f59e0b; text-decoration:none;">&#9733;</a></td>`
    )
    .join('');

  const html = emailHtml(R.title, `
        <p style="margin-top:0;">${escapeHtml(fmt(E.hi, { name: firstName }))}</p>
        <p>${fmt(R.intro, { tour: escapeHtml(details.tourTitle), date: escapeHtml(date) })}</p>
        <div style="background:#faf9ff; border:1px solid #ede9fe; border-radius:12px; padding:14px 8px 8px; margin:16px 0; text-align:center;">
          <p style="margin:0 0 4px; color:#6d28d9; font-size:14px; font-weight:600;">${R.tap}</p>
          <table role="presentation" style="border-collapse:collapse; margin:0 auto;"><tr>${stars}</tr></table>
        </div>
        <p style="margin:24px 0; text-align:center;"><a href="${reviewLink}" style="${EMAIL_BUTTON}">${R.button}</a></p>
        <p>${R.google} <a href="${details.googleReviewUrl}" style="color:#6d28d9;">${R.googleLink}</a>.</p>
        <p style="margin-bottom:8px;">${R.notRight}</p>
        <p style="margin-top:0; line-height:2;">
          <a href="${whatsappHref('Hi! About my recent tour. (ref: EMAIL-REVIEW)')}" style="color:#15803d; font-weight:600;">${E.confirm.whatsapp}</a><br />
          <a href="${PHONE_TEL}" style="color:#6d28d9;">${fmt(E.confirm.call, { phone: PHONE_DISPLAY })}</a>
        </p>`);
  const text = [
    R.title,
    ``,
    fmt(E.hi, { name: firstName }),
    plain(fmt(R.intro, { tour: details.tourTitle, date })),
    ``,
    `${R.button}: ${reviewLink}`,
    `${R.google} ${details.googleReviewUrl}`,
    ``,
    fmt(R.notRightText, { phone: PHONE_DISPLAY }),
    ``,
    `IWIS Global · ${SITE}`,
  ].join('\n');

  return post(env, 'sendReviewRequestEmail', { from: FROM(env), to: details.to, subject: fmt(R.subject, { tour: details.tourTitle }), html, text });
}

export interface AdminBookingNotificationDetails {
  travelerName: string;
  travelerEmail: string;
  travelerPhone: string;
  tourTitle: string;
  travelDate: string;
  travelers: number;
  amountPaid: number; // smallest currency subunit
  totalAmount: number;
  currency: string;
  bookingId: string;
  paymentType: 'full' | 'deposit';
  discountLabel?: string | null;
}

// "New booking" alert to the business inbox, sent alongside the customer's
// own confirmation email (sendBookingConfirmationEmail) for every online
// booking. Same best-effort contract: never throws, never blocks the
// booking on a delivery failure.
export async function sendAdminBookingNotificationEmail(env: Record<string, any>, details: AdminBookingNotificationDetails): Promise<void> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return;

  const from = env.BOOKING_EMAIL_FROM || 'IWIS Global <info@iwisglobal.com>';
  const to = env.ADMIN_NOTIFICATION_EMAIL || 'info@iwisglobal.com';
  const date = displayDate(details.travelDate);
  const amount = formatAmount(details.amountPaid, details.currency);
  const adminUrl = `${SITE}/admin/bookings/${details.bookingId}`;
  const depositNote = details.paymentType === 'deposit' ? ` (25% deposit; balance ${formatAmount(details.totalAmount - details.amountPaid, details.currency)} on pickup)` : '';

  const rows: [string, string][] = [
    ['Tour', details.tourTitle],
    ['Date', date],
    ['Travelers', String(details.travelers)],
    ['Traveler', details.travelerName || '(not given)'],
    ['Phone', details.travelerPhone || '(not given)'],
    ['Email', details.travelerEmail || '(not given)'],
    ...(details.discountLabel ? ([['Discount', details.discountLabel]] as [string, string][]) : []),
    ['Amount paid', `${amount}${depositNote}`],
    ['Booking ID', details.bookingId],
  ];
  const cell = 'padding:6px 0; vertical-align:top;';

  const html = emailHtml('New booking', `
        <table style="width:100%; border-collapse: collapse; margin: 0 0 16px; font-size: 14px; background:#faf9ff; border:1px solid #ede9fe; border-radius:12px;">
          ${rows
            .map(
              ([label, value]) =>
                `<tr><td style="${cell} color:#78716c; padding-left:14px; padding-right:12px;">${escapeHtml(label)}</td><td style="${cell} text-align:right; padding-right:14px; word-break:break-all;${label === 'Amount paid' ? ' font-weight:600;' : ''}">${escapeHtml(value)}</td></tr>`
            )
            .join('')}
        </table>
        <p style="margin:24px 0 0; text-align:center;"><a href="${adminUrl}" style="${EMAIL_BUTTON}">Open booking</a></p>`);
  const text = [`New booking`, ``, ...rows.map(([label, value]) => `${label}: ${value}`), ``, `Open booking: ${adminUrl}`].join('\n');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject: `New booking — ${details.tourTitle}, ${date}`, html, text }),
    });
    if (!res.ok) {
      console.error('sendAdminBookingNotificationEmail: Resend API error', res.status, await res.text());
    }
  } catch (err) {
    console.error('sendAdminBookingNotificationEmail: request failed', err);
  }
}

export interface WhatsappHandoffEmailDetails {
  name: string | null;
  phone: string; // digits with country code
  reason: string;
  lastMessages: { direction: string; body: string }[];
  draft: string;
}

const HANDOFF_REASON_TEXT: Record<string, string> = {
  handoff: 'a refund, complaint, booking change or similar',
  no_knowledge: 'there is no approved answer for the question',
  price_mismatch: 'the draft quoted a price that is not in the catalogue',
  unsupported: 'the guest sent a voice note, image or other non-text message',
  format: 'the draft was not in the expected format',
  no_booking: 'no booking was found under this WhatsApp number',
  cap: 'the daily draft limit was reached',
  no_api_key: 'the AI key is not set',
  error: 'drafting failed',
};

// "A guest needs a person" alert to the business inbox when a WhatsApp chat
// moves to needs-a-person (src/lib/waInbox.ts). Same best-effort contract as the
// booking alert: never throws, never blocks the webhook.
export async function sendWhatsappHandoffEmail(env: Record<string, any>, details: WhatsappHandoffEmailDetails): Promise<void> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return;

  const from = env.BOOKING_EMAIL_FROM || 'IWIS Global <info@iwisglobal.com>';
  const to = env.ADMIN_NOTIFICATION_EMAIL || 'info@iwisglobal.com';
  const who = details.name || `+${details.phone}`;
  const chatUrl = `${SITE}/admin/whatsapp?c=${encodeURIComponent(details.phone)}`;
  const why = HANDOFF_REASON_TEXT[details.reason] ?? details.reason;
  const cell = 'padding:6px 0; vertical-align:top;';

  const messages = details.lastMessages
    .map(
      (m) =>
        `<tr><td style="${cell} color:#78716c; padding-left:14px; padding-right:12px; white-space:nowrap;">${m.direction === 'in' ? 'Guest' : 'Us'}</td><td style="${cell} padding-right:14px;">${escapeHtml(m.body)}</td></tr>`
    )
    .join('');
  const draft = details.draft
    ? `<p style="margin:16px 0 4px; font-size:13px; color:#78716c;">Drafted reply (not sent)</p><p style="margin:0; padding:12px 14px; background:#faf9ff; border:1px solid #ede9fe; border-radius:12px; white-space:pre-line;">${escapeHtml(details.draft)}</p>`
    : '';

  const html = emailHtml('A guest needs a person', `
        <p style="margin:0 0 12px;"><strong>${escapeHtml(who)}</strong> (+${escapeHtml(details.phone)}) wrote on WhatsApp. Why: ${escapeHtml(why)}.</p>
        <table style="width:100%; border-collapse: collapse; margin: 0 0 8px; font-size: 14px; background:#faf9ff; border:1px solid #ede9fe; border-radius:12px;">${messages}</table>
        ${draft}
        <p style="margin:24px 0 0; text-align:center;"><a href="${chatUrl}" style="${EMAIL_BUTTON}">Open the chat</a></p>`);
  const text = [
    `${who} (+${details.phone}) wrote on WhatsApp. Why: ${why}.`,
    ``,
    ...details.lastMessages.map((m) => `${m.direction === 'in' ? 'Guest' : 'Us'}: ${m.body}`),
    ...(details.draft ? [``, `Drafted reply (not sent):`, details.draft] : []),
    ``,
    `Open the chat: ${chatUrl}`,
  ].join('\n');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject: `WhatsApp: ${who} needs a person`, html, text }),
    });
    if (!res.ok) {
      console.error('sendWhatsappHandoffEmail: Resend API error', res.status, await res.text());
    }
  } catch (err) {
    console.error('sendWhatsappHandoffEmail: request failed', err);
  }
}

// Short alert to the business inbox about automatic WhatsApp replies: the runaway
// breaker switching them off, or a message marked Wrong in the audit. Plain text
// content only; best effort like the other alerts.
export async function sendAutoReplyAlertEmail(
  env: Record<string, any>,
  details: { title: string; message: string; path?: string; linkLabel?: string }
): Promise<boolean> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return false;

  const from = env.BOOKING_EMAIL_FROM || 'IWIS Global <info@iwisglobal.com>';
  const to = env.ADMIN_NOTIFICATION_EMAIL || 'info@iwisglobal.com';
  const url = `${SITE}${details.path ?? '/admin/whatsapp/auto'}`;
  const label = details.linkLabel ?? 'Open automatic reply settings';
  const html = emailHtml(details.title, `
        <p style="margin:0 0 12px; white-space:pre-line;">${escapeHtml(details.message)}</p>
        <p style="margin:24px 0 0; text-align:center;"><a href="${url}" style="${EMAIL_BUTTON}">${escapeHtml(label)}</a></p>`);
  const text = `${details.message}\n\n${label}: ${url}`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject: `WhatsApp: ${details.title}`, html, text }),
    });
    if (!res.ok) console.error('sendAutoReplyAlertEmail: Resend API error', res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error('sendAutoReplyAlertEmail: request failed', err);
    return false;
  }
}

export interface PasswordResetEmailDetails {
  to: string;
  name: string;
  link: string; // /reset-password?t=… (src/lib/passwordReset.ts), valid one hour
  locale?: Locale;
}

// "Forgot password" link for an email/password account.
export async function sendPasswordResetEmail(env: Record<string, any>, details: PasswordResetEmailDetails): Promise<boolean> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !details.to) return false;

  const locale = details.locale ?? 'en';
  const E = getDictionary(locale).emails;
  const X = E.reset;
  const first = details.name.trim().split(/\s+/)[0] || E.there;
  const link = withLang(details.link, locale);
  const html = emailHtml(X.title, `
        <p style="margin-top:0;">${escapeHtml(fmt(E.hi, { name: first }))}</p>
        <p>${X.intro}</p>
        <p style="margin:24px 0; text-align:center;"><a href="${link}" style="${EMAIL_BUTTON}">${X.button}</a></p>
        <p style="${EMAIL_NOTE}">${X.note}</p>`);
  const text = [X.title, ``, fmt(E.hi, { name: first }), X.intro, link, ``, X.note, ``, `IWIS Global · ${SITE}`].join('\n');

  return post(env, 'sendPasswordResetEmail', { from: FROM(env), to: details.to, subject: X.subject, html, text });
}

// Security alert after a password reset, so the owner hears about it if it
// wasn't them. Deliberately carries no link to act on.
export async function sendPasswordChangedEmail(env: Record<string, any>, details: { to: string; name: string; locale?: Locale }): Promise<boolean> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !details.to) return false;

  const E = getDictionary(details.locale ?? 'en').emails;
  const X = E.changed;
  const first = details.name.trim().split(/\s+/)[0] || E.there;
  const wa = `<a href="${whatsappHref('Hi! My IWIS Global password was changed and it was not me. (ref: EMAIL-PASSWORD-CHANGED)')}" style="color:#15803d; font-weight:600;">${X.whatsapp}</a>`;
  const html = emailHtml(X.title, `
        <p style="margin-top:0;">${escapeHtml(fmt(E.hi, { name: first }))}</p>
        <p>${X.p1}</p>
        <p>${X.p2}</p>
        <p style="background:#fef2f2; border:1px solid #fecaca; border-radius:10px; padding:12px 14px; color:#7f1d1d;">${fmt(X.warn, { wa })}</p>`);
  const text = [X.title, ``, fmt(E.hi, { name: first }), X.p1, X.p2, fmt(X.warnText, { phone: PHONE_DISPLAY }), ``, `IWIS Global · ${SITE}`].join('\n');

  return post(env, 'sendPasswordChangedEmail', { from: FROM(env), to: details.to, subject: X.subject, html, text });
}

// "Confirm your email" for a new email/password account, so bookings made
// with this email (before or after signing up) can show in My Bookings.
export async function sendEmailVerificationEmail(env: Record<string, any>, details: { to: string; name: string; link: string; locale?: Locale }): Promise<boolean> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !details.to) return false;

  const E = getDictionary(details.locale ?? 'en').emails;
  const X = E.verify;
  const first = details.name.trim().split(/\s+/)[0] || E.there;
  const html = emailHtml(X.title, `
        <p style="margin-top:0;">${escapeHtml(fmt(E.hi, { name: first }))}</p>
        <p>${X.intro}</p>
        <p style="margin:24px 0; text-align:center;"><a href="${details.link}" style="${EMAIL_BUTTON}">${X.button}</a></p>
        <p style="${EMAIL_NOTE}">${X.note}</p>`);
  const text = [X.title, ``, fmt(E.hi, { name: first }), X.intro, details.link, ``, X.note, ``, `IWIS Global · ${SITE}`].join('\n');

  return post(env, 'sendEmailVerificationEmail', { from: FROM(env), to: details.to, subject: X.subject, html, text });
}

// --- Custom Agra trips (src/lib/customTripPayment.ts) -----------------------

export interface CustomTripEmailDetails {
  tripId: string;
  startDate: string;
  endDate: string;
  days: { date: string; stops: { id: string; name: string }[] }[];
  vehicleId: string;
  vehicleName: string;
  guests: number;
  currency: string;
  depositMinor: number;
  totalMinor: number;
  hotel: HotelChoice;
}

export interface CustomTripGuestEmailDetails extends CustomTripEmailDetails {
  kind: 'received' | 'confirmed' | 'cancelled';
  to: string;
  name: string;
  locale?: Locale;
}

// The guest's own words for their hotel choice, as on the review step.
function hotelLine(hotel: HotelChoice, R: ReturnType<typeof getDictionary>['customTour']['review']): string {
  if (hotel.mode === 'listed') return fmt(R.hotelListed, { name: hotel.name ?? '' });
  if (hotel.mode === 'arrange') return fmt(R.hotelArrange, { nights: hotel.nights ?? 0, rooms: hotel.rooms ?? 0 });
  return R.hotelOwn;
}

// To the guest, in their language: deposit received, then confirmed or
// cancelled once the team has decided. Best-effort, like every email here.
export async function sendCustomTripGuestEmail(env: Record<string, any>, d: CustomTripGuestEmailDetails): Promise<boolean> {
  if (!env.RESEND_API_KEY || !d.to) return false;
  const locale = d.locale ?? 'en';
  const dict = getDictionary(locale);
  const X = dict.customTripEmail;
  const T = dict.customTour;
  const K = X[d.kind];
  const nameText = d.name.trim().split(/\s+/)[0] || dict.emails.there;
  const when = displayDate(d.startDate, locale);
  const dates = d.days.length > 1 ? fmt(T.review.dates, { from: when, to: displayDate(d.endDate, locale) }) : when;
  const stopName = (s: { id: string; name: string }) => (T.stopNames as Record<string, string>)[s.id] ?? s.name;
  const vehicle = (T.vehicleNames as Record<string, string>)[d.vehicleId] ?? d.vehicleName;
  const viewUrl = withLang(`${SITE}/customize-your-tour/thanks?trip=${encodeURIComponent(d.tripId)}`, locale);
  const waUrl = whatsappHref(`Hi! Question about my Agra trip ${d.tripId}. (ref: EMAIL-CUSTOM-TRIP)`);

  const rows: [string, string, string?][] = [
    [X.ref, d.tripId, 'word-break:break-all;'],
    [X.dates, dates],
    [X.vehicle, vehicle],
    [X.guests, String(d.guests)],
    [X.deposit, formatAmount(d.depositMinor, d.currency), 'font-weight:600;'],
    [X.total, formatAmount(d.totalMinor, d.currency)],
    [X.balance, formatAmount(d.totalMinor - d.depositMinor, d.currency)],
    [X.hotel, hotelLine(d.hotel, T.review)],
  ];
  const itinerary = d.days.map((day) => `${fmt(T.itinerary.day, { n: d.days.indexOf(day) + 1 })} · ${displayDate(day.date, locale)}: ${day.stops.map(stopName).join(' → ')}`);
  const cell = 'padding:6px 0; vertical-align:top;';
  const html = emailHtml(K.title, `
        <p style="margin-top:0;">${escapeHtml(fmt(K.intro, { name: nameText }))}</p>
        <table style="width:100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; background:#faf9ff; border:1px solid #ede9fe; border-radius:12px;">
          ${rows
            .map(
              ([label, value, style]) =>
                `<tr><td style="${cell} color:#78716c; padding-left:14px; padding-right:12px;">${escapeHtml(label)}</td><td style="${cell} text-align:right; padding-right:14px; ${style ?? ''}">${escapeHtml(value)}</td></tr>`
            )
            .join('')}
        </table>
        <p style="margin:0 0 4px; font-weight:600;">${escapeHtml(X.itinerary)}</p>
        <ul style="margin:0 0 16px; padding-left:20px; font-size:14px;">${itinerary.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
        <p style="margin:24px 0; text-align:center;"><a href="${viewUrl}" style="${EMAIL_BUTTON}">${X.view}</a></p>
        <p style="margin-bottom:8px;">${X.questions}</p>
        <p style="margin-top:0; line-height:2;">
          <a href="${waUrl}" style="color:#15803d; font-weight:600;">WhatsApp</a><br />
          <a href="${PHONE_TEL}" style="color:#6d28d9;">${PHONE_DISPLAY}</a><br />
          <a href="mailto:${EMAIL}" style="color:#6d28d9;">${EMAIL}</a>
        </p>`);
  const text = [K.title, ``, fmt(K.intro, { name: nameText }), ``, ...rows.map(([label, value]) => `${label}: ${value}`), ``, X.itinerary, ...itinerary, ``, `${X.view}: ${viewUrl}`, ``, X.questions, `${PHONE_DISPLAY} · ${EMAIL}`, ``, `IWIS Global · ${SITE}`].join('\n');
  return post(env, 'sendCustomTripGuestEmail', { from: FROM(env), to: d.to, subject: K.subject, html, text });
}

export interface CustomTripAdminEmailDetails extends CustomTripEmailDetails {
  bookingId: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
}

// To the business inbox, in English, when a deposit arrives: what to confirm.
export async function sendCustomTripAdminEmail(env: Record<string, any>, d: CustomTripAdminEmailDetails): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  const to = env.ADMIN_NOTIFICATION_EMAIL || EMAIL;
  const adminUrl = `${SITE}/admin/bookings/${d.bookingId}`;
  const dates = d.days.length > 1 ? `${displayDate(d.startDate)} to ${displayDate(d.endDate)}` : displayDate(d.startDate);
  const rows: [string, string][] = [
    ['Guest', d.guestName],
    ['Phone', d.guestPhone],
    ['Email', d.guestEmail],
    ['Dates', dates],
    ['Vehicle', d.vehicleName],
    ['Guests', String(d.guests)],
    ['Deposit paid', formatAmount(d.depositMinor, d.currency)],
    ['Trip total', formatAmount(d.totalMinor, d.currency)],
    ['Hotel', hotelLine(d.hotel, getDictionary('en').customTour.review)],
    ['Booking ID', d.bookingId],
  ];
  const itinerary = d.days.map((day, i) => `Day ${i + 1} · ${displayDate(day.date)}: ${day.stops.map((s) => s.name).join(' → ')}`);
  const cell = 'padding:6px 0; vertical-align:top;';
  const html = emailHtml('Custom Agra trip: needs confirming', `
        <table style="width:100%; border-collapse: collapse; margin: 0 0 16px; font-size: 14px; background:#faf9ff; border:1px solid #ede9fe; border-radius:12px;">
          ${rows.map(([label, value]) => `<tr><td style="${cell} color:#78716c; padding-left:14px; padding-right:12px;">${escapeHtml(label)}</td><td style="${cell} text-align:right; padding-right:14px; word-break:break-all;">${escapeHtml(value)}</td></tr>`).join('')}
        </table>
        <ul style="margin:0 0 16px; padding-left:20px; font-size:14px;">${itinerary.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
        <p style="margin:24px 0 0; text-align:center;"><a href="${adminUrl}" style="${EMAIL_BUTTON}">Open booking</a></p>`);
  const text = [`Custom Agra trip: needs confirming`, ``, ...rows.map(([l, v]) => `${l}: ${v}`), ``, ...itinerary, ``, `Open booking: ${adminUrl}`].join('\n');
  await post(env, 'sendCustomTripAdminEmail', { from: FROM(env), to, subject: `Custom Agra trip to confirm: ${d.guestName}, ${dates}`, html, text });
}

// An alert to the business inbox when a paid hotel booking needs a person (the
// booking could not be confirmed with Hotelbeds, or a refund failed). Callers
// pass the booking id, the payment id and a reason only, never guest details.
// Best effort: never throws.
export async function sendHotelAlertEmail(env: Record<string, any>, subject: string, body: string, title = 'Hotel booking needs attention'): Promise<void> {
  try {
    if (!env.RESEND_API_KEY) return;
    const to = env.ADMIN_NOTIFICATION_EMAIL || EMAIL;
    const html = emailHtml(escapeHtml(title), `<pre style="white-space:pre-wrap; font-size:14px; margin:0;">${escapeHtml(body)}</pre>`);
    await post(env, 'sendHotelAlertEmail', { from: FROM(env), to, subject, html, text: body });
  } catch (err) {
    console.error('sendHotelAlertEmail: failed', err instanceof Error ? err.message : 'error');
  }
}

// --- Private offers (src/lib/offerPayment.ts) ------------------------------
// English only. Money as "€174.00" (en-IE), the same format as the offer page.

export interface OfferPaymentEmailDetails {
  offerId: string;
  offerPaymentId: string;
  title: string;
  dateLabel: string;
  pickup: string;
  kind: 'full' | 'deposit' | 'balance';
  depositPercent: number;
  amountMinor: number;
  currency: string;
  totalMinor: number;
  balanceMinor: number; // still to pay after this payment (0 when paid in full)
  optionLabel: string;
  vehicle: string;
  guideLanguage: 'en' | 'de';
  payerName: string;
  payerEmail: string;
  payerPhone: string;
  paymentId: string;
}

const OFFER_WHATSAPP_DISPLAY = '+91 63992 26633';
const OFFER_WHATSAPP_HREF = 'https://wa.me/916399226633';

export function formatOfferMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(minor / 100);
}

export function offerKindLabel(kind: 'full' | 'deposit' | 'balance', depositPercent: number): string {
  return kind === 'full' ? 'full payment' : kind === 'deposit' ? `booking amount (${depositPercent}%)` : 'balance';
}

const offerGuideLabel = (lang: 'en' | 'de') => (lang === 'de' ? 'German' : 'English');

function offerTable(rows: [string, string][]): string {
  const cell = 'padding:6px 0; vertical-align:top;';
  return `
        <table style="width:100%; border-collapse: collapse; margin: 0 0 16px; font-size: 14px; background:#faf9ff; border:1px solid #ede9fe; border-radius:12px;">
          ${rows.map(([label, value]) => `<tr><td style="${cell} color:#78716c; padding-left:14px; padding-right:12px;">${escapeHtml(label)}</td><td style="${cell} text-align:right; padding-right:14px; word-break:break-word;${label === 'Amount paid' ? ' font-weight:600;' : ''}">${escapeHtml(value)}</td></tr>`).join('')}
        </table>`;
}

// The guest's receipt, to the payer's email. Never throws.
export async function sendOfferReceiptEmail(env: Record<string, any>, d: OfferPaymentEmailDetails): Promise<boolean> {
  try {
    if (!env.RESEND_API_KEY || !d.payerEmail) return false;
    const money = (m: number) => formatOfferMoney(m, d.currency);
    const offerUrl = `${SITE}/offer/${d.offerId}`;
    const rows: [string, string][] = [
      ['Amount paid', money(d.amountMinor)],
      ['Payment', offerKindLabel(d.kind, d.depositPercent)],
      ['Vehicle', `${d.optionLabel} (${d.vehicle})`],
      ['Guide', offerGuideLabel(d.guideLanguage)],
      ['Date', d.dateLabel],
      ['Pickup', d.pickup],
      ['Trip total', money(d.totalMinor)],
      ...(d.kind === 'deposit' ? ([['Balance remaining', money(d.balanceMinor)]] as [string, string][]) : []),
    ];
    const intro = d.kind === 'deposit'
      ? `Thank you, we have received your booking amount for ${d.title}. The balance of ${money(d.balanceMinor)} can be paid on your offer page before the tour.`
      : `Thank you, we have received your payment for ${d.title}. Your tour is paid in full.`;
    const html = emailHtml('Payment received', `
        <p style="margin:0 0 16px;">Dear ${escapeHtml(d.payerName || 'guest')},</p>
        <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
        ${offerTable(rows)}
        <p style="margin:24px 0; text-align:center;"><a href="${offerUrl}" style="${EMAIL_BUTTON}">View your offer</a></p>
        <p style="${EMAIL_NOTE}">Questions? WhatsApp <a href="${OFFER_WHATSAPP_HREF}" style="color:#6d28d9;">${OFFER_WHATSAPP_DISPLAY}</a> or email <a href="mailto:${EMAIL}" style="color:#6d28d9;">${EMAIL}</a>.</p>`);
    const text = [
      'Payment received',
      '',
      `Dear ${d.payerName || 'guest'},`,
      '',
      intro,
      '',
      ...rows.map(([l, v]) => `${l}: ${v}`),
      '',
      `Your offer: ${offerUrl}`,
      '',
      `Questions? WhatsApp ${OFFER_WHATSAPP_DISPLAY} or email ${EMAIL}`,
      '',
      `IWIS Global · ${SITE}`,
    ].join('\n');
    return await post(env, 'sendOfferReceiptEmail', { from: FROM(env), to: d.payerEmail, subject: `Payment received: ${d.title}`, html, text });
  } catch (err) {
    console.error('sendOfferReceiptEmail: failed', err instanceof Error ? err.message : 'error');
    return false;
  }
}

// "Payment received" to the business inbox. Carries the payer's details: this
// is the business notification. True when Resend accepted it. Never throws.
export async function sendOfferAdminEmail(env: Record<string, any>, d: OfferPaymentEmailDetails & { customerName: string }): Promise<boolean> {
  try {
    if (!env.RESEND_API_KEY) return false;
    const to = env.ADMIN_NOTIFICATION_EMAIL || EMAIL;
    const money = (m: number) => formatOfferMoney(m, d.currency);
    const rows: [string, string][] = [
      ['Offer', d.offerId],
      ['Customer', d.customerName],
      ['Payer', d.payerName || '(not given)'],
      ['Email', d.payerEmail || '(not given)'],
      ['Phone', d.payerPhone || '(not given)'],
      ['Payment', offerKindLabel(d.kind, d.depositPercent)],
      ['Amount paid', `${money(d.amountMinor)} (${d.currency})`],
      ['Option', `${d.optionLabel} (${d.vehicle})`],
      ['Guide', offerGuideLabel(d.guideLanguage)],
      ['Date', d.dateLabel],
      ['Trip total', money(d.totalMinor)],
      ['Balance remaining', money(d.balanceMinor)],
      ['Offer payment', d.offerPaymentId],
      ['Razorpay payment', d.paymentId],
    ];
    const html = emailHtml('Private offer: payment received', `${offerTable(rows)}
        <p style="margin:24px 0 0; text-align:center;"><a href="${SITE}/offer/${d.offerId}" style="${EMAIL_BUTTON}">Open the offer page</a></p>`);
    const text = ['Private offer: payment received', '', ...rows.map(([l, v]) => `${l}: ${v}`), '', `Offer page: ${SITE}/offer/${d.offerId}`].join('\n');
    return await post(env, 'sendOfferAdminEmail', { from: FROM(env), to, subject: `Offer payment received: ${d.customerName}, ${money(d.amountMinor)} ${offerKindLabel(d.kind, d.depositPercent)}`, html, text });
  } catch (err) {
    console.error('sendOfferAdminEmail: failed', err instanceof Error ? err.message : 'error');
    return false;
  }
}
