// Paths the site never uses but the framework serves anyway.
//
// The Astro Cloudflare adapter ships an `/_image` endpoint that downloads whatever address it is given
// (`/_image?href=https://example.com/page`) and returns it from our own domain with the original content type,
// including HTML and SVG that can run script. Nothing on this site uses it (no `astro:assets` anywhere in src),
// so the middleware answers 404 before the framework routes the request.
//
// Several spellings reach the endpoint (`/%5Fimage`, `//_image`, `/./_image`), so the path is normalised first:
// decoded (repeatedly, so double encoding is caught too), repeated slashes collapsed, dot segments resolved.

const BLOCKED_FIRST_SEGMENTS = new Set(['_image']);

function decodeFully(path: string): string {
  let out = path;
  for (let i = 0; i < 4; i++) {
    let next: string;
    try {
      next = decodeURIComponent(out);
    } catch {
      // A malformed escape: fall back to a plain %XX replace so it cannot hide a blocked segment.
      next = out.replace(/%([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
    }
    if (next === out) break;
    out = next;
  }
  return out;
}

export function normalisePath(pathname: string): string[] {
  const parts = decodeFully(pathname).replace(/\\/g, '/').split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part.toLowerCase());
  }
  return stack;
}

export function isBlockedPath(pathname: string): boolean {
  const [first] = normalisePath(pathname);
  return first !== undefined && BLOCKED_FIRST_SEGMENTS.has(first);
}
