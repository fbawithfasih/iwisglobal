import { useState, type FocusEvent } from 'react';
import { CURRENCY_SYMBOLS, type Currency } from '../lib/currency';
import { isFriday, FRIDAY_CLOSED_MESSAGE, todayIst } from '../lib/availability';
import { pickPricingTier, computeDepositAmount, type PricingTier } from '../lib/catalog';
import { bestDiscount, offerProblem, offerValueLabel, offerConditions, type Offer } from '../lib/offers';

// Same as MAX_TRAVELERS_PER_DATE in src/lib/db.ts (one vehicle per date);
// the server enforces it — this only keeps the stepper in range.
const MAX_TRAVELERS = 12;

type ContactField = 'name' | 'email' | 'phone';
// Checked before payment: a mistyped email means the confirmation and
// tickets never arrive; a phone without a country code can't be reached on
// WhatsApp.
function contactErrors(name: string, email: string, phone: string): Partial<Record<ContactField, string>> {
  const errors: Partial<Record<ContactField, string>> = {};
  if (name.trim().length < 2) errors.name = 'Please enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) errors.email = 'Please check your email address — we send your confirmation there.';
  const digits = phone.replace(/[\s().-]/g, '');
  if (!/^\+\d{8,15}$/.test(digits)) errors.phone = 'Include your country code, e.g. +44 7700 900123 or +91 98765 43210.';
  return errors;
}

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
  // Automatic offers live for this tour today (src/lib/offers.ts). Display
  // only, like the rest of the estimate — create-order decides the charge.
  offers?: Offer[];
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
  offers = [],
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
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ContactField, string>>>({});
  // After Razorpay closes on success, while verify-payment saves the booking.
  const [confirming, setConfirming] = useState(false);
  // Paid, but the booking couldn't be saved automatically: the payment id,
  // so the customer can quote it rather than pay again.
  const [paidUnconfirmed, setPaidUnconfirmed] = useState<string | null>(null);
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState<Offer | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);

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
  // Same choice razorpay.ts's createOrder makes: one discount, the biggest
  // of the Founding Guest Offer, automatic offers and the entered coupon,
  // on the full total (tour + add-ons).
  const bookingCtx = { tourId, travelDate: date, travelers, currency, today: todayIst() };
  const couponProblem = coupon ? offerProblem(coupon, bookingCtx) : null;
  const discount = bestDiscount(rawTotal, bookingCtx, coupon && !couponProblem ? [...offers, coupon] : offers, foundingGuestEligible);
  const total = rawTotal - (discount?.amount ?? 0);

  const applyCoupon = async () => {
    const code = couponInput.trim();
    if (!code) return;
    setCouponChecking(true);
    setCouponError(null);
    try {
      const res = await fetch('/api/check-coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, tourId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "That code isn't valid.");
      setCoupon(body.offer);
    } catch (err: any) {
      setCoupon(null);
      setCouponError(err.message);
    } finally {
      setCouponChecking(false);
    }
  };
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
    if (isFriday(date)) return setError(FRIDAY_CLOSED_MESSAGE);
    const errors = contactErrors(name, email, phone);
    setFieldErrors(errors);
    const firstBad = (['name', 'email', 'phone'] as ContactField[]).find((f) => errors[f]);
    if (firstBad) {
      const el = document.getElementById(`traveler-${firstBad}`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
      return;
    }

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
          // Only a code that fits this booking; the server re-checks it.
          couponCode: coupon && !couponProblem ? coupon.code : undefined,
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
        // Square logo for Razorpay's header (it shows a letter without one).
        // Always the live https URL: Razorpay's window won't load an http one.
        image: 'https://www.iwisglobal.com/logo-globe.png',
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) => {
          setConfirming(true);
          try {
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
            const body = await verifyRes.json().catch(() => ({}));
            if (verifyRes.status === 409) {
              // Date sold out while paying: the server has refunded (or says to
              // contact us) — its message explains which.
              setConfirming(false);
              setLoading(false);
              setError(body.error || 'This date just sold out. Please contact us.');
              return;
            }
            if (!verifyRes.ok) throw new Error(body.error || 'verify failed');
            setConfirmed(body.payment_id);
            window.location.href = `/booking/confirmation?payment_id=${body.payment_id}`;
          } catch {
            setConfirming(false);
            setLoading(false);
            setPaidUnconfirmed(response.razorpay_payment_id);
          }
        },
        modal: { ondismiss: () => setLoading(false) },
        // Razorpay drops a prefilled number that contains spaces or dashes.
        prefill: { name, email, contact: phone.replace(/[\s().-]/g, '') },
        theme: { color: '#6d28d9' },
      };

      track('payment_initiated', { tour_id: tourId, tour_name: tourTitle, travelers, currency: orderCurrency, value: amount / 100 });

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', (resp: { error: { description: string } }) => {
        setError(resp.error.description || 'Payment failed');
        setLoading(false);
      });
      // Stays "loading" (button locked) while the payment window is open;
      // ondismiss, payment.failed or the handler above release it.
      rzp.open();
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
      setLoading(false);
    }
  };

  if (confirmed) {
    return <p className="text-emerald-700 font-medium">Booking confirmed — payment {confirmed}.</p>;
  }

  const money = (n: number) => `${CURRENCY_SYMBOLS[currency]}${n.toLocaleString(currency === 'USD' ? 'en-US' : 'en-IN')}`;

  // Phones: the floating WhatsApp button sits over the right end of these
  // fields, so hide it while the keyboard is up (BaseLayout's
  // body.booking-typing rule) and bring it back when focus leaves the form.
  const TYPING_TYPES = ['text', 'email', 'tel', 'number', 'date'];
  const onFormFocus = (e: FocusEvent<HTMLDivElement>) => {
    const t = e.target as HTMLInputElement;
    document.body.classList.toggle('booking-typing', t.tagName === 'INPUT' && TYPING_TYPES.includes(t.type));
  };
  const onFormBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) document.body.classList.remove('booking-typing');
  };

  return (
    <div onFocus={onFormFocus} onBlur={onFormBlur} className="rounded-xl border border-brand-100 bg-white p-6 shadow-sm space-y-4">
      {foundingGuestEligible && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">Founding Guest Offer:</span> 15% off — {foundingGuestSlotsLeft}{' '}
          {foundingGuestSlotsLeft === 1 ? 'spot' : 'spots'} left, no code needed.
        </div>
      )}
      {offers.map((offer) => (
        <div key={offer.id} className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">{offer.name}:</span> {offerValueLabel(offer, currency)}
          {offerConditions(offer) && <> · {offerConditions(offer)}</>}. No code needed.
        </div>
      ))}
      <div>
        <label htmlFor="travel-date" className="block text-sm font-medium mb-1">Travel date</label>
        <input
          id="travel-date"
          type="date"
          value={date}
          min={minDate}
          onChange={(e) => {
            setDate(e.target.value);
            if (e.target.value) track('availability_checked', { tour_id: tourId, tour_name: tourTitle, date: e.target.value });
          }}
          className="w-full rounded border border-stone-300 px-3 py-2"
        />
        {/* A native date input can't grey out weekdays, so say it up front and
            flag a Friday pick straight away (the server rejects it too). */}
        {date && isFriday(date) ? (
          <p className="text-xs text-red-600 mt-1" role="alert">{FRIDAY_CLOSED_MESSAGE}</p>
        ) : (
          <p className="text-xs text-stone-500 mt-1">
            {availabilityLabel && <span className="text-accent-600">{availabilityLabel} · </span>}
            No tours on Fridays (Taj Mahal closed)
          </p>
        )}
      </div>

      <div>
        <p id="travelers-label" className="block text-sm font-medium mb-1">Travelers</p>
        {/* − / + instead of a number box: on phones, clearing the box to type
            a new number snapped it to 1, so "4" became "14". */}
        <div id="travelers" role="group" aria-labelledby="travelers-label" className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setTravelers((t) => Math.max(1, t - 1))}
            disabled={travelers <= 1}
            aria-label="One fewer traveler"
            className="h-11 w-11 rounded-full border border-stone-300 text-xl leading-none disabled:opacity-40"
          >
            −
          </button>
          <span aria-live="polite" className="min-w-8 text-center text-lg font-semibold">{travelers}</span>
          <button
            type="button"
            onClick={() => setTravelers((t) => Math.min(MAX_TRAVELERS, t + 1))}
            disabled={travelers >= MAX_TRAVELERS}
            aria-label="One more traveler"
            className="h-11 w-11 rounded-full border border-stone-300 text-xl leading-none disabled:opacity-40"
          >
            +
          </button>
          {travelers >= MAX_TRAVELERS && <span className="text-xs text-stone-500">Up to {MAX_TRAVELERS} per booking</span>}
        </div>
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
                    (included{addOn.perTraveler ? ` — ${CURRENCY_SYMBOLS[currency]}${addOn.amount.toLocaleString(currency === 'USD' ? 'en-US' : 'en-IN')} × ${travelers} travelers` : ''} — uncheck to remove)
                  </span>
                </span>
              ) : (
                <span>
                  {addOn.name}{' '}
                  {addOn.amount === 0
                    ? '(free)'
                    : `(+${CURRENCY_SYMBOLS[currency]}${addOn.amount.toLocaleString(currency === 'USD' ? 'en-US' : 'en-IN')}${addOn.perTraveler ? ` × ${travelers}` : ''})`}
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
            If you cancel less than 24 hours before your tour, 50% of the deposit is refunded, since your vehicle and guide are already committed by then.
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
            placeholder="e.g. Priya Sharma"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (fieldErrors.name) setFieldErrors((f) => ({ ...f, name: undefined }));
            }}
            aria-invalid={!!fieldErrors.name}
            aria-describedby={fieldErrors.name ? 'traveler-name-error' : undefined}
            className={`w-full rounded border px-3 py-2 ${fieldErrors.name ? 'border-red-500' : 'border-stone-300'}`}
          />
          {fieldErrors.name && <p id="traveler-name-error" className="text-xs text-red-600 mt-1">{fieldErrors.name}</p>}
        </div>
        <div>
          <label htmlFor="traveler-email" className="block text-sm font-medium mb-1">Email</label>
          <input
            id="traveler-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
            }}
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? 'traveler-email-error' : undefined}
            className={`w-full rounded border px-3 py-2 ${fieldErrors.email ? 'border-red-500' : 'border-stone-300'}`}
          />
          {fieldErrors.email && <p id="traveler-email-error" className="text-xs text-red-600 mt-1">{fieldErrors.email}</p>}
        </div>
        <div>
          <label htmlFor="traveler-phone" className="block text-sm font-medium mb-1">Phone (with country code)</label>
          <input
            id="traveler-phone"
            type="tel"
            autoComplete="tel"
            placeholder="+44 7700 900123"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              if (fieldErrors.phone) setFieldErrors((f) => ({ ...f, phone: undefined }));
            }}
            aria-invalid={!!fieldErrors.phone}
            aria-describedby={fieldErrors.phone ? 'traveler-phone-error' : undefined}
            className={`w-full rounded border px-3 py-2 ${fieldErrors.phone ? 'border-red-500' : 'border-stone-300'}`}
          />
          {fieldErrors.phone && <p id="traveler-phone-error" className="text-xs text-red-600 mt-1">{fieldErrors.phone}</p>}
        </div>
      </div>

      <div className="text-sm">
        {!couponOpen && !coupon ? (
          <button type="button" onClick={() => setCouponOpen(true)} className="min-h-11 text-brand-800 underline">
            Have a coupon code?
          </button>
        ) : (
          <div>
            <label htmlFor="coupon-code" className="block font-medium mb-1">Coupon code</label>
            <div className="flex gap-2">
              <input
                id="coupon-code"
                type="text"
                autoCapitalize="characters"
                autoComplete="off"
                value={couponInput}
                onChange={(e) => {
                  setCouponInput(e.target.value);
                  setCouponError(null);
                  // Editing the code undoes the applied one, so Apply comes back.
                  setCoupon(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyCoupon();
                  }
                }}
                className="min-w-0 flex-1 rounded border border-stone-300 px-3 py-2 text-base uppercase"
              />
              {coupon ? (
                <button
                  type="button"
                  onClick={() => {
                    setCoupon(null);
                    setCouponInput('');
                  }}
                  className="min-h-11 rounded border border-stone-300 px-4"
                >
                  Remove
                </button>
              ) : (
                <button
                  type="button"
                  onClick={applyCoupon}
                  disabled={couponChecking || !couponInput.trim()}
                  className="min-h-11 rounded bg-stone-900 px-4 text-white disabled:opacity-50"
                >
                  {couponChecking ? 'Checking…' : 'Apply'}
                </button>
              )}
            </div>
            <p role="status" aria-live="polite" className="mt-1 text-xs">
              {couponError && <span className="text-red-600">{couponError}</span>}
              {coupon && couponProblem && <span className="text-red-600">{couponProblem}</span>}
              {coupon && !couponProblem && discount?.offerId === coupon.id && (
                <span className="text-emerald-700">✓ {coupon.name} applied: −{money(discount.amount)}</span>
              )}
              {coupon && !couponProblem && discount && discount.offerId !== coupon.id && (
                <span className="text-stone-600">Your {discount.label} already gives a bigger discount, so this code isn't needed.</span>
              )}
            </p>
          </div>
        )}
      </div>

      <div className="text-lg font-semibold">
        {paymentType === 'deposit' ? 'Due now (deposit)' : 'Total'}: {CURRENCY_SYMBOLS[currency]}{amountDueNow.toLocaleString(currency === 'USD' ? 'en-US' : 'en-IN')}
        {paymentType === 'deposit' && (
          <span className="block text-sm font-normal text-stone-500">
            + {CURRENCY_SYMBOLS[currency]}{balanceDue.toLocaleString(currency === 'USD' ? 'en-US' : 'en-IN')} on pickup
          </span>
        )}
        {discount && (
          <>
            <span className="block text-sm font-normal text-stone-500">
              <s>{money(rawTotal)}</s>
              {paymentType === 'deposit' && <> {money(total)} tour total</>}
            </span>
            <span className="block text-sm font-normal text-amber-700">
              {discount.label} <span className="whitespace-nowrap">−{money(discount.amount)}</span>
            </span>
          </>
        )}
      </div>

      <button
        onClick={handleBook}
        disabled={loading || confirming || !!paidUnconfirmed}
        className="w-full rounded-full bg-brand-800 hover:bg-brand-900 text-white py-3 font-medium disabled:opacity-60 transition"
      >
        {confirming ? 'Confirming your payment…' : loading ? 'Processing…' : 'Book & Pay'}
      </button>

      <p className="text-xs text-stone-500">
        By booking you agree to our <a href="/terms" className="text-brand-800 underline">Terms</a> and{' '}
        <a href="/cancellation-refund-policy" className="text-brand-800 underline">Cancellation &amp; Refund Policy</a>.
      </p>

      <div className="text-xs text-stone-500 space-y-0.5">
        <p>✓ Free cancellation up to 24 hours before your tour</p>
        <p>✓ Instant confirmation</p>
      </div>

      {confirming && (
        <p role="status" aria-live="polite" className="rounded-lg bg-brand-50 border border-brand-100 px-3 py-2 text-sm text-brand-900">
          Payment received — confirming your booking. Please don't close this page.
        </p>
      )}

      {paidUnconfirmed && (
        <div role="alert" className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-3 text-sm text-amber-900 space-y-2">
          <p>
            Your payment went through (reference <span className="font-mono break-all">{paidUnconfirmed}</span>), but we
            couldn't finish your booking automatically. Please WhatsApp us with this reference — you won't be charged twice.
          </p>
          <a
            href={`https://wa.me/916399226633?text=${encodeURIComponent(`Hi! I paid for the ${tourTitle} on ${date} but my booking didn't confirm. Payment reference: ${paidUnconfirmed} (ref: PAY-UNCONFIRMED)`)}`}
            target="_blank"
            rel="noopener noreferrer"
            data-wa-ref="PAY-UNCONFIRMED"
            className="inline-flex min-h-11 items-center rounded-full bg-[#25D366] px-5 font-semibold text-white"
          >
            WhatsApp us
          </a>
        </div>
      )}

      {error && (
        <p role="alert" aria-live="polite" className="text-red-600 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
