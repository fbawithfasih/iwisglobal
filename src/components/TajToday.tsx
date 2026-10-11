import { useEffect, useState } from 'react';
import { track } from '../lib/analytics';
import { fmt } from '../i18n/fmt';
import { fmtNode } from '../i18n/format';
import type { Locale } from '../lib/i18n';
import type { Dictionary } from '../i18n/dictionaries';
import { formatDay, formatTime, nextNightViewing, tajStatus, type NextNightViewing, type TajStatus } from '../lib/tajToday';

// "Taj Mahal today" panel. The server renders a neutral placeholder; the real
// status is computed in the browser (it depends on the visitor's clock) and
// refreshed once a minute, so there is no hydration mismatch and the page
// stays fully static.

interface Snapshot {
  status: TajStatus;
  night: NextNightViewing | null;
}

const STATE_STYLE: Record<TajStatus['state'], { dot: string; pill: string }> = {
  open: { dot: 'bg-green-500', pill: 'bg-green-100 text-green-800' },
  'before-opening': { dot: 'bg-amber-500', pill: 'bg-amber-100 text-amber-800' },
  'after-closing': { dot: 'bg-stone-400', pill: 'bg-stone-100 text-stone-700' },
  'closed-friday': { dot: 'bg-red-500', pill: 'bg-red-100 text-red-800' },
};

const STATE_TEXT: Record<TajStatus['state'], keyof Dictionary['tajToday']> = {
  open: 'open',
  'before-opening': 'before',
  'after-closing': 'after',
  'closed-friday': 'friday',
};

function nightLine(night: NextNightViewing, t: Dictionary['tajToday']): string {
  if (night.daysAway === 0) return t.tonight;
  if (night.daysAway === 1) return t.tomorrow;
  return fmt(t.inDays, { n: night.daysAway });
}

export default function TajToday({ t, locale, moonHref }: { t: Dictionary['tajToday']; locale: Locale; moonHref: string }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setSnap({ status: tajStatus(now), night: nextNightViewing(now) });
    };
    update();
    const id = window.setInterval(update, 60_000);
    return () => window.clearInterval(id);
  }, []);

  if (!snap) {
    return <div className="min-h-[13rem] rounded-2xl border border-brand-100 bg-white shadow-sm shadow-brand-900/5" aria-hidden="true" />;
  }

  const { status, night } = snap;
  const style = STATE_STYLE[status.state];
  const headText = t[STATE_TEXT[status.state]];
  const next = status.nextOpen;

  return (
    <section aria-labelledby="taj-today-title" className="flex flex-col rounded-2xl border border-brand-100 bg-white p-4 shadow-sm shadow-brand-900/5 min-[300px]:p-5 2xl:p-7 [@media(max-height:500px)]:p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="taj-today-title" className="font-serif text-lg font-semibold text-brand-900 2xl:text-2xl">{t.title}</h3>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${style.pill}`}>
          <span className={`h-2 w-2 rounded-full ${style.dot} ${status.state === 'open' ? 'motion-safe:animate-pulse' : ''}`} aria-hidden="true" />
          {headText}
        </span>
      </div>

      <p className="mt-2 text-sm text-stone-700 2xl:mt-3 2xl:text-base" aria-live="polite">
        {status.state === 'open' && fmtNode(t.hoursEnd, { time: <strong>{formatTime(status.closes, locale)}</strong> })}
        {status.state === 'before-opening' && fmtNode(t.gatesOpen, { time: <strong>{formatTime(status.opens, locale)}</strong> })}
        {(status.state === 'after-closing' || status.state === 'closed-friday') && next && (
          <>{fmtNode(t.nextOpening, { day: <strong>{formatDay(tajStatus(next).today, locale)}</strong>, time: <strong>{formatTime(next, locale)}</strong> })}</>
        )}
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm [@media(max-height:500px)]:mt-2 [@media(max-height:500px)]:gap-1.5 2xl:mt-4 2xl:gap-3 2xl:text-base">
        <div className="rounded-xl bg-brand-50 p-3">
          <dt className="text-xs font-medium text-brand-700">{t.sunrise}<span className="hidden [@media(max-height:500px)]:inline"> {t.approx}</span></dt>
          <dd className="font-semibold text-brand-900">{formatTime(status.sunrise, locale)}</dd>
        </div>
        <div className="rounded-xl bg-brand-50 p-3">
          <dt className="text-xs font-medium text-brand-700">{t.sunset}<span className="hidden [@media(max-height:500px)]:inline"> {t.approx}</span></dt>
          <dd className="font-semibold text-brand-900">{formatTime(status.sunset, locale)}</dd>
        </div>
      </dl>

      {night && (
        <div className="mt-3 rounded-xl border border-brand-100 bg-gradient-to-br from-brand-950 to-brand-800 p-3 text-white 2xl:mt-4 2xl:p-5 [@media(max-height:500px)]:mt-2 [@media(max-height:500px)]:p-2.5">
          <p className="text-xs font-medium text-brand-200">{t.moonTitle}</p>
          <p className="mt-0.5 font-semibold 2xl:text-lg">
            {nightLine(night, t)} · {formatDay(night.date, locale)}
          </p>
          <p className="mt-0.5 text-xs text-brand-200">
            {night.runStart === night.runEnd ? t.oneNight : fmt(t.nights, { from: formatDay(night.runStart, locale), to: formatDay(night.runEnd, locale) })}
          </p>
          <a
            href={moonHref}
            onClick={() => track('taj_today_moonlight_click', { daysAway: night.daysAway })}
            className="mt-2 inline-flex min-h-11 items-center rounded-full bg-white px-4 text-sm font-semibold text-brand-900 transition hover:bg-brand-50 2xl:min-h-12 2xl:px-6 2xl:text-base"
          >
            {t.moonCta}
          </a>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-snug text-stone-500 sm:hidden [@media(max-height:500px)]:!hidden">{t.footShort}</p>
      <p className="mt-auto hidden pt-3 [@media(max-height:500px)]:!hidden text-[11px] 2xl:text-xs leading-snug text-stone-500 sm:block">
        {t.footFull}
      </p>
    </section>
  );
}
