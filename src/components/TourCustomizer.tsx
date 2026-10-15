import { useEffect, useMemo, useRef, useState } from 'react';
import { track } from '../lib/analytics';
import { fmt } from '../i18n/fmt';
import PhoneInput from './PhoneInput';
import type { Dictionary } from '../i18n/dictionaries';
import { getAvailability } from '../lib/availability';
import { AGRA_HOTELS } from '../lib/agraHotels';
import {
  MAX_HOTEL_NIGHTS,
  MAX_HOTEL_ROOMS,
  MAX_NOTES_LENGTH,
  addDays,
  priceTrip,
  travellerTotal,
  validateTrip,
  type Currency,
  type CustomRates,
  type HotelChoice,
  type StartPoint,
  type TripErrorCode,
  type TripError,
  type TripInput,
  validateContact,
} from '../lib/customTrip';

// "Customise your Agra tour": five steps (trip, itinerary, vehicle, hotel,
// review) and a live estimate. It uses the same price function as the server
// (src/lib/customTrip.ts), but the estimate here is only a preview: the server
// recalculates and charges its own figure.

export interface CustomizerTemplate {
  slug: string;
  title: string;
  start: StartPoint;
  vehicleId?: string;
  stopIds: string[];
}

interface Props {
  rates: CustomRates;
  templates: CustomizerTemplate[];
  currency: Currency;
  intlLocale: string;
  locale: string;
  t: Dictionary['customTour'];
  // The name, email and phone labels and messages the booking form already uses.
  contact: Pick<Dictionary['booking'], 'fullName' | 'namePlaceholder' | 'email' | 'emailPlaceholder' | 'phone' | 'errName' | 'errEmail' | 'errPhone' | 'gatewayLoad'>;
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

// Which problems belong to which step, so each step only shows its own.
const STEP_CODES: TripErrorCode[][] = [
  ['bad_start_date', 'start_too_soon', 'bad_travellers', 'group_too_large'],
  ['bad_days', 'too_many_days', 'day_empty', 'too_many_stops', 'unknown_stop', 'duplicate_stop', 'closed_friday', 'night_only', 'day_too_full'],
  ['unknown_vehicle', 'vehicle_too_small', 'rates_not_set'],
  ['bad_hotel'],
];
const STEP_KEYS = ['trip', 'itinerary', 'vehicle', 'hotel', 'review'] as const;
const CATEGORIES = ['foreign', 'indian', 'saarc', 'children'] as const;

const fieldClass =
  'min-h-11 w-full rounded-xl border border-brand-200 bg-white px-3 text-base text-stone-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';
const primaryButton =
  'min-h-11 rounded-full bg-brand-700 px-6 text-sm font-semibold text-white transition hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50';
const linkButton =
  'min-h-11 rounded-lg px-2 text-sm font-semibold text-brand-700 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600';
const smallButton =
  'min-h-11 min-w-11 rounded-lg border border-brand-200 bg-white px-2 text-sm text-brand-800 hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-40';

export default function TourCustomizer({ rates, templates, currency, intlLocale, locale, t, contact }: Props) {
  const [step, setStep] = useState(0);
  const [minDate, setMinDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [start, setStart] = useState<StartPoint>('delhi');
  const [travellers, setTravellers] = useState({ foreign: 2, indian: 0, saarc: 0, children: 0 });
  const [days, setDays] = useState<{ stopIds: string[] }[]>([{ stopIds: [] }]);
  const [vehicleId, setVehicleId] = useState('');
  const [hotel, setHotel] = useState<HotelChoice>({ mode: 'own' });
  const [attempted, setAttempted] = useState<Record<number, boolean>>({});
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [paying, setPaying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [contactTried, setContactTried] = useState(false);
  // Set when Razorpay took the payment but the booking could not be confirmed on screen.
  const [unconfirmed, setUnconfirmed] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // The earliest start depends on today's date, so it is set after the page loads.
  useEffect(() => {
    const min = getAvailability().minBookableDate;
    setMinDate(min);
    setStartDate((d) => d || min);
  }, []);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const liveVehicles = useMemo(
    () => rates.vehicles.filter((v) => v.active && v.agraDay.inr > 0).sort((a, b) => a.seats - b.seats || a.agraDay.inr - b.agraDay.inr),
    [rates]
  );
  const total = travellerTotal(travellers);
  const stops = useMemo(() => new Map(rates.stops.map((s) => [s.id, s])), [rates]);

  // Keep a vehicle selected that fits the group: the smallest one that does.
  useEffect(() => {
    const current = liveVehicles.find((v) => v.id === vehicleId);
    if (current && current.seats >= total) return;
    setVehicleId(liveVehicles.find((v) => v.seats >= total)?.id ?? '');
  }, [liveVehicles, total, vehicleId]);

  const input: TripInput = { startDate, start, travellers, vehicleId, days, hotel, currency };
  const errors = useMemo(() => validateTrip(input, rates), [startDate, start, travellers, vehicleId, days, hotel, currency, rates]); // eslint-disable-line react-hooks/exhaustive-deps
  const priced = useMemo(() => (errors.length === 0 ? priceTrip(input, rates) : null), [errors]); // eslint-disable-line react-hooks/exhaustive-deps
  const quote = priced && priced.ok ? priced.quote : null;

  const symbol = currency === 'USD' ? '$' : '₹';
  const money = (n: number) => `${symbol}${n.toLocaleString(currency === 'USD' ? 'en-US' : 'en-IN')}`;
  const rateIn = (m: { inr: number; usd: number | null }) => (currency === 'INR' ? m.inr : m.usd !== null && m.usd > 0 ? m.usd : Math.ceil(m.inr / rates.usdRate));
  const stopName = (id: string) => (t.stopNames as Record<string, string>)[id] ?? stops.get(id)?.name ?? id;
  const vehicleName = (id: string) => (t.vehicleNames as Record<string, string>)[id] ?? rates.vehicles.find((v) => v.id === id)?.name ?? id;
  const dateLabel = (d: string) =>
    d ? new Date(`${d}T00:00:00Z`).toLocaleDateString(intlLocale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
  const longDate = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString(intlLocale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');
  const errorText = (e: TripError) => {
    const p = { ...(e.params ?? {}) } as Record<string, string | number>;
    if (typeof p.stop === 'string') p.stop = stopName(p.stop);
    if (typeof p.vehicle === 'string') p.vehicle = vehicleName(p.vehicle);
    return fmt((t.errors as Record<string, string>)[e.code] ?? e.message, p);
  };

  const contactErrs = validateContact({ name, email, phone });
  const contactMessage = { name: contact.errName, email: contact.errEmail, phone: contact.errPhone } as const;

  async function pay() {
    if (!quote || paying) return;
    setPayError(null);
    setContactTried(true);
    const bad = (['name', 'email', 'phone'] as const).find((f) => contactErrs[f]);
    if (bad) {
      const el = document.getElementById(`custom-${bad}`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
      return;
    }
    setPaying(true);
    track('custom_tour_checkout', { total: quote.total, deposit: quote.deposit, days: quote.days.length, currency });
    try {
      if (!(await loadRazorpayScript())) throw new Error(contact.gatewayLoad);
      // Only the selections and contact details go to the server, which prices
      // the trip itself and ignores any figure from this page.
      const res = await fetch('/api/custom-trip/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trip: input, contact: { name, email, phone }, locale }),
      });
      const order = await res.json().catch(() => ({}));
      if (!res.ok || !order.orderId || !order.publicKey) {
        throw new Error(res.status === 400 && order.error === 'invalid_trip' ? t.review.incomplete : t.review.gateway);
      }
      const rzp = new window.Razorpay({
        key: order.publicKey,
        amount: order.amount,
        currency: order.currency,
        name: 'IWIS Global',
        description: t.heading,
        order_id: order.orderId,
        image: 'https://www.iwisglobal.com/logo-globe.png',
        handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          setPaying(true);
          setConfirming(true);
          setPayError(null);
          try {
            const verify = await fetch('/api/custom-trip/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(response),
            });
            const done = await verify.json().catch(() => ({}));
            if (!verify.ok || !done.tripId) throw new Error('verify');
            track('custom_tour_paid', { total: quote.total, deposit: quote.deposit, currency });
            window.location.href = `/customize-your-tour/thanks?trip=${encodeURIComponent(done.tripId)}`;
          } catch {
            setPaying(false);
            setConfirming(false);
            setUnconfirmed(response.razorpay_payment_id);
          }
        },
        modal: { ondismiss: () => setPaying(false) },
        // Razorpay drops a prefilled number that contains spaces or dashes.
        prefill: { name, email, contact: phone.replace(/[\s().-]/g, '') },
        theme: { color: '#6d28d9' },
      });
      rzp.on('payment.failed', () => {
        setPayError(t.review.failed);
        setPaying(false);
      });
      rzp.open();
    } catch (err: any) {
      setPayError(err?.message || t.review.gateway);
      setPaying(false);
    }
  }

  const stepErrors = (s: number) => errors.filter((e) => STEP_CODES[s]?.includes(e.code));

  function go(to: number) {
    setStep(to);
    track('custom_tour_step', { step: to + 1 });
  }
  function next() {
    if (stepErrors(step).length > 0) {
      setAttempted((a) => ({ ...a, [step]: true }));
      return;
    }
    go(step + 1);
  }

  function setCount(key: (typeof CATEGORIES)[number], value: string) {
    const n = Math.max(0, Math.min(50, Math.floor(Number(value) || 0)));
    setTravellers((tr) => ({ ...tr, [key]: n }));
  }
  function updateStops(day: number, fn: (ids: string[]) => string[]) {
    setDays((ds) => ds.map((d, i) => (i === day ? { stopIds: fn(d.stopIds) } : d)));
  }
  function move(day: number, index: number, by: number) {
    updateStops(day, (ids) => {
      const to = index + by;
      if (to < 0 || to >= ids.length) return ids;
      const copy = [...ids];
      [copy[index], copy[to]] = [copy[to], copy[index]];
      return copy;
    });
  }
  function applyTemplate(day: number, slug: string) {
    const tpl = templates.find((x) => x.slug === slug);
    if (!tpl) return;
    updateStops(day, () => [...tpl.stopIds]);
    if (day === 0) {
      setStart(tpl.start);
      const v = liveVehicles.find((x) => x.id === tpl.vehicleId);
      if (v && v.seats >= total) setVehicleId(v.id);
    }
    track('custom_tour_template', { tour: slug });
  }

  useEffect(() => {
    if (step === 4 && quote) track('custom_tour_estimate', { total: quote.total, days: quote.days.length, currency });
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const showErrors = (s: number) => stepErrors(s).filter((e) => attempted[s] || (s === 1 && e.code !== 'day_empty'));

  const summary = (
    <aside aria-label={t.summary.heading} className="rounded-3xl border border-brand-100 bg-brand-50/50 p-4 lg:sticky lg:top-24">
      <h2 className="font-serif text-lg font-semibold text-brand-900">{t.summary.heading}</h2>
      {quote ? (
        <div aria-live="polite" className="mt-2 text-sm text-stone-700">
          <p>{quote.days.length === 1 ? dateLabel(quote.startDate) : fmt(t.review.dates, { from: dateLabel(quote.startDate), to: dateLabel(quote.endDate) })}</p>
          <p>{vehicleName(quote.vehicle.id)} · {fmt(t.trip.guests, { n: travellerTotal(quote.travellers) })}</p>
          <p className="mt-3 text-xs text-stone-500">{t.summary.total}</p>
          <p className="font-serif text-3xl font-semibold text-brand-900">{money(quote.total)}</p>
        </div>
      ) : (
        <p aria-live="polite" className="mt-2 text-sm text-stone-600">{t.summary.empty}</p>
      )}
    </aside>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <section aria-labelledby="customizer-step-title" className="min-w-0 rounded-3xl border border-brand-100 bg-white p-4 shadow-sm shadow-brand-900/5 min-[300px]:p-6">
        <nav aria-label={t.heading}>
          <ol className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium">
            {STEP_KEYS.map((key, i) => (
              <li key={key} aria-current={i === step ? 'step' : undefined} className="flex min-h-11 items-center">
                {i < step ? (
                  <button type="button" onClick={() => go(i)} className="min-h-11 text-brand-700 underline underline-offset-2">{i + 1}. {t.steps[key]}</button>
                ) : (
                  <span className={i === step ? 'font-semibold text-brand-900' : 'text-stone-400'}>{i + 1}. {t.steps[key]}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <p className="mt-2 text-xs text-brand-700">{fmt(t.stepOf, { n: step + 1, total: STEP_KEYS.length })}</p>

        {step === 0 && (
          <div>
            <h2 id="customizer-step-title" ref={headingRef} tabIndex={-1} className="mt-2 font-serif text-xl font-semibold text-brand-900 outline-none md:text-2xl">{t.trip.heading}</h2>
            <div className="mt-4 grid gap-5">
              <div>
                <label htmlFor="ct-start-date" className="mb-1 block text-sm font-medium text-stone-800">{t.trip.startDate}</label>
                <input id="ct-start-date" type="date" value={startDate} min={minDate || undefined} onChange={(e) => setStartDate(e.target.value)} className={`${fieldClass} sm:max-w-xs`} />
                {startDate && <p className="mt-1 text-xs text-stone-500">{dateLabel(startDate)}</p>}
              </div>
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-stone-800">{t.trip.startFrom}</legend>
                {(['delhi', 'agra'] as const).map((value) => (
                  <label key={value} className="flex min-h-11 items-center gap-3 text-sm text-stone-800">
                    <input type="radio" name="ct-start" checked={start === value} onChange={() => setStart(value)} className="h-5 w-5 accent-brand-700" />
                    {value === 'delhi' ? t.trip.startDelhi : t.trip.startAgra}
                  </label>
                ))}
                {start === 'delhi' && <p className="text-xs text-stone-500">{t.trip.startHint}</p>}
              </fieldset>
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-stone-800">{t.trip.travellers}</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {CATEGORIES.map((key) => (
                    <div key={key}>
                      <label htmlFor={`ct-${key}`} className="mb-1 block text-sm text-stone-700">{t.trip[key]}</label>
                      <input id={`ct-${key}`} type="number" inputMode="numeric" min={0} max={50} value={travellers[key]} onChange={(e) => setCount(key, e.target.value)} className={fieldClass} />
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-stone-500">{t.trip.childrenHint} {fmt(t.trip.guests, { n: total })}</p>
              </fieldset>
              {showErrors(0).length > 0 && (
                <ul role="alert" className="grid gap-1 text-sm text-red-700">
                  {showErrors(0).map((e, k) => <li key={k}>{errorText(e)}</li>)}
                </ul>
              )}
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 id="customizer-step-title" ref={headingRef} tabIndex={-1} className="mt-2 font-serif text-xl font-semibold text-brand-900 outline-none md:text-2xl">{t.itinerary.heading}</h2>
            <p className="mt-1 text-sm text-stone-600">{t.itinerary.hint}</p>
            <div className="mt-4 grid gap-4">
              {days.map((day, i) => {
                const available = rates.stops.filter((s) => s.active && !day.stopIds.includes(s.id));
                const dayErrors = showErrors(1).filter((e) => e.day === i);
                return (
                  <div key={i} className="rounded-2xl border border-brand-100 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold text-brand-900">{fmt(t.itinerary.day, { n: i + 1 })}{startDate ? ` · ${dateLabel(addDays(startDate, i))}` : ''}</h3>
                      {days.length > 1 && (
                        <button type="button" onClick={() => setDays((ds) => ds.filter((_, k) => k !== i))} className={linkButton}>{fmt(t.itinerary.removeDay, { n: i + 1 })}</button>
                      )}
                    </div>
                    {templates.length > 0 && (
                      <div className="mt-2">
                        <label htmlFor={`ct-tpl-${i}`} className="mb-1 block text-xs text-stone-600">{t.itinerary.fromTour}</label>
                        <select id={`ct-tpl-${i}`} value="" onChange={(e) => applyTemplate(i, e.target.value)} className={fieldClass}>
                          <option value="">{t.itinerary.fromTourNone}</option>
                          {templates.map((tpl) => <option key={tpl.slug} value={tpl.slug}>{tpl.title}</option>)}
                        </select>
                      </div>
                    )}
                    <ol className="mt-3 grid gap-2">
                      {day.stopIds.length === 0 && <li className="text-sm text-stone-500">{t.itinerary.empty}</li>}
                      {day.stopIds.map((id, k) => {
                        const stop = stops.get(id);
                        return (
                          <li key={id} className="flex flex-wrap items-center gap-2 rounded-xl bg-brand-50/60 px-3 py-1.5">
                            <span className="min-w-0 flex-1 font-medium text-stone-900 [overflow-wrap:anywhere]">
                              {k + 1}. {stopName(id)}
                              {stop?.closedFridays && <span className="block text-xs font-normal text-stone-500 [overflow-wrap:normal]">{t.itinerary.closedFridays}</span>}
                              {stop?.nightOnly && <span className="block text-xs font-normal text-stone-500 [overflow-wrap:normal]">{t.itinerary.nightOnly}</span>}
                            </span>
                            <button type="button" aria-label={fmt(t.itinerary.up, { stop: stopName(id) })} disabled={k === 0} onClick={() => move(i, k, -1)} className={smallButton}><span aria-hidden="true">↑</span></button>
                            <button type="button" aria-label={fmt(t.itinerary.down, { stop: stopName(id) })} disabled={k === day.stopIds.length - 1} onClick={() => move(i, k, 1)} className={smallButton}><span aria-hidden="true">↓</span></button>
                            <button type="button" aria-label={fmt(t.itinerary.remove, { stop: stopName(id) })} onClick={() => updateStops(i, (ids) => ids.filter((x) => x !== id))} className={smallButton}><span aria-hidden="true">✕</span></button>
                          </li>
                        );
                      })}
                    </ol>
                    {available.length > 0 && (
                      <div className="mt-3">
                        <label htmlFor={`ct-add-${i}`} className="mb-1 block text-xs text-stone-600">{t.itinerary.addStop}</label>
                        <select id={`ct-add-${i}`} value="" onChange={(e) => e.target.value && updateStops(i, (ids) => [...ids, e.target.value])} className={fieldClass}>
                          <option value="">{t.itinerary.addStopPlaceholder}</option>
                          {available.map((s) => <option key={s.id} value={s.id}>{stopName(s.id)}</option>)}
                        </select>
                      </div>
                    )}
                    {dayErrors.length > 0 && (
                      <ul role="alert" className="mt-3 grid gap-1 text-sm text-red-700">
                        {dayErrors.map((e, k) => <li key={k}>{errorText(e)}</li>)}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
            {days.length < rates.maxDays && (
              <button type="button" onClick={() => setDays((ds) => [...ds, { stopIds: [] }])} className={`${linkButton} mt-3`}>{t.itinerary.addDay}</button>
            )}
            {showErrors(1).filter((e) => e.day === undefined).length > 0 && (
              <ul role="alert" className="mt-3 grid gap-1 text-sm text-red-700">
                {showErrors(1).filter((e) => e.day === undefined).map((e, k) => <li key={k}>{errorText(e)}</li>)}
              </ul>
            )}
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 id="customizer-step-title" ref={headingRef} tabIndex={-1} className="mt-2 font-serif text-xl font-semibold text-brand-900 outline-none md:text-2xl">{t.vehicle.heading}</h2>
            <p className="mt-1 text-sm text-stone-600">{t.vehicle.hint}</p>
            <fieldset className="mt-4 grid gap-3">
              <legend className="sr-only">{t.vehicle.heading}</legend>
              {liveVehicles.map((v) => {
                const fits = v.seats >= total;
                return (
                  <label key={v.id} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border p-3 ${vehicleId === v.id ? 'border-2 border-brand-500 bg-brand-50/60' : 'border-brand-100'} ${fits ? '' : 'opacity-50'}`}>
                    <input type="radio" name="ct-vehicle" disabled={!fits} checked={vehicleId === v.id} onChange={() => setVehicleId(v.id)} className="mt-1 h-5 w-5 accent-brand-700" />
                    <span className="min-w-0">
                      <span className="block font-semibold text-brand-900">{vehicleName(v.id)}</span>
                      <span className="block text-xs text-stone-600">{fmt(t.vehicle.seats, { n: v.seats })} · {fmt(t.vehicle.perDay, { price: money(rateIn(v.agraDay)) })}</span>
                      {start === 'delhi' && v.delhiReturn.inr > 0 && <span className="block text-xs text-stone-600">{fmt(t.vehicle.delhiExtra, { price: money(rateIn(v.delhiReturn)) })}</span>}
                      {!fits && <span className="block text-xs text-red-700">{t.vehicle.tooSmall}</span>}
                    </span>
                  </label>
                );
              })}
            </fieldset>
            {showErrors(2).length > 0 && (
              <ul role="alert" className="mt-3 grid gap-1 text-sm text-red-700">
                {showErrors(2).map((e, k) => <li key={k}>{errorText(e)}</li>)}
              </ul>
            )}
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 id="customizer-step-title" ref={headingRef} tabIndex={-1} className="mt-2 font-serif text-xl font-semibold text-brand-900 outline-none md:text-2xl">{t.hotel.heading}</h2>
            <p className="mt-1 text-sm text-stone-600">{t.hotel.hint}</p>
            <fieldset className="mt-4">
              <legend className="sr-only">{t.hotel.heading}</legend>
              {(['own', 'listed', 'arrange'] as const).map((mode) => (
                <label key={mode} className="flex min-h-11 items-center gap-3 text-sm text-stone-800">
                  <input type="radio" name="ct-hotel" checked={hotel.mode === mode} onChange={() => setHotel(mode === 'arrange' ? { mode, nights: 1, rooms: 1 } : { mode })} className="h-5 w-5 accent-brand-700" />
                  {t.hotel[mode]}
                </label>
              ))}
            </fieldset>
            {hotel.mode !== 'own' && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="ct-hotel-name" className="mb-1 block text-sm text-stone-700">{t.hotel.pick}</label>
                  <select id="ct-hotel-name" value={hotel.name ?? ''} onChange={(e) => setHotel((h) => ({ ...h, name: e.target.value || undefined }))} className={fieldClass}>
                    <option value="">{hotel.mode === 'arrange' ? t.hotel.any : t.itinerary.addStopPlaceholder}</option>
                    {AGRA_HOTELS.map((h) => <option key={h.name} value={h.name}>{h.name}</option>)}
                  </select>
                </div>
                {hotel.mode === 'arrange' && (
                  <>
                    <div>
                      <label htmlFor="ct-nights" className="mb-1 block text-sm text-stone-700">{t.hotel.nights}</label>
                      <input id="ct-nights" type="number" inputMode="numeric" min={1} max={MAX_HOTEL_NIGHTS} value={hotel.nights ?? ''} onChange={(e) => setHotel((h) => ({ ...h, nights: Number(e.target.value) }))} className={fieldClass} />
                    </div>
                    <div>
                      <label htmlFor="ct-rooms" className="mb-1 block text-sm text-stone-700">{t.hotel.rooms}</label>
                      <input id="ct-rooms" type="number" inputMode="numeric" min={1} max={MAX_HOTEL_ROOMS} value={hotel.rooms ?? ''} onChange={(e) => setHotel((h) => ({ ...h, rooms: Number(e.target.value) }))} className={fieldClass} />
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor="ct-notes" className="mb-1 block text-sm text-stone-700">{t.hotel.notes}</label>
                      <textarea id="ct-notes" rows={3} maxLength={MAX_NOTES_LENGTH} value={hotel.notes ?? ''} onChange={(e) => setHotel((h) => ({ ...h, notes: e.target.value }))} className={`${fieldClass} py-2`} />
                    </div>
                  </>
                )}
              </div>
            )}
            <p className="mt-3 text-xs text-stone-500">{t.hotel.note}</p>
            {showErrors(3).length > 0 && (
              <ul role="alert" className="mt-3 grid gap-1 text-sm text-red-700">
                {showErrors(3).map((e, k) => <li key={k}>{errorText(e)}</li>)}
              </ul>
            )}
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 id="customizer-step-title" ref={headingRef} tabIndex={-1} className="mt-2 font-serif text-xl font-semibold text-brand-900 outline-none md:text-2xl">{t.review.heading}</h2>
            {!quote ? (
              <div className="mt-3 text-sm text-stone-700" role="alert">
                <p>{t.review.incomplete}</p>
                {priced && !priced.ok && <ul className="mt-2 grid gap-1 text-red-700">{priced.errors.map((e, k) => <li key={k}>{errorText(e)}</li>)}</ul>}
                {errors.length > 0 && <ul className="mt-2 grid gap-1 text-red-700">{errors.map((e, k) => <li key={k}>{errorText(e)}</li>)}</ul>}
              </div>
            ) : (
              <div className="mt-3">
                <p className="text-sm text-stone-700">
                  {quote.days.length === 1 ? dateLabel(quote.startDate) : fmt(t.review.dates, { from: dateLabel(quote.startDate), to: dateLabel(quote.endDate) })} · {vehicleName(quote.vehicle.id)} · {fmt(t.trip.guests, { n: travellerTotal(quote.travellers) })}
                </p>
                <ol className="mt-3 grid gap-2">
                  {quote.days.map((d) => (
                    <li key={d.index} className="rounded-xl bg-brand-50/60 px-3 py-2 text-sm">
                      <span className="font-semibold text-brand-900">{fmt(t.itinerary.day, { n: d.index + 1 })} · {dateLabel(d.date)}</span>
                      <span className="block text-stone-700">{d.stops.map((s) => stopName(s.id)).join(' → ')}</span>
                    </li>
                  ))}
                </ol>
                <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                  <dt>{t.review.vehicle}</dt><dd className="text-right">{money(quote.vehicleTotal)}</dd>
                  <dt>{t.review.guide}</dt><dd className="text-right">{money(quote.guideTotal)}</dd>
                  <dt>{t.review.tickets}</dt><dd className="text-right">{money(quote.ticketsTotal)}</dd>
                  <dt className="border-t border-brand-100 pt-2 font-semibold">{t.review.total}</dt><dd className="border-t border-brand-100 pt-2 text-right font-serif text-xl font-semibold text-brand-900">{money(quote.total)}</dd>
                  <dt>{t.review.deposit}</dt><dd className="text-right font-semibold">{money(quote.deposit)}</dd>
                  <dt>{t.review.balance}</dt><dd className="text-right">{money(quote.balance)}</dd>
                </dl>
                <p className="mt-3 text-xs text-stone-500">{fmt(t.review.ticketsNote, { date: longDate(quote.ticketFeesCheckedOn) })}</p>
                <p className="mt-1 text-xs text-stone-500">
                  {hotel.mode === 'own' && t.review.hotelOwn}
                  {hotel.mode === 'listed' && fmt(t.review.hotelListed, { name: hotel.name ?? '' })}
                  {hotel.mode === 'arrange' && fmt(t.review.hotelArrange, { nights: hotel.nights ?? 0, rooms: hotel.rooms ?? 0 })}
                  {' · '}{t.hotel.note}
                </p>
                <p className="mt-1 text-xs text-stone-500">{t.review.estimateNote}</p>

                <h3 className="mt-5 font-serif text-lg font-semibold text-brand-900">{t.review.contactHeading}</h3>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="custom-name" className="mb-1 block text-sm font-medium">{contact.fullName}</label>
                    <input id="custom-name" className={fieldClass} autoComplete="name" placeholder={contact.namePlaceholder} value={name} onChange={(e) => setName(e.target.value)}
                      aria-invalid={contactTried && !!contactErrs.name} aria-describedby={contactTried && contactErrs.name ? 'custom-name-error' : undefined} />
                    {contactTried && contactErrs.name && <p id="custom-name-error" className="mt-1 text-xs text-red-600">{contactMessage.name}</p>}
                  </div>
                  <div>
                    <label htmlFor="custom-email" className="mb-1 block text-sm font-medium">{contact.email}</label>
                    <input id="custom-email" type="email" className={fieldClass} autoComplete="email" placeholder={contact.emailPlaceholder} value={email} onChange={(e) => setEmail(e.target.value)}
                      aria-invalid={contactTried && !!contactErrs.email} aria-describedby={contactTried && contactErrs.email ? 'custom-email-error' : undefined} />
                    {contactTried && contactErrs.email && <p id="custom-email-error" className="mt-1 text-xs text-red-600">{contactMessage.email}</p>}
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="custom-phone" className="mb-1 block text-sm font-medium">{contact.phone}</label>
                    <PhoneInput id="custom-phone" value={phone} onChange={setPhone} invalid={contactTried && !!contactErrs.phone} describedBy={contactTried && contactErrs.phone ? 'custom-phone-error' : undefined} />
                    {contactTried && contactErrs.phone && <p id="custom-phone-error" className="mt-1 text-xs text-red-600">{contactMessage.phone}</p>}
                  </div>
                </div>
                <p className="mt-3 text-xs text-stone-600">
                  {t.review.terms} <a href="/cancellation-refund-policy" className="font-semibold text-brand-700 underline">{t.review.termsLink}</a>.
                </p>
                {payError && <p className="mt-3 text-sm text-red-700" role="alert">{payError}</p>}
                {unconfirmed && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="alert">{fmt(t.review.unconfirmed, { id: unconfirmed })}</p>}
                <button type="button" onClick={pay} disabled={paying || !!unconfirmed} className={`${primaryButton} mt-4 disabled:opacity-60`}>
                  {confirming ? t.review.confirming : paying ? t.review.opening : fmt(t.review.payDeposit, { amount: money(quote.deposit) })}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {step > 0 && <button type="button" onClick={() => go(step - 1)} className={linkButton}>{t.back}</button>}
          {step < STEP_KEYS.length - 1 && <button type="button" onClick={next} className={primaryButton}>{t.next}</button>}
        </div>
      </section>

      {summary}
    </div>
  );
}
