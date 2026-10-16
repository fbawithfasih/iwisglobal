import { useEffect, useRef, useState } from 'react';
import { fmt } from '../i18n/fmt';
import type { Dictionary } from '../i18n/dictionaries';
import { validateContact } from '../lib/customTrip';
import PhoneInput from './PhoneInput';
import type { StoredSearch } from './HotelSearch';

// Review and pay for a quoted hotel room. The server priced the quote
// (src/lib/hotelQuote.ts) and prices the order again; this page only shows it,
// collects the guest names and runs the Razorpay window. It never sends a price.

interface StoredQuote {
  bookingId: string;
  hotelName: string;
  roomName: string;
  boardName: string;
  checkIn: string;
  checkOut: string;
  price: number;
  currency: 'INR' | 'USD';
  cancellation: { amount: number; from: string }[];
  rateComments: string[];
  commentsUnavailable: boolean;
  changed: boolean;
  rooms: number;
}

interface Props {
  // The admin test page points these at /admin/... (see HotelSearch).
  orderUrl?: string;
  searchPath?: string;
  t: Dictionary['hotelBooking']['checkout'];
  bookingId: string;
  intlLocale: string;
  locale: string;
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

// Same rule as the server (src/lib/hotelPayment.ts); the server has the last word.
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}' .-]{0,59}$/u;
const nameOk = (v: string) => NAME_RE.test(v.trim());

const fieldClass =
  'min-h-11 w-full rounded-xl border border-brand-200 bg-white px-3 text-base text-stone-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 aria-[invalid=true]:border-red-600';
const primaryButton =
  'min-h-11 rounded-full bg-brand-700 px-6 text-sm font-semibold text-white transition hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50';
const labelClass = 'mb-1 block text-sm font-medium text-stone-800';
const card = 'rounded-3xl border border-brand-100 bg-white p-4 shadow-sm shadow-brand-900/5 min-[300px]:p-6';

type Name = { first: string; last: string };

