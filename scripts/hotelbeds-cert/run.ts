// Hotelbeds certification scenarios (docs/hotelbeds-certification.md, Task 17).
// Runs the scenarios Hotelbeds asks to see against the TEST API and saves every
// request and response as JSON so they can be sent with the certification email.
//
//   A  one room, 2 adults                      search -> book -> voucher data
//   B  two rooms, different occupancies        search (+ CheckRate when needed); no booking, see the note in the pack
//   C  children with ages                      search -> book with ages
//   D  a RECHECK rate                          search -> CheckRate -> book
//   E  a BOOKABLE rate                         search -> book, and NO CheckRate call
//   F  cancellation                            every booking made above is cancelled
//
// Run from the repo root (Node 22.5+):
//   export HOTELBEDS_API_KEY=... HOTELBEDS_SECRET=...        # the TEST key
//   sh scripts/hotelbeds-cert/run.sh
// Optional: HOTEL_CODES=1234,5678 (Agra hotel codes; without it the search uses
// the destination code, AGR by default), DESTINATION=PMI (another destination; the test
// inventory is thin in Agra, so scenarios C and D may need one), CHECK_IN=2026-12-10, NIGHTS=2.
//
// Safety: it refuses to run unless the server is api.test.hotelbeds.com, it never
// writes the key or secret to the logs, and it cancels what it books even when a
// scenario fails. Nothing here touches the website's database or Razorpay.
import { mkdirSync, writeFileSync } from 'node:fs';
import { cancelHotelBooking, bookHotel, getHotelBooking, hbConfig, hbRequest } from '../../src/lib/hotelbeds';
import { buildAvailabilityBody, parseAvailability, type HotelResult, type RateOption, type SearchInput } from '../../src/lib/hotelSearch';

const cfg = hbConfig(process.env);
if (!cfg) {
  console.error('Set HOTELBEDS_API_KEY and HOTELBEDS_SECRET (the test key) and run again.');
  process.exit(1);
}
if (new URL(cfg.baseUrl).host !== 'api.test.hotelbeds.com') {
  console.error(`Refusing to run against ${cfg.baseUrl}: this script books real inventory when pointed at the live API. Unset HOTELBEDS_BASE_URL to use the test server.`);
  process.exit(1);
}

