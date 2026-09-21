// Provider-agnostic payment interface. Phase 1 ships razorpay.ts as the only
// implementation; a stripe.ts can be added later (e.g. for travelers paying
// in USD/EUR) without touching the booking API routes, which only talk to
// this interface.

export interface BookingRequest {
  tourId: string;
  date: string; // ISO date (YYYY-MM-DD)
  travelers: number;
  addOnIds: string[];
  currency?: 'INR' | 'USD';
  receipt?: string;
  // GA4 client_id (from the browser's _ga cookie), carried in the order's
  // notes so the Razorpay webhook — which runs server-to-server with no
  // access to the browser — can attribute the eventual purchase event to
  // the same GA4 user/session (backlog 2.8). Optional: absent if GA4
  // hasn't loaded yet, or for a return visitor without the cookie.
  gaClientId?: string;
  // Backlog 0.4 — pay the full amount now, or a 25% deposit with the
  // balance due on pickup. Defaults to 'full' when omitted.
  paymentType?: 'full' | 'deposit';
}

export interface OrderResult {
  orderId: string;
  amount: number; // smallest currency subunit (e.g. paise)
  currency: string;
  publicKey: string; // key the client uses to open the checkout widget
}

export interface VerifyRequest {
  orderId: string;
  paymentId: string;
  signature: string;
}

export interface VerifiedBooking {
  paymentId: string;
  orderId: string;
  tourId: string;
  date: string;
  travelers: number;
  addOnIds: string[];
  currency: 'INR' | 'USD';
  totalAmount: number; // smallest currency subunit — the full tour price, regardless of what was actually charged
  paymentType: 'full' | 'deposit';
}

export interface PaymentProvider {
  createOrder(req: BookingRequest, env: Record<string, unknown>): Promise<OrderResult>;
  verifyPayment(req: VerifyRequest, env: Record<string, unknown>): Promise<VerifiedBooking>;
  // Full refund for a payment that was captured but couldn't be honored
  // (e.g. the date sold out to a concurrent booking between payment and
  // capacity check). Throws on failure — callers must surface that to
  // support rather than silently losing track of the refund.
  refundPayment(paymentId: string, env: Record<string, unknown>): Promise<void>;
}
