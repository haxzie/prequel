// Tailwind v4 is a PostCSS plugin here, not the Vite plugin `apps/desktop` uses.
// Next runs PostCSS itself; Turbopack then transforms and minifies with
// Lightning CSS. There is no `tailwind.config.js` — the theme lives in
// `src/app/globals.css`.
//
// See `experimental.turbopackLocalPostcssConfig` in next.config.ts for why this
// file needs help being found at all in this monorepo.
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
