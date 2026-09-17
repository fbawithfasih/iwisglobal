// Provider-agnostic payment interface. Phase 1 ships razorpay.ts as the only
// implementation; a stripe.ts can be added later (e.g. for travelers paying
// in USD/EUR) without touching the booking API routes, which only talk to
// this interface.

export interface BookingRequest {
  tourId: string;
  date: string; // ISO date (YYYY-MM-DD)
  travelers: number;
  addOnIds: string[];
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
}

export interface PaymentProvider {
  createOrder(req: BookingRequest, env: Record<string, unknown>): Promise<OrderResult>;
  verifyPayment(req: VerifyRequest, env: Record<string, unknown>): Promise<VerifiedBooking>;
}
