import { useState } from 'react';
import { CURRENCY_SYMBOLS, type Currency } from '../lib/currency';
import { pickPricingTier, computeDepositAmount, applyFoundingGuestDiscount, type PricingTier } from '../lib/catalog';

declare global {
  interface Window {
    Razorpay: any;
    dataLayer: any[];
  }
}

// Thin wrapper around GTM's dataLayer (backlog 2.8/2.9's "Key events" list
// — product-marketing-context.md §9). `purchase` is deliberately NOT pushed
// here: on a redirect-based payment flow the browser can navigate away
// before this would fire, which undercounts. That event is server-side
// only, via the Razorpay webhook (src/pages/api/webhooks/razorpay.ts).
function track(event: string, params: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event, ...params });
}

// GA4's client_id, read from the _ga cookie it sets once GTM's GA4 tag has
// loaded (format: GA1.1.<part1>.<part2> — the id itself is the last two
// segments). Passed to /api/create-order so the eventual webhook-fired
// purchase event can be attributed to this same GA4 user (backlog 2.8).
// Returns undefined if GA4 hasn't set the cookie yet — the webhook falls
// back to a fresh id in that case rather than failing.
function getGaClientId(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(/(?:^|;\s*)_ga=([^;]+)/);
  if (!match) return undefined;
  const parts = decodeURIComponent(match[1]).split('.');
  return parts.length >= 4 ? `${parts[2]}.${parts[3]}` : undefined;
}

interface AddOnOption {
  id: string;
  name: string;
  amount: number;
  includedByDefault?: boolean;
  perTraveler?: boolean;
}

interface BookingWidgetProps {
  tourId: string;
  tourTitle: string;
  pricePerTraveler: number; // flat per-traveler rate — used when pricingTiers is empty
  pricingTiers?: PricingTier[]; // backlog 0.2: price varies with group size when set
  currency: Currency;
  addOns: AddOnOption[];
  minDate: string;
  availabilityLabel?: string;
  // Backlog 1.1 — display only; the server independently decides real
  // eligibility at payment time from a fresh count. 0 or undefined hides
  // the banner and applies no discount to the estimate.
  foundingGuestSlotsLeft?: number;
}

