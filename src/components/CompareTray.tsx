import { track } from '../lib/analytics';
import { useShortlist } from './useShortlist';

// Small pill at the bottom-left that appears once a tour is saved: compare
// them side by side, send the list to someone on WhatsApp, or clear it. It
// stays clear of the floating WhatsApp button (bottom-right) and is hidden
// while a page's own sticky booking bar is showing (see BaseLayout styles).

export default function CompareTray() {
  const { items, ready, toggle, clear } = useShortlist();
  if (!ready || items.length === 0) return null;

  const compareHref = `/compare?t=${items.map((i) => encodeURIComponent(i.slug)).join(',')}`;
  const shareText = () =>
    `Tours I am looking at from IWIS Global:\n${items.map((i) => `- ${i.title}: ${window.location.origin}/tours/${i.slug}`).join('\n')}`;

  return (
    <div className="iwis-tray fixed bottom-4 left-4 z-40 max-w-[calc(100vw-6rem)] rounded-2xl border border-brand-200 bg-white p-2 shadow-xl shadow-brand-900/15 [@media(max-height:500px)]:hidden">
      <p className="px-2 pb-1 text-xs font-semibold text-brand-900">
        {items.length} {items.length === 1 ? 'tour' : 'tours'} saved
      </p>
      <ul className="mb-1 hidden gap-1 px-1 sm:grid">
        {items.map((i) => (
          <li key={i.slug} className="flex items-center justify-between gap-2 text-xs text-stone-700">
            <span className="truncate">{i.title}</span>
            <button type="button" onClick={() => toggle(i)} aria-label={`Remove ${i.title}`} className="min-h-6 shrink-0 px-1 text-stone-500 hover:text-red-700">
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-1.5">
        <a
          href={compareHref}
          onClick={() => track('compare_open', { count: items.length })}
          className={`inline-flex min-h-11 items-center rounded-full px-3.5 text-sm font-semibold ${items.length >= 2 ? 'bg-brand-700 text-white hover:bg-brand-800' : 'pointer-events-none bg-stone-100 text-stone-400'}`}
          aria-disabled={items.length < 2}
        >
          {items.length >= 2 ? 'Compare' : 'Save one more'}
        </a>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(shareText())}`}
          target="_blank"
          rel="noopener"
          onClick={() => track('shortlist_share', { count: items.length })}
          className="inline-flex min-h-11 items-center rounded-full border border-brand-200 px-3.5 text-sm font-semibold text-brand-800 hover:bg-brand-50"
        >
          Share
        </a>
        <button type="button" onClick={clear} className="min-h-11 px-2 text-xs font-semibold text-stone-500 underline underline-offset-2">
          Clear
        </button>
      </div>
    </div>
  );
}
