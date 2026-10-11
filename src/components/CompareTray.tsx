import { track } from '../lib/analytics';
import { useShortlist } from './useShortlist';

// Small pill at the bottom-left that appears once a tour is saved: compare
// them side by side, send the list to someone on WhatsApp, or clear it. It
// stays clear of the floating WhatsApp button (bottom-right) and is hidden
// while a page's own sticky booking bar is showing (see BaseLayout styles).
// On ultrawide screens it zooms with the page and lines up with the content
// column (max-w-7xl = 1280px) instead of sitting at the far screen edge.

export default function CompareTray() {
  const { items, ready, toggle, clear } = useShortlist();
  if (!ready || items.length === 0) return null;

  const compareHref = `/compare?t=${items.map((i) => encodeURIComponent(i.slug)).join(',')}`;
  const shareText = () =>
    `Tours I am looking at from IWIS Global:\n${items.map((i) => `- ${i.title}: ${window.location.origin}/tours/${i.slug}`).join('\n')}`;

  return (
    <div className="iwis-tray fixed bottom-3 left-3 right-[5.25rem] z-40 rounded-2xl border border-brand-200 bg-white/95 p-1.5 shadow-xl shadow-brand-900/15 backdrop-blur sm:right-auto sm:bottom-4 sm:left-4 sm:max-w-sm sm:p-2 2xl:bottom-8 2xl:left-8 2xl:max-w-md 2xl:rounded-3xl 2xl:p-3 min-[2200px]:[--z:1.25] min-[3000px]:[--z:1.5] min-[2200px]:[zoom:var(--z)] min-[2200px]:left-[calc((100vw/var(--z)-1280px)/2+1.5rem)] [@media(max-height:500px)]:hidden">
      <p className="hidden px-2 pb-1 text-xs font-semibold text-brand-900 sm:block 2xl:pb-2 2xl:text-sm">
        {items.length} {items.length === 1 ? 'tour' : 'tours'} saved
      </p>
      <ul className="mb-1 hidden gap-1 px-1 sm:grid">
        {items.map((i) => (
          <li key={i.slug} className="flex items-center justify-between gap-2 text-xs text-stone-700 2xl:text-sm">
            <span className="truncate pl-1">{i.title}</span>
            <button type="button" onClick={() => toggle(i)} aria-label={`Remove ${i.title}`} className="flex min-h-9 min-w-9 shrink-0 items-center justify-center text-base text-stone-500 hover:text-red-700">
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 pl-2 pr-0.5 text-sm font-bold text-brand-800 sm:hidden" aria-label={`${items.length} tours saved`}>
          <svg viewBox="0 0 24 24" className="mr-1 inline h-4 w-4 align-[-2px]" fill="currentColor" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.2-9.3C1.7 8.2 3.4 5 6.6 5c2 0 3.5 1.1 5.4 3.2C13.9 6.1 15.4 5 17.4 5c3.2 0 4.9 3.2 3.8 6.2-1.7 4.7-9.2 9.3-9.2 9.3Z" /></svg>
          {items.length}
        </span>
        <a
          href={compareHref}
          onClick={() => track('compare_open', { count: items.length })}
          className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-full px-3 text-sm font-semibold sm:flex-none sm:px-3.5 2xl:px-5 2xl:text-base ${items.length >= 2 ? 'bg-brand-700 text-white hover:bg-brand-800' : 'pointer-events-none bg-stone-100 text-stone-400'}`}
          aria-disabled={items.length < 2}
        >
          {items.length >= 2 ? 'Compare' : 'Save one more'}
        </a>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(shareText())}`}
          target="_blank"
          rel="noopener"
          onClick={() => track('shortlist_share', { count: items.length })}
          className="inline-flex min-h-11 items-center rounded-full border border-brand-200 px-3 text-sm font-semibold text-brand-800 hover:bg-brand-50 sm:px-3.5 2xl:px-5 2xl:text-base"
        >
          Share
        </a>
        <button type="button" onClick={clear} aria-label="Clear saved tours" className="min-h-11 min-w-9 px-1.5 text-xs font-semibold text-stone-500 sm:underline sm:underline-offset-2 2xl:text-sm">
          <span className="sm:hidden" aria-hidden="true">✕</span><span className="hidden sm:inline">Clear</span>
        </button>
      </div>
    </div>
  );
}
