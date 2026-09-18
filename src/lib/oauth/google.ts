// Google OAuth 2.0 (server-side authorization-code flow). Requires
// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET — create a "Web application"
// OAuth client at https://console.cloud.google.com/apis/credentials with
// this app's /auth/google/callback URL added as an authorized redirect URI.

import { decodeJwtPayload, type OAuthProfile } from './shared';

export function buildGoogleAuthorizeUrl(env: Record<string, unknown>, redirectUri: string, state: string): string {
  const clientId = env.GOOGLE_CLIENT_ID as string | undefined;
  if (!clientId) throw new Error('Google sign-in is not configured.');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(env: Record<string, unknown>, code: string, redirectUri: string): Promise<OAuthProfile> {
  const clientId = env.GOOGLE_CLIENT_ID as string | undefined;
  const clientSecret = env.GOOGLE_CLIENT_SECRET as string | undefined;
  if (!clientId || !clientSecret) throw new Error('Google sign-in is not configured.');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error('Could not verify your Google sign-in. Please try again.');
  const tokens: any = await res.json();
  const claims = decodeJwtPayload(tokens.id_token);

  return {
    providerSub: claims.sub,
    email: claims.email,
    name: claims.name || claims.email,
    avatarUrl: claims.picture ?? null,
  };
}
