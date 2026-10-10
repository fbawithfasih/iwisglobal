// Country calling codes for the booking form's phone field. ISO 3166-1 alpha-2
// code -> ITU calling code. Territories that share +1 (the North American
// numbering plan) all use "1": the guest types their area code as part of the
// number. Names come from the browser's own region names (Intl.DisplayNames),
// so no name table has to be shipped.
const DIAL_CODES: Record<string, string> = {
  AF: '93', AL: '355', DZ: '213', AS: '1', AD: '376', AO: '244', AI: '1', AG: '1', AR: '54', AM: '374',
  AW: '297', AU: '61', AT: '43', AZ: '994', BS: '1', BH: '973', BD: '880', BB: '1', BY: '375', BE: '32',
  BZ: '501', BJ: '229', BM: '1', BT: '975', BO: '591', BA: '387', BW: '267', BR: '55', IO: '246', VG: '1',
  BN: '673', BG: '359', BF: '226', BI: '257', KH: '855', CM: '237', CA: '1', CV: '238', BQ: '599', KY: '1',
  CF: '236', TD: '235', CL: '56', CN: '86', CX: '61', CC: '61', CO: '57', KM: '269', CG: '242', CD: '243',
  CK: '682', CR: '506', CI: '225', HR: '385', CU: '53', CW: '599', CY: '357', CZ: '420', DK: '45', DJ: '253',
  DM: '1', DO: '1', EC: '593', EG: '20', SV: '503', GQ: '240', ER: '291', EE: '372', SZ: '268', ET: '251',
  FK: '500', FO: '298', FJ: '679', FI: '358', FR: '33', GF: '594', PF: '689', GA: '241', GM: '220', GE: '995',
  DE: '49', GH: '233', GI: '350', GR: '30', GL: '299', GD: '1', GP: '590', GU: '1', GT: '502', GG: '44',
  GN: '224', GW: '245', GY: '592', HT: '509', HN: '504', HK: '852', HU: '36', IS: '354', IN: '91', ID: '62',
  IR: '98', IQ: '964', IE: '353', IM: '44', IL: '972', IT: '39', JM: '1', JP: '81', JE: '44', JO: '962',
  KZ: '7', KE: '254', KI: '686', XK: '383', KW: '965', KG: '996', LA: '856', LV: '371', LB: '961', LS: '266',
  LR: '231', LY: '218', LI: '423', LT: '370', LU: '352', MO: '853', MG: '261', MW: '265', MY: '60', MV: '960',
  ML: '223', MT: '356', MH: '692', MQ: '596', MR: '222', MU: '230', YT: '262', MX: '52', FM: '691', MD: '373',
  MC: '377', MN: '976', ME: '382', MS: '1', MA: '212', MZ: '258', MM: '95', NA: '264', NR: '674', NP: '977',
  NL: '31', NC: '687', NZ: '64', NI: '505', NE: '227', NG: '234', NU: '683', NF: '672', KP: '850', MK: '389',
  MP: '1', NO: '47', OM: '968', PK: '92', PW: '680', PS: '970', PA: '507', PG: '675', PY: '595', PE: '51',
  PH: '63', PL: '48', PT: '351', PR: '1', QA: '974', RE: '262', RO: '40', RU: '7', RW: '250', BL: '590',
  SH: '290', KN: '1', LC: '1', MF: '590', PM: '508', VC: '1', WS: '685', SM: '378', ST: '239', SA: '966',
  SN: '221', RS: '381', SC: '248', SL: '232', SG: '65', SX: '1', SK: '421', SI: '386', SB: '677', SO: '252',
  ZA: '27', KR: '82', SS: '211', ES: '34', LK: '94', SD: '249', SR: '597', SJ: '47', SE: '46', CH: '41',
  SY: '963', TW: '886', TJ: '992', TZ: '255', TH: '66', TL: '670', TG: '228', TK: '690', TO: '676', TT: '1',
  TN: '216', TR: '90', TM: '993', TC: '1', TV: '688', UG: '256', UA: '380', AE: '971', GB: '44', US: '1',
  UY: '598', UZ: '998', VU: '678', VA: '39', VE: '58', VN: '84', VI: '1', WF: '681', EH: '212', YE: '967',
  ZM: '260', ZW: '263', AX: '358',
};

export interface Country {
  iso: string;
  name: string;
  dial: string; // digits only, no "+"
}

// Shown first in the list: where most guests come from, then A to Z.
const POPULAR = ['IN', 'US', 'GB', 'CA', 'AU', 'AE', 'DE', 'FR', 'IT', 'ES', 'NL', 'SG'];

let cache: { all: Country[]; popular: Country[] } | undefined;

export function getCountries(): { all: Country[]; popular: Country[] } {
  if (cache) return cache;
  let names: Intl.DisplayNames | undefined;
  try {
    names = new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    names = undefined;
  }
  const all = Object.entries(DIAL_CODES)
    .map(([iso, dial]) => ({ iso, dial, name: names?.of(iso) ?? iso }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const popular = POPULAR.map((iso) => all.find((c) => c.iso === iso)).filter((c): c is Country => !!c);
  cache = { all, popular };
  return cache;
}

export function flagSrc(iso: string): string {
  return `/flags/${iso.toLowerCase()}.svg`;
}

export function countryByIso(iso: string): Country {
  const { all } = getCountries();
  return all.find((c) => c.iso === iso) ?? all[0];
}

// Countries that keep a leading 0 in the number after the country code
// (Italian numbers include it). Everywhere else one leading 0 is the national
// "trunk" prefix, which is dropped when dialling from abroad.
const KEEPS_LEADING_ZERO = new Set(['IT', 'VA', 'SM']);

// What the booking form stores: "+<code> <digits>", or '' when no digits.
export function formatPhone(country: Country, national: string): string {
  let digits = national.replace(/\D/g, '');
  if (!KEEPS_LEADING_ZERO.has(country.iso)) digits = digits.replace(/^0/, '');
  return digits ? `+${country.dial} ${digits}` : '';
}

// Main country for calling codes shared by several countries.
const MAIN_FOR_SHARED_CODE = new Set(['US', 'GB', 'IN', 'RU', 'AU', 'FR', 'NO', 'FI', 'IT', 'MA', 'NL', 'ZA']);

// A full international number (typed or pasted as "+44 7700 900123") is split
// into its country and the rest, using the longest matching calling code.
export function parseInternational(raw: string, fallback: Country): { country: Country; national: string } {
  const text = raw.trim();
  if (!text.startsWith('+')) return { country: fallback, national: text };
  const digits = text.replace(/\D/g, '');
  const { all } = getCountries();
  for (let len = 3; len >= 1; len--) {
    const code = digits.slice(0, len);
    const matches = all.filter((c) => c.dial === code);
    if (matches.length) {
      const preferred = matches.find((c) => MAIN_FOR_SHARED_CODE.has(c.iso)) ?? matches[0];
      return { country: preferred, national: digits.slice(len) };
    }
  }
  return { country: fallback, national: digits };
}

// Best guess at the visitor's country from their browser language (en-GB -> GB).
export function guessCountry(): Country | undefined {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return region ? getCountries().all.find((c) => c.iso === region) : undefined;
  } catch {
    return undefined;
  }
}
