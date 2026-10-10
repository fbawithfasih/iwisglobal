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
  addOnNames?: string[]; // the add-ons chosen (entryTickets.ts chosenAddOnNames)
}

// The deposit terms, worded once for the email and the confirmation page.
export function depositTermsNote(balanceLabel: string): string {
  return `You've paid a 25% deposit to secure this booking; the remaining ${balanceLabel} is due on pickup. If you cancel less than 24 hours before your tour, 50% of the deposit is refunded.`;
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
    ...(details.addOnNames?.length ? ([['Add-ons', details.addOnNames.join(', ')]] as [string, string, string?][]) : []),
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
  const depositNote = isDeposit ? depositTermsNote(formatAmount(balanceDue, details.currency)) : '';
  const cancelNote = 'Free cancellation up to 24 hours before your tour starts (50% refund after that; no refund for no-shows).';
  const html = emailHtml('Booking confirmed', `
        <p style="margin-top:0;">Hi ${name},</p>
        <p>Your booking with IWIS Global is confirmed. Here are the details:</p>
        <table style="width:100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; background:#faf9ff; border:1px solid #ede9fe; border-radius:12px;">
          ${rows
            .map(
              ([label, value, style]) =>
                `<tr><td style="${cell} color:#78716c; padding-left:14px; padding-right:12px;">${escapeHtml(label)}</td><td style="${cell} text-align:right; padding-right:14px; ${style ?? ''}">${escapeHtml(value)}</td></tr>`
            )
            .join('')}
        </table>
        ${viewUrl ? `<p style="margin:24px 0; text-align:center;"><a href="${viewUrl}" style="${EMAIL_BUTTON}">View your booking</a></p>` : ''}
        ${depositNote ? `<p style="${EMAIL_NOTE}">${depositNote}</p>` : ''}
        <p style="${EMAIL_NOTE}">${cancelNote}</p>
        <p style="margin-bottom:8px;">Questions? Just reply to this email, or:</p>
        <p style="margin-top:0; line-height:2;">
          <a href="${waUrl}" style="color:#15803d; font-weight:600;">WhatsApp us</a><br />
          <a href="${PHONE_TEL}" style="color:#6d28d9;">Call ${PHONE_DISPLAY}</a><br />
          <a href="mailto:${EMAIL}" style="color:#6d28d9;">${EMAIL}</a>
        </p>`);

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
  const html = emailHtml('Your monument entry tickets', `
        <p style="margin-top:0;">Hi ${name},</p>
        <p>We've booked the monument entry tickets for your <strong>${escapeHtml(details.tourTitle)}</strong> on <strong>${escapeHtml(date)}</strong>. They're attached to this email.</p>
        ${
          ticketLines.length
            ? `<div style="background:#faf9ff; border:1px solid #ede9fe; border-radius:12px; padding:12px 16px; margin:16px 0;"><p style="margin:0 0 4px; font-size:12px; letter-spacing:1px; text-transform:uppercase; color:#7c3aed;">Attached</p><ul style="margin:0; padding-left:20px;">${ticketLines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul></div>`
            : ''
        }
        <p style="${EMAIL_NOTE}">Please keep this email handy on the day of your tour.</p>
        <p style="color:#78716c; font-size:13px;">Booking ID: ${escapeHtml(details.bookingId)}</p>
        <p style="margin-bottom:8px;">Questions? Just reply to this email, or:</p>
        <p style="margin-top:0; line-height:2;">
          <a href="${waUrl}" style="color:#15803d; font-weight:600;">WhatsApp us</a><br />
          <a href="${PHONE_TEL}" style="color:#6d28d9;">Call ${PHONE_DISPLAY}</a><br />
          <a href="mailto:${EMAIL}" style="color:#6d28d9;">${EMAIL}</a>
        </p>`);
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

export interface ReviewRequestEmailDetails {
  to: string;
  travelerName: string;
  tourTitle: string;
  travelDate: string;
  // /review?t=<token> (src/lib/reviews.ts); each star adds &rating=N.
  reviewUrl: string;
  googleReviewUrl: string;
}

// "How was your tour?" — sent from the admin booking or Reviews page after
// the trip. Returns whether it was sent, like sendEntryTicketEmail.
export async function sendReviewRequestEmail(env: Record<string, any>, details: ReviewRequestEmailDetails): Promise<boolean> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !details.to) return false;

  const from = env.BOOKING_EMAIL_FROM || 'IWIS Global <info@iwisglobal.com>';
  const first = details.travelerName.trim().split(/\s+/)[0] || 'there';
  const firstName = first.charAt(0).toUpperCase() + first.slice(1);
  const name = escapeHtml(firstName);
  const date = displayDate(details.travelDate);
  const starUrl = (n: number) => `${details.reviewUrl}&rating=${n}`;
  // Five big tappable stars; each opens the review page with that rating picked.
  const stars = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        `<td style="padding:0 2px;"><a href="${starUrl(n)}" title="${n} star${n > 1 ? 's' : ''}" style="display:block; width:48px; line-height:48px; text-align:center; font-size:34px; color:#f59e0b; text-decoration:none;">&#9733;</a></td>`
    )
    .join('');

  const html = emailHtml('How was your tour?', `
        <p style="margin-top:0;">Hi ${name},</p>
        <p>Thank you for touring with IWIS Global. How was your <strong>${escapeHtml(details.tourTitle)}</strong> on <strong>${escapeHtml(date)}</strong>? Your rating helps other travelers, and helps us get better.</p>
        <div style="background:#faf9ff; border:1px solid #ede9fe; border-radius:12px; padding:14px 8px 8px; margin:16px 0; text-align:center;">
          <p style="margin:0 0 4px; color:#6d28d9; font-size:14px; font-weight:600;">Tap a star to rate your tour</p>
          <table role="presentation" style="border-collapse:collapse; margin:0 auto;"><tr>${stars}</tr></table>
        </div>
        <p style="margin:24px 0; text-align:center;"><a href="${details.reviewUrl}" style="${EMAIL_BUTTON}">Rate your tour</a></p>
        <p>You can also review us on Google: <a href="${details.googleReviewUrl}" style="color:#6d28d9;">leave a Google review</a>.</p>
        <p style="margin-bottom:8px;">Something not right? Just reply to this email, or:</p>
        <p style="margin-top:0; line-height:2;">
          <a href="${whatsappHref('Hi! About my recent tour. (ref: EMAIL-REVIEW)')}" style="color:#15803d; font-weight:600;">WhatsApp us</a><br />
          <a href="${PHONE_TEL}" style="color:#6d28d9;">Call ${PHONE_DISPLAY}</a>
        </p>`);
  const text = [
    `How was your tour?`,
    ``,
    `Hi ${firstName},`,
    `Thank you for touring with IWIS Global. How was your ${details.tourTitle} on ${date}? Your rating helps other travelers, and helps us get better.`,
    ``,
    `Rate your tour: ${details.reviewUrl}`,
    `Or review us on Google: ${details.googleReviewUrl}`,
    ``,
    `Something not right? Reply to this email, WhatsApp us or call ${PHONE_DISPLAY}.`,
    ``,
    `IWIS Global · ${SITE}`,
  ].join('\n');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: details.to, subject: `How was your tour? — ${details.tourTitle}`, html, text }),
    });
    if (!res.ok) {
      console.error('sendReviewRequestEmail: Resend API error', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('sendReviewRequestEmail: request failed', err);
    return false;
  }
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

export interface PasswordResetEmailDetails {
  to: string;
  name: string;
  link: string; // /reset-password?t=… (src/lib/passwordReset.ts), valid one hour
}

// "Forgot password" link for an email/password account.
export async function sendPasswordResetEmail(env: Record<string, any>, details: PasswordResetEmailDetails): Promise<boolean> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !details.to) return false;

  const from = env.BOOKING_EMAIL_FROM || 'IWIS Global <info@iwisglobal.com>';
  const first = details.name.trim().split(/\s+/)[0] || 'there';
  const html = emailHtml('Reset your password', `
        <p style="margin-top:0;">Hi ${escapeHtml(first)},</p>
        <p>Someone (hopefully you) asked to reset the password for your IWIS Global account. Tap the button to choose a new one.</p>
        <p style="margin:24px 0; text-align:center;"><a href="${details.link}" style="${EMAIL_BUTTON}">Choose a new password</a></p>
        <p style="${EMAIL_NOTE}">The link works once, within the next hour. If you didn't ask for this, you can ignore this email; your password stays the same.</p>`);
  const text = [
    `Reset your password`,
    ``,
    `Hi ${first},`,
    `Someone (hopefully you) asked to reset the password for your IWIS Global account. Open this link to choose a new one. It works once, within the next hour:`,
    details.link,
    ``,
    `If you didn't ask for this, you can ignore this email; your password stays the same.`,
    ``,
    `IWIS Global · ${SITE}`,
  ].join('\n');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: details.to, subject: 'Reset your IWIS Global password', html, text }),
    });
    if (!res.ok) {
      console.error('sendPasswordResetEmail: Resend API error', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('sendPasswordResetEmail: request failed', err);
    return false;
  }
}

