import type { MetaContext } from './metaCapi';

// OpenAI Ads Conversions API: the server sends the same order_created and lead_created events the browser's OpenAI
// pixel sends (src/components/CookieConsent.astro), so a conversion still counts when the browser could not send it
// (ad blockers, a page lost after paying). Each event carries the same id as the browser's copy (the payment id, or
// the enquiry's event id), which is how OpenAI is asked to count it once.
//
// Only with consent, exactly as for the browser's pixel and for Meta: the MetaContext the booking and enquiry calls
// already carry says whether the visitor accepted (src/lib/consentRegion.ts). No name, email, phone or address is sent.
//
// Settings (Cloudflare Pages): OPENAI_ADS_API_KEY (OpenAI Ads Manager, the pixel, Conversions API key) and optionally
// OPENAI_ADS_PIXEL_ID (defaults to the site's pixel). Without the key this does nothing.

export const OPENAI_PIXEL_ID = 'AG2t5xN1b69gQk9Eds3Le8';
const ENDPOINT = 'https://bzr.openai.com/v1/events';

export interface OpenAiEvent {
  id: string; // the same id the browser's copy uses
  type: 'order_created' | 'lead_created';
  sourceUrl: string;
  amountMinor?: number; // whole minor units: 12000.00 rupees is 1200000
  currency?: string;
  contentIds?: string[];
  quantity?: number;
}

export function buildOpenAiEvent(e: OpenAiEvent, nowMs = Date.now()): Record<string, unknown> {
  let data: Record<string, unknown>;
  if (e.type === 'order_created') {
    data = { type: 'contents' };
    if (e.amountMinor !== undefined && Number.isFinite(e.amountMinor) && e.currency) {
      data.amount = Math.round(e.amountMinor);
      data.currency = e.currency.toUpperCase();
    }
    if (e.contentIds?.length) {
      data.contents = e.contentIds.map((id) => ({ id, content_type: 'product', ...(Number.isInteger(e.quantity) ? { quantity: e.quantity } : {}) }));
    }
  } else {
    data = { type: 'customer_action' };
  }
  return { id: e.id, type: e.type, timestamp_ms: nowMs, source_url: e.sourceUrl, action_source: 'web', data };
}

// Sends one event. Never throws and never blocks a booking: returns whether OpenAI accepted it.
export async function sendOpenAiEvent(env: Record<string, any>, e: OpenAiEvent, ctx: Pick<MetaContext, 'consent'>): Promise<boolean> {
  const key = env.OPENAI_ADS_API_KEY;
  if (!key || !ctx.consent || !e.id) return false;
  try {
    const pixel = String(env.OPENAI_ADS_PIXEL_ID || OPENAI_PIXEL_ID);
    const res = await fetch(`${ENDPOINT}?pid=${encodeURIComponent(pixel)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ validate_only: false, events: [buildOpenAiEvent(e)] }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error('openai capi: event refused', e.type, res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.error('openai capi: send failed', e.type, err instanceof Error ? err.message : 'error');
    return false;
  }
}
