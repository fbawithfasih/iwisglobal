// Cloudflare Pages runtime env (dashboard-bound vars) falls back to
// build-time import.meta.env for local dev — the two differ between
// production and `astro dev`.
export function resolveEnv(locals: unknown): Record<string, any> {
  const runtimeEnv = (locals as any)?.runtime?.env ?? {};
  return {
    ...runtimeEnv,
    PUBLIC_RAZORPAY_KEY_ID: runtimeEnv.PUBLIC_RAZORPAY_KEY_ID ?? import.meta.env.PUBLIC_RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: runtimeEnv.RAZORPAY_KEY_SECRET ?? import.meta.env.RAZORPAY_KEY_SECRET,
  };
}
