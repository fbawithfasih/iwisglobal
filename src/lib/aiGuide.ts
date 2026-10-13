// src/lib/aiGuide.ts
//
// "YourGuide" — the AI-backed hero question box (src/components/AiGuideBox.tsx).
// Rate-limited via ai_guide_requests (see schema_ai_guide_usage.sql) so a
// burst of traffic or abuse can't run up an unbounded Anthropic bill.
// The system prompt is rebuilt from the live tour catalog on every
// request so Claude never has to invent a price — see buildSystemPrompt.

import type { D1Like } from './db';
import { toHex } from './passwordHash';

export const AI_GUIDE_MODEL = 'claude-haiku-4-5-20251001';
export const MAX_OUTPUT_TOKENS = 300;
export const RATE_LIMIT_PER_IP_PER_DAY = 10;
export const RATE_LIMIT_SITE_WIDE_PER_DAY = 300;

export const FALLBACK_TEXT =
  "I couldn't get you an answer just now — you're welcome to browse our tours, or WhatsApp us at +91 6399226633 and we'll help directly.";

const DAY_MS = 24 * 60 * 60 * 1000;

// Privacy-only hash of the visitor's IP so ai_guide_requests never stores
// a raw IP. Not a security boundary — anyone with the IP can recompute
// the same hash, since there's no secret salt involved.
export async function hashIp(ip: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(ip));
  return toHex(digest);
}

export async function checkRateLimit(db: D1Like, ipHash: string): Promise<{ allowed: boolean }> {
  const since = Date.now() - DAY_MS;
  const [perIp, siteWide] = await Promise.all([
    db
      .prepare('SELECT COUNT(*) as count FROM ai_guide_requests WHERE ip_hash = ? AND created_at > ?')
      .bind(ipHash, since)
      .first<{ count: number }>(),
    db
      .prepare('SELECT COUNT(*) as count FROM ai_guide_requests WHERE created_at > ?')
      .bind(since)
      .first<{ count: number }>(),
  ]);
  const perIpCount = perIp?.count ?? 0;
  const siteWideCount = siteWide?.count ?? 0;
  return {
    allowed: perIpCount < RATE_LIMIT_PER_IP_PER_DAY && siteWideCount < RATE_LIMIT_SITE_WIDE_PER_DAY,
  };
}

// Called BEFORE the Anthropic call (not after) so a burst of concurrent
// requests can't all race past the cap while waiting on Claude. A request
// that then fails downstream still "spends" its slot for the day —
// accepted trade-off, simpler than a two-phase reserve/commit.
export async function recordRequest(db: D1Like, ipHash: string): Promise<void> {
  await db.prepare('INSERT INTO ai_guide_requests (ip_hash, created_at) VALUES (?, ?)').bind(ipHash, Date.now()).run();
}

export interface GuideTourSummary {
  title: string;
  amount: number;
  currency: string;
  durationLabel: string;
}

export function buildSystemPrompt(tours: GuideTourSummary[], languageName = 'English'): string {
  const catalogLines = tours.length
    ? tours.map((t) => `- ${t.title} — ${t.amount} ${t.currency} per traveler, ${t.durationLabel}`).join('\n')
    : '- (no published tours currently available — direct the visitor to /tours or WhatsApp)';

  return `You are YourGuide, a friendly travel assistant for IWIS Global, a private Taj Mahal & Agra tour operator based in Agra, India.

Answer questions about visiting Agra and the Taj Mahal, and about IWIS Global's tours, using ONLY:
1. The CURRENT TOURS data below (this is live, accurate data).
2. Safe, general, widely-known travel knowledge (dress modestly at religious/heritage sites, mornings are best for photos and cooler weather, etc.).

Never state a specific ticket price, monument entry fee, or timing that is not in the CURRENT TOURS data below. If asked for a figure you don't have verified data for, say so plainly and point to /tours, /guides, or WhatsApp (+91 6399226633) instead of guessing.

Keep answers to 2-4 sentences. If asked something unrelated to travel, Agra, or IWIS Global's tours, politely decline and redirect to travel questions.

Reply in ${languageName}, the language the visitor chose on the site, unless they write to you in a different language, in which case reply in theirs.

Respond in plain prose only — no markdown (no **bold**, no bullet points, no headers, no numbered lists). The answer is displayed as plain text, so markdown syntax would show up as literal asterisks or dashes.

CURRENT TOURS:
${catalogLines}`;
}

export interface GuideExchange {
  q: string;
  a: string;
}

export interface ClaudeResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

// One Messages API call, shared by YourGuide and the WhatsApp reply agent.
// Throws on any failure; callers decide the fallback.
export async function callAnthropic(opts: {
  apiKey: string;
  model: string;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
  timeoutMs?: number;
}): Promise<ClaudeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens,
        system: opts.system,
        messages: opts.messages,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Anthropic API error: ${res.status}`);
    }

    const json: any = await res.json();
    // Newer models can put a (possibly empty) thinking block before the text.
    const blocks: any[] = Array.isArray(json?.content) ? json.content : [];
    const text = blocks
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    if (!text.trim()) {
      throw new Error(`Anthropic API returned no text (stop_reason: ${json?.stop_reason ?? 'unknown'})`);
    }
    return {
      text: text.trim(),
      inputTokens: Number(json?.usage?.input_tokens) || 0,
      outputTokens: Number(json?.usage?.output_tokens) || 0,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function askYourGuide(
  message: string,
  history: GuideExchange[],
  systemPrompt: string,
  apiKey: string
): Promise<string> {
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  // Only the single most recent exchange is ever passed in (enforced by
  // the API route, Task 3) — this loop just flattens it into the shape
  // the Messages API expects.
  for (const exchange of history) {
    messages.push({ role: 'user', content: exchange.q });
    messages.push({ role: 'assistant', content: exchange.a });
  }
  messages.push({ role: 'user', content: message });

  const { text } = await callAnthropic({
    apiKey,
    model: AI_GUIDE_MODEL,
    system: systemPrompt,
    messages,
    maxTokens: MAX_OUTPUT_TOKENS,
  });
  return text;
}