export default function HotelCheckout({ t, bookingId, intlLocale, locale, orderUrl = '/api/hotels/order', searchPath = '/hotels' }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [data, setData] = useState<{ quote: StoredQuote; search: StoredSearch } | null>(null);
  // names[room][guest]: adults first, then children, as the server expects.
  const [names, setNames] = useState<Name[][]>([]);
  const [holderFirst, setHolderFirst] = useState('');
  const [holderLast, setHolderLast] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [tried, setTried] = useState(false);
  const [paying, setPaying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [payError, setPayError] = useState('');
  const [expired, setExpired] = useState(false);
  const [refunded, setRefunded] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState('');
  const payingRef = useRef(false);

  // sessionStorage only exists in the browser, so read it after the page loads.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`hotel-quote:${bookingId}`);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.quote?.bookingId === bookingId && Array.isArray(parsed?.search?.rooms) && parsed.search.rooms.length > 0) {
        setData(parsed);
        setNames(parsed.search.rooms.map((r: StoredSearch['rooms'][number]) => Array.from({ length: r.adults + r.childAges.length }, () => ({ first: '', last: '' }))));
      }
    } catch {
      // Blocked or unreadable storage is handled as an expired price.
    }
    setLoaded(true);
  }, [bookingId]);

  if (!loaded) return null;

  const searchLink = (
    <a href={searchPath} className="font-semibold text-brand-700 underline underline-offset-2">{t.searchAgain}</a>
  );

  if (!data || expired) {
    return (
      <div className={card} role="alert">
        <p className="text-stone-800">{t.expired}</p>
        <p className="mt-3">{searchLink}</p>
      </div>
    );
  }
  if (refunded) {
    return (
      <div className={card} role="alert">
        <p className="text-stone-800">{t.refunded}</p>
        <p className="mt-3">{searchLink}</p>
      </div>
    );
  }

  const { quote, search } = data;
  const money = (n: number) => `${quote.currency === 'USD' ? '$' : '₹'}${n.toLocaleString(quote.currency === 'USD' ? 'en-US' : 'en-IN')}`;
  const shortDate = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(intlLocale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  };
  const deadline = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleString(intlLocale, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  };

  const nights = Math.max(1, Math.round((Date.parse(`${quote.checkOut}T00:00:00Z`) - Date.parse(`${quote.checkIn}T00:00:00Z`)) / 86_400_000));
  // Same rule as the search results: free until the first fee starts, if that is still ahead.
  const first = quote.cancellation[0];
  const freeUntil = first && Date.parse(first.from) > Date.now() ? first.from : null;

  const partyKey = (r: StoredSearch['rooms'][number]) => `${r.adults}|${[...r.childAges].sort((a, b) => a - b).join(',')}`;
  const uniform = search.rooms.every((r) => partyKey(r) === partyKey(search.rooms[0]));

  const nameErr = (n: Name) => ({ first: !nameOk(n.first), last: !nameOk(n.last) });
  const contactErrs = validateContact({ name: 'xx', email, phone });
  const holderErr = { first: !nameOk(holderFirst), last: !nameOk(holderLast) };
  const hasErrors =
    holderErr.first || holderErr.last || !!contactErrs.email || !!contactErrs.phone || names.some((room) => room.some((n) => nameErr(n).first || nameErr(n).last));
  const show = tried;
  const blocked = quote.commentsUnavailable || !uniform;

  const setName = (room: number, guest: number, key: keyof Name, value: string) =>
    setNames((all) => all.map((r, i) => (i === room ? r.map((n, j) => (j === guest ? { ...n, [key]: value } : n)) : r)));

  async function pay() {
    if (payingRef.current || blocked) return;
    setPayError('');
    setTried(true);
    if (hasErrors) {
      // Focus the first field with a problem so it is announced.
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el?.focus({ preventScroll: true });
      });
      return;
    }
    payingRef.current = true;
    setPaying(true);
    try {
      if (!(await loadRazorpayScript())) throw new Error(t.gatewayLoad);
      const res = await fetch(orderUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: quote.bookingId,
          rooms: names.map((room) => ({ names: room.map((n) => ({ first: n.first.trim(), last: n.last.trim() })) })),
          contact: { holderFirst: holderFirst.trim(), holderLast: holderLast.trim(), email: email.trim(), phone },
          locale,
        }),
      });
      const order = await res.json().catch(() => ({}));
      if (res.status === 409 && order.error === 'not_quoted') {
        setExpired(true);
        return;
      }
      if (!res.ok || !order.orderId || !order.publicKey) {
        throw new Error(order.error === 'unsupported_party' ? t.unsupportedParty : order.error === 'bad_details' ? t.errorsSummary : t.gateway);
      }
      const rzp = new window.Razorpay({
        key: order.publicKey,
        amount: order.amount,
        currency: order.currency,
        name: 'IWIS Global',
        description: quote.hotelName,
        order_id: order.orderId,
        image: 'https://www.iwisglobal.com/logo-globe.png',
        handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          setConfirming(true);
          setPayError('');
          try {
            const verify = await fetch('/api/hotels/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(response),
            });
            const done = await verify.json().catch(() => ({}));
            if (verify.ok && done.success) {
              window.location.href = `/hotels/voucher?booking=${encodeURIComponent(quote.bookingId)}`;
              return;
            }
            // The payment was refunded because the hotel did not confirm.
            if (done.error === 'not_booked_refunded') {
              setConfirming(false);
              setRefunded(true);
              return;
            }
            throw new Error('verify');
          } catch {
            // Paid, but the answer did not reach this page. Never charge twice.
            setConfirming(false);
            setUnconfirmed(response.razorpay_payment_id);
          }
        },
        modal: {
          ondismiss: () => {
            payingRef.current = false;
            setPaying(false);
          },
        },
        // Razorpay drops a prefilled number that contains spaces or dashes.
        prefill: { name: `${holderFirst.trim()} ${holderLast.trim()}`, email: email.trim(), contact: phone.replace(/[\s().-]/g, '') },
        theme: { color: '#6d28d9' },
      });
      rzp.on('payment.failed', () => {
        setPayError(t.failed);
        payingRef.current = false;
        setPaying(false);
      });
      rzp.open();
    } catch (err: any) {
      setPayError(err?.message || t.gateway);
      payingRef.current = false;
      setPaying(false);
    }
  }

  const err = (on: boolean, id: string) => (show && on ? { 'aria-invalid': true as const, 'aria-describedby': id } : {});
  const errText = (on: boolean, id: string, text: string) =>
    show && on ? (
      <p id={id} className="mt-1 text-sm text-red-700">{text}</p>
    ) : null;

  return (
    <div className="grid gap-6">
      {quote.changed && (
        <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t.priceChanged}</p>
      )}

      <section className={card} aria-labelledby="hc-summary">
        <h2 id="hc-summary" className="font-serif text-xl font-semibold text-brand-900">{quote.hotelName}</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="font-medium text-stone-800">{t.room}</dt><dd className="text-stone-700">{quote.roomName}</dd></div>
          <div><dt className="font-medium text-stone-800">{t.board}</dt><dd className="text-stone-700">{quote.boardName}</dd></div>
          <div>
            <dt className="font-medium text-stone-800">{t.dates}</dt>
            <dd className="text-stone-700">{shortDate(quote.checkIn)} – {shortDate(quote.checkOut)} ({nights === 1 ? t.night : fmt(t.nights, { n: nights })})</dd>
          </div>
          <div><dt className="font-medium text-stone-800">{t.total}</dt><dd className="font-serif text-2xl font-semibold text-brand-900">{money(quote.price)}</dd></div>
        </dl>

        <h3 className="mt-6 text-sm font-semibold text-brand-900">{t.cancellation}</h3>
        <p className={`mt-1 text-sm ${freeUntil ? 'text-green-800' : 'text-stone-800'}`}>
          {freeUntil ? fmt(t.freeUntil, { date: deadline(freeUntil) }) : t.nonRefundable}
        </p>
      </section>

      <section className={card} aria-labelledby="hc-comments">
        <h3 id="hc-comments" className="text-sm font-semibold text-brand-900">{t.rateComments}</h3>
        {quote.commentsUnavailable && <p role="alert" className="mt-2 text-sm text-red-800">{t.commentsUnavailable}</p>}
        {quote.rateComments.length > 0 && (
          <ul className="mt-2 grid gap-2 text-sm text-stone-800">
            {quote.rateComments.map((c, i) => <li key={i} className="whitespace-pre-line">{c}</li>)}
          </ul>
        )}
      </section>

      <section className={card} aria-labelledby="hc-guests">
        <h3 id="hc-guests" className="font-serif text-xl font-semibold text-brand-900">{t.guests}</h3>
        <div className="mt-4 grid gap-6">
          {search.rooms.map((room, i) => (
            <fieldset key={i} className="rounded-2xl border border-brand-100 p-4">
              {search.rooms.length > 1 && <legend className="px-1 text-sm font-semibold text-brand-900">{fmt(t.roomN, { n: i + 1 })}</legend>}
              <div className="grid gap-4">
                {(names[i] ?? []).map((n, j) => {
                  const isChild = j >= room.adults;
                  const e = nameErr(n);
                  const label = isChild ? fmt(t.child, { n: j - room.adults + 1 }) : fmt(t.adult, { n: j + 1 });
                  return (
                    <div key={j}>
                      <p className="mb-1 text-sm font-semibold text-stone-800">
                        {label}
                        {isChild && <span className="ml-2 font-normal text-stone-600">({fmt(t.age, { age: room.childAges[j - room.adults] })})</span>}
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label htmlFor={`hc-${i}-${j}-f`} className={labelClass}>{t.firstName}</label>
                          <input id={`hc-${i}-${j}-f`} className={fieldClass} autoComplete="off" value={n.first} maxLength={60}
                            onChange={(ev) => setName(i, j, 'first', ev.target.value)} {...err(e.first, `hc-${i}-${j}-fe`)} />
                          {errText(e.first, `hc-${i}-${j}-fe`, t.errName)}
                        </div>
                        <div>
                          <label htmlFor={`hc-${i}-${j}-l`} className={labelClass}>{t.lastName}</label>
                          <input id={`hc-${i}-${j}-l`} className={fieldClass} autoComplete="off" value={n.last} maxLength={60}
                            onChange={(ev) => setName(i, j, 'last', ev.target.value)} {...err(e.last, `hc-${i}-${j}-le`)} />
                          {errText(e.last, `hc-${i}-${j}-le`, t.errName)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </section>

      <section className={card} aria-labelledby="hc-holder">
        <h3 id="hc-holder" className="font-serif text-xl font-semibold text-brand-900">{t.holder}</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="hc-hf" className={labelClass}>{t.firstName}</label>
            <input id="hc-hf" className={fieldClass} autoComplete="given-name" value={holderFirst} maxLength={60}
              onChange={(ev) => setHolderFirst(ev.target.value)} {...err(holderErr.first, 'hc-hf-e')} />
            {errText(holderErr.first, 'hc-hf-e', t.errName)}
          </div>
          <div>
            <label htmlFor="hc-hl" className={labelClass}>{t.lastName}</label>
            <input id="hc-hl" className={fieldClass} autoComplete="family-name" value={holderLast} maxLength={60}
              onChange={(ev) => setHolderLast(ev.target.value)} {...err(holderErr.last, 'hc-hl-e')} />
            {errText(holderErr.last, 'hc-hl-e', t.errName)}
          </div>
          <div>
            <label htmlFor="hc-email" className={labelClass}>{t.email}</label>
            <input id="hc-email" type="email" className={fieldClass} autoComplete="email" value={email} maxLength={200}
              onChange={(ev) => setEmail(ev.target.value)} {...err(!!contactErrs.email, 'hc-email-e')} />
            {errText(!!contactErrs.email, 'hc-email-e', t.errEmail)}
          </div>
          <div>
            <label htmlFor="hc-phone" className={labelClass}>{t.phone}</label>
            <PhoneInput id="hc-phone" value={phone} onChange={setPhone} invalid={show && !!contactErrs.phone} describedBy={show && contactErrs.phone ? 'hc-phone-e' : undefined} />
            {errText(!!contactErrs.phone, 'hc-phone-e', t.errPhone)}
          </div>
        </div>
      </section>

      <div className={card}>
        {!uniform && <p role="alert" className="mb-3 text-sm text-red-800">{t.unsupportedParty}</p>}
        {show && hasErrors && <p role="alert" className="mb-3 text-sm text-red-800">{t.errorsSummary}</p>}
        {payError && <p role="alert" className="mb-3 text-sm text-red-800">{payError}</p>}
        {unconfirmed && <p role="alert" className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{fmt(t.unconfirmed, { id: unconfirmed })}</p>}
        <p className="mb-3 text-sm text-stone-700">{t.terms}</p>
        <button type="button" onClick={pay} disabled={paying || !!unconfirmed || blocked} className={primaryButton}>
          {confirming ? t.confirming : paying ? t.opening : fmt(t.pay, { amount: money(quote.price) })}
        </button>
      </div>
    </div>
  );
}
