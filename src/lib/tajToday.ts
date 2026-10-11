// "Taj Mahal today": whether the monument is open, sunrise and sunset in
// Agra, and the next night-viewing night. Pure and browser-safe so the
// island can run it on the client and a node script can test it. Every
// function takes `now` so a test can pick the moment.
//
// Official visiting hours (tajmahal.gov.in): 30 minutes before sunrise to 30
// minutes before sunset, closed on Fridays. Sunrise and sunset come from the
// standard NOAA/"sunrise equation" calculation, accurate to about a minute or
// two, so the panel labels them approximate.

import { todayIst, isFriday } from './availability';
import { NIGHT_VIEWING_DATES } from './nightViewing';
import { intlLocale, type Locale } from './i18n';

const AGRA_LAT = 27.1751;
const AGRA_LON = 78.0421;
const RAD = Math.PI / 180;
const IST = 'Asia/Kolkata';
const DAY_MS = 86_400_000;

// Sunrise and sunset (as Dates) for a YYYY-MM-DD calendar day in Agra.
export function sunTimes(ymd: string): { sunrise: Date; sunset: Date } {
  const [y, m, d] = ymd.split('-').map(Number);
  // Days since J2000.0 at noon UT of this date, then adjusted to Agra's longitude.
  const jdNoon = Date.UTC(y, m - 1, d, 12) / DAY_MS + 2440587.5;
  const n = Math.round(jdNoon - 2451545.0 + 0.0008);
  const jStar = n - AGRA_LON / 360; // east longitude puts local solar noon before UT noon
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const transit = 2451545.0 + jStar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinDec = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  // -0.833 degrees: the sun's disc and atmospheric refraction at the horizon.
  const cosH = (Math.sin(-0.833 * RAD) - Math.sin(AGRA_LAT * RAD) * sinDec) / (Math.cos(AGRA_LAT * RAD) * cosDec);
  const H = Math.acos(Math.max(-1, Math.min(1, cosH))) / RAD;
  const toDate = (jd: number) => new Date((jd - 2440587.5) * DAY_MS);
  return { sunrise: toDate(transit - H / 360), sunset: toDate(transit + H / 360) };
}

export function formatTime(date: Date, locale: Locale = 'en'): string {
  // English keeps "5:24 PM"; the other languages use their own clock style.
  return date.toLocaleTimeString(locale === 'en' ? 'en-US' : intlLocale(locale), { hour: 'numeric', minute: '2-digit', timeZone: IST });
}

function shiftDay(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The Taj is open from 30 minutes before sunrise to 30 minutes before sunset.
function openingWindow(ymd: string): { opens: Date; closes: Date } {
  const { sunrise, sunset } = sunTimes(ymd);
  return { opens: new Date(sunrise.getTime() - 30 * 60_000), closes: new Date(sunset.getTime() - 30 * 60_000) };
}

export type TajState = 'open' | 'before-opening' | 'after-closing' | 'closed-friday';

export interface TajStatus {
  state: TajState;
  today: string; // YYYY-MM-DD in India
  sunrise: Date;
  sunset: Date;
  opens: Date; // today's opening time
  closes: Date; // today's closing time
  nextOpen: Date | null; // when it next opens, unless it is open now
}

export function tajStatus(now: Date = new Date()): TajStatus {
  const today = todayIst(now);
  const { sunrise, sunset } = sunTimes(today);
  const { opens, closes } = openingWindow(today);
  // The next day it is open (skipping a Friday).
  let next = shiftDay(today, 1);
  if (isFriday(next)) next = shiftDay(next, 1);
  const nextOpen = openingWindow(next).opens;

  let state: TajState;
  let upcoming: Date | null;
  if (isFriday(today)) {
    state = 'closed-friday';
    upcoming = openingWindow(shiftDay(today, 1)).opens;
  } else if (now < opens) {
    state = 'before-opening';
    upcoming = opens;
  } else if (now >= closes) {
    state = 'after-closing';
    upcoming = nextOpen;
  } else {
    state = 'open';
    upcoming = null;
  }
  return { state, today, sunrise, sunset, opens, closes, nextOpen: upcoming };
}

export interface NextNightViewing {
  date: string; // YYYY-MM-DD, the next night-viewing night (tonight counts until 11:59 PM)
  daysAway: number; // 0 = tonight
  runStart: string; // first night of the run of consecutive nights this one belongs to
  runEnd: string; // last night of that run
}

// The next night-viewing night on or after today, or null once the published
// dates run out (the list is yearly; see src/lib/nightViewing.ts).
export function nextNightViewing(now: Date = new Date()): NextNightViewing | null {
  const today = todayIst(now);
  const date = NIGHT_VIEWING_DATES.find((d) => d >= today);
  if (!date) return null;
  const dates = new Set(NIGHT_VIEWING_DATES);
  let runStart = date;
  while (dates.has(shiftDay(runStart, -1))) runStart = shiftDay(runStart, -1);
  let runEnd = date;
  while (dates.has(shiftDay(runEnd, 1))) runEnd = shiftDay(runEnd, 1);
  const daysAway = Math.round((new Date(`${date}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / DAY_MS);
  return { date, daysAway, runStart, runEnd };
}

// "Sat 24 Oct" for a YYYY-MM-DD date.
export function formatDay(ymd: string, locale: Locale = 'en'): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString(intlLocale(locale), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