export default function BookingWidget({
  tourId,
  tourTitle,
  pricePerTraveler,
  pricingTiers = [],
  currency,
  addOns,
  minDate,
  availabilityLabel,
  foundingGuestSlotsLeft = 0,
}: BookingWidgetProps) {
  const foundingGuestEligible = foundingGuestSlotsLeft > 0;
  const [date, setDate] = useState(minDate);
  const [travelers, setTravelers] = useState(2);
  // Add-ons marked includedByDefault (backlog 0.3, e.g. monument entry)
  // start checked — the customer opts OUT by unchecking, not in by checking.
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>(() =>
    addOns.filter((a) => a.includedByDefault).map((a) => a.id)
  );
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [paymentType, setPaymentType] = useState<'full' | 'deposit'>('full'); // backlog 0.4
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);

  // Same tier-matching logic computeTotal() uses server-side — this is a
  // display estimate only; the server independently recomputes it from its
  // own D1-sourced catalog, so this can't be tampered with to change price.
  const currentRate = pickPricingTier(pricingTiers, travelers)?.amount ?? pricePerTraveler;

  const addOnsTotal = selectedAddOns.reduce((sum, id) => {
    const addOn = addOns.find((a) => a.id === id);
    if (!addOn) return sum;
    return sum + (addOn.perTraveler ? addOn.amount * travelers : addOn.amount);
  }, 0);
  const rawTotal = currentRate * travelers + addOnsTotal;
  // Mirrors razorpay.ts's createOrder / verify-payment.ts exactly — the
  // discount applies to the full total (tour + add-ons), same rate.
  const total = applyFoundingGuestDiscount(rawTotal, foundingGuestEligible);
  const depositAmount = computeDepositAmount(total);
  const balanceDue = total - depositAmount;
  const amountDueNow = paymentType === 'deposit' ? depositAmount : total;

  const toggleAddOn = (id: string) => {
    setSelectedAddOns((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  };

  const loadRazorpayScript = (): Promise<boolean> =>
    new Promise((resolve) => {
      if (window.Razorpay) return resolve(true);
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });

  const handleBook = async () => {
    setError(null);

    if (!date) return setError('Please choose a travel date.');
    if (!name || !email || !phone) return setError('Please fill in your name, email, and phone.');

    track('checkout_started', { tour_id: tourId, tour_name: tourTitle, travelers, currency, value: total, payment_type: paymentType });

    setLoading(true);
    try {
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) throw new Error('Failed to load payment gateway. Check your connection.');

      // Only the tourId, date, traveler count, and add-on ids are sent — the
      // server is the source of truth for pricing (see src/lib/catalog.ts).
      const orderRes = await fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tourId,
          date,
          travelers,
          addOnIds: selectedAddOns,
          currency,
          receipt: `rcpt_${Date.now()}`,
          gaClientId: getGaClientId(),
          paymentType,
        }),
      });

      if (!orderRes.ok) {
        const { error: msg } = await orderRes.json();
        throw new Error(msg || 'Could not create booking');
      }

      const { orderId, amount, currency: orderCurrency, publicKey } = await orderRes.json();
      if (!publicKey) throw new Error('Payment gateway response was incomplete. Please contact support.');

      const options = {
        key: publicKey,
        amount,
        currency: orderCurrency,
        name: 'IWIS Global',
        description: tourTitle,
        order_id: orderId,
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) => {
          const verifyRes = await fetch('/api/verify-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...response,
              travelerName: name,
              travelerEmail: email,
              travelerPhone: phone,
            }),
          });

          if (!verifyRes.ok) {
            const { error: msg } = await verifyRes.json();
            setError(msg || 'Payment verification failed');
            return;
          }

          const { payment_id } = await verifyRes.json();
          setConfirmed(payment_id);
          window.location.href = `/booking/confirmation?payment_id=${payment_id}`;
        },
        modal: { ondismiss: () => setLoading(false) },
        prefill: { name, email, contact: phone },
        theme: { color: '#6d28d9' },
      };

      track('payment_initiated', { tour_id: tourId, tour_name: tourTitle, travelers, currency: orderCurrency, value: amount / 100 });

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', (resp: { error: { description: string } }) => {
        setError(resp.error.description || 'Payment failed');
        setLoading(false);
      });
      rzp.open();
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  if (confirmed) {
    return <p className="text-emerald-700 font-medium">Booking confirmed — payment {confirmed}.</p>;
  }

  return (
    <div className="rounded-xl border border-brand-100 bg-white p-6 shadow-sm space-y-4">
      {foundingGuestEligible && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">Founding Guest Offer:</span> 15% off — {foundingGuestSlotsLeft}{' '}
          {foundingGuestSlotsLeft === 1 ? 'spot' : 'spots'} left, no code needed.
        </div>
      )}
      <div>
        <label className="block text-sm font-medium mb-1">Travel date</label>
        <input
          type="date"
          value={date}
          min={minDate}
          onChange={(e) => {
            setDate(e.target.value);
            if (e.target.value) track('availability_checked', { tour_id: tourId, tour_name: tourTitle, date: e.target.value });
          }}
          className="w-full rounded border border-stone-300 px-3 py-2"
        />
        {availabilityLabel && <p className="text-xs text-accent-600 mt-1">{availabilityLabel}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Travelers</label>
        <input
          type="number"
          min={1}
          max={12}
          value={travelers}
          onChange={(e) => setTravelers(Math.max(1, Number(e.target.value)))}
          className="w-full rounded border border-stone-300 px-3 py-2"
        />
        {pricingTiers.length > 0 && (
          <p className="text-xs text-stone-500 mt-1">
            {CURRENCY_SYMBOLS[currency]}{currentRate.toLocaleString(currency === 'USD' ? 'en-US' : 'en-IN')}/person for {travelers} {travelers === 1 ? 'traveler' : 'travelers'}
          </p>
        )}
      </div>

      {addOns.length > 0 && (
        <div>
          <label className="block text-sm font-medium mb-1">Add-ons</label>
          {addOns.map((addOn) => (
            <label key={addOn.id} className="flex items-center gap-2 text-sm py-2">
              <input
                type="checkbox"
                checked={selectedAddOns.includes(addOn.id)}
                onChange={() => toggleAddOn(addOn.id)}
                className="h-4 w-4"
              />
              {addOn.includedByDefault ? (
                <span>
                  {addOn.name}{' '}
                  <span className="text-emerald-700">
                    (included{addOn.perTraveler ? ` — ${CURRENCY_SYMBOLS[currency]}${addOn.amount} × ${travelers} travelers` : ''} — uncheck to remove)
                  </span>
                </span>
              ) : (
                <span>
                  {addOn.name} (+{CURRENCY_SYMBOLS[currency]}{addOn.amount}{addOn.perTraveler ? ` × ${travelers}` : ''})
                </span>
              )}
            </label>
          ))}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-1">Payment</label>
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm border border-stone-300 rounded px-3 py-2 cursor-pointer has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
            <input type="radio" name="paymentType" checked={paymentType === 'full'} onChange={() => setPaymentType('full')} className="mt-0.5" />
            <span>
              Pay in full — {CURRENCY_SYMBOLS[currency]}{total.toLocaleString(currency === 'USD' ? 'en-US' : 'en-IN')}
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm border border-stone-300 rounded px-3 py-2 cursor-pointer has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
            <input type="radio" name="paymentType" checked={paymentType === 'deposit'} onChange={() => setPaymentType('deposit')} className="mt-0.5" />
            <span>
              Pay 25% deposit now — {CURRENCY_SYMBOLS[currency]}{depositAmount.toLocaleString(currency === 'USD' ? 'en-US' : 'en-IN')}, balance{' '}
              {CURRENCY_SYMBOLS[currency]}{balanceDue.toLocaleString(currency === 'USD' ? 'en-US' : 'en-IN')} due on pickup
            </span>
          </label>
        </div>
        {paymentType === 'deposit' && (
          <p className="text-xs text-stone-500 mt-1">
            The deposit is non-refundable within 24 hours of your tour, since your vehicle and guide are already committed by then.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div>
          <label htmlFor="traveler-name" className="block text-sm font-medium mb-1">Full name</label>
          <input
            id="traveler-name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-stone-300 px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="traveler-email" className="block text-sm font-medium mb-1">Email</label>
          <input
            id="traveler-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-stone-300 px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="traveler-phone" className="block text-sm font-medium mb-1">Phone (with country code)</label>
          <input
            id="traveler-phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded border border-stone-300 px-3 py-2"
          />
        </div>
      </div>

      <div className="text-lg font-semibold">
        {paymentType === 'deposit' ? 'Due now (deposit)' : 'Total'}: {CURRENCY_SYMBOLS[currency]}{amountDueNow.toLocaleString(currency === 'USD' ? 'en-US' : 'en-IN')}
        {paymentType === 'deposit' && (
          <span className="block text-sm font-normal text-stone-500">
            + {CURRENCY_SYMBOLS[currency]}{balanceDue.toLocaleString(currency === 'USD' ? 'en-US' : 'en-IN')} on pickup
          </span>
        )}
      </div>

      <button
        onClick={handleBook}
        disabled={loading}
        className="w-full rounded bg-brand-800 hover:bg-brand-900 text-white py-3 font-medium disabled:opacity-60 transition"
      >
        {loading ? 'Processing…' : 'Book & Pay'}
      </button>

      <div className="text-xs text-stone-500 space-y-0.5">
        <p>✓ Free cancellation up to 24 hours before your tour</p>
        <p>✓ Instant confirmation</p>
      </div>

      {error && (
        <p role="alert" aria-live="polite" className="text-red-600 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
