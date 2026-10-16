#!/usr/bin/env node
// Renders a private-offer JSON file as a branded A4 itinerary PDF (selectable
// text) using headless Google Chrome on macOS.
//
// Usage:
//   node scripts/offer-pdf.mjs <offer.json> <out.pdf> [--logo <path.png|.jpg>] [--keep-html] [--allow-placeholder]
//
// Example (sharper than the default 250 px public/logo.png when printed):
//   node scripts/offer-pdf.mjs offer.json offer.pdf --logo path/to/iwis-logo-hires.jpg
//
// Workflow: run scripts/offer-seed.mjs <offer.json> --id-only, put the printed
// id into the JSON `id` field and at the end of `link`
// (https://www.iwisglobal.com/offer/<id>), then run this script so the PDF
// carries the real link. The intermediate HTML is written to the system temp
// folder and deleted afterwards (it contains the customer's name); pass
// --keep-html to keep it (its path is printed). The id must not be the all-zero
// placeholder and `link` must end with /offer/<id>; --allow-placeholder skips
// the placeholder check for sample runs only. Keep the JSON and PDF out of the repository:
// they hold customer data.

import { readFileSync, writeFileSync, existsSync, statSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { dirname, extname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CURRENCIES = ['EUR', 'USD', 'INR'];

const fail = (msg) => {
  process.stderr.write(`offer-pdf: ${msg}\n`);
  process.exit(1);
};
const isStr = (v) => typeof v === 'string';
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const PLACEHOLDER_ID = 'po_00000000000000000000000000000000';

function validate(o, allowPlaceholder) {
  if (!isObj(o)) fail('the JSON must be an object');
  if (!isStr(o.customerName) || !o.customerName.trim()) fail('customerName must be a non-empty string');
  if (!CURRENCIES.includes(o.currency)) fail(`currency must be one of ${CURRENCIES.join(', ')}`);
  if (!isInt(o.depositPercent) || o.depositPercent < 1 || o.depositPercent > 99) fail('depositPercent must be an integer from 1 to 99');
  if (!isInt(o.germanGuideExtraMinor) || o.germanGuideExtraMinor < 0) fail('germanGuideExtraMinor must be an integer of 0 or more');
  if (!isStr(o.id) || !/^po_[0-9a-f]{32}$/.test(o.id)) fail('id must look like po_ followed by 32 lowercase hex characters');
  if (o.id === PLACEHOLDER_ID && !allowPlaceholder) {
    fail('the offer id is still the placeholder: run `node scripts/offer-seed.mjs <json> --id-only`, put the id in both `id` and `link` (pass --allow-placeholder only for sample runs)');
  }
  if (!isStr(o.link) || !/^https:\/\/\S+$/.test(o.link)) fail('link must be an https URL');
  if (!o.link.endsWith(`/offer/${o.id}`)) fail(`link must end with /offer/${o.id} (the offer id in the JSON)`);
  if (!Array.isArray(o.options) || o.options.length === 0) fail('options must be a non-empty array');
  o.options.forEach((p, i) => {
    if (!isObj(p)) fail(`options[${i}] must be an object`);
    for (const k of ['id', 'label', 'vehicle']) if (!isStr(p[k]) || !p[k]) fail(`options[${i}].${k} must be a non-empty string`);
    if (!isInt(p.totalMinor) || p.totalMinor <= 0) fail(`options[${i}].totalMinor must be a positive integer`);
  });
  const c = o.content;
  if (!isObj(c)) fail('content must be an object');
  for (const k of ['title', 'summary', 'dateLabel', 'pickup', 'hotel', 'cancellation', 'contactWhatsapp']) {
    if (!isStr(c[k])) fail(`content.${k} must be a string`);
  }
  if (!isInt(c.travellers) || c.travellers <= 0) fail('content.travellers must be a positive integer');
  if (!Array.isArray(c.itinerary) || c.itinerary.length === 0) fail('content.itinerary must be a non-empty array');
  c.itinerary.forEach((s, i) => {
    if (!isObj(s) || !isStr(s.time) || !isStr(s.title) || !isStr(s.text)) fail(`content.itinerary[${i}] needs string time, title and text`);
  });
  for (const k of ['includes', 'excludes']) {
    if (!Array.isArray(c[k]) || !c[k].every(isStr)) fail(`content.${k} must be an array of strings`);
  }
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

// ---- arguments ----
const args = process.argv.slice(2);
const pos = [];
let logoPath = null;
let keepHtml = false;
let allowPlaceholder = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--logo') {
    logoPath = args[++i];
    if (!logoPath) fail('--logo needs a file path');
  } else if (args[i] === '--keep-html') keepHtml = true;
  else if (args[i] === '--allow-placeholder') allowPlaceholder = true;
  else pos.push(args[i]);
}
if (pos.length !== 2) fail('usage: node scripts/offer-pdf.mjs <offer.json> <out.pdf> [--logo <path>] [--keep-html] [--allow-placeholder]');
const jsonFile = resolve(pos[0]);
const outPdf = resolve(pos[1]);
if (extname(outPdf).toLowerCase() !== '.pdf') fail('the output file must end in .pdf');

let offer;
try {
  offer = JSON.parse(readFileSync(jsonFile, 'utf8'));
} catch (e) {
  fail(`cannot read ${jsonFile}: ${e.message}`);
}
validate(offer, allowPlaceholder);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const logoFile = logoPath ? resolve(logoPath) : join(repoRoot, 'public', 'logo.png');
if (!existsSync(logoFile)) fail(`logo not found: ${logoFile}`);
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const mime = MIME[extname(logoFile).toLowerCase()];
if (!mime) fail('the logo must be a .png, .jpg or .jpeg file');
const logoUri = `data:${mime};base64,${readFileSync(logoFile).toString('base64')}`;

if (!existsSync(CHROME)) fail(`Google Chrome not found at ${CHROME}. Install Chrome, or render the HTML file by hand.`);

// ---- money ----
const fmt = new Intl.NumberFormat('en-IE', { style: 'currency', currency: offer.currency });
const money = (minor) => fmt.format(minor / 100);
const deposit = (total) => Math.round((total * offer.depositPercent) / 100);
const c = offer.content;
const pct = offer.depositPercent;

// ---- html ----
const timeline = c.itinerary
  .map(
    (s) => `<div class="step"><div class="time">${esc(s.time)}</div><div class="what"><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></div></div>`
  )
  .join('\n');

const optionCard = (o) => {
  const rows = [
    ['English-speaking guide', o.totalMinor],
    ['German-speaking guide', o.totalMinor + offer.germanGuideExtraMinor],
  ]
    .map(([name, total]) => {
      const dep = deposit(total);
      return `<div class="lang">
  <div class="lang-name">${esc(name)}</div>
  <div class="total">${esc(money(total))}</div>
  <div class="split">${esc(pct)}% booking amount <b>${esc(money(dep))}</b><br>Balance later <b>${esc(money(total - dep))}</b></div>
</div>`;
    })
    .join('\n');
  return `<div class="option"><h3>${esc(o.label)}</h3><p class="vehicle">${esc(o.vehicle)}</p>${rows}</div>`;
};

const list = (items) => items.map((t) => `<li>${esc(t)}</li>`).join('');
const extraNote = offer.germanGuideExtraMinor > 0 ? ` A German-speaking guide adds ${esc(money(offer.germanGuideExtraMinor))}.` : '';

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(c.title)} - ${esc(offer.customerName)}</title>
<style>
  @page { size: A4; margin: 0; }
  /* Chrome repeats thead/tfoot on every printed page, so these spacers keep every page's content clear of the top edge and of the footer. */
  table.frame { width: 100%; border-collapse: collapse; }
  table.frame td { padding: 0 14mm; vertical-align: top; }
  .sp-top { height: 12mm; } .sp-bot { height: 26mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 9.2pt; line-height: 1.38; color: #1f1a2e; }
  h1, h2, h3.serif, .brand { font-family: 'Cormorant Garamond', Georgia, 'Times New Roman', serif; }
  .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-35deg); z-index: -1; pointer-events: none;
    font-family: Helvetica, Arial, sans-serif; font-weight: 700; font-size: 64pt; letter-spacing: 8pt; color: #000; opacity: 0.08; white-space: nowrap; }
  .footer { position: fixed; bottom: 9mm; left: 14mm; right: 14mm; text-align: center; font-size: 7.8pt; color: #6b6480; border-top: 0.5pt solid #ddd6fe; padding-top: 2mm; background: transparent; }
  header { display: flex; align-items: center; gap: 6mm; padding-bottom: 4mm; border-bottom: 1.2mm solid #6d28d9; }
  header img { width: 25mm; height: 25mm; object-fit: contain; display: block; }
  .brand { font-size: 12pt; letter-spacing: 2pt; text-transform: uppercase; color: #6d28d9; font-weight: 700; }
  h1 { text-wrap: balance; margin: 1mm 0 1.5mm; font-size: 19pt; line-height: 1.08; color: #2e1065; font-weight: 700; }
  .prepared { font-size: 10pt; color: #4c4366; }
  .prepared b { color: #2e1065; }
  .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 6mm; margin: 3mm 0 1mm; padding: 2.5mm 4mm; background: #f5f3ff; border-left: 1.2mm solid #6d28d9; border-radius: 1mm; }
  .fact .k { font-size: 7.4pt; letter-spacing: 1pt; text-transform: uppercase; color: #6d28d9; font-weight: 700; }
  .fact .v { font-size: 9.6pt; }
  .summary { margin: 3mm 0 0; color: #3b3355; }
  h2 { font-size: 15pt; color: #2e1065; margin: 4mm 0 1.5mm; padding-bottom: 1mm; border-bottom: 0.4pt solid #ddd6fe; font-weight: 700; break-after: avoid; }
  .step { display: flex; gap: 4mm; padding: 1.3mm 0; border-bottom: 0.3pt solid #ede9fe; break-inside: avoid; }
  .time { flex: 0 0 27mm; font-weight: 700; color: #6d28d9; font-size: 9pt; padding-top: 0.3mm; }
  .what h3 { margin: 0; font-size: 10.2pt; color: #2e1065; }
  .what p { margin: 0.6mm 0 0; color: #3b3355; }
  .options { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; break-inside: avoid; }
  .option { border: 0.6pt solid #c4b5fd; border-radius: 2mm; padding: 3mm 3.5mm; background: #fff; }
  .option h3 { margin: 0; font-size: 11pt; color: #2e1065; }
  .vehicle { margin: 0.4mm 0 2mm; color: #6b6480; font-size: 8.6pt; }
  .lang { padding: 2mm 0; border-top: 0.3pt solid #ede9fe; }
  .lang-name { font-size: 8pt; letter-spacing: 0.6pt; text-transform: uppercase; color: #6b6480; font-weight: 700; }
  .total { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 19pt; font-weight: 700; color: #6d28d9; line-height: 1.15; }
  .split { font-size: 8.8pt; color: #3b3355; }
  .note { margin: 2mm 0 0; font-size: 8.8pt; color: #4c4366; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; break-inside: avoid; }
  .cols h3 { margin: 0 0 1mm; font-size: 10.2pt; color: #2e1065; }
  ul { margin: 0; padding-left: 4.5mm; } li { margin: 0.6mm 0; }
  .pay { break-inside: avoid; margin-top: 5mm; padding: 3.5mm 4mm; background: #f5f3ff; border: 0.6pt solid #c4b5fd; border-radius: 2mm; }
  .pay h2 { margin-top: 0; border: 0; padding: 0; }
  .pay .url { font-size: 10.4pt; font-weight: 700; word-break: break-all; }
  .pay a { color: #6d28d9; }
  .pay p { margin: 1.2mm 0 0; }
  .contact { break-inside: avoid; margin-top: 4mm; font-size: 9.2pt; }
  .contact b { color: #2e1065; }
</style></head>
<body>
<div class="watermark">CONFIDENTIAL</div>
<div class="footer">Confidential — prepared for ${esc(offer.customerName)}. IWIS Global — www.iwisglobal.com</div>
<table class="frame"><thead><tr><td><div class="sp-top"></div></td></tr></thead><tfoot><tr><td><div class="sp-bot"></div></td></tr></tfoot><tbody><tr><td>
<header>
  <img src="${logoUri}" alt="IWIS Global">
  <div>
    <div class="brand">IWIS Global</div>
    <h1>${esc(c.title)}</h1>
    <div class="prepared">Prepared for <b>${esc(offer.customerName)}</b></div>
  </div>
</header>
<div class="facts">
  <div class="fact"><div class="k">Date</div><div class="v">${esc(c.dateLabel)}</div></div>
  <div class="fact"><div class="k">Travellers</div><div class="v">${esc(c.travellers)}</div></div>
  <div class="fact"><div class="k">Pickup</div><div class="v">${esc(c.pickup)}</div></div>
  <div class="fact"><div class="k">Hotel</div><div class="v">${esc(c.hotel)}</div></div>
</div>
<p class="summary">${esc(c.summary)}</p>

<h2>Your day, step by step</h2>
${timeline}

<h2>Your options</h2>
<div class="options">
${offer.options.map(optionCard).join('\n')}
</div>
<p class="note">All prices are all-inclusive for your group of ${esc(c.travellers)}, in ${esc(offer.currency)}.${extraNote}</p>

<h2>What is included</h2>
<div class="cols">
  <div><h3>Included</h3><ul>${list(c.includes)}</ul></div>
  <div><h3>Not included</h3><ul>${list(c.excludes)}</ul></div>
</div>

<div class="pay">
  <h2>How to pay</h2>
  <div class="url"><a href="${esc(offer.link)}">${esc(offer.link)}</a></div>
  <p>Pay in full, or pay a ${esc(pct)}% booking amount now and the balance later, on the same secure page.</p>
  <p><b>Cancellation:</b> ${esc(c.cancellation)}</p>
</div>

<div class="contact">
  <b>Questions?</b> WhatsApp ${esc(c.contactWhatsapp)} &nbsp;|&nbsp; info@iwisglobal.com &nbsp;|&nbsp; www.iwisglobal.com
</div>
</td></tr></tbody></table>
</body></html>
`;

const htmlFile = join(tmpdir(), `offer-pdf-${process.pid}-${Date.now()}.html`);
let renderError = null;
const profileDir = mkdtempSync(join(tmpdir(), 'offer-pdf-chrome-'));
try {
  writeFileSync(htmlFile, html);
  execFileSync(
    CHROME,
    ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--user-data-dir=${profileDir}`, `--print-to-pdf=${outPdf}`, pathToFileURL(htmlFile).href],
    { stdio: ['ignore', 'ignore', 'ignore'], timeout: 90000 }
  );
} catch (e) {
  renderError = e;
} finally {
  rmSync(profileDir, { recursive: true, force: true });
  if (!keepHtml) {
    try { unlinkSync(htmlFile); } catch {}
  }
}
if (renderError) fail(`Chrome failed to render the PDF: ${renderError.message}`);
if (keepHtml) process.stdout.write(`HTML kept at ${htmlFile}\n`);

if (!existsSync(outPdf) || statSync(outPdf).size < 10 * 1024) fail('the PDF was not created or is suspiciously small');
const pages = (readFileSync(outPdf, 'latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
process.stdout.write(`${outPdf}${pages ? ` (${pages} page${pages === 1 ? '' : 's'})` : ''}\n`);
if (pages > 3) fail(`the PDF has ${pages} pages; shorten the text (maximum 3)`);
