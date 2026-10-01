// Shared between google.ts and apple.ts: the normalized profile shape both
// providers resolve to, and the id_token JWT payload decoder they both use.

export interface OAuthProfile {
  providerSub: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  // The provider vouches that this email belongs to the account (id_token
  // email_verified claim). Only then are guest bookings with it linked.
  emailVerified: boolean;
}

// Decodes (but does NOT verify the signature of) an id_token's payload.
// Safe here because both callers fetch the id_token directly from the
// provider's token endpoint over TLS (server-to-server), not from the
// client — the "confidential client" flow, where the transport itself is
// the trust boundary, unlike verifying a client-supplied id_token.
export function decodeJwtPayload(jwt: string): any {
  const payload = jwt.split('.')[1];
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(json);
}
