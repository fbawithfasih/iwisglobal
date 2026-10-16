#!/usr/bin/env node
// Turns a private-offer JSON file into ONE SQL statement for the
// private_offers table (schema_private_offers.sql). It never connects to a
// database: the owner applies the printed SQL after an explicit decision.
//
// Usage:
//   node scripts/offer-seed.mjs <offer.json>             SQL on stdout, id on stderr
//   node scripts/offer-seed.mjs <offer.json> --id-only   only the id on stdout
//
// If the JSON has no id, or the all-zero placeholder id, a new
// po_ + 32 hex id is generated. Put the printed id into the JSON `id` field
// and into the end of the `link` field (https://www.iwisglobal.com/offer/<id>)
// BEFORE running scripts/offer-pdf.mjs, so the PDF carries the real link.
// Keep the JSON file out of the repository: it holds customer data.

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const PLACEHOLDER_ID = 'po_00000000000000000000000000000000';
const ID_PATTERN = /^po_[0-9a-f]{32}$/;
const CURRENCIES = ['EUR', 'USD', 'INR'];

const fail = (msg) => {
  process.stderr.write(`offer-seed: ${msg}\n`);
  process.exit(1);
};
const isStr = (v) => typeof v === 'string';
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function validate(o) {
  if (!isObj(o)) fail('the JSON must be an object');
  if (!isStr(o.customerName) || !o.customerName.trim()) fail('customerName must be a non-empty string');
  for (const k of ['customerEmail', 'customerPhone']) {
    if (o[k] !== undefined && !isStr(o[k])) fail(`${k} must be a string`);
  }
  if (!CURRENCIES.includes(o.currency)) fail(`currency must be one of ${CURRENCIES.join(', ')}`);
  if (!isInt(o.depositPercent) || o.depositPercent < 1 || o.depositPercent > 99) fail('depositPercent must be an integer from 1 to 99');
  if (!isInt(o.germanGuideExtraMinor) || o.germanGuideExtraMinor < 0) fail('germanGuideExtraMinor must be an integer of 0 or more');
  if (!Array.isArray(o.options) || o.options.length === 0) fail('options must be a non-empty array');
  const ids = new Set();
  o.options.forEach((p, i) => {
    if (!isObj(p)) fail(`options[${i}] must be an object`);
    for (const k of ['id', 'label', 'vehicle']) if (!isStr(p[k]) || !p[k]) fail(`options[${i}].${k} must be a non-empty string`);
    if (!isInt(p.totalMinor) || p.totalMinor <= 0) fail(`options[${i}].totalMinor must be a positive integer`);
    if (ids.has(p.id)) fail(`options[${i}].id "${p.id}" is duplicated`);
    ids.add(p.id);
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
  if (c.pdf !== undefined && typeof c.pdf !== 'boolean') fail('content.pdf must be a boolean');
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const args = process.argv.slice(2);
const idOnly = args.includes('--id-only');
const file = args.find((a) => !a.startsWith('--'));
if (!file) fail('usage: node scripts/offer-seed.mjs <offer.json> [--id-only]');

let data;
try {
  data = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  fail(`cannot read ${file}: ${e.message}`);
}
validate(data);

let id = data.id;
if (id === undefined || id === '' || id === PLACEHOLDER_ID) {
  id = `po_${randomBytes(16).toString('hex')}`;
} else if (!isStr(id) || !ID_PATTERN.test(id)) {
  fail('id must be missing or look like po_ followed by 32 lowercase hex characters');
}

if (idOnly) {
  process.stdout.write(`${id}\n`);
  process.exit(0);
}

const options = data.options.map((p) => ({ id: p.id, label: p.label, vehicle: p.vehicle, totalMinor: p.totalMinor }));
const c = data.content;
const content = {
  title: c.title, summary: c.summary, dateLabel: c.dateLabel, travellers: c.travellers,
  pickup: c.pickup, hotel: c.hotel,
  itinerary: c.itinerary.map((s) => ({ time: s.time, title: s.title, text: s.text })),
  includes: c.includes, excludes: c.excludes, cancellation: c.cancellation, contactWhatsapp: c.contactWhatsapp,
};
if (c.pdf !== undefined) content.pdf = c.pdf;

const sql =
  `INSERT INTO private_offers (id, status, customer_name, customer_email, customer_phone, currency, content_json, options_json, deposit_percent, german_guide_extra_minor, created_at) VALUES (` +
  [
    q(id), q('open'), q(data.customerName), q(data.customerEmail ?? ''), q(data.customerPhone ?? ''), q(data.currency),
    q(JSON.stringify(content)), q(JSON.stringify(options)), String(data.depositPercent), String(data.germanGuideExtraMinor), q(new Date().toISOString()),
  ].join(', ') +
  `);\n`;

process.stderr.write(`offer id: ${id}\n`);
process.stdout.write(sql);
