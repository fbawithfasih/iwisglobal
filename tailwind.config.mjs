import colors from 'tailwindcss/colors';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // Deliberate purple brand identity, kept distinctive (CTAs/links/
        // pale section backgrounds) rather than applied everywhere.
        brand: colors.violet,
        // Reserved for offers/urgency only — not a second primary color.
        accent: colors.orange,
      },
      // Source Serif 4 (clean, upright; replaced the slanted Cormorant
      // Garamond on 27 Sep 2026) is loaded in BaseLayout.astro's <head> and
      // `font-serif` is used on every heading sitewide, but without this
      // override Tailwind's default serif stack (Georgia/Times) rendered
      // instead — the font was loaded but never actually applied.
      fontFamily: {
        serif: ['"Source Serif 4"', 'ui-serif', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
