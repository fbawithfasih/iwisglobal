// src/pages/api/ai-guide.ts
import type { APIRoute } from 'astro';
import { resolveEnv } from '../../lib/env';
import { listTours } from '../../lib/tours';
import { resolveCurrency, resolvePrice } from '../../lib/currency';
import { resolveLocale, LOCALES } from '../../lib/i18n';
import {
  hashIp,
  checkRateLimit,
  recordRequest,
  buildSystemPrompt,
  askYourGuide,
  FALLBACK_TEXT,
  type GuideExchange,
} from '../../lib/aiGuide';

export const prerender = false;

const MAX_MESSAGE_LENGTH = 300;

function fallbackResponse() {
  return new Response(JSON.stringify({ answer: FALLBACK_TEXT }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  let message = '';
  let history: GuideExchange[] = [];

  try {
    const body = await request.json();
    message = typeof body?.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE_LENGTH) : '';
    history = Array.isArray(body?.history)
      ? body.history
          .filter((h: any) => typeof h?.q === 'string' && typeof h?.a === 'string')
          .slice(-1)
          .map((h: GuideExchange) => ({
            q: h.q.slice(0, MAX_MESSAGE_LENGTH),
            a: h.a.slice(0, MAX_MESSAGE_LENGTH),
          }))
      : [];
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!message) {
    return new Response(JSON.stringify({ error: 'Missing message' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const env = resolveEnv(locals);
  const db = env.DB;
  const apiKey = env.ANTHROPIC_API_KEY;

  // Missing config (D1 not bound locally, or ANTHROPIC_API_KEY not yet
  // set/propagated) degrades to the same fallback a rate-limited visitor
  // sees — never a 500, per the spec's "never a raw error" rule.
  if (!db || !apiKey) {
    console.warn(`ai-guide: missing config — ${!db ? 'DB' : ''}${!db && !apiKey ? ' and ' : ''}${!apiKey ? 'ANTHROPIC_API_KEY' : ''} not bound`);
    return fallbackResponse();
  }

  try {
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const ipHash = await hashIp(ip);
    const { allowed } = await checkRateLimit(db, ipHash);
    if (!allowed) {
      return fallbackResponse();
    }

    await recordRequest(db, ipHash);

    // Same currency the visitor actually sees on the page (the `currency`
    // cookie every tour page reads/writes) — otherwise YourGuide quotes a
    // base-currency (INR) figure that doesn't match a USD-viewing
    // visitor's own page, a real point of confusion for a paying customer.
    const currency = resolveCurrency(new URL(request.url).searchParams, cookies.get('currency')?.value);
    const locale = resolveLocale(new URL(request.url).searchParams, cookies.get('lang')?.value);
    const tours = await listTours(db, { status: 'published' }, locale);
    const languageName = LOCALES.find((l) => l.code === locale)?.label ?? 'English';
    const systemPrompt = buildSystemPrompt(
      tours.map((t) => {
        const resolved = resolvePrice({ amount: t.amount, usdAmount: t.usdAmount }, currency);
        return { title: t.title, amount: resolved.amount, currency: resolved.currency, durationLabel: t.durationLabel };
      }),
      languageName
    );

    const answer = await askYourGuide(message, history, systemPrompt, apiKey);
    return new Response(JSON.stringify({ answer }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return fallbackResponse();
  }
};
