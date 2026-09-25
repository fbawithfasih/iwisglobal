import { defineMiddleware } from 'astro:middleware';

// Every page is server-rendered and BaseLayout builds its canonical from the
// request path, so /help and /help/ both answered 200 and each claimed to be
// canonical. One URL per page: 301 any trailing-slash path to its bare form.
export const onRequest = defineMiddleware((context, next) => {
  const { pathname, search } = context.url;
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return context.redirect(pathname.replace(/\/+$/, '') + search, 301);
  }
  return next();
});
