// Cross-site form protection with one narrow exemption: the one-click unsubscribe that Gmail, Yahoo and Apple Mail send
// (RFC 8058). Those servers POST "List-Unsubscribe=One-Click" with no Origin header, which Astro's built-in check
// (security.checkOrigin) refuses with a 403, so people cannot unsubscribe from the button in their mail app.
//
// Same rule as Astro's: a request that changes things (not GET, HEAD or OPTIONS) with a form content type
// (application/x-www-form-urlencoded, multipart/form-data, text/plain) must carry an Origin header equal to this site.
// JSON requests (webhooks, our own API calls) are not form posts and are not covered, as before.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];

/** The exact body RFC 8058 says a mail provider sends. */
export const ONE_CLICK_BODY = 'List-Unsubscribe=One-Click';

/** /unsubscribe/<token>, with or without an /es, /fr or /de prefix. The token is the credential, as in the email link. */
const UNSUBSCRIBE_PATH = /^\/((es|fr|de)\/)?unsubscribe\/[^/]+\/?$/;

export function isFormContentType(contentType: string | null): boolean {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  return FORM_TYPES.includes(type);
}

/** True when this request is exactly a mail provider's one-click unsubscribe. */
export async function isOneClickUnsubscribe(request: Request, url: URL): Promise<boolean> {
  if (request.method !== 'POST' || !UNSUBSCRIBE_PATH.test(url.pathname)) return false;
  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') return false;
  const length = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(length) || length > 200) return false;
  try {
    return (await request.clone().text()).trim() === ONE_CLICK_BODY;
  } catch {
    return false;
  }
}

/** True when the request must be refused as a cross-site form post. */
export async function isForbiddenCrossSitePost(request: Request, url: URL): Promise<boolean> {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return false;
  if (!isFormContentType(request.headers.get('content-type'))) return false;
  if (request.headers.get('origin') === url.origin) return false;
  return !(await isOneClickUnsubscribe(request, url));
}
