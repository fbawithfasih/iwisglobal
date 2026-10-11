import { useEffect, useState } from 'react';
import { AGRA_SITES } from '../lib/agraSites';
import { track } from '../lib/analytics';
import { fmt } from '../i18n/fmt';
import type { Dictionary } from '../i18n/dictionaries';

// Schematic map of the places people visit in Agra. Hand-drawn, not to scale,
// and says so. Full version (the /agra page): pins are toggle buttons that
// open a detail panel. Compact version (tour pages): pins are links, and the
// itinerary list above can light them up by dispatching "iwis:site" with
// the slugs of the stop being looked at.

export interface MapSiteDetail {
  slug: string;
  name: string;
  hours: string;
  ticketForeign: string;
  closedFriday: boolean;
}

interface Props {
  t: Dictionary['agraMap'];
  details?: MapSiteDetail[];
  compact?: boolean;
  // Compact: only these sites are part of the tour; the rest are dimmed.
  inTour?: string[];
}

export default function AgraMap({ t, details = [], compact = false, inTour }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [lit, setLit] = useState<string[]>([]);

  useEffect(() => {
    const onSite = (e: Event) => setLit((e as CustomEvent<string[]>).detail ?? []);
    window.addEventListener('iwis:site', onSite);
    return () => window.removeEventListener('iwis:site', onSite);
  }, []);

  const detail = details.find((d) => d.slug === selected);

  return (
    <div>
      <div className="relative aspect-[4/3] w-full sm:aspect-[3/2] overflow-hidden rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50 to-white">
        <svg viewBox="0 0 600 400" className="absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden="true">
          {/* The Yamuna, between the Fort and Taj (south bank) and Itimad-ud-Daulah and Mehtab Bagh (north bank). */}
          <path d="M-10 190 C130 215 230 140 330 160 S520 215 610 170 L610 215 C520 262 430 205 330 205 S130 270 -10 238 Z" fill="#c4b5fd" opacity="0.55" />
        </svg>
        <span className="pointer-events-none absolute left-1/2 top-[47%] -translate-x-1/2 text-[11px] italic text-brand-800/80">{t.river}</span>

        {AGRA_SITES.map((site) => {
          const dimmed = compact && inTour && !inTour.includes(site.slug);
          const active = selected === site.slug || lit.includes(site.slug);
          const cls = `absolute z-10 flex min-h-11 -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border px-2 text-[11px] font-semibold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 min-[400px]:px-2.5 min-[400px]:text-sm ${active ? 'border-brand-700 bg-brand-700 text-white motion-safe:scale-110' : dimmed ? 'border-stone-200 bg-white/70 text-stone-400' : 'border-brand-200 bg-white text-brand-900 hover:bg-brand-50'}`;
          const style = { left: `${site.x}%`, top: `${site.y}%` };
          const dot = <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${active ? 'bg-white' : 'bg-brand-600'}`} aria-hidden="true" />;
          return compact ? (
            <a key={site.slug} href={`/agra/${site.slug}`} className={cls} style={style}>
              {dot}
              <span className="whitespace-nowrap">{site.name}</span>
            </a>
          ) : (
            <button
              key={site.slug}
              type="button"
              aria-pressed={selected === site.slug}
              onClick={() => {
                setSelected(selected === site.slug ? null : site.slug);
                track('agra_map_pin', { site: site.slug });
              }}
              className={cls}
              style={style}
            >
              {dot}
              <span className="whitespace-nowrap">{site.name}</span>
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-xs text-stone-500">{t.schematic}</p>

      {!compact && (
        <div className="mt-3 min-h-[7rem]" aria-live="polite">
          {detail ? (
            <div className="rounded-2xl border border-brand-100 bg-white p-4 shadow-sm shadow-brand-900/5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-serif text-lg font-semibold text-brand-900">{detail.name}</h3>
                {detail.closedFriday ? (
                  <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">{t.closedFri}</span>
                ) : (
                  <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">{t.openFri}</span>
                )}
              </div>
              <p className="mt-2 text-sm text-stone-700"><strong>{t.hours}</strong> {detail.hours}</p>
              <p className="mt-1 text-sm text-stone-700"><strong>{t.ticket}</strong> {detail.ticketForeign}</p>
              <a href={`/agra/${detail.slug}`} className="mt-3 inline-flex min-h-11 items-center rounded-full bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800">
                {fmt(t.read, { name: detail.name })}
              </a>
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-brand-200 p-4 text-sm text-stone-600">{t.tap}</p>
          )}
        </div>
      )}
    </div>
  );
}
