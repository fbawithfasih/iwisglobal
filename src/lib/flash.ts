// The small confirmation ("Saved", "Message sent") shown once after an admin action. A handler calls setFlash just before it
// redirects; AdminLayout reads it on the next page with takeFlash, shows it and deletes it, so a refresh never shows it again.
// The cookie holds a key, never text, so what is shown can only be one of the fixed messages below.
import type { AstroCookies } from 'astro';

export const FLASH_COOKIE = 'admin_flash';

export const FLASH_MESSAGES = {
  saved: 'Saved',
  status: 'Status updated',
  itinerary: 'Itinerary saved',
  note: 'Note added',
  stage: 'Stage updated',
  followup: 'Follow-up saved',
  assigned: 'Assigned',
  taken: 'The lead is yours now',
  done: 'Marked done',
  sent: 'Message sent',
  template: 'Template sent',
  chat_taken: 'You are handling this chat',
  handed_over: 'Chat handed over',
  given_back: 'Given back to the agent',
  discarded: 'Draft discarded',
  created: 'Created',
  deleted: 'Deleted',
  published: 'Published',
  unpublished: 'Unpublished',
  approved: 'Review approved',
  hidden: 'Review hidden',
  booking_created: 'Booking created',
  campaign_created: 'Campaign created',
  lead_added: 'Lead added',
} as const;

export type FlashKey = keyof typeof FLASH_MESSAGES;

export function setFlash(cookies: AstroCookies, key: FlashKey): void {
  cookies.set(FLASH_COOKIE, key, { path: '/admin', maxAge: 60, httpOnly: true, secure: true, sameSite: 'lax' });
}

/** The message to show now, or null. Always clears the cookie. */
export function takeFlash(cookies: AstroCookies): string | null {
  const raw = cookies.get(FLASH_COOKIE)?.value;
  if (raw === undefined) return null;
  cookies.delete(FLASH_COOKIE, { path: '/admin' });
  return Object.prototype.hasOwnProperty.call(FLASH_MESSAGES, raw) ? FLASH_MESSAGES[raw as FlashKey] : null;
}
