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
// selected add-ons (each add-on is a flat per-booking charge, not
// per-traveler). Add-ons marked includedByDefault are NOT auto-added here —
// the caller (client UI pre-checking them, or a server call passing their
// ids) decides which add-on ids are actually selected; this just prices
// whatever was selected, same as before.
export function computeTotal(
  item: CatalogItem,
  travelers: number,
  addOnIds: string[]
): number {
  const base = perTravelerRate(item, travelers) * travelers;
  const addOnsTotal = (addOnIds ?? []).reduce((sum, id) => {
    const addOn = getAddOn(item, id);
    return sum + (addOn?.amount ?? 0);
  }, 0);
  return base + addOnsTotal;
}
