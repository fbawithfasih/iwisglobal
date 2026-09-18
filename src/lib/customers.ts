// D1 access for customer accounts (schema_customers.sql). Separate from
// db.ts (payment-verified bookings) and crm.ts (admin CRM), same as the
// payments/bookings/admin split elsewhere in this app.

import type { D1Like } from './db';

export interface CustomerRow {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  provider: 'google' | 'apple';
  provider_sub: string;
  created_at: string;
}

export interface CustomerProfile {
  provider: 'google' | 'apple';
  providerSub: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
}

// Finds an existing customer for this provider identity, or creates one.
// Matches on (provider, provider_sub) — the stable id the provider issues —
// not email, since a provider's email can change but the subject id can't.
export async function upsertCustomer(db: D1Like, profile: CustomerProfile): Promise<CustomerRow> {
  const existing = await db
    .prepare(`SELECT * FROM customers WHERE provider = ? AND provider_sub = ?`)
    .bind(profile.provider, profile.providerSub)
    .first<CustomerRow>();
  if (existing) return existing;

  const id = `cust_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO customers (id, email, name, avatar_url, provider, provider_sub, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, profile.email, profile.name, profile.avatarUrl ?? null, profile.provider, profile.providerSub, now)
    .run();

  return { id, email: profile.email, name: profile.name, avatar_url: profile.avatarUrl ?? null, provider: profile.provider, provider_sub: profile.providerSub, created_at: now };
}

export async function getCustomerById(db: D1Like, id: string): Promise<CustomerRow | null> {
  return db.prepare(`SELECT * FROM customers WHERE id = ?`).bind(id).first<CustomerRow>();
}

export interface CustomerBookingRow {
  id: string;
  tour_id: string;
  travel_date: string;
  travelers: number;
  amount_paid: number;
  currency: string;
  status: string;
  created_at: string;
}

export async function listCustomerBookings(db: D1Like, customerId: string): Promise<CustomerBookingRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, tour_id, travel_date, travelers, amount_paid, currency, status, created_at
       FROM bookings WHERE customer_id = ? ORDER BY travel_date DESC`
    )
    .bind(customerId)
    .all<CustomerBookingRow>();
  return results;
}
