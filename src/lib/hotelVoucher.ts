// The voucher for a confirmed hotel booking: what the guest shows at check-in.
// Built from the stored booking and the mirrored Hotelbeds content, and it
// never carries a price (Hotelbeds requires the voucher to be price-free).

import type { HotelContent } from './hotelContent';

export interface HotelBookingRow {
  id: string;
  status: string;
  hb_reference: string;
  holder_name: string;
  guests_json: string;
  selected_json: string;
  search_json: string;
  supplier_json: string;
}

export interface Voucher {
  reference: string; // Hotelbeds booking reference
  ourReference: string; // what Hotelbeds holds as our client reference
  hotelName: string;
  category: string;
  address: string;
  destination: string;
  phone: string;
  checkIn: string;
  checkOut: string;
  holder: string;
  rooms: { roomName: string; boardName: string; guests: { name: string; age?: number }[] }[];
  rateComments: string[];
  payableLine: string;
}

// Same value hotelClientReference() in hotelPayment.ts sends to Hotelbeds.
const CLIENT_REFERENCE_LENGTH = 20;
export const NO_ADDRESS = 'See hotel details';

// The wording Hotelbeds requires, character for character.
export function payableLine(supplier: { name: string; vat: string }, reference: string): string {
  return `Payable through ${supplier.name}, acting as agent for the service operating company, details of which can be provided upon request. VAT: ${supplier.vat} Reference: ${reference}`;
}

const parse = (raw: string): any => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

// Null when the booking is not confirmed (or its stored data is unreadable), so
// a voucher is never shown for money that was refunded or is still pending.
export function buildVoucher(row: HotelBookingRow, content: HotelContent | null): Voucher | null {
  if (row.status !== 'booked' || !str(row.hb_reference)) return null;
  const selected = parse(row.selected_json);
  const search = parse(row.search_json);
  const guests = parse(row.guests_json);
  if (!selected || !search || !Array.isArray(guests) || guests.length === 0) return null;

  const hotelName = str(content?.name) || str(selected.hotelName);
  if (!hotelName) return null;

  const addressParts = content ? [content.address, content.postalCode, content.city].map(str).filter(Boolean) : [];
  const supplier = parse(row.supplier_json) ?? {};
  const reference = row.hb_reference.trim();
  const supplierName = str(supplier.name);

  return {
    reference,
    ourReference: row.id.slice(0, CLIENT_REFERENCE_LENGTH),
    hotelName,
    category: str(content?.categoryName),
    address: addressParts.length > 0 ? addressParts.join(', ') : NO_ADDRESS,
    destination: str(content?.city),
    phone: str(content?.phone),
    checkIn: str(search.checkIn),
    checkOut: str(search.checkOut),
    holder: str(row.holder_name),
    rooms: guests.map((room: any) => ({
      roomName: str(selected.roomName),
      boardName: str(selected.boardName),
      guests: (Array.isArray(room?.names) ? room.names : []).map((g: any) => {
        const name = `${str(g?.first)} ${str(g?.last)}`.trim();
        return g?.type === 'CH' && typeof g.age === 'number' ? { name, age: g.age } : { name };
      }),
    })),
    rateComments: Array.isArray(selected.rateComments) ? selected.rateComments.filter((c: unknown): c is string => typeof c === 'string' && c.trim() !== '') : [],
    // Empty (not invented) when Hotelbeds did not send the supplier details.
    payableLine: supplierName ? payableLine({ name: supplierName, vat: str(supplier.vat) }, reference) : '',
  };
}
