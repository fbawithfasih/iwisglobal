// Cloudflare Pages runtime env (dashboard-bound vars) falls back to
// build-time import.meta.env for local dev — the two differ between
// production and `astro dev`.
export function resolveEnv(locals: unknown): Record<string, any> {
  const runtimeEnv = (locals as any)?.runtime?.env ?? {};
  return {
    ...runtimeEnv,
    PUBLIC_RAZORPAY_KEY_ID: runtimeEnv.PUBLIC_RAZORPAY_KEY_ID ?? import.meta.env.PUBLIC_RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: runtimeEnv.RAZORPAY_KEY_SECRET ?? import.meta.env.RAZORPAY_KEY_SECRET,
    ADMIN_PASSWORD_SALT: runtimeEnv.ADMIN_PASSWORD_SALT ?? import.meta.env.ADMIN_PASSWORD_SALT,
    ADMIN_PASSWORD_HASH: runtimeEnv.ADMIN_PASSWORD_HASH ?? import.meta.env.ADMIN_PASSWORD_HASH,
    ADMIN_SESSION_SECRET: runtimeEnv.ADMIN_SESSION_SECRET ?? import.meta.env.ADMIN_SESSION_SECRET,
    CUSTOMER_SESSION_SECRET: runtimeEnv.CUSTOMER_SESSION_SECRET ?? import.meta.env.CUSTOMER_SESSION_SECRET,
    GOOGLE_CLIENT_ID: runtimeEnv.GOOGLE_CLIENT_ID ?? import.meta.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: runtimeEnv.GOOGLE_CLIENT_SECRET ?? import.meta.env.GOOGLE_CLIENT_SECRET,
    APPLE_CLIENT_ID: runtimeEnv.APPLE_CLIENT_ID ?? import.meta.env.APPLE_CLIENT_ID,
    APPLE_TEAM_ID: runtimeEnv.APPLE_TEAM_ID ?? import.meta.env.APPLE_TEAM_ID,
    APPLE_KEY_ID: runtimeEnv.APPLE_KEY_ID ?? import.meta.env.APPLE_KEY_ID,
    APPLE_PRIVATE_KEY: runtimeEnv.APPLE_PRIVATE_KEY ?? import.meta.env.APPLE_PRIVATE_KEY,
    RESEND_API_KEY: runtimeEnv.RESEND_API_KEY ?? import.meta.env.RESEND_API_KEY,
    BOOKING_EMAIL_FROM: runtimeEnv.BOOKING_EMAIL_FROM ?? import.meta.env.BOOKING_EMAIL_FROM,
  };
}
