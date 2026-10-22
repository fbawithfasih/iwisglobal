import PostalMime from 'postal-mime';

// Cloudflare Email Worker. Pages cannot host Email Routing handlers, so this small Worker parses the
// mail and posts it to the site (src/pages/api/inbound/email.ts). A copy is forwarded to a person
// first, so a parse or network failure never loses an enquiry.

interface Env {
  INBOUND_URL: string;
  INBOUND_EMAIL_SECRET: string;
  FORWARD_TO?: string;
}

const KEEP_HEADERS = ['auto-submitted', 'precedence', 'list-unsubscribe', 'x-autoreply', 'x-autorespond'];

export default {
  async email(message: any, env: Env): Promise<void> {
    if (env.FORWARD_TO) {
      try {
        await message.forward(env.FORWARD_TO);
      } catch (err) {
        console.error('forward failed', err instanceof Error ? err.message : 'error');
      }
    }
    try {
      const raw = await new Response(message.raw).arrayBuffer();
      if (raw.byteLength > 5_000_000) return; // oversized: the forwarded copy is enough
      const mail = await PostalMime.parse(raw);
      const headers: Record<string, string> = {};
      for (const h of mail.headers ?? []) {
        const key = String(h.key).toLowerCase();
        if (KEEP_HEADERS.includes(key)) headers[key] = String(h.value).toLowerCase();
      }
      const res = await fetch(env.INBOUND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-inbound-secret': env.INBOUND_EMAIL_SECRET },
        body: JSON.stringify({
          from: { address: mail.from?.address ?? message.from, name: mail.from?.name ?? '' },
          to: message.to,
          subject: mail.subject ?? '',
          text: (mail.text ?? '').slice(0, 4000),
          messageId: mail.messageId ?? '',
          date: mail.date ?? '',
          headers,
        }),
      });
      if (!res.ok) console.error('inbound post failed', res.status);
    } catch (err) {
      console.error('inbound parse failed', err instanceof Error ? err.message : 'error');
    }
  },
};
