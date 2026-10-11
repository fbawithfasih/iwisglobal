// src/components/AiGuideBox.tsx
//
// Replaces the hero's old "Search tours in Agra" pill (src/pages/index.astro)
// with an AI-backed question box, per docs/superpowers/specs/2026-09-21-ai-guide-design.md.
import { useState, type FormEvent } from 'react';

const MAX_LENGTH = 300;

interface Exchange {
  q: string;
  a: string;
}

interface Labels {
  placeholder: string;
  inputAria: string;
  submitAria: string;
  browse: string;
  fallback: string;
}

export default function AiGuideBox({ t }: { t: Labels }) {
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<Exchange[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = message.trim().slice(0, MAX_LENGTH);
    if (!trimmed || loading) return;

    setLoading(true);
    setAnswer(null);

    window.gtag?.('event', 'ai_guide_asked');

    try {
      const res = await fetch('/api/ai-guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, history }),
      });
      const json = await res.json();
      const text = typeof json?.answer === 'string' ? json.answer : t.fallback;
      setAnswer(text);
      setHistory([{ q: trimmed, a: text }]);
      setMessage('');
    } catch {
      setAnswer(t.fallback);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <form
        onSubmit={submit}
        className="flex items-center justify-between gap-2 w-full bg-white rounded-full pl-5 pr-1.5 py-1.5 shadow-lg hover:shadow-xl transition md:gap-4 md:pl-6 md:pr-2 md:py-2"
      >
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={MAX_LENGTH}
          placeholder={t.placeholder}
          aria-label={t.inputAria}
          className="flex-1 min-w-0 h-10 bg-transparent text-stone-700 text-sm placeholder:text-stone-500 outline-none md:h-11"
        />
        <button
          type="submit"
          disabled={loading}
          aria-label={t.submitAria}
          className="flex items-center justify-center h-10 w-10 rounded-full bg-brand-800 text-white shrink-0 disabled:opacity-60 transition md:h-11 md:w-11"
        >
          {loading ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 animate-spin">
              <path strokeLinecap="round" d="M12 3a9 9 0 1 0 9 9" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l1.8 4.5L18 9l-4.2 1.5L12 15l-1.8-4.5L6 9l4.2-1.5L12 3z" />
            </svg>
          )}
        </button>
      </form>

      <a href="/tours" className="mx-auto mt-3 flex w-fit min-h-11 items-center rounded-full bg-amber-300 px-6 text-sm font-semibold text-brand-950 shadow-md transition hover:bg-amber-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/60 md:mt-4 md:text-base">
        {t.browse}
      </a>

      {answer && (
        // Higher opacity (90% vs the weather card's 40%) than the
        // lavender-section glass card — this one sits over a busy photo,
        // not a flat color, so it needs more contrast to stay legible.
        <div className="mt-4 rounded-xl border border-white/50 bg-white/90 backdrop-blur-md p-4 text-left text-sm text-stone-700 leading-relaxed">
          {answer}
        </div>
      )}
    </div>
  );
}
