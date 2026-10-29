// Writes the German site texts next to their English originals as a CSV for a native speaker to proofread (Google Sheets or Excel).
// Round 1 is the customer journey: from the home page to the booking confirmation, the policies and the emails.
// Run:  npx esbuild scripts/german-review-export.ts --bundle --platform=node --format=esm --outfile=/tmp/gre.mjs --log-level=error \
//         --define:import.meta.glob=__glob "--banner:js=const __glob = () => ({});" && node /tmp/gre.mjs > docs/german-review/de-round-1.csv
// HTML tags inside a text (for example <strong> or <a href>) must stay as they are; only the words around them are corrected.
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';

const ROUND_1 = ['nav', 'hero', 'trust', 'home', 'footer', 'tourCard', 'toursPage', 'tourPage', 'offers', 'founding', 'booking', 'confirmation', 'enquiryForm', 'contactPage', 'aboutPage', 'impressumPage', 'cancelPage', 'termsPage', 'privacyPage', 'emails'];

const rows: [string, string, string][] = [];
const walk = (path: string, d: unknown, e: unknown) => {
  if (typeof d === 'string') rows.push([path, typeof e === 'string' ? e : '', d]);
  else if (d && typeof d === 'object') for (const k of Object.keys(d as object)) walk(`${path}.${k}`, (d as any)[k], (e as any)?.[k]);
};
for (const ns of ROUND_1) walk(ns, (de as any)[ns], (en as any)[ns]);

const cell = (s: string) => `"${s.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
console.log(['key', 'english', 'german_now', 'german_corrected_or_OK', 'note'].map(cell).join(','));
for (const [k, e, g] of rows) console.log([k, e, g, '', ''].map(cell).join(','));
