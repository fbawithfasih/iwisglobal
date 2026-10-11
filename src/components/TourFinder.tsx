import { useEffect, useState } from 'react';
import { track } from '../lib/analytics';
import { recommendTours, type Answers, type Match, type Style, type When, type Who } from '../lib/tourMatch';
import { nextNightViewing } from '../lib/tajToday';

// "Find my tour": three big questions, then a top pick and two alternatives.
// Suggestions only: the price shown is the tour's "From" price and the real
// total is calculated on the tour page and re-checked by the server.

export interface FinderTour {
  slug: string;
  title: string;
  image: string;
  durationLabel: string;
  fromAmount: number; // numeric, for the tie-break
  fromLabel: string; // already formatted, e.g. "₹5,799"
}

interface Step<T extends string> {
  key: keyof Answers;
  title: string;
  options: { value: T; label: string; hint?: string }[];
}

const STEPS: [Step<When>, Step<Who>, Step<Style>] = [
  {
    key: 'when',
    title: 'When do you want to see the Taj?',
    options: [
      { value: 'sunrise', label: 'At sunrise', hint: 'Soft light, fewer crowds' },
      { value: 'day', label: 'During the day', hint: 'A full sightseeing day' },
      { value: 'night', label: 'By moonlight', hint: 'Full-moon nights only' },
      { value: 'any', label: 'Not sure yet' },
    ],
  },
  {
    key: 'who',
    title: 'Who is travelling?',
    options: [
      { value: 'small', label: '1 or 2 people' },
      { value: 'group', label: '3 or more', hint: 'Family or friends' },
      { value: 'any', label: 'Not sure yet' },
    ],
  },
  {
    key: 'style',
    title: 'What matters most?',
    options: [
      { value: 'value', label: 'Best value' },
      { value: 'train', label: 'Fast, by train' },
      { value: 'luxury', label: 'Comfort and luxury' },
      { value: 'overnight', label: 'No rush, stay overnight' },
      { value: 'any', label: 'Not sure yet' },
    ],
  },
];

export default function TourFinder({ tours }: { tours: FinderTour[] }) {
  const [answers, setAnswers] = useState<Partial<Answers>>({});
  const [step, setStep] = useState(0);
  const [nightAvailable, setNightAvailable] = useState(true);

  // Whether a night-viewing night is left depends on today's date.
  useEffect(() => setNightAvailable(nextNightViewing() !== null), []);

  const done = step >= STEPS.length;
  const current = STEPS[Math.min(step, STEPS.length - 1)];
  const picks: Match[] = done
    ? recommendTours(tours.map((t) => ({ slug: t.slug, fromAmount: t.fromAmount })), answers as Answers, nightAvailable).slice(0, 3)
    : [];

  function choose(value: string) {
    const next = { ...answers, [current.key]: value } as Partial<Answers>;
    setAnswers(next);
    setStep(step + 1);
    if (step + 1 >= STEPS.length) {
      const top = recommendTours(tours.map((t) => ({ slug: t.slug, fromAmount: t.fromAmount })), next as Answers, nightAvailable)[0];
      track('tour_finder_result', { ...next, top_tour: top?.slug });
    }
  }

  function restart() {
    setAnswers({});
    setStep(0);
  }

  const byslug = new Map(tours.map((t) => [t.slug, t]));

  return (
    <section aria-labelledby="finder-title" className="rounded-3xl border border-brand-100 bg-white p-4 shadow-sm shadow-brand-900/5 min-[300px]:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="finder-title" className="font-serif text-xl font-semibold text-brand-900 md:text-2xl">Find your Taj Mahal tour</h2>
        {!done && <span className="text-xs font-medium text-brand-700">Question {step + 1} of {STEPS.length}</span>}
      </div>

      {!done && (
        <div className="mt-1" aria-live="polite">
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-brand-100" aria-hidden="true">
            <div className="h-full rounded-full bg-brand-600 motion-safe:transition-all" style={{ width: `${(step / STEPS.length) * 100}%` }} />
          </div>
          <p className="mt-4 text-base font-medium text-stone-800">{current.title}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {current.options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => choose(o.value)}
                className="min-h-11 rounded-xl border border-brand-200 bg-white px-4 py-3 text-left transition hover:border-brand-500 hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <span className="block font-semibold text-brand-900">{o.label}</span>
                {o.hint && <span className="block text-xs text-stone-500">{o.hint}</span>}
              </button>
            ))}
          </div>
          {step > 0 && (
            <button type="button" onClick={() => setStep(step - 1)} className="mt-3 min-h-11 text-sm font-semibold text-brand-700 underline underline-offset-2">
              Back
            </button>
          )}
        </div>
      )}

      {done && (
        <div className="mt-4" aria-live="polite">
          {picks.length === 0 ? (
            <p className="text-stone-700">We could not match a tour right now. <a href="/tours" className="font-semibold text-brand-700 underline">Browse every tour</a> or <a href="/contact" className="font-semibold text-brand-700 underline">ask us</a>.</p>
          ) : (
            <ul className="grid gap-3">
              {picks.map((m, i) => {
                const t = byslug.get(m.slug);
                if (!t) return null;
                return (
                  <li key={m.slug} className={i === 0 ? 'rounded-2xl border-2 border-brand-500 bg-brand-50/60 p-3' : 'rounded-2xl border border-brand-100 p-3'}>
                    <a href={`/tours/${t.slug}`} onClick={() => track('tour_finder_click', { tour: t.slug, rank: i + 1 })} className="flex min-w-0 gap-3">
                      {t.image && <img src={t.image} alt="" loading="lazy" decoding="async" className="h-20 w-24 shrink-0 rounded-xl object-cover min-[300px]:h-24 min-[300px]:w-32" />}
                      <span className="min-w-0">
                        {i === 0 && <span className="mb-1 inline-block rounded-full bg-brand-700 px-2.5 py-0.5 text-xs font-semibold text-white">Our pick for you</span>}
                        <span className="block font-semibold text-brand-900 [overflow-wrap:anywhere]">{t.title}</span>
                        <span className="block text-xs text-stone-500">{t.durationLabel} · from {t.fromLabel}/person</span>
                        {m.reasons.length > 0 && <span className="mt-1 block text-xs text-stone-700">{m.reasons.join(' · ')}</span>}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
          <button type="button" onClick={restart} className="mt-3 min-h-11 text-sm font-semibold text-brand-700 underline underline-offset-2">
            Start again
          </button>
        </div>
      )}
    </section>
  );
}
