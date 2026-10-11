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