// Security alert after a password reset, so the owner hears about it if it
// wasn't them. Deliberately carries no link to act on.
export async function sendPasswordChangedEmail(env: Record<string, any>, details: { to: string; name: string }): Promise<boolean> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !details.to) return false;

  const from = env.BOOKING_EMAIL_FROM || 'IWIS Global <info@iwisglobal.com>';
  const first = details.name.trim().split(/\s+/)[0] || 'there';
  const html = emailHtml('Your password was changed', `
        <p style="margin-top:0;">Hi ${escapeHtml(first)},</p>
        <p>The password for your IWIS Global account was just changed using a reset link.</p>
        <p>If this was you, there's nothing else to do.</p>
        <p style="background:#fef2f2; border:1px solid #fecaca; border-radius:10px; padding:12px 14px; color:#7f1d1d;"><strong>If it wasn't you</strong>, reply to this email or <a href="${whatsappHref('Hi! My IWIS Global password was changed and it was not me. (ref: EMAIL-PASSWORD-CHANGED)')}" style="color:#15803d; font-weight:600;">WhatsApp us</a> straight away.</p>`);
  const text = [
    `Your password was changed`,
    ``,
    `Hi ${first},`,
    `The password for your IWIS Global account was just changed using a reset link.`,
    `If this was you, there's nothing else to do.`,
    `If it wasn't you, reply to this email or WhatsApp us on ${PHONE_DISPLAY} straight away.`,
    ``,
    `IWIS Global · ${SITE}`,
  ].join('\n');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: details.to, subject: 'Your IWIS Global password was changed', html, text }),
    });
    if (!res.ok) {
      console.error('sendPasswordChangedEmail: Resend API error', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('sendPasswordChangedEmail: request failed', err);
    return false;
  }
}

