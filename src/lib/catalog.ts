// Pure pricing types/helpers shared by the DB-backed catalog (src/lib/tours.ts).
//
// Both /api/create-order and /api/verify-payment ultimately rely on
// getCatalogItem() in tours.ts so the charged amount is NEVER taken from the
// client. The browser only sends a tourId (and optional addOnIds) — the
// server looks up the canonical price in D1 and creates the payment-provider
// order with that amount.
//
// Also imported directly by BookingWidget.tsx (client-side) for a live price
// estimate as the traveler picks a group size — purely for display; the
// server recomputes the same way from its own D1-sourced CatalogItem, so a
// tampered client estimate can't change what's actually charged.

export interface AddOn {
  id: string;
  name: string;
  amount: number; // major currency units (e.g. rupees), already resolved to the catalog item's currency
  usdAmount?: number | null; // raw USD price as set by the admin, before currency resolution
  includedByDefault?: boolean; // bundled into the price by default; customer can opt out (uncheck) to subtract it
  perTraveler?: boolean; // backlog 0.3 — true for a per-person cost (e.g. a monument ticket, charged amount × travelers); false/absent keeps the original flat per-booking behavior (e.g. a private art-gallery stop)
}

// Per-traveler price at a given group size (backlog 0.2 — "group-size
// pricing tiers"). Same dual-purpose shape as AddOn above: `amount` is
// already resolved to the catalog item's currency when this comes from
// getCatalogItem/computeTotal; usdAmount is only present on the raw,
// admin-entered rows (ParsedTour.pricingTiers) before currency resolution.
export interface PricingTier {
  travelers: number;
  amount: number; // price PER TRAVELER at this group size
  usdAmount?: number | null;
}

export interface CatalogItem {
  amount: number; // major currency units, per traveler — flat fallback used when pricingTiers is empty/absent
  currency: string;
  addOns?: AddOn[];
  pricingTiers?: PricingTier[];
}

export function getAddOn(item: CatalogItem, addOnId: string): AddOn | null {
  return item.addOns?.find((a) => a.id === addOnId) ?? null;
}

// Picks the tier for a given traveler count: the highest tier whose
// `travelers` is <= the requested count, so a group larger than the biggest
// published tier still prices at that tier's per-person rate rather than
// going unpriced. Falls back to the smallest tier if the request is below
// it (shouldn't happen since tiers normally start at 1, but stays safe if
// they don't). Returns null only when there are no tiers at all.
export function pickPricingTier(tiers: PricingTier[], travelers: number): PricingTier | null {
  if (!tiers || tiers.length === 0) return null;
  const sorted = [...tiers].sort((a, b) => a.travelers - b.travelers);
  let match = sorted[0];
  for (const tier of sorted) {
    if (tier.travelers <= travelers) match = tier;
  }
  return match;
}

// The per-traveler rate to charge for a given group size: the matching
// pricing tier if the tour has any, otherwise the flat `amount`. This is
// the one place that decides "which price applies" — computeTotal and the
// booking widget's live estimate both go through it, so they can't drift.
export function perTravelerRate(item: CatalogItem, travelers: number): number {
  const tier = pickPricingTier(item.pricingTiers ?? [], travelers);
  return tier ? tier.amount : item.amount;
}

// Computes the total charge (in major currency units) for a booking:
// the group-size-appropriate per-traveler rate × traveler count, plus any
// selected add-ons. An add-on is a flat per-booking charge by default (e.g.
// a private art-gallery stop); one marked `perTraveler` (e.g. a monument
// entry ticket, backlog 0.3) is multiplied by traveler count instead, since
// its real cost scales with group size. Add-ons marked includedByDefault
// are NOT auto-added here — the caller (client UI pre-checking them, or a
// server call passing their ids) decides which add-on ids are actually
// selected; this just prices whatever was selected, same as before.
export function computeTotal(
  item: CatalogItem,
  travelers: number,
  addOnIds: string[]
): number {
  const base = perTravelerRate(item, travelers) * travelers;
  const addOnsTotal = (addOnIds ?? []).reduce((sum, id) => {
    const addOn = getAddOn(item, id);
    if (!addOn) return sum;
    return sum + (addOn.perTraveler ? addOn.amount * travelers : addOn.amount);
  }, 0);
  return base + addOnsTotal;
}

// Backlog 0.4 — 25% deposit, balance on pickup. Rounded up to the nearest
// whole major-currency unit so the deposit is never fractionally under a
// clean 25%, and total - deposit (the balance) never has a stray paisa/cent
// left over from rounding down.
export const DEPOSIT_RATE = 0.25;

export function computeDepositAmount(total: number): number {
  return Math.ceil(total * DEPOSIT_RATE);
}

// Backlog 1.1 — "Founding Guest" launch offer: 15% off, auto-applied (no
// code) for the first 25 confirmed bookings site-wide, no end date — it
// just stops once slot 25 is taken. Eligibility is decided once at
// create-order time (src/lib/payments/razorpay.ts, via db.ts's
// countBookings) and carried in the trusted Razorpay order notes so
// verify-payment.ts can apply the exact same discount deterministically,
// without re-querying a booking count that may have moved on by then.
export const FOUNDING_GUEST_DISCOUNT_RATE = 0.15;
export const FOUNDING_GUEST_SLOT_CAP = 25;
// Ended by the owner on 25 Oct 2026, before paid advertising, with 21 spots unused. Bookings that already had it
// keep their discount (it is stored with each booking). Set back to false to reopen the remaining spots.
export const FOUNDING_GUEST_ENDED = true;

// The one place that decides whether the offer is open: the charge (razorpay.ts) and every banner use it.
export function foundingGuestSlotsLeft(bookingCount: number): number {
  return FOUNDING_GUEST_ENDED ? 0 : Math.max(0, FOUNDING_GUEST_SLOT_CAP - bookingCount);
}

// Rounded to a whole rupee/dollar: 15% off otherwise leaves paise/cents
// (₹15,998 → ₹13,598.3), which the booking widget displayed as-is. Every
// display and charge path goes through this function, so rounding here keeps
// the shown price and the Razorpay charge identical.
export function applyFoundingGuestDiscount(totalMajorUnits: number, eligible: boolean): number {
  return eligible ? Math.round(totalMajorUnits * (1 - FOUNDING_GUEST_DISCOUNT_RATE)) : totalMajorUnits;
}
