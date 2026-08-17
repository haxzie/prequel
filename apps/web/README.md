# @prequel/web

The public site — landing, blog, pricing and about. Next.js 16 (App Router,
React 19, Turbopack) with Tailwind v4.

```bash
pnpm dev:web    # http://localhost:3000
```

Every route is static except `/api/waitlist`. `pnpm --filter @prequel/web build`
prints the table; anything marked `ƒ` that you did not intend to be dynamic is
worth chasing down.

## Layout

```
src/app/          routes, plus icon.svg, opengraph-image, sitemap, robots
src/components/   the shell and the page furniture
src/content/      posts.ts (the registry) and blog/*.mdx (the prose)
src/lib/          site.ts, pricing.ts, og.tsx
public/           prequel.svg
```

## Styling

Tailwind v4 through **PostCSS** — `postcss.config.mjs` plus
`@tailwindcss/postcss`. Not the `@tailwindcss/vite` plugin `apps/desktop` uses;
that is a Vite plugin and does nothing here.

There is no `tailwind.config.js`. The palette and the custom utilities live in
`src/app/globals.css`, mapped through `@theme inline` exactly as the desktop
renderer does it. Colours are lifted from the app icon — the sun gradient, the
playhead blue, the clip purple and its lilac handles.

`experimental.turbopackLocalPostcssConfig` in `next.config.ts` is **load-bearing
in this monorepo.** Turbopack looks for a PostCSS config at the project root
first, and the project root here is the repo root. Without the flag this app's
`postcss.config.mjs` can be skipped, Tailwind never runs, and every page renders
unstyled with nothing reported. If the site suddenly looks like plain HTML, that
is where to look.

The site is **dark only**. `color-scheme` is fixed and there is no
`prefers-color-scheme` block to keep in sync.

## The mark

`src/components/Logo.tsx` is the only place the logo is rendered. The artwork
bleeds to all four edges, so it is always clipped to the macOS superellipse —
radius 0.2237 of the side, exponent 4, the same shape
`apps/desktop/scripts/make-app-icon.mjs` masks the app icon with. Engines
without `corner-shape` fall back to the rounded square.

`src/app/icon.svg` carries that curve baked into a clip path instead, because
nothing wraps a favicon — and `src/lib/og.tsx` uses that same file, since satori
supports neither `corner-shape` nor a stylesheet.

## Adding a blog post

1. Write `src/content/blog/<slug>.mdx`. Prose only — `@next/mdx` does not read
   frontmatter.
2. Add an entry to `ENTRIES` in `src/content/posts.ts` with that slug.

Metadata lives in the registry rather than the MDX so the index page does not
have to import every post's body to list them. Element styling comes from
`src/mdx-components.tsx`, so the MDX carries no class names.

`useMDXComponents` there takes **no argument** — Next 16 changed the signature,
and the 15-era `(components) => …` form silently drops the overrides.

Remark and rehype plugins must be named as **strings** in `next.config.ts`.
Turbopack runs them in Rust and cannot be handed a JavaScript function, which
rules out most syntax highlighters.

## Waitlist

`WaitlistForm` posts to `/api/waitlist`, which files the address as a response
to a Google Form. `WAITLIST_ENDPOINT` and `WAITLIST_FIELD` both default to the
live form, so it works with no configuration.

It runs server-side because Google Forms sends no CORS headers: posted from the
browser the response is opaque, and the form appears to work whether or not
anything arrived.

**The failure mode to know about.** Google accepts any POST, discards fields it
does not recognise and answers 200 either way. A wrong `WAITLIST_FIELD` loses
every address with nothing logged anywhere. The field id is also _not_ the
question id in the form's HTML — they are different numbers. After any change
to the form, re-derive it and submit one real response to check it lands:

```bash
curl -s "https://docs.google.com/forms/d/<edit-id>/viewform" |
  grep -o 'FB_PUBLIC_LOAD_DATA_ = .*' # entry ids live in this blob, not in the markup
```

## Environment

`src/instrumentation.ts` calls `validateEnv()`, so a missing or malformed
variable fails at boot with the offending name rather than at the first request.

`@prequel/env` ships raw TypeScript rather than a compiled `dist`, so it is
listed in `transpilePackages`. Do not import it from `next.config.ts` — that
file is loaded by Node before transpilation applies.

## AGENTS.md

`apps/web/AGENTS.md` is generated and re-added by `next dev`. Do not hand-edit
it; committing it alongside your work is the way to keep the tree clean.
