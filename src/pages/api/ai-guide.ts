// src/pages/api/ai-guide.ts
import type { APIRoute } from 'astro';
import { resolveEnv } from '../../lib/env';
import { listTours } from '../../lib/tours';
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

export const POST: APIRoute = async ({ request, locals }) => {
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

    const tours = await listTours(db, { status: 'published' });
    const systemPrompt = buildSystemPrompt(
      tours.map((t) => ({ title: t.title, amount: t.amount, currency: t.currency, durationLabel: t.durationLabel }))
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
