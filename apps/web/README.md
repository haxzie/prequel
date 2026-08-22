# @prequel/web

The public site — landing, blog, pricing and about — and the dashboard where a
team's shared recordings live. Next.js 16 (App Router, React 19, Turbopack) with
Tailwind v4.

```bash
pnpm dev:web                    # http://localhost:3000
pnpm --filter @prequel/api dev  # :8787 — the dashboard needs it
```

**There are no route handlers here.** Every API — auth, the library, uploads,
transcription, the waitlist — is the Cloudflare Worker in `apps/api`. See its
README for why; the short version is that D1 and R2 want bindings, and Vercel's
4.5 MB function body limit is not something video can be moved through.

The marketing pages are static. `/app/*`, `/login`, `/onboarding`, `/invite/*`,
`/desktop/auth` and `/v/*` are dynamic because they read a session or mint a
signed URL. `pnpm --filter @prequel/web build` prints the table; anything marked
`ƒ` outside that list is worth chasing down.

## Layout

```
src/app/          routes, plus icon.svg, opengraph-image, sitemap, robots
src/components/   the shell and the page furniture
src/content/      posts.ts + blog/*.mdx, use-cases.ts + create/*.mdx,
                  competitors.ts + alternatives/*.mdx
                  (a registry for the metadata, MDX for the prose)
src/components/dashboard/  the signed-in surfaces, all client components
src/lib/          site.ts, pricing.ts, faq.ts, seo.ts, og.tsx,
                  api.ts + session.ts + auth-client.ts (the Worker)
src/middleware.ts the cheap half of the dashboard's auth gate
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

## The dashboard

`/app` is the team's library: everything somebody pressed **Share Link** on in
the desktop app's export dialog. `/v/<slug>` is what those links open — a public
player page, no account needed on the viewer's side.

**Sessions.** The cookie is set by the Worker on `.prequel.sh`, so it covers both
hosts. `getMe()` in `src/lib/session.ts` forwards the incoming `cookie` header
and lets the Worker answer, wrapped in React's `cache()` — a dashboard page reads
the session in its layout, its page and a couple of components, and without
dedupe that is four calls to Cloudflare for one render.

`middleware.ts` only checks that a session cookie _exists_. Whether it is valid
is the Worker's answer to give, and asking it there would put a round-trip in
front of every navigation including the ones that ask again anyway. It is a fast
path, not authorisation — every page still calls `getMe()` and acts on the real
answer.

**Locally the cookie works with no domain set**, because cookies ignore the port
and `localhost:3000` and `localhost:8787` are the same host. In production it is
scoped to `.prequel.sh`. Pointing `NEXT_PUBLIC_API_URL` at anything outside that
domain leaves the dashboard signed out immediately after signing in.

**Every call needs `credentials: "include"`.** That is what `api()` in
`src/lib/api.ts` is for. A bare `fetch` to another origin sends no cookie and
comes back 401 while the user is plainly signed in.

**`/v/[slug]` must stay dynamic.** Its `src` is a presigned R2 URL with a
six-hour life, so a statically rendered copy would serve an expired one to
everybody who arrived after the build — which looks like a video that will not
play rather than like a stale cache. Note this is the opposite of every other
dynamic route here, which all set `dynamicParams = false` and prerender their
whole set.

It is also `robots: { index: false }`. A share link is unlisted, not public:
indexing one would turn "anyone with the link" into "anyone at all", which is not
what sharing was understood to mean.

## Waitlist

`WaitlistForm` posts to `/v1/waitlist` on the Worker, which files the address as
a response to a Google Form. It is the one endpoint a browser calls without
credentials, and the only reason this form is a client component.

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

Both `WAITLIST_ENDPOINT` and `WAITLIST_FIELD` are now vars in
`apps/api/wrangler.jsonc`, not variables in `.env`.

## Environment

`src/instrumentation.ts` calls `validateEnv()`, so a missing or malformed
variable fails at boot with the offending name rather than at the first request.

There is almost nothing server-side left to validate. `NEXT_PUBLIC_APP_URL` and
`NEXT_PUBLIC_API_URL` are the two that matter, and both are public. Secrets — the
OpenAI key, Google's OAuth pair, R2's and SES's credentials — belong to the
Worker and live in `apps/api/.dev.vars` and `wrangler secret`.

`@prequel/env` ships raw TypeScript rather than a compiled `dist`, so it is
listed in `transpilePackages`. Do not import it from `next.config.ts` — that
file is loaded by Node before transpilation applies.

## AGENTS.md

`apps/web/AGENTS.md` is generated and re-added by `next dev`. Do not hand-edit
it; committing it alongside your work is the way to keep the tree clean.
