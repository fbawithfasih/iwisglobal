import { useRef, useState } from 'react';
import PhoneInput from './PhoneInput';
import { validateContact } from '../lib/customTrip';
import { depositMinor, tripTotalMinor } from '../lib/offerPricing';
import type { GuideLanguage, OfferState, OfferTerms } from '../lib/offerPricing';

// The payment part of a private offer page (src/pages/offer/[id].astro): the
// option, guide language and payment choice, the contact details and the
// Razorpay checkout. The amounts shown here come from the same pure functions
// as the server (src/lib/offerPricing.ts) but are for DISPLAY only: the order
// endpoint recomputes and charges its own figure from the stored terms.

interface Props {
  offerId: string;
  title: string;
  terms: OfferTerms;
  state: OfferState;
  // The WhatsApp number, digits only, for the "message us" help text.
  whatsapp: string;
  prefill: { name: string; email: string; phone: string };
}

declare global {
  interface Window {
    Razorpay: any;
  }
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

const fieldClass =
  'min-h-11 w-full rounded-xl border border-brand-200 bg-white px-3 text-base text-stone-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';
const primaryButton =
  'min-h-11 w-full rounded-full bg-brand-700 px-6 text-base font-semibold text-white transition hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60 sm:w-auto';

const NAME_ERROR = 'Please enter your full name.';
const EMAIL_ERROR = 'Please enter a valid email address.';
const PHONE_ERROR = 'Please enter your phone number with the country code, for example +44 7700 900123.';

export default function OfferCheckout({ offerId, title, terms, state, whatsapp, prefill }: Props) {
  const [optionId, setOptionId] = useState(terms.options[0]?.id ?? '');
  const [lang, setLang] = useState<GuideLanguage>('en');
  const [mode, setMode] = useState<'full' | 'deposit'>('full');
  const [name, setName] = useState(prefill.name);
  const [email, setEmail] = useState(prefill.email);
  const [phone, setPhone] = useState(prefill.phone);
  const [paying, setPaying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [contactTried, setContactTried] = useState(false);
  // Set when Razorpay took the payment but we could not confirm it on screen.
  const [unconfirmed, setUnconfirmed] = useState('');
  const confirmingRef = useRef(false);

  const fmt = (minor: number) => {
    const f = new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency: terms.currency,
      minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    });
    return f.format(minor / 100);
  };

  const extra = terms.germanGuideExtraMinor;
  const total = tripTotalMinor(terms, optionId, lang) ?? 0;
  const deposit = depositMinor(total, terms.depositPercent);
  const balance = total - deposit;
  const paidOption = terms.options.find((o) => o.id === state.optionId);

  const contactErrs = validateContact({ name, email, phone });
  const contactMessage = { name: NAME_ERROR, email: EMAIL_ERROR, phone: PHONE_ERROR } as const;
  const whatsappHref = `https://wa.me/${whatsapp}`;

  const idle = !paying && !unconfirmed;
  const amountToPay = state.status === 'deposit_paid' ? state.balanceMinor : mode === 'full' ? total : deposit;

  function focusField(field: 'name' | 'email' | 'phone') {
    const el = document.getElementById(`offer-${field}`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.focus({ preventScroll: true });
  }

  async function pay() {
    if (paying || unconfirmed) return;
    setPayError(null);
    setContactTried(true);
    const bad = (['name', 'email', 'phone'] as const).find((f) => contactErrs[f]);
    if (bad) {
      focusField(bad);
      return;
    }
    setPaying(true);
    try {
      if (!(await loadRazorpayScript())) throw new Error('gateway');
      const balanceMode = state.status === 'deposit_paid';
      const res = await fetch('/api/offer/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          balanceMode
            ? { offerId, mode: 'balance', contact: { name, email, phone } }
            : { offerId, mode, optionId, guideLanguage: lang, contact: { name, email, phone } },
        ),
      });
      const order = await res.json().catch(() => ({}));
      if (!res.ok || !order.orderId || !order.publicKey) {
        if (res.status === 404) throw new Error('This offer is no longer available. Please message us on WhatsApp.');
        if (res.status === 400 && order.error === 'bad_contact') {
          setContactTried(true);
          const field = (['name', 'email', 'phone'] as const).find((f) => order.fields?.[f]);
          if (field) focusField(field);
          throw new Error('Please check your contact details.');
        }
        if (res.status === 409) {
          throw new Error(
            order.error === 'already_paid'
              ? 'This offer has already been paid.'
              : 'Something is not right with this selection. Please refresh the page and try again.',
          );
        }
        throw new Error('gateway');
      }
      const rzp = new window.Razorpay({
        key: order.publicKey,
        amount: order.amount,
        currency: order.currency,
        name: 'IWIS Global',
        description: title,
        order_id: order.orderId,
        image: 'https://www.iwisglobal.com/logo-globe.png',
        handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          confirmingRef.current = true;
          setPaying(true);
          setConfirming(true);
          setPayError(null);
          try {
            const verify = await fetch('/api/offer/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });
            const done = await verify.json().catch(() => ({}));
            if (!verify.ok || !done.success) throw new Error('verify');
            // The server is the source of truth for what has been paid.
            window.location.reload();
          } catch {
            confirmingRef.current = false;
            setConfirming(false);
            setPaying(false);
            setUnconfirmed(response.razorpay_payment_id);
          }
        },
        modal: { ondismiss: () => { if (!confirmingRef.current) setPaying(false); } },
        // Razorpay drops a prefilled number that contains spaces or dashes.
        prefill: { name, email, contact: phone.replace(/[\s().-]/g, '') },
        theme: { color: '#6d28d9' },
      });
      rzp.on('payment.failed', () => {
        setPayError('The payment did not go through. You have not been charged.');
        setPaying(false);
      });
      rzp.open();
    } catch (err: any) {
      const msg = err?.message;
      setPayError(!msg || msg === 'gateway' ? 'We could not start the payment. Please try again, or message us on WhatsApp.' : msg);
      setPaying(false);
    }
  }

  if (state.status === 'paid_in_full') {
    return (
      <section aria-labelledby="offer-paid-title" className="no-print rounded-3xl border border-emerald-200 bg-emerald-50 p-4 min-[300px]:p-6" role="status">
        <h2 id="offer-paid-title" className="font-serif text-xl font-semibold text-emerald-900 md:text-2xl">Payment received in full. Thank you!</h2>
        <p className="mt-2 text-sm text-emerald-900">
          Your tour is confirmed{paidOption ? ` (${paidOption.label}${state.guideLanguage === 'de' ? ', German-speaking guide' : ', English-speaking guide'})` : ''}. We will be in touch with your pickup details. If you have any questions,{' '}
          <a href={whatsappHref} className="font-semibold underline">message us on WhatsApp</a>.
        </p>
      </section>
    );
  }

  const contactBlock = (
    <>
      <h2 className="font-serif text-xl font-semibold text-brand-900 md:text-2xl">Your details</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="offer-name" className="mb-1 block text-sm font-medium text-stone-800">Full name</label>
          <input id="offer-name" className={fieldClass} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)}
            aria-invalid={contactTried && !!contactErrs.name} aria-describedby={contactTried && contactErrs.name ? 'offer-name-error' : undefined} />
          {contactTried && contactErrs.name && <p id="offer-name-error" className="mt-1 text-sm text-red-700">{contactMessage.name}</p>}
        </div>
        <div>
          <label htmlFor="offer-email" className="mb-1 block text-sm font-medium text-stone-800">Email</label>
          <input id="offer-email" type="email" className={fieldClass} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
            aria-invalid={contactTried && !!contactErrs.email} aria-describedby={contactTried && contactErrs.email ? 'offer-email-error' : undefined} />
          {contactTried && contactErrs.email && <p id="offer-email-error" className="mt-1 text-sm text-red-700">{contactMessage.email}</p>}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="offer-phone" className="mb-1 block text-sm font-medium text-stone-800">Phone (with country code)</label>
          <PhoneInput id="offer-phone" value={phone} defaultValue={prefill.phone || undefined} onChange={setPhone} invalid={contactTried && !!contactErrs.phone} describedBy={contactTried && contactErrs.phone ? 'offer-phone-error' : undefined} />
          {contactTried && contactErrs.phone && <p id="offer-phone-error" className="mt-1 text-sm text-red-700">{contactMessage.phone}</p>}
        </div>
      </div>
    </>
  );

  const payArea = (label: string) => (
    <div className="mt-5">
      {payError && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{payError}</p>}
      {unconfirmed && (
        <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="alert">
          Your payment went through, but we could not confirm it on screen. Please message us on{' '}
          <a href={whatsappHref} className="font-semibold underline">WhatsApp</a> with this number: <strong className="break-all">{unconfirmed}</strong> and we will confirm it for you.
        </p>
      )}
      <button type="button" onClick={pay} disabled={!idle} className={primaryButton}>
        {confirming ? 'Confirming your payment...' : paying ? 'Opening secure payment...' : label}
      </button>
      <p className="mt-2 text-xs text-stone-600">Secure payment by Razorpay. By paying you agree to our <a href="/cancellation-refund-policy" className="font-semibold text-brand-700 underline">cancellation and refund policy</a>.</p>
    </div>
  );

  if (state.status === 'deposit_paid') {
    return (
      <section aria-labelledby="offer-deposit-title" className="no-print rounded-3xl border border-brand-100 bg-white p-4 shadow-sm shadow-brand-900/5 min-[300px]:p-6">
        <div className="rounded-2xl bg-emerald-50 p-4 text-emerald-900" role="status">
          <h2 id="offer-deposit-title" className="font-serif text-xl font-semibold md:text-2xl">Booking amount received: {fmt(state.paidMinor)}</h2>
          <p className="mt-2 text-sm">
            Your choice: {paidOption?.label ?? 'your tour'}{paidOption ? ` (${paidOption.vehicle})` : ''}, with {state.guideLanguage === 'de' ? 'a German-speaking guide' : 'an English-speaking guide'}
            {state.totalMinor ? `. Trip total ${fmt(state.totalMinor)}.` : '.'}
          </p>
        </div>
        <div className="mt-6">{contactBlock}</div>
        {payArea(`Pay the balance - ${fmt(state.balanceMinor)}`)}
      </section>
    );
  }

  return (
    <section aria-label="Choose your option and pay" className="no-print grid gap-8 rounded-3xl border border-brand-100 bg-white p-4 shadow-sm shadow-brand-900/5 min-[300px]:p-6">
      <div>
        <h2 id="offer-options-title" className="font-serif text-xl font-semibold text-brand-900 md:text-2xl">Choose your option</h2>
        <div role="radiogroup" aria-labelledby="offer-options-title" className="mt-3 grid gap-3 md:grid-cols-2">
          {terms.options.map((o) => {
            const selected = o.id === optionId;
            return (
              <label key={o.id} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border p-3 ${selected ? 'border-2 border-brand-500 bg-brand-50/60' : 'border-brand-100'}`}>
                <input type="radio" name="offer-option" value={o.id} checked={selected} aria-checked={selected} onChange={() => setOptionId(o.id)} className="mt-1 h-5 w-5 shrink-0 accent-brand-700" />
                <span className="min-w-0">
                  <span className="block font-semibold text-brand-900 [overflow-wrap:anywhere]">{o.label}</span>
                  <span className="block text-sm text-stone-700 [overflow-wrap:anywhere]">{o.vehicle}</span>
                  <span className="mt-1 block font-serif text-2xl font-semibold text-brand-900">{fmt(tripTotalMinor(terms, o.id, lang) ?? 0)}</span>
                  <span className="block text-xs text-stone-600">All-inclusive for your group</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <h2 id="offer-lang-title" className="font-serif text-xl font-semibold text-brand-900 md:text-2xl">Guide language</h2>
        <div role="radiogroup" aria-labelledby="offer-lang-title" className="mt-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-stone-800">
            <input type="radio" name="offer-lang" checked={lang === 'en'} aria-checked={lang === 'en'} onChange={() => setLang('en')} className="h-5 w-5 accent-brand-700" />
            English (no extra charge)
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-stone-800">
            <input type="radio" name="offer-lang" checked={lang === 'de'} aria-checked={lang === 'de'} onChange={() => setLang('de')} className="h-5 w-5 accent-brand-700" />
            {extra > 0 ? `German (+ ${fmt(extra)})` : 'German'}
          </label>
        </div>
      </div>

      <div>
        <h2 id="offer-mode-title" className="font-serif text-xl font-semibold text-brand-900 md:text-2xl">How would you like to pay?</h2>
        <div role="radiogroup" aria-labelledby="offer-mode-title" className="mt-2">
          <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1.5 text-sm text-stone-800">
            <input type="radio" name="offer-mode" checked={mode === 'full'} aria-checked={mode === 'full'} onChange={() => setMode('full')} className="mt-0.5 h-5 w-5 shrink-0 accent-brand-700" />
            <span>Pay in full - <strong>{fmt(total)}</strong></span>
          </label>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1.5 text-sm text-stone-800">
            <input type="radio" name="offer-mode" checked={mode === 'deposit'} aria-checked={mode === 'deposit'} onChange={() => setMode('deposit')} className="mt-0.5 h-5 w-5 shrink-0 accent-brand-700" />
            <span>Pay {terms.depositPercent}% now as the booking amount - <strong>{fmt(deposit)}</strong> (balance {fmt(balance)}, payable on this page before the tour)</span>
          </label>
        </div>
      </div>

      <div>
        {contactBlock}
        {payArea(`Pay ${fmt(amountToPay)}`)}
      </div>
    </section>
  );
}
