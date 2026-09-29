/// <reference path="../.astro/types.d.ts" />

// Google tag (gtag.js), defined inline in BaseLayout's <head>. Site events
// go through it: the Tag Manager container has no tags, so events pushed to
// dataLayer as plain objects never reached Google Analytics.
interface Window {
  gtag?: (...args: unknown[]) => void;
}
