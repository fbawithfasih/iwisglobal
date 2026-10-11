import { useState } from 'react';
import { track } from '../lib/analytics';

// Drag from sunrise to moonlight and watch the light change on the Taj.
// This is a simulation: CSS filters and a colour wash over one real daytime
// photograph, so it is labelled "Illustration" on the picture. The ends link
// to the tours that really are at those hours.

interface Stop {
  at: number;
  label: string;
  brightness: number;
  saturate: number;
  sepia: number;
  wash: [number, number, number, number]; // rgba overlay
}

const STOPS: Stop[] = [
  { at: 0, label: 'Sunrise', brightness: 0.95, saturate: 1.1, sepia: 0.25, wash: [255, 150, 120, 0.3] },
  { at: 33, label: 'Daytime', brightness: 1.05, saturate: 1.05, sepia: 0, wash: [255, 255, 255, 0] },
  { at: 66, label: 'Sunset', brightness: 0.95, saturate: 1.2, sepia: 0.3, wash: [255, 140, 40, 0.28] },
  { at: 100, label: 'Moonlight', brightness: 0.45, saturate: 0.7, sepia: 0, wash: [20, 20, 90, 0.55] },
];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function lightAt(v: number) {
  let i = 0;
  while (i < STOPS.length - 2 && v > STOPS[i + 1].at) i++;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  const t = Math.min(1, Math.max(0, (v - a.at) / (b.at - a.at)));
  return {
    brightness: mix(a.brightness, b.brightness, t),
    saturate: mix(a.saturate, b.saturate, t),
    sepia: mix(a.sepia, b.sepia, t),
    wash: a.wash.map((c, k) => mix(c, b.wash[k], t)) as [number, number, number, number],
  };
}

const CAPTION: Record<string, string> = {
  Sunrise: 'Soft pink light and the fewest people. The Taj opens 30 minutes before sunrise.',
  Daytime: 'Bright white marble, long shadows gone. The classic photo light.',
  Sunset: 'Warm gold on the marble. Gates close 30 minutes before sunset.',
  Moonlight: 'Only on the official full-moon nights, in small timed batches.',
};

export default function LightSlider({ sunriseHref, moonlightHref }: { sunriseHref: string; moonlightHref: string }) {
  const [v, setV] = useState(33);
  const light = lightAt(v);
  const near = STOPS.reduce((best, s) => (Math.abs(s.at - v) < Math.abs(best.at - v) ? s : best));
  const night = Math.max(0, (v - 66) / 34); // 0 until sunset, 1 at moonlight
  const [r, g, b, a] = light.wash;

  return (
    <div>
      <div className="relative aspect-[3/2] w-full overflow-hidden rounded-2xl border border-brand-100 bg-brand-950">
        <img
          src="/taj-mahal-1200.jpg"
          srcSet="/taj-mahal-750.jpg 750w, /taj-mahal-1200.jpg 1200w"
          sizes="(min-width: 1024px) 60vw, 100vw"
          width={1200}
          height={800}
          alt="The Taj Mahal's white marble mausoleum and minarets reflected in the long garden pool"
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          style={{ filter: `brightness(${light.brightness}) saturate(${light.saturate}) sepia(${light.sepia})` }}
        />
        <div className="absolute inset-0" style={{ backgroundColor: `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${a})` }} aria-hidden="true" />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            opacity: night,
            backgroundImage:
              'radial-gradient(circle at 82% 16%, #fef9c3 0 3.2%, rgba(254,249,195,0.25) 3.4% 7%, transparent 7.5%), radial-gradient(1.5px 1.5px at 12% 14%, #fff 99%, transparent), radial-gradient(1.5px 1.5px at 30% 8%, #fff 99%, transparent), radial-gradient(1.5px 1.5px at 52% 18%, #fff 99%, transparent), radial-gradient(1.5px 1.5px at 66% 7%, #fff 99%, transparent), radial-gradient(1.5px 1.5px at 24% 26%, #fff 99%, transparent)',
          }}
          aria-hidden="true"
        />
        <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white">Illustration</span>
        <span className="absolute bottom-2 left-2 rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-brand-900">{near.label}</span>
      </div>

      <div className="mt-3 rounded-xl border border-brand-100 bg-brand-50/60 p-3">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={v}
          onChange={(e) => setV(Number(e.target.value))}
          onPointerUp={() => track('light_slider_used', { stop: near.label })}
          aria-label="Time of day at the Taj Mahal"
          aria-valuetext={near.label}
          className="h-11 w-full cursor-pointer accent-brand-700"
        />
        <div className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {STOPS.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setV(s.at)}
              aria-pressed={near.label === s.label}
              className={`min-h-11 rounded-lg px-2 text-sm font-semibold transition ${near.label === s.label ? 'bg-brand-700 text-white' : 'bg-white text-brand-800 hover:bg-brand-50'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-3 text-sm text-stone-700" aria-live="polite">{CAPTION[near.label]}</p>
      <p className="mt-1 text-xs text-stone-500">Illustration: a simulation of the light on a daytime photo, not a photograph of those moments.</p>

      {(near.label === 'Sunrise' || near.label === 'Moonlight') && (
        <a
          href={near.label === 'Sunrise' ? sunriseHref : moonlightHref}
          onClick={() => track('light_slider_cta', { stop: near.label })}
          className="mt-3 inline-flex min-h-11 items-center rounded-full bg-brand-700 px-5 text-sm font-semibold text-white hover:bg-brand-800"
        >
          {near.label === 'Sunrise' ? 'See the sunrise tour' : 'See the moonlight tour'}
        </a>
      )}
    </div>
  );
}
