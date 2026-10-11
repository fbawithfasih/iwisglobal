import { useState } from 'react';
import { track } from '../lib/analytics';
import { SHORTLIST_MAX, useShortlist } from './useShortlist';

// Heart on a tour card or tour page: save up to three tours to compare.

export default function ShortlistButton({ slug, title, label = false }: { slug: string; title: string; label?: boolean }) {
  const { has, toggle, ready } = useShortlist();
  const [full, setFull] = useState(false);
  const saved = ready && has(slug);

  function onClick(e: React.MouseEvent) {
    // The button can sit on top of a card link; do not follow it.
    e.preventDefault();
    e.stopPropagation();
    const ok = toggle({ slug, title });
    setFull(!ok);
    if (ok) track(saved ? 'shortlist_remove' : 'shortlist_add', { tour: slug });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${title} from your shortlist` : `Save ${title} to compare`}
      title={full ? `You can compare up to ${SHORTLIST_MAX} tours` : undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border text-sm font-semibold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${label ? 'px-4' : 'min-w-11'} ${saved ? 'border-brand-700 bg-brand-700 text-white' : 'border-brand-200 bg-white/95 text-brand-800 hover:bg-brand-50'}`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.5s-7.5-4.6-9.2-9.3C1.7 8.2 3.4 5 6.6 5c2 0 3.5 1.1 5.4 3.2C13.9 6.1 15.4 5 17.4 5c3.2 0 4.9 3.2 3.8 6.2-1.7 4.7-9.2 9.3-9.2 9.3Z" />
      </svg>
      {label && <span>{saved ? 'Saved' : full ? `Max ${SHORTLIST_MAX} saved` : 'Save to compare'}</span>}
    </button>
  );
}