// Hotelbeds rate-limits the test key (HTTP 429). Every call is spaced out, and a 429 is
// waited out and retried a few times before the scenario gives up.
const GAP_MS = Number(process.env.CERT_GAP_MS ?? 1500);
const BACKOFF_MS = Number(process.env.CERT_BACKOFF_MS ?? 15000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
let rateLimited = false;
async function call<T extends { status: number }>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let res!: T;
  for (let i = 0; i < attempts; i++) {
    const wait = lastCall + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    res = await fn();
    lastCall = Date.now();
    if (res.status !== 429) {
      rateLimited = false;
      return res;
    }
    rateLimited = true;
    console.log(`    HTTP 429 (too many requests): waiting ${Math.round((BACKOFF_MS * (i + 1)) / 1000)}s before trying again`);
    await sleep(BACKOFF_MS * (i + 1));
  }
  return res;
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = `hotelbeds-cert-logs/${stamp}`;
mkdirSync(dir, { recursive: true });
let n = 0;
const log = (label: string, request: unknown, response: { status: number; json: unknown }) => {
  n += 1;
  const file = `${dir}/${String(n).padStart(2, '0')}-${label}.json`;
  writeFileSync(file, JSON.stringify({ label, request, status: response.status, response: response.json }, null, 2));
  console.log(`  ${String(n).padStart(2, '0')} ${label}: HTTP ${response.status}`);
};
const notes: string[] = [];
const note = (s: string) => { notes.push(s); console.log(`  - ${s}`); };

const addDays = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
const checkIn = process.env.CHECK_IN || addDays(new Date().toISOString().slice(0, 10), 30);
const checkOut = addDays(checkIn, Number(process.env.NIGHTS) || 2);
const hotelCodes = (process.env.HOTEL_CODES || '').split(',').map((s) => Number(s.trim())).filter((x) => Number.isInteger(x) && x > 0);

async function availability(label: string, rooms: SearchInput['rooms'], offsetDays = 0, nights = Number(process.env.NIGHTS) || 2): Promise<HotelResult[]> {
  const stayIn = addDays(checkIn, offsetDays);
  const input: SearchInput = { checkIn: stayIn, checkOut: addDays(stayIn, nights), rooms };
  const body: any = buildAvailabilityBody(input, hotelCodes);
  if (hotelCodes.length === 0) body.hotels = undefined, body.destination = { code: process.env.DESTINATION || 'AGR' };
  const res = await call(() => hbRequest(cfg!, '/hotel-api/1.0/hotels', { body, timeoutMs: 60_000 }));
  log(`availability-${label}`, body, res);
  return parseAvailability(res.json);
}

async function checkRate(label: string, rateKey: string): Promise<{ rateKey: string; net: number } | null> {
  const body = { rooms: [{ rateKey }] };
  const res = await call(() => hbRequest(cfg!, '/hotel-api/1.0/checkrates', { body }));
  log(`checkrate-${label}`, body, res);
  const rate = res.json?.hotel?.rooms?.[0]?.rates?.[0];
  return res.status === 200 && rate?.rateKey ? { rateKey: rate.rateKey, net: Number(rate.net) } : null;
}

const booked: { label: string; reference: string }[] = [];
async function book(label: string, rateKey: string, party: { adults: number; childAges: number[] }) {
  const paxes = [
    ...Array.from({ length: party.adults }, (_, i) => ({ roomId: 1, type: 'AD' as const, name: 'Test', surname: `Adult${i + 1}` })),
    ...party.childAges.map((age, i) => ({ roomId: 1, type: 'CH' as const, name: 'Test', surname: `Child${i + 1}`, age })),
  ];
  const request = { clientReference: `CERT${label}${Date.now().toString(36)}`.slice(0, 20), holder: { name: 'Test', surname: 'Holder' }, rooms: [{ rateKey, paxes }] };
  const res = await call(() => bookHotel(cfg!, request));
  log(`booking-${label}`, request, res);
  const reference = res.json?.booking?.reference;
  if (res.status === 200 && typeof reference === 'string') {
    booked.push({ label, reference });
    const detail = await call(() => getHotelBooking(cfg!, reference));
    log(`booking-detail-${label}`, { reference }, detail);
    const supplier = res.json.booking.invoiceCompany;
    note(`${label}: booked ${reference}; supplier on the booking response: ${supplier?.company ?? supplier?.name ?? 'MISSING'} / VAT ${supplier?.registrationNumber ?? 'MISSING'}`);
  } else {
    note(`${label}: booking FAILED (HTTP ${res.status}); see the log`);
  }
}

const pick = (hotels: HotelResult[], want?: RateOption['rateType']): RateOption | null =>
  hotels.flatMap((h) => h.rates).find((r) => !want || r.rateType === want) ?? null;

// The test inventory is thin, so a scenario that finds nothing in one window tries
// other dates (and 1 or 3 nights) before giving up. Every attempt is logged.
const WINDOWS: [number, number][] = [[0, 2], [0, 1], [7, 2], [14, 3], [30, 2], [45, 1], [60, 2], [90, 2], [120, 3]];
async function findStay(label: string, rooms: SearchInput['rooms'], accept: (hotels: HotelResult[]) => boolean, windows: [number, number][] = WINDOWS): Promise<HotelResult[]> {
  let last: HotelResult[] = [];
  for (let i = 0; i < windows.length; i++) {
    const [offset, nights] = windows[i];
    last = await availability(`${label}-try${i + 1}`, rooms, offset, nights);
    const rates = last.reduce((n, h) => n + h.rates.length, 0);
    console.log(`    try ${i + 1}: +${offset} days, ${nights} night(s): ${last.length} hotels, ${rates} rates`);
    if (accept(last)) return last;
    if (rateLimited) {
      note(`${label}: Hotelbeds is still rate-limiting (HTTP 429) after waiting. Stopping this scenario; wait a few minutes (or until tomorrow if the test quota is used up) and run again.`);
      break;
    }
  }
  return last;
}
const hasRates = (h: HotelResult[]) => h.some((x) => x.rates.length > 0);
const hasRecheck = (h: HotelResult[]) => h.some((x) => x.rates.some((r) => r.rateType === 'RECHECK'));

async function main() {
  console.log(`Stay ${checkIn} to ${checkOut} on ${cfg!.baseUrl}. Logs: ${dir}`);

  console.log('A. One room, 2 adults');
  const a = await availability('A', [{ adults: 2, childAges: [] }]);
  const ra = pick(a, 'BOOKABLE') ?? pick(a);
  if (!ra) note('A: no rates returned');
  else {
    let key = ra.rateKey;
    if (ra.rateType === 'RECHECK') key = (await checkRate('A', key))?.rateKey ?? key;
    await book('A', key, { adults: 2, childAges: [] });
  }

  console.log('B. Two rooms, different occupancies (search only)');
  const b = await findStay('B', [{ adults: 2, childAges: [] }, { adults: 1, childAges: [6] }], hasRates);
  const rb = pick(b, 'RECHECK');
  if (rb) await checkRate('B', rb.rateKey);
  note(`B: ${b.length} hotels returned with ${b.reduce((n, h) => n + h.rates.length, 0)} rates. Our checkout cannot book rooms with different occupancies yet (see the pack).`);

  console.log('C. Children with ages');
  // The test inventory rarely has a room for 2 adults and 2 children, so smaller families are tried too.
  const FAMILIES: { adults: number; childAges: number[] }[] = [
    { adults: 2, childAges: [5, 9] },
    { adults: 2, childAges: [7] },
    { adults: 1, childAges: [7] },
  ];
  const FAMILY_WINDOWS: [number, number][] = [[0, 2], [14, 3], [30, 2], [60, 2]];
  let c: HotelResult[] = [];
  let family = FAMILIES[0];
  for (const f of FAMILIES) {
    console.log(`  family: ${f.adults} adult(s), children aged ${f.childAges.join(', ')}`);
    c = await findStay(`C-${f.adults}a${f.childAges.length}c`, [f], hasRates, f === FAMILIES[0] ? WINDOWS : FAMILY_WINDOWS);
    family = f;
    if (hasRates(c) || rateLimited) break;
  }
  const rc = pick(c, 'BOOKABLE') ?? pick(c);
  if (!rc) note('C: no rates returned for any family size');
  else {
    const key = rc.rateType === 'RECHECK' ? ((await checkRate('C', rc.rateKey))?.rateKey ?? rc.rateKey) : rc.rateKey;
    await book('C', key, family);
  }

  console.log('D. A RECHECK rate');
  let rd = pick([...a, ...c, ...b], 'RECHECK');
  if (!rd) {
    const d = await findStay('D', [{ adults: 2, childAges: [] }], hasRecheck);
    rd = pick(d, 'RECHECK');
  }
  if (!rd) note('D: no RECHECK rate came back in these searches; widen the dates or HOTEL_CODES and run again');
  else {
    const checked = await checkRate('D', rd.rateKey);
    if (!checked) note('D: CheckRate did not return a bookable rate');
    else await book('D', checked.rateKey, { adults: rd.adults || 2, childAges: [] });
  }

  console.log('E. A BOOKABLE rate (no CheckRate call)');
  const re = pick([...a, ...c], 'BOOKABLE');
  if (!re) note('E: no BOOKABLE rate came back in these searches');
  else await book('E', re.rateKey, { adults: re.adults || 2, childAges: [] });
}

async function cancelAll() {
  console.log('F. Cancellation');
  for (const b of booked) {
    const res = await call(() => cancelHotelBooking(cfg!, b.reference), 8);
    log(`cancel-${b.label}`, { reference: b.reference }, res);
    note(`${b.label}: cancel ${b.reference} -> HTTP ${res.status}${res.status === 200 ? '' : ' (CANCEL BY HAND in the Hotelbeds test back office)'}`);
  }
}

try {
  await main();
} catch (e) {
  note(`ERROR: ${e instanceof Error ? e.message : 'unknown'}`);
} finally {
  await cancelAll();
  writeFileSync(`${dir}/SUMMARY.txt`, notes.join('\n') + '\n');
  console.log(`\nDone. Send the files in ${dir} with the certification email.`);
}
