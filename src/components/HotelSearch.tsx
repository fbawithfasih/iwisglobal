import { useEffect, useRef, useState } from 'react';
import { fmt } from '../i18n/fmt';
import type { Dictionary } from '../i18n/dictionaries';
import { getAvailability } from '../lib/availability';
import { addDays } from '../lib/customTrip';
import { MAX_ADULTS_PER_ROOM, MAX_CHILDREN_PER_ROOM, MAX_ROOMS } from '../lib/hotelSearch';
import type { ShownHotel, ShownRate } from '../lib/hotelSearchService';

// Hotel search: dates and party in, priced rooms out. The server decides every
// price and rule (src/lib/hotelSearchService.ts); this only collects the
// search and shows the answer.

interface RoomState { adults: number; childAges: (number | '')[] }

interface Props {
  t: Dictionary['hotelBooking'];
  currency: 'INR' | 'USD';
  intlLocale: string;
  locale: string;
  // Task 12: wire this to the booking page. Until then the button does nothing.
  onSelect?: (hotel: ShownHotel, rate: ShownRate) => void;
}

const fieldClass =
  'min-h-11 w-full rounded-xl border border-brand-200 bg-white px-3 text-base text-stone-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';
const primaryButton =
  'min-h-11 rounded-full bg-brand-700 px-6 text-sm font-semibold text-white transition hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50';
const linkButton =
  'min-h-11 rounded-lg px-2 text-sm font-semibold text-brand-700 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-40 disabled:no-underline';
