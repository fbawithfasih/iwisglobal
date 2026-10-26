// Carries the ad a visitor came from into a WhatsApp chat they start from the site.
// The site's wa.me links prefill a message ending in "(ref: BOOKBAR-TOURS-...)"; when the
// visitor arrived from an ad (utm tags, or Google's / Meta's click id), the click handler in
// BaseLayout.astro adds " · via google/paid/<campaign>" inside that bracket. The WhatsApp
// webhook reads it back (parseWaRef), so the lead is tagged google / meta / chatgpt rather
// than just "website button". Guests see the tag in the prefilled text; it is short and
// they can delete it, in which case the lead is simply untagged as before.

export interface FirstTouch {
  source?: string;
  medium?: string;
  campaign?: string;
  gclid?: string;
  fbclid?: string;
}

const clean = (v: unknown, n: number) => String(v ?? '').toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n);

// "google/paid/123456" from the visitor's first touch, or '' when they did not come from a tagged link.
export function sourceTag(t: FirstTouch | null | undefined): string {
  if (!t) return '';
  const source = clean(t.source, 20) || (t.gclid ? 'google' : t.fbclid ? 'meta' : '');
  if (!source) return '';
  const medium = clean(t.medium, 12) || 'paid';
  const campaign = clean(t.campaign, 40);
  return [source, medium, campaign].filter(Boolean).join('/');
}

// Adds the tag inside the "(ref: ...)" of a wa.me link's text. Unchanged when there is no tag,
// no ref bracket, or it is already tagged.
export function withSourceTag(href: string, tag: string): string {
  if (!tag) return href;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  if (!/(^|\.)wa\.me$/.test(url.hostname)) return href;
  const text = url.searchParams.get('text');
  if (!text || !/\(ref:\s*[^)]+\)/i.test(text) || / · via /.test(text)) return href;
  url.searchParams.set('text', text.replace(/\(ref:\s*([^)]+)\)/i, (_m, ref: string) => `(ref: ${ref.trim()} · via ${tag})`));
  return url.toString();
}

// From a guest's first message: the site ref ("BOOKBAR-TOURS-...") and, if present, the ad source.
export function parseWaRef(body: string): { ref: string; source: string; medium: string; campaign: string } {
  const inner = /\(ref:\s*([^)]+)\)/i.exec(body)?.[1]?.trim() ?? '';
  const [ref, via = ''] = inner.split(/\s+·\s+via\s+/);
  const [source = '', medium = '', campaign = ''] = via.trim().split('/');
  return { ref: (ref ?? '').trim(), source: clean(source, 20), medium: clean(medium, 12), campaign: clean(campaign, 40) };
}
