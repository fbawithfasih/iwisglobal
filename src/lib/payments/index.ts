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
