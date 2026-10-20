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
  // The admin test page (src/pages/admin/hotels/preview.astro) points these at
  // /admin/..., the only place the admin sign-in cookie is sent.
  searchUrl?: string;
  rateUrl?: string;
  bookPath?: string;
  t: Dictionary['hotelBooking'];
  currency: 'INR' | 'USD';
  intlLocale: string;
  locale: string;
}

// What the checkout page reads back from sessionStorage (see HotelCheckout).
export interface StoredSearch { checkIn: string; checkOut: string; rooms: { adults: number; childAges: number[] }[] }

const fieldClass =
  'min-h-11 w-full rounded-xl border border-brand-200 bg-white px-3 text-base text-stone-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';
const primaryButton =
  'min-h-11 rounded-full bg-brand-700 px-6 text-sm font-semibold text-white transition hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50';
const linkButton =
  'min-h-11 rounded-lg px-2 text-sm font-semibold text-brand-700 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-40 disabled:no-underline';
const labelClass = 'mb-1 block text-sm font-medium text-stone-800';

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export default function HotelSearch({ t, intlLocale, searchUrl = '/api/hotels/search', rateUrl = '/api/hotels/rate', bookPath = '/hotels/book' }: Props) {
  const [minDate, setMinDate] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [rooms, setRooms] = useState<RoomState[]>([{ adults: 2, childAges: [] }]);
  const [hotels, setHotels] = useState<ShownHotel[] | null>(null);
  // Nights of the search that produced `hotels`, as the server counted them.
  const [nights, setNights] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  // The search that produced `hotels`, and the rate whose price is being checked.
  const [searched, setSearched] = useState<StoredSearch | null>(null);
  const [selecting, setSelecting] = useState('');
  const [selectError, setSelectError] = useState('');
  const ageRefs = useRef<Record<string, HTMLSelectElement | null>>({});
  // The photo being viewed full size: the hotel's photos and which one is open.
  const [zoom, setZoom] = useState<{ images: string[]; index: number } | null>(null);

  // Keyboard for the full-size photo: Escape closes, the arrow keys move between photos.
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoom(null);
      else if (e.key === 'ArrowRight') setZoom((z) => (z ? { ...z, index: (z.index + 1) % z.images.length } : z));
      else if (e.key === 'ArrowLeft') setZoom((z) => (z ? { ...z, index: (z.index - 1 + z.images.length) % z.images.length } : z));
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [zoom]);

  // Read on the client so the server render and first client render match.
  useEffect(() => setMinDate(getAvailability().minBookableDate), []);

  // The custom-tour thanks page links here with the trip's dates and party
  // (?checkIn=&checkOut=&adults=). Only well-formed values are used; the server
  // validates the search again either way.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
    const inDate = q.get('checkIn');
    const outDate = q.get('checkOut');
    if (isDate(inDate) && isDate(outDate) && outDate > inDate) {
      setCheckIn(inDate);
      setCheckOut(outDate);
    }
    const adults = Number(q.get('adults'));
    if (Number.isInteger(adults) && adults >= 1 && adults <= MAX_ADULTS_PER_ROOM) setRooms([{ adults, childAges: [] }]);
  }, []);

  // Amounts are shown in the currency the server priced them in.
  const money = (n: number, cur: 'INR' | 'USD') => `${cur === 'USD' ? '$' : '₹'}${n.toLocaleString(cur === 'USD' ? 'en-US' : 'en-IN')}`;
  const longDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(intlLocale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  };

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
      const res = await fetch(searchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkIn, checkOut, rooms }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && Array.isArray(data?.hotels)) {
        setHotels(data.hotels);
        setNights(Number(data.nights) || 1);
        setSearched({ checkIn, checkOut, rooms: rooms.map((r) => ({ adults: r.adults, childAges: r.childAges as number[] })) });
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

  // Ask the server to re-check and price the chosen rate, then go to the
  // booking page. Nothing from here is trusted for the price.
  async function select(r: ShownRate) {
    if (selecting || !searched) return;
    setSelectError('');
    setSelecting(r.rateKey);
    try {
      const trip = new URLSearchParams(window.location.search).get('trip') ?? undefined;
      const res = await fetch(rateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rateKey: r.rateKey, shownPrice: r.price, trip }),
      });
      const data = await res.json().catch(() => null);
      const id = data?.quote?.bookingId;
      if (res.ok && typeof id === 'string') {
        try {
          sessionStorage.setItem(`hotel-quote:${id}`, JSON.stringify({ quote: data.quote, search: searched }));
        } catch {
          // The booking page shows its "expired" message if this is blocked.
        }
        window.location.href = `${bookPath}?b=${encodeURIComponent(id)}`;
        return;
      }
      setSelectError(data?.error === 'sold_out' ? t.errors.sold_out : data?.error === 'unavailable' ? t.errors.unavailable : t.errors.select_failed);
    } catch {
      setSelectError(t.errors.select_failed);
    }
    setSelecting('');
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
        {selectError && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{selectError}</p>}
        {hotels && hotels.length === 0 && <p className="rounded-xl bg-stone-100 p-4 text-sm text-stone-700">{t.results.none}</p>}
        {hotels && hotels.length > 0 && (
          <ul className="grid gap-6">
            {hotels.map((h) => (
              <li key={h.code} className="overflow-hidden rounded-3xl border border-brand-100 bg-white shadow-sm shadow-brand-900/5">
                <div className="grid md:grid-cols-[16rem_1fr]">
                  {h.image ? (
                    <button type="button" onClick={() => setZoom({ images: h.images.length ? h.images : [h.image!], index: 0 })} aria-label={`${h.name}: ${t.results.details}`} className="block h-48 w-full cursor-zoom-in md:h-full">
                      <img src={h.image} alt="" loading="lazy" className="h-full w-full object-cover" />
                    </button>
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
                        <span className="block font-serif text-2xl font-semibold text-brand-900">{money(h.from, h.currency)}</span>
                        <span className="block text-xs text-stone-600">{t.results.total}</span>
                        <span className="block text-xs text-stone-600">{money(h.rates[0].perNight, h.rates[0].currency)} {t.results.perNight}</span>
                      </p>
                    </div>
                    {h.facilities.length > 0 && (
                      <p className="mt-3 text-sm text-stone-700"><span className="font-medium">{t.results.facilities}:</span> {h.facilities.slice(0, 5).join(', ')}</p>
                    )}
                    {(h.description || h.images.length > 1 || h.facilityList.length > 0) && (
                      <details className="mt-3 rounded-xl border border-brand-100 bg-brand-50/40 p-3 text-sm text-stone-700">
                        <summary className="cursor-pointer font-medium text-brand-800">{t.results.details}</summary>
                        {h.description && <p className="mt-3 whitespace-pre-line">{h.description}</p>}
                        {h.images.length > 1 && (
                          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {h.images.map((src, i) => (
                              <li key={src}>
                                <button type="button" onClick={() => setZoom({ images: h.images, index: i })} aria-label={`${h.name} ${i + 1}/${h.images.length}`} className="block w-full cursor-zoom-in">
                                  <img src={src} alt="" loading="lazy" className="h-24 w-full rounded-lg object-cover" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        {h.facilityList.length > 0 && (
                          <div className="mt-3">
                            <p className="font-medium">{t.results.allFacilities}</p>
                            <ul className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                              {h.facilityList.map((f) => <li key={f.name}>{f.name}{f.paid && <span className="text-stone-500"> ({t.results.extraFee})</span>}</li>)}
                            </ul>
                          </div>
                        )}
                      </details>
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
                            <span className="font-serif text-lg font-semibold text-brand-900">{money(r.price, r.currency)}</span>
                            {nights > 1 && <span className="text-xs text-stone-600">{money(r.perNight, r.currency)} {t.results.perNight}</span>}
                            <button type="button" className={primaryButton} disabled={!!selecting} onClick={() => select(r)}>{t.results.select}</button>
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
      {zoom && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3" onClick={() => setZoom(null)}>
          <img src={zoom.images[zoom.index]} alt="" className="max-h-[88vh] max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
          <button type="button" autoFocus onClick={() => setZoom(null)} aria-label={t.results.closePhoto} className="absolute right-3 top-3 min-h-11 min-w-11 rounded-full bg-white/90 text-xl font-semibold text-stone-900">✕</button>
          {zoom.images.length > 1 && (
            <>
              <button type="button" onClick={(e) => { e.stopPropagation(); setZoom({ ...zoom, index: (zoom.index - 1 + zoom.images.length) % zoom.images.length }); }} aria-label={t.results.previousPhoto} className="absolute left-3 top-1/2 min-h-11 min-w-11 -translate-y-1/2 rounded-full bg-white/90 text-xl font-semibold text-stone-900">‹</button>
              <button type="button" onClick={(e) => { e.stopPropagation(); setZoom({ ...zoom, index: (zoom.index + 1) % zoom.images.length }); }} aria-label={t.results.nextPhoto} className="absolute right-3 top-1/2 min-h-11 min-w-11 -translate-y-1/2 rounded-full bg-white/90 text-xl font-semibold text-stone-900">›</button>
              <p className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">{zoom.index + 1} / {zoom.images.length}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
