# Email artwork

Served from `prequel.sh/email/…` and linked by `apps/api/src/lib/ses.ts`. An
email cannot carry a React component or a Tailwind class, so the one piece of
brand on it has to be a flat image on a public URL.

`wordmark.png` is the shipped app icon from `apps/desktop/build/icon.png`,
already masked to the macOS squircle by `pnpm app-icon`, beside "Prequel" set
the way `components/Nav.tsx` sets it: **Playwrite VN 400** with a 0.4px stroke
for the extra weight the family has no cut for. 303×100, which is 152×50 at 2×,
on transparency and in the light-theme `--fg` so it sits on the email's white
shell.

**Not Geist.** `components/Logo.tsx` exports a `Wordmark` that pairs the mark
with the word in the body sans, and it is the wrong reference for this — the
nav, which is what anybody means by "the logo", is the handwriting face. The
two look nothing alike and the mistake is invisible until somebody who knows
the brand looks at it.

Regenerate it by rendering the mark and the word together at 3× in headless
Chrome and cropping to the alpha bounds. The font has to be embedded as a local
`@font-face`: headless Chrome cannot always reach `fonts.gstatic.com`, and a
web font that never arrives falls back silently to a system sans that still
looks like a wordmark. Nothing builds this automatically — it changes when the
brand does, which is roughly never.
