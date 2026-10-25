// Browser-side analytics shared by the interactive islands. Google events go
// through gtag.js, whose consent mode (set in BaseLayout from the
// cookie_consent cookie) keeps storage off until the visitor accepts. Meta
// events are queued on window.iwisPixelQueue and only sent after consent
// (CookieConsent.astro). This adds no consent logic of its own.
//
// `purchase` is deliberately not sent from here: on a redirect-based payment
// the browser can navigate away first and undercount, so it is server-side
// only, via the Razorpay webhook (src/pages/api/webhooks/razorpay.ts).

type GtagWindow = Window & { gtag?: (...args: unknown[]) => void };

export function track(event: string, params: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  (window as GtagWindow).gtag?.('event', event, params);
}

// A Meta Pixel standard event. Queued, and only sent if the visitor accepts cookies (CookieConsent.astro).
export function pixel(event: string, params: Record<string, unknown> = {}, eventId?: string): void {
  if (typeof window === 'undefined') return;
  const w = window as Window & { iwisPixelQueue?: unknown[] };
  (w.iwisPixelQueue = w.iwisPixelQueue || []).push([event, params, eventId ? { eventID: eventId } : {}]);
}

// Where this visit came from (first touch of the tab session, recorded by BaseLayout), for the order and the lead.
export function firstTouch(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem('iwis_first_touch') || '{}');
  } catch {
    return {};
  }
}
