// D1 access for customer accounts (schema_customers.sql). Separate from
// db.ts (payment-verified bookings) and crm.ts (admin CRM), same as the
// payments/bookings/admin split elsewhere in this app.

import type { D1Like } from './db';

export interface CustomerRow {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  provider: 'google' | 'apple' | 'email';
  provider_sub: string;
  password_hash: string | null;
  password_salt: string | null;
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

  return {
    id,
    email: profile.email,
    name: profile.name,
    avatar_url: profile.avatarUrl ?? null,
    provider: profile.provider,
    provider_sub: profile.providerSub,
    password_hash: null,
    password_salt: null,
    created_at: now,
  };
}

export async function getCustomerById(db: D1Like, id: string): Promise<CustomerRow | null> {
  return db.prepare(`SELECT * FROM customers WHERE id = ?`).bind(id).first<CustomerRow>();
}

// Email lookups are case-insensitive (normalizeEmail lowercases before
// storing/querying) so "User@x.com" and "user@x.com" resolve to one account.
export async function getCustomerByEmail(db: D1Like, email: string): Promise<CustomerRow | null> {
  return db.prepare(`SELECT * FROM customers WHERE email = ?`).bind(normalizeEmail(email)).first<CustomerRow>();
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface EmailSignupInput {
  email: string;
  name: string;
  passwordHash: string;
  passwordSalt: string;
}

// Creates a password-based customer account. provider_sub has no external
// meaning for the 'email' provider — it's set to the normalized email so
// the existing (provider, provider_sub) index still gives it a unique key.
export async function createCustomerWithPassword(db: D1Like, input: EmailSignupInput): Promise<CustomerRow> {
  const email = normalizeEmail(input.email);
  const id = `cust_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO customers (id, email, name, avatar_url, provider, provider_sub, password_hash, password_salt, created_at)
       VALUES (?, ?, ?, NULL, 'email', ?, ?, ?, ?)`
    )
    .bind(id, email, input.name, email, input.passwordHash, input.passwordSalt, now)
    .run();

  return {
    id,
    email,
    name: input.name,
    avatar_url: null,
    provider: 'email',
    provider_sub: email,
    password_hash: input.passwordHash,
    password_salt: input.passwordSalt,
    created_at: now,
  };
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
