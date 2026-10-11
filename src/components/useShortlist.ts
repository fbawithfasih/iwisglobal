import { useCallback, useEffect, useState } from 'react';

// The visitor's shortlist of tours (max 3, which is also the compare set),
// kept in localStorage. Every read and write is wrapped because storage
// throws in some private windows and when site data is blocked; the list then
// just lives in memory for the page. All islands on a page stay in sync
// through a small custom event, and other tabs through the "storage" event.
// Nothing here is sent anywhere: it never leaves the browser.

export interface ShortlistItem {
  slug: string;
  title: string;
}

export const SHORTLIST_MAX = 3;
const KEY = 'iwis-shortlist-v1';
const EVENT = 'iwis:shortlist';

function read(): ShortlistItem[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is ShortlistItem => !!x && typeof x.slug === 'string' && typeof x.title === 'string')
      .slice(0, SHORTLIST_MAX);
  } catch {
    return [];
  }
}

// Memory fallback so a blocked store still works within the page.
let memory: ShortlistItem[] | null = null;

function load(): ShortlistItem[] {
  return memory ?? read();
}

function save(items: ShortlistItem[]): void {
  memory = items;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* kept in memory only */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function useShortlist() {
  const [items, setItems] = useState<ShortlistItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setItems(load());
    sync();
    setReady(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) {
        memory = null;
        sync();
      }
    };
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const has = useCallback((slug: string) => items.some((i) => i.slug === slug), [items]);

  // Returns false when the list is full and the tour was not added.
  const toggle = useCallback((item: ShortlistItem): boolean => {
    const current = load();
    if (current.some((i) => i.slug === item.slug)) {
      save(current.filter((i) => i.slug !== item.slug));
      return true;
    }
    if (current.length >= SHORTLIST_MAX) return false;
    save([...current, item]);
    return true;
  }, []);

  const clear = useCallback(() => save([]), []);

  return { items, ready, has, toggle, clear };
}
