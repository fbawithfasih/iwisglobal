/// <reference path="../.astro/types.d.ts" />

// Google tag (gtag.js), defined inline in BaseLayout's <head>. Site events
// go through it: the Tag Manager container has no tags, so events pushed to
// dataLayer as plain objects never reached Google Analytics.
interface Window {
  gtag?: (...args: unknown[]) => void;
}

// Set by src/middleware.ts for the pages that have per-language URLs.
declare namespace App {
  interface Locals {
    locale?: 'en' | 'es' | 'fr' | 'de';
    canonicalPath?: string;
    // Set by src/lib/adminGate.ts on /admin requests: who is signed in.
    admin?: import('./lib/authz').Principal;
  }
}
