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
src/content/      posts.ts + blog/*.mdx, use-cases.ts + create/*.mdx,
                  competitors.ts + alternatives/*.mdx
                  (a registry for the metadata, MDX for the prose)
src/lib/          site.ts, pricing.ts, faq.ts, seo.ts, og.tsx
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

## Adding a use-case page

The `/create/<slug>` pages are the keyword landing pages. They share one hero
component and the whole of the landing page's body; only the hero copy, the
metadata and a short FAQ tail differ.

1. Write `src/content/create/<slug>.mdx`. Prose only, and **no `#` heading** —
   the `<h1>` is the hero, and a second one on the page is the easiest own goal
   here. Start at `##`.
2. Add an entry to `useCases` in `src/content/use-cases.ts` with that slug.

Aim for 250–450 words. Below that the page is thin content sitting on a body
sixteen other pages already carry, which is the failure mode of a set like this.

Declaration order in the registry is the footer's order, and there is no index
page — the footer column is what makes the set crawlable.

A registry entry with no matching MDX file fails the **build**, with a
module-not-found at prerender. That is the intended behaviour: it is a missing
file, caught before it ships. Do not wrap the import in a try/catch to make it
quieter.

## Adding a comparison page

`/alternatives/<competitor>` pages compare Prequel against a named product.
Same two-step shape as the others — MDX for the prose, `src/content/competitors.ts`
for everything else — but they carry a rule the rest of the site does not.

**They make checkable claims about someone else's product.** Every entry has a
`verifiedOn` date and a `sources` list, both of which render on the page. If a
price or a feature cannot be cited, leave the row out; an omitted row costs
nothing and a wrong one discredits every number on all eleven pages.

**Quote every billing period.** Screen Studio is $29 a month billed monthly
*and* $9 a month billed yearly. Publishing only the monthly figure reads as
three times the real annual cost and is checkable in one click. That is what
`priceSummary` is for — the summary card uses it rather than `plans[0]`.

Our own prices are never written in that file. The comparison reads `PLANS`
from `src/lib/pricing.ts`, so when the placeholders there become real numbers,
one edit fixes every page.

Competitor logos are not bundled. `mark: "monogram"` draws their initial in
their own accent colour and needs no third-party asset. Setting `mark: "asset"`
reads `public/logos/<slug>.svg`, and should only be done once that file exists
and the vendor's brand terms have been checked — Apple's prohibit it, so
`quicktime` stays a monogram.

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

## Transcription

`/api/transcribe` forwards a recording's microphone track to OpenAI Whisper for
the desktop app's caption feature. It needs `OPENAI_API_KEY`; without it the
route answers 503 and the editor reports that transcription is unavailable,
which is deliberate — the site still builds and deploys with no key.

**The audio passes through this server.** That is forced, not chosen: OpenAI's
ephemeral keys are scoped to the Realtime API, so there is no short-lived
credential that would let the desktop app upload to `/v1/audio/transcriptions`
itself. The only other option is embedding the real key in a downloadable app.
Nothing is written to disk here and the audio is not retained past the forward,
but it is worth knowing that this route is on the path of every user's
microphone.

**`whisper-1`, and not by preference.** It is the only OpenAI model that returns
word timestamps at all — the gpt-4o transcribe models do not support
`timestamp_granularities` — and `response_format=verbose_json` is a precondition
for getting them rather than a nicety. Its word times are interpolated from
segment boundaries rather than measured, so they run a couple of hundred
milliseconds out; the desktop app declares this as `timings: "interpolated"` and
snaps the boundaries to the audio to recover most of it.

**Size.** The route rejects anything over 4 MB, which is a little over four
minutes of `mic.m4a`. Two ceilings stack: OpenAI accepts 25 MB, and a serverless
host in front of this accepts far less — Vercel's function body limit is 4.5 MB
and is infrastructure, not something application code can raise. Lifting this
means streaming the upload or putting the route somewhere without that limit.

This is the only runtime link between the site and the desktop app. They still
share no code — the rule in `AGENTS.md` is about imports across that boundary,
not about an HTTP endpoint — and the JSON this route returns is the whole
contract between them.

**What is weak about it, plainly.** There is no account system, so the rate
limit is an in-memory `Map` keyed on an anonymous per-install id: per-instance
on serverless, and reset by every deploy. It stops one client running this in a
loop and nothing more. The size cap is what bounds the cost of any single call.

**The desktop side needs the deployed URL at build time.** It calls
`NEXT_PUBLIC_APP_URL`, baked into the Electron main bundle when it is packaged —
see `publicEnv` in `apps/desktop/electron.vite.config.ts`. Packaging without it
set ships an app that calls `http://localhost:3000`. `PREQUEL_APP_URL` overrides
it when pointing a dev build at a local `next dev`.

## Environment

`src/instrumentation.ts` calls `validateEnv()`, so a missing or malformed
variable fails at boot with the offending name rather than at the first request.

`@prequel/env` ships raw TypeScript rather than a compiled `dist`, so it is
listed in `transpilePackages`. Do not import it from `next.config.ts` — that
file is loaded by Node before transpilation applies.

## AGENTS.md

`apps/web/AGENTS.md` is generated and re-added by `next dev`. Do not hand-edit
it; committing it alongside your work is the way to keep the tree clean.
