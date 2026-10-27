import type { D1Like } from './db';
import { OPEN_STAGES } from './contacts';
import { AWAITING_STATUS } from './customTripPayment';
import { viewCounts } from './leadsAdmin';
import { formatDuration, listInbox } from './waInbox';

// The "waiting for you" bell in the admin shell (src/layouts/AdminLayout.astro, fed by /admin/api/notifications).
// It is a live count of work that is waiting, not an "unread" list: the number goes down when someone does the work, never
// because someone looked. Same sources as the Today page, but only counts, so it is cheap to refresh every minute.

export type NotificationKey = 'chats' | 'leads' | 'mine' | 'confirm';
export interface NotificationItem { key: NotificationKey; label: string; count: number; detail: string; href: string }
export interface Notifications { total: number; items: NotificationItem[]; failed: boolean }

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export async function loadNotifications(db: D1Like, opts: { me: string; now?: Date }): Promise<Notifications> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const stages = OPEN_STAGES.map(() => '?').join(',');
  try {
    const [inbox, counts, awaiting, mine] = await Promise.all([
      listInbox(db, 'all', now, opts.me),
      viewCounts(db, nowIso, opts.me),
      db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE status = ?`).bind(AWAITING_STATUS).first<{ n: number }>(),
      opts.me
        ? db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE status IN (${stages}) AND owner = ? AND next_action_at IS NOT NULL AND next_action_at <= ?`).bind(...OPEN_STAGES, opts.me, nowIso).first<{ n: number }>()
        : Promise.resolve(null),
    ]);

    const waiting = inbox.filter((c) => c.waiting && c.state !== 'opted_out');
    const longest = waiting.reduce((m, c) => Math.max(m, c.waitingMs), 0);
    const leadsNeed = counts.attention ?? 0; // new and unanswered, or a follow-up that has come due: counted once each
    const unanswered = counts.unanswered ?? 0;
    const mineDue = mine?.n ?? 0;
    const toConfirm = awaiting?.n ?? 0;

    const all: NotificationItem[] = [
      { key: 'chats', label: plural(waiting.length, 'WhatsApp chat waiting for a reply', 'WhatsApp chats waiting for a reply'), count: waiting.length, detail: waiting.length ? `Longest wait ${formatDuration(longest)}` : '', href: '/admin/whatsapp?tab=attention' },
      { key: 'leads', label: plural(leadsNeed, 'lead needs attention', 'leads need attention'), count: leadsNeed, detail: leadsNeed ? `${unanswered} with no reply, ${Math.max(leadsNeed - unanswered, 0)} follow-up${leadsNeed - unanswered === 1 ? '' : 's'} due` : '', href: '/admin/leads' },
      { key: 'mine', label: plural(mineDue, 'of your follow-ups is due', 'of your follow-ups are due'), count: mineDue, detail: '', href: '/admin/leads?view=mine' },
      { key: 'confirm', label: plural(toConfirm, 'booking to confirm', 'bookings to confirm'), count: toConfirm, detail: toConfirm ? 'Custom trips waiting for you' : '', href: '/admin?view=awaiting' },
    ];
    const items = all.filter((i) => i.count > 0);

    // "Your follow-ups" are already inside the leads number when they are open leads: show them as a line but count them once.
    const total = waiting.length + leadsNeed + toConfirm;
    return { total, items, failed: false };
  } catch (err) {
    console.error('notifications failed', err instanceof Error ? err.message : 'error');
    return { total: 0, items: [], failed: true };
  }
}
