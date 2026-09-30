// One result per page request for a query several components need (the
// layout, tour cards, the Founding Guest note). A page can start these early,
// all at once, so they don't each wait on a separate round trip to D1 (the
// database is in North America; most visitors are not).
const cache = new WeakMap<Request, Map<string, Promise<unknown>>>();

export function forRequest<T>(request: Request, key: string, load: () => Promise<T>): Promise<T> {
  let entries = cache.get(request);
  if (!entries) {
    entries = new Map();
    cache.set(request, entries);
  }
  let value = entries.get(key) as Promise<T> | undefined;
  if (!value) {
    value = load();
    entries.set(key, value);
  }
  return value;
}
