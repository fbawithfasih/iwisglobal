// Taj Mahal night viewing is allowed only on the full-moon night and the two
// nights either side of it, never on a Friday (the monument is closed), and
// not at all during Ramzan. The Archaeological Survey of India publishes the
// full-moon nights for each year at https://www.tajmahal.gov.in/night-view.aspx
// (notice "Dates of full moon for night viewing of Taj Mahal in the year
// 2026-27"). Add the next year's nights here when the ASI publishes them: until
// then the Moonlight tour has no bookable dates after the last one below.
// Free of server-only code: the booking widget (browser) uses it too.

// Tours that can only be booked on a night-viewing night.
export const NIGHT_VIEWING_TOUR_IDS = ['TAJ_MAHAL_MOONLIGHT_TOUR'];

// Full-moon nights in the ASI's 2026-27 notice. February 2027 is absent on
// purpose: night viewing is suspended for Ramzan (17 Feb to 8 Mar 2027).
const FULL_MOON_NIGHTS = [
  '2026-04-02',
  '2026-05-01',
  '2026-05-31',
  '2026-06-29',
  '2026-07-29',
  '2026-08-28',
  '2026-09-26',
  '2026-10-26',
  '2026-11-24',
  '2026-12-23',
  '2027-01-22',
  '2027-03-21',
];

export const NIGHT_VIEWING_DATE_MESSAGE =
  'Night viewing is only on the full-moon night and the two nights either side (never a Friday). Please pick one of the listed dates.';

function shift(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const isFridayDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay() === 5;

// Every bookable night, sorted: each full-moon night plus two either side,
// minus Fridays.
export const NIGHT_VIEWING_DATES: string[] = [
  ...new Set(FULL_MOON_NIGHTS.flatMap((moon) => [-2, -1, 0, 1, 2].map((n) => shift(moon, n)))),
]
  .filter((d) => !isFridayDate(d))
  .sort();

export function isNightViewingTour(tourId: string): boolean {
  return NIGHT_VIEWING_TOUR_IDS.includes(tourId);
}

export function isNightViewingDate(value: string): boolean {
  return NIGHT_VIEWING_DATES.includes(value);
}

// The bookable nights on or after `minDate` (YYYY-MM-DD).
export function nightViewingDatesFrom(minDate: string): string[] {
  return NIGHT_VIEWING_DATES.filter((d) => d >= minDate);
}
