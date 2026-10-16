// Validation of the /admin/hotels settings form, kept separate from the page so it can be unit-tested.
// saveHotelSettings treats a blank number as 0, so blanks are caught here first.
export interface HotelSettingsFormValues {
  markupPercent: string;
  fxEurInr: string;
  fxEurUsd: string;
  minStars: string;
}

export type HotelFormCheck = { ok: true } | { ok: false; error: string };

const FIELDS: { key: keyof HotelSettingsFormValues; label: string }[] = [
  { key: 'markupPercent', label: 'Markup percent' },
  { key: 'fxEurInr', label: 'EUR to INR rate' },
  { key: 'fxEurUsd', label: 'EUR to USD rate' },
  { key: 'minStars', label: 'Minimum stars' },
];

export function checkHotelSettingsForm(values: HotelSettingsFormValues, currentlyEnabled: boolean): HotelFormCheck {
  for (const f of FIELDS) {
    const raw = String(values[f.key] ?? '').trim();
    if (raw === '') return { ok: false, error: `${f.label} cannot be blank. Enter 0 if you mean zero.` };
    if (!Number.isFinite(Number(raw))) return { ok: false, error: `${f.label} must be a number.` };
  }
  if (currentlyEnabled && (Number(values.markupPercent.trim()) === 0 || Number(values.fxEurInr.trim()) === 0)) {
    return { ok: false, error: 'Hotels are switched on, so markup and the EUR to INR rate cannot be 0. Switch hotels off first.' };
  }
  return { ok: true };
}
