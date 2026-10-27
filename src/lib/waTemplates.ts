// WhatsApp message templates: the only thing the business may send to a guest who last wrote more
// than 24 hours ago. Each one must be created and approved in Meta (WhatsApp Manager) under exactly
// this name and language before it can be sent; until then WhatsApp refuses it and staff see why.
// The wording here is what is submitted for approval, so changing it means a new template in Meta.
// One parameter, {{1}}: the guest's first name.

export interface WaTemplate {
  id: string; // name:language, what the admin form posts
  name: string;
  language: 'en' | 'de';
  label: string;
  body: string;
  // The category to submit it under; Meta makes the final call and may reclassify it.
  category: 'UTILITY' | 'MARKETING';
}

export const WA_TEMPLATES: WaTemplate[] = [
  {
    id: 'iwis_followup:en', name: 'iwis_followup', language: 'en', category: 'MARKETING',
    label: 'Follow up on an enquiry (English)',
    body: 'Hello {{1}}, this is IWIS Global following up on your message about Agra. Reply here and we will continue helping you.',
  },
  {
    id: 'iwis_followup:de', name: 'iwis_followup', language: 'de', category: 'MARKETING',
    label: 'Follow up on an enquiry (German)',
    body: 'Guten Tag {{1}}, hier ist IWIS Global. Wir melden uns zu Ihrer Nachricht über Agra. Antworten Sie hier, dann helfen wir Ihnen gerne weiter.',
  },
  {
    id: 'iwis_booking_update:en', name: 'iwis_booking_update', language: 'en', category: 'UTILITY',
    label: 'Update about a booking (English)',
    body: 'Hello {{1}}, we have an update about your booking with IWIS Global. Please reply here and we will share the details.',
  },
  {
    id: 'iwis_booking_update:de', name: 'iwis_booking_update', language: 'de', category: 'UTILITY',
    label: 'Update about a booking (German)',
    body: 'Guten Tag {{1}}, wir haben eine Neuigkeit zu Ihrer Buchung bei IWIS Global. Bitte antworten Sie hier, dann teilen wir Ihnen die Details mit.',
  },
];

export const findTemplate = (id: string): WaTemplate | undefined => WA_TEMPLATES.find((t) => t.id === id);

export const renderTemplate = (t: WaTemplate, name: string): string => t.body.replace('{{1}}', name);

// WhatsApp rejects a parameter with line breaks, tabs or runs of spaces, and over 60 characters is
// not a name. Returns the cleaned value, or null when nothing usable is left.
export function cleanTemplateName(raw: string): string | null {
  const v = raw.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  return v && v.length <= 60 ? v : null;
}

// The pickup details template: how pickup details reach a guest who has not written in the last 24 hours (a guest who
// booked on the website usually has not). Six parameters. Must be created and approved in Meta under this exact name and
// language before it can be sent; until then WhatsApp refuses it and staff see why.
export const PICKUP_TEMPLATE = {
  name: 'iwis_pickup_details',
  language: 'en',
  category: 'UTILITY' as const,
  body:
    'Hello {{1}}, here are your pickup details for {{2}} on {{3}}. Pickup time: {{4}}. Vehicle: {{5}}. Driver: {{6}}. ' +
    'Your driver is your first contact at pickup, so please keep your phone on. IWIS Global',
};

export interface PickupFacts {
  guestName: string;
  tourTitle: string;
  dateLabel: string;
  pickupTime: string;
  vehicle: string;
  driverName: string;
  driverPhone: string;
  guide?: string;
}

// WhatsApp rejects empty parameters and parameters with line breaks, tabs or runs of spaces.
const param = (raw: string, fallback: string, max = 120): string => {
  const v = raw.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max).trim();
  return v || fallback;
};

export function pickupTemplateParams(f: PickupFacts): string[] {
  const driver = f.driverName.trim()
    ? param(f.driverName, '', 60) + (f.driverPhone.trim() ? ` ${param(f.driverPhone, '', 30)}` : '')
    : 'to be confirmed';
  return [
    param(f.guestName.trim().split(/\s+/)[0] ?? '', 'there', 60),
    param(f.tourTitle, 'your tour'),
    param(f.dateLabel, 'your travel date', 40),
    param(f.pickupTime, 'to be confirmed', 40),
    param(f.vehicle, 'to be confirmed', 80),
    driver,
  ];
}

export const renderPickupTemplate = (params: string[]): string =>
  params.reduce((text, p, i) => text.replace(`{{${i + 1}}}`, p), PICKUP_TEMPLATE.body);
