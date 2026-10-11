import { useEffect, useState } from 'react';
import { track } from '../lib/analytics';
import { formatDay, formatTime, nextNightViewing, tajStatus, type NextNightViewing, type TajStatus } from '../lib/tajToday';

// "Taj Mahal today" panel. The server renders a neutral placeholder; the real
// status is computed in the browser (it depends on the visitor's clock) and
// refreshed once a minute, so there is no hydration mismatch and the page
// stays fully static.

interface Snapshot {
  status: TajStatus;
  night: NextNightViewing | null;
}

const HEADLINE: Record<TajStatus['state'], { text: string; dot: string; pill: string }> = {
  open: { text: 'Open now', dot: 'bg-green-500', pill: 'bg-green-100 text-green-800' },
  'before-opening': { text: 'Opens soon', dot: 'bg-amber-500', pill: 'bg-amber-100 text-amber-800' },
  'after-closing': { text: 'Closed for today', dot: 'bg-stone-400', pill: 'bg-stone-100 text-stone-700' },
  'closed-friday': { text: 'Closed today (Friday)', dot: 'bg-red-500', pill: 'bg-red-100 text-red-800' },
};

function nightLine(night: NextNightViewing): string {
  if (night.daysAway === 0) return 'Tonight';
  if (night.daysAway === 1) return 'Tomorrow night';
  return `In ${night.daysAway} days`;
}

export default function TajToday() {
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
  const head = HEADLINE[status.state];
  const next = status.nextOpen;

  return (
    <section aria-labelledby="taj-today-title" className="rounded-2xl border border-brand-100 bg-white p-4 shadow-sm shadow-brand-900/5 min-[300px]:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="taj-today-title" className="font-serif text-lg font-semibold text-brand-900">Taj Mahal today</h3>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${head.pill}`}>
          <span className={`h-2 w-2 rounded-full ${head.dot} ${status.state === 'open' ? 'motion-safe:animate-pulse' : ''}`} aria-hidden="true" />
          {head.text}
        </span>
      </div>

      <p className="mt-2 text-sm text-stone-700" aria-live="polite">
        {status.state === 'open' && <>Visiting hours end around <strong>{formatTime(status.closes)}</strong> today.</>}
        {status.state === 'before-opening' && <>Gates open around <strong>{formatTime(status.opens)}</strong>, half an hour before sunrise.</>}
        {(status.state === 'after-closing' || status.state === 'closed-friday') && next && (
          <>Next opening: <strong>{formatDay(tajStatus(next).today)}, around {formatTime(next)}</strong>.</>
        )}
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-brand-50 p-3">
          <dt className="text-xs font-medium text-brand-700">Sunrise</dt>
          <dd className="font-semibold text-brand-900">{formatTime(status.sunrise)}</dd>
        </div>
        <div className="rounded-xl bg-brand-50 p-3">
          <dt className="text-xs font-medium text-brand-700">Sunset</dt>
          <dd className="font-semibold text-brand-900">{formatTime(status.sunset)}</dd>
        </div>
      </dl>

      {night && (
        <div className="mt-3 rounded-xl border border-brand-100 bg-gradient-to-br from-brand-950 to-brand-800 p-3 text-white">
          <p className="text-xs font-medium text-brand-200">Next full-moon night viewing</p>
          <p className="mt-0.5 font-semibold">
            {nightLine(night)} · {formatDay(night.date)}
          </p>
          <p className="mt-0.5 text-xs text-brand-200">
            {night.runStart === night.runEnd ? 'One night this month' : `Viewing nights ${formatDay(night.runStart)} to ${formatDay(night.runEnd)}`}
          </p>
          <a
            href="/tours/taj-mahal-moonlight-night-viewing-tour"
            onClick={() => track('taj_today_moonlight_click', { daysAway: night.daysAway })}
            className="mt-2 inline-flex min-h-11 items-center rounded-full bg-white px-4 text-sm font-semibold text-brand-900 transition hover:bg-brand-50"
          >
            See the moonlight tour
          </a>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-snug text-stone-500">
        Sunrise and sunset are approximate (within a couple of minutes). Hours follow the official rule: 30 minutes before sunrise to 30 minutes before sunset, closed Fridays.
      </p>
    </section>
  );
}