const labelClass = 'mb-1 block text-sm font-medium text-stone-800';

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export default function HotelSearch({ t, currency, intlLocale, onSelect }: Props) {
  const [minDate, setMinDate] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [rooms, setRooms] = useState<RoomState[]>([{ adults: 2, childAges: [] }]);
  const [hotels, setHotels] = useState<ShownHotel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const ageRefs = useRef<Record<string, HTMLSelectElement | null>>({});

  // Read on the client so the server render and first client render match.
  useEffect(() => setMinDate(getAvailability().minBookableDate), []);

  const symbol = currency === 'USD' ? '$' : '₹';
  const money = (n: number) => `${symbol}${n.toLocaleString(currency === 'USD' ? 'en-US' : 'en-IN')}`;
  const longDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(intlLocale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  };
  const nights = checkIn && checkOut ? Math.max(1, Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000)) : 1;

  const updateRoom = (i: number, fn: (r: RoomState) => RoomState) => setRooms((rs) => rs.map((r, j) => (j === i ? fn(r) : r)));
  const errorText = (code: string, params?: Record<string, string | number>) => {
    const text = (t.errors as Record<string, string>)[code] ?? t.errors.unavailable;
    return fmt(text, params ?? {});
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    for (let i = 0; i < rooms.length; i++) {
      const j = rooms[i].childAges.findIndex((a) => a === '');
      if (j >= 0) {
        setErrors([t.errors.bad_age]);
        setHotels(null);
        ageRefs.current[`${i}-${j}`]?.focus();
        return;
      }
    }
    setErrors([]);
    setLoading(true);
    try {
      const res = await fetch('/api/hotels/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkIn, checkOut, rooms }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && Array.isArray(data?.hotels)) {
        setHotels(data.hotels);
      } else if (data?.error === 'invalid_search' && Array.isArray(data.errors)) {
        setHotels(null);
        setErrors(data.errors.map((er: { code: string; params?: Record<string, string | number> }) => errorText(er.code, er.params)));
      } else {
        setHotels(null);
        setErrors([t.errors.unavailable]);
      }
    } catch {
      setHotels(null);
      setErrors([t.errors.unavailable]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-8">
      <form onSubmit={submit} noValidate className="rounded-3xl border border-brand-100 bg-white p-4 shadow-sm shadow-brand-900/5 min-[300px]:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="hs-in" className={labelClass}>{t.labels.checkIn}</label>
            <input id="hs-in" type="date" required value={checkIn} min={minDate || undefined} className={fieldClass}
              onChange={(e) => { setCheckIn(e.target.value); if (checkOut && e.target.value && checkOut <= e.target.value) setCheckOut(''); }} />
          </div>
          <div>
            <label htmlFor="hs-out" className={labelClass}>{t.labels.checkOut}</label>
            <input id="hs-out" type="date" required value={checkOut} min={checkIn ? addDays(checkIn, 1) : minDate || undefined} className={fieldClass}
              onChange={(e) => setCheckOut(e.target.value)} />
          </div>
        </div>

        <div className="mt-6 grid gap-4">
          {rooms.map((room, i) => (
            <fieldset key={i} className="rounded-2xl border border-brand-100 p-4">
              <legend className="px-1 text-sm font-semibold text-brand-900">{fmt(t.labels.room, { n: i + 1 })}</legend>
              <div className="max-w-xs">
                <label htmlFor={`hs-adults-${i}`} className={labelClass}>{t.labels.adults}</label>
                <select id={`hs-adults-${i}`} value={room.adults} className={fieldClass}
                  onChange={(e) => updateRoom(i, (r) => ({ ...r, adults: Number(e.target.value) }))}>
                  {range(1, MAX_ADULTS_PER_ROOM).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              {room.childAges.length > 0 && (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {room.childAges.map((age, j) => (
                    <div key={j}>
                      <label htmlFor={`hs-age-${i}-${j}`} className={labelClass}>{fmt(t.labels.childAge, { n: j + 1 })}</label>
                      <select id={`hs-age-${i}-${j}`} value={age} className={fieldClass} aria-invalid={errors.length > 0 && age === ''}
                        ref={(el) => { ageRefs.current[`${i}-${j}`] = el; }}
                        onChange={(e) => updateRoom(i, (r) => ({ ...r, childAges: r.childAges.map((a, k) => (k === j ? (e.target.value === '' ? '' : Number(e.target.value)) : a)) }))}>
                        <option value="">-</option>
                        {range(0, 17).map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-x-4">
                <button type="button" className={linkButton} disabled={room.childAges.length >= MAX_CHILDREN_PER_ROOM}
                  onClick={() => updateRoom(i, (r) => ({ ...r, childAges: [...r.childAges, ''] }))}>{t.labels.addChild}</button>
                {room.childAges.length > 0 && (
                  <button type="button" className={linkButton}
                    aria-label={`${t.labels.children} -1`}
                    onClick={() => updateRoom(i, (r) => ({ ...r, childAges: r.childAges.slice(0, -1) }))}>-1 {t.labels.children}</button>
                )}
                {rooms.length > 1 && (
                  <button type="button" className={linkButton} onClick={() => setRooms((rs) => rs.filter((_, j) => j !== i))}>{fmt(t.labels.removeRoom, { n: i + 1 })}</button>
                )}
              </div>
            </fieldset>
          ))}
          <div>
            <button type="button" className={linkButton} disabled={rooms.length >= MAX_ROOMS}
              onClick={() => setRooms((rs) => [...rs, { adults: 2, childAges: [] }])}>{t.labels.addRoom}</button>
          </div>
        </div>

        {errors.length > 0 && (
          <div role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">
            {errors.map((m, i) => <p key={i}>{m}</p>)}
          </div>
        )}

        <button type="submit" disabled={loading} className={`${primaryButton} mt-6`}>{loading ? t.labels.searching : t.labels.search}</button>
      </form>

      <div aria-live="polite">
        {hotels && hotels.length === 0 && <p className="rounded-xl bg-stone-100 p-4 text-sm text-stone-700">{t.results.none}</p>}
        {hotels && hotels.length > 0 && (
          <ul className="grid gap-6">
            {hotels.map((h) => (
              <li key={h.code} className="overflow-hidden rounded-3xl border border-brand-100 bg-white shadow-sm shadow-brand-900/5">
                <div className="grid md:grid-cols-[16rem_1fr]">
                  {h.image ? (
                    <img src={h.image} alt="" loading="lazy" className="h-48 w-full object-cover md:h-full" />
                  ) : (
                    <div className="h-48 w-full bg-brand-50 md:h-full" aria-hidden="true" />
                  )}
                  <div className="p-4 min-[300px]:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="font-serif text-xl font-semibold text-brand-900">{h.name}</h2>
                        <p className="mt-1 text-sm text-stone-700">
                          {h.stars > 0 && <span aria-label={h.categoryName} className="mr-2 text-amber-600">{'★'.repeat(h.stars)}</span>}
                          {h.categoryName}
                        </p>
                        {h.address && <p className="mt-1 text-sm text-stone-600">{h.address}</p>}
                      </div>
                      <p className="text-right">
                        <span className="block text-xs text-stone-600">{t.results.from}</span>
                        <span className="block font-serif text-2xl font-semibold text-brand-900">{money(h.from)}</span>
                        <span className="block text-xs text-stone-600">{t.results.total}</span>
                        {nights > 1 && <span className="block text-xs text-stone-600">{money(Math.ceil(h.from / nights))} {t.results.perNight}</span>}
                      </p>
                    </div>
                    {h.facilities.length > 0 && (
                      <p className="mt-3 text-sm text-stone-700"><span className="font-medium">{t.results.facilities}:</span> {h.facilities.slice(0, 5).join(', ')}</p>
                    )}
                    <ul className="mt-4 grid gap-3">
                      {h.rates.map((r) => (
                        <li key={r.rateKey} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-brand-50/60 p-3">
                          <div className="min-w-0 text-sm">
                            <p className="font-semibold text-stone-900">{r.roomName}</p>
                            <p className="text-stone-700">{r.boardName}</p>
                            <p className={r.freeCancellationUntil ? 'text-green-800' : 'text-stone-600'}>
                              {r.freeCancellationUntil ? fmt(t.results.freeCancel, { date: longDate(r.freeCancellationUntil) }) : t.results.nonRefundable}
                            </p>
                            {r.promotions.map((p) => <p key={p} className="text-brand-700">{t.results.promotion}: {p}</p>)}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-serif text-lg font-semibold text-brand-900">{money(r.price)}</span>
                            <button type="button" className={primaryButton} onClick={() => onSelect?.(h, r)}>{t.results.select}</button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
