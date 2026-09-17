// Server-side source of truth for what each tour (and its add-ons) costs.
//
// Both /api/create-order and /api/verify-payment rely on this so the
// charged amount is NEVER taken from the client. The browser only sends a
// tourId (and optional addOnIds) — the server looks up the canonical price
// here and creates the payment-provider order with that amount.

export interface AddOn {
  id: string;
  name: string;
  amount: number; // major currency units (e.g. rupees)
}

export interface CatalogItem {
  amount: number; // major currency units, per traveler
  currency: string;
  addOns?: AddOn[];
}

export const CATALOG: Record<string, CatalogItem> = {
  SAME_DAY_AGRA_DELHI: {
    amount: 4999,
    currency: 'INR',
    addOns: [
      { id: 'ART_GALLERY_STOP', name: 'Art gallery & souvenir stop', amount: 500 },
    ],
  },
};

export function getCatalogItem(tourId: unknown): CatalogItem | null {
  if (typeof tourId !== 'string') return null;
  return CATALOG[tourId] ?? null;
}

export function getAddOn(item: CatalogItem, addOnId: string): AddOn | null {
  return item.addOns?.find((a) => a.id === addOnId) ?? null;
}

// Computes the total charge (in major currency units) for a booking:
// per-traveler tour price × traveler count, plus any selected add-ons
// (each add-on is a flat per-booking charge, not per-traveler).
export function computeTotal(
  item: CatalogItem,
  travelers: number,
  addOnIds: string[]
): number {
  const base = item.amount * travelers;
  const addOnsTotal = (addOnIds ?? []).reduce((sum, id) => {
    const addOn = getAddOn(item, id);
    return sum + (addOn?.amount ?? 0);
  }, 0);
  return base + addOnsTotal;
}