// "Confirm your email" for a new email/password account, so bookings made
// with this email (before or after signing up) can show in My Bookings.
export async function sendEmailVerificationEmail(env: Record<string, any>, details: { to: string; name: string; link: string }): Promise<boolean> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !details.to) return false;

  const from = env.BOOKING_EMAIL_FROM || 'IWIS Global <info@iwisglobal.com>';
  const first = details.name.trim().split(/\s+/)[0] || 'there';
  const html = emailHtml('Confirm your email', `
        <p style="margin-top:0;">Hi ${escapeHtml(first)},</p>
        <p>Thanks for creating an IWIS Global account. Confirm this is your email and any tour you've booked with it, before or after signing up, will show in My Bookings.</p>
        <p style="margin:24px 0; text-align:center;"><a href="${details.link}" style="${EMAIL_BUTTON}">Confirm my email</a></p>
        <p style="${EMAIL_NOTE}">The link works within the next 24 hours. If you didn't create an account, you can ignore this email.</p>`);
  const text = [
    `Confirm your email`,
    ``,
    `Hi ${first},`,
    `Thanks for creating an IWIS Global account. Confirm this is your email and any tour you've booked with it, before or after signing up, will show in My Bookings:`,
    details.link,
    ``,
    `The link works within the next 24 hours. If you didn't create an account, you can ignore this email.`,
    ``,
    `IWIS Global · ${SITE}`,
  ].join('\n');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: details.to, subject: 'Confirm your email — IWIS Global', html, text }),
    });
    if (!res.ok) {
      console.error('sendEmailVerificationEmail: Resend API error', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('sendEmailVerificationEmail: request failed', err);
    return false;
  }
}
