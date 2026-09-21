// Transactional email via Resend's HTTP API — a single fetch call, no SDK
// dependency, consistent with this app's Web-Crypto-only approach elsewhere
// (adminAuth.ts, customerAuth.ts). Booking confirmations only, matching the
// original intent documented in .env.example for BOOKING_EMAIL_API_KEY/FROM.
//
// Best-effort: by the time this runs, the booking is already paid/created,
// so a failed or unconfigured email must never surface as a booking
// failure. Every exported function here swallows its own errors and logs.

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
}

function formatAmount(amountPaid: number, currency: string): string {
  const major = (amountPaid / 100).toFixed(2);
  return currency === 'USD' ? `$${major}` : `₹${major}`;
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

  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1c1917;">
      <h2 style="color:#5b21b6; margin-bottom: 4px;">Booking confirmed</h2>
      <p>Hi ${name},</p>
      <p>Your booking with IWIS Global is confirmed. Here are the details:</p>
      <table style="width:100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr><td style="padding:6px 0; color:#78716c;">Tour</td><td style="padding:6px 0; text-align:right;">${escapeHtml(details.tourTitle)}</td></tr>
        <tr><td style="padding:6px 0; color:#78716c;">Date</td><td style="padding:6px 0; text-align:right;">${escapeHtml(details.travelDate)}</td></tr>
        <tr><td style="padding:6px 0; color:#78716c;">Travelers</td><td style="padding:6px 0; text-align:right;">${details.travelers}</td></tr>
        <tr><td style="padding:6px 0; color:#78716c;">${isDeposit ? 'Deposit paid' : 'Amount'}</td><td style="padding:6px 0; text-align:right;">${amount}</td></tr>
        ${
          isDeposit
            ? `<tr><td style="padding:6px 0; color:#78716c;">Balance due on pickup</td><td style="padding:6px 0; text-align:right; font-weight:600;">${formatAmount(balanceDue, details.currency)}</td></tr>`
            : ''
        }
        <tr><td style="padding:6px 0; color:#78716c;">Booking ID</td><td style="padding:6px 0; text-align:right;">${escapeHtml(details.bookingId)}</td></tr>
      </table>
      ${
        isDeposit
          ? `<p>You've paid a 25% deposit to secure this booking; the remaining ${formatAmount(balanceDue, details.currency)} is due on pickup. The deposit is non-refundable within 24 hours of your tour, since your vehicle and guide are already committed by then.</p>`
          : ''
      }
      <p>Free cancellation up to 24 hours before your tour starts. Questions? Just reply to this email or message us on WhatsApp.</p>
      <p style="color:#a8a29e; font-size:12px; margin-top:24px;">IWIS Global &middot; www.iwisglobal.com</p>
    </div>
  `;

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
      }),
    });
    if (!res.ok) {
      console.error('sendBookingConfirmationEmail: Resend API error', res.status, await res.text());
    }
  } catch (err) {
    console.error('sendBookingConfirmationEmail: request failed', err);
  }
}
