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
    },
  },
  plugins: [],
}
