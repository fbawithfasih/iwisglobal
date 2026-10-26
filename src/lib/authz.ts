// Who may do what in the admin. Two roles:
//   owner  everything.
//   team   everything except: team management, the audit log, erasing a person, system settings.
// "System settings" means the pages and actions below. Hiding a link is never the control: the middleware
// (src/middleware.ts) and each owner-only page or action check the same rules, so a person who types an
// address or posts a form by hand is refused too.
import { normalisePath } from './blockedPaths';

export type Role = 'owner' | 'team';

export type Principal = {
  /** How they signed in: the shared owner password (emergency access) or their own Google account. */
  source: 'owner_password' | 'staff';
  role: Role;
  /** Null for the owner-password sign-in, which is not tied to one person. */
  email: string | null;
  name: string;
  staffId: string | null;
};

/** Pages only the owner may open (first path segments after /admin, joined with /). */
export const OWNER_ONLY_PAGES = [
  'team', // staff accounts
  'audit', // audit log
  'overview', // owner overview: money totals and each person's workload
  'custom-trips', // "Customise your tour" prices, vehicles, fees and on/off switch
  'leads/meta', // Meta (Facebook, Instagram) connection and conversion settings
  'leads/backfill', // bulk rebuild of the contact records
  'whatsapp/launch', // automatic-reply launch checks
  'whatsapp/auto', // automatic-reply on/off and limits
] as const;

/** Actions on shared pages that only the owner may take: [area, action]. */
export const OWNER_ONLY_ACTIONS: ReadonlyArray<readonly [string, string]> = [
  ['person', 'erase'], // right-to-be-forgotten deletion
  ['hotels', 'switch_on'],
  ['hotels', 'switch_off'],
  ['hotels', 'save'], // markup and exchange rates
  ['hotels', 'refresh'],
  ['whatsapp', 'purge'], // delete old conversations
];

export function isOwnerOnlyPath(pathname: string): boolean {
  const parts = normalisePath(pathname);
  if (parts[0] !== 'admin') return false;
  const rest = parts.slice(1).join('/');
  return OWNER_ONLY_PAGES.some((p) => rest === p || rest.startsWith(p + '/'));
}

export function canAccessPath(principal: Principal, pathname: string): boolean {
  return principal.role === 'owner' || !isOwnerOnlyPath(pathname);
}

export function canDo(principal: Principal | undefined | null, area: string, action: string): boolean {
  if (!principal) return false;
  if (principal.role === 'owner') return true;
  return !OWNER_ONLY_ACTIONS.some(([a, b]) => a === area && b === action);
}

/** Who may hold a lead or a chat: nobody (''), the owner login, or a team member's email. */
export function isValidHolder(value: string): boolean {
  return value === '' || value === 'owner' || (value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

export const ownerPrincipal = (): Principal => ({ source: 'owner_password', role: 'owner', email: null, name: 'Owner', staffId: null });

/** The label written to the audit log as the actor. */
export function actorLabel(principal: Principal | undefined | null): string {
  if (!principal) return 'owner';
  return principal.email ?? 'owner';
}
