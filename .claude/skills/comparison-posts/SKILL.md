---
name: comparison-posts
description: Write a comparison or listicle post for the blog: "best screen recorders for Mac", "top N alternatives to X", "X vs Y", a roundup, a buyer's guide. Use this whenever someone asks for a post that ranks or compares Prequel against other tools, or asks to add a competitor to one, or to refresh the prices in an existing one. Covers the shape of the post, the voice, how Prequel is positioned, capturing competitor screenshots without their cookie banners, which links are allowed, and what to check before it ships.
---

# Comparison posts

Marketing posts that rank Prequel against other tools. They live in the blog
alongside the engineering write-ups and read nothing like them: an engineering
post explains a decision to somebody who will maintain it, and one of these
sells to a stranger who is deciding in about forty seconds.

`/alternatives/<slug>` pages are the neighbouring genre and are **not** this.
Those make narrow, cited, head-to-head claims and are governed by
`src/content/competitors.ts`. These are the wide roundups that link to them.
How-tos, explainers and pillars are `[[guide-posts]]`. A post built around
leaving one named tool ("Loom alternatives") is `[[alternatives-posts]]`,
which has its own shape: proof for every reason people leave, a methodology
block, pros and cons per tool. This skill keeps the screenshot procedure
that both use.

Prices and complaints come from a brief. If `.context/research/<slug>.md`
exists, `[[blog-research]]` has already fetched and dated them; if it does
not, run that skill before writing a post that names ten prices.

## Where things go

| Path                                       | What it is                                         |
| ------------------------------------------ | -------------------------------------------------- |
| `apps/web/src/content/blog/<slug>.mdx`     | The prose. No frontmatter; MDX cannot read it.     |
| `apps/web/src/content/posts.ts`            | Title, excerpt, date, tag, reading time.           |
| `apps/web/public/blog/tools/<tool>.webp`   | Screenshots, **shared across every post**.         |
| `apps/web/src/content/competitors.ts`      | Cited facts for the six with comparison pages.     |
| `apps/web/src/mdx-components.tsx`          | Table and image styling. Already done, do not add. |
| `.claude/skills/comparison-posts/scripts/` | The screenshot capturer.                           |

Tables work because `remark-gfm` is on in `next.config.ts`. Images have an
`img` override that reserves a 16:10 box, so every screenshot wants that ratio
or it gets cropped.

## The shape

Lead with the table. Somebody who lands here from a search wants the answer
before the argument, and burying it under two paragraphs of throat-clearing is
how they leave.

```
## TL;DR
<table: rank, tool, price, best for>
Prices checked on <date>.

<two short paragraphs: what this post is, and the one-line answer>

## What is <the thing>?          <- unique across the blog
<two short paragraphs, the first standing alone>

---

## 1. Prequel
<screenshot>
<what it does, sold hard>
**Price.** ... **Requires.** ...

## 2. <competitor>
<screenshot>
<what it is genuinely good at>
<one subtle factual point where Prequel wins>
**Price.** <their pricing, plainly>
[Prequel vs <competitor> →](/alternatives/<slug>)   ← only if that page exists

...

## So which one
<use-case blocks, then the cost argument, then the trial>
[See what Prequel costs →](/pricing)
```

**Every post opens with a definitional question**, as its own `##` section:
"What is a webcam overlay?", "What is internal audio?". Answer it in two short
paragraphs, plainly enough that the first one stands alone if a search engine or
an assistant lifts it out with nothing around it.

On a pillar it goes at the very top. On a roundup it goes **under** the TL;DR
table, because the table stays first: somebody who searched for a comparison
wants the answer before a definition.

The question has to be unique across the blog. Two pages answering "What is a
screen recorder?" in near-identical words compete with each other for the same
result rather than one of them winning it, so a roundup takes the choosing
question ("How do you choose a screen recorder for Mac?") and the pillar keeps
the definition.

The FAQ is **not** written in the MDX. It lives on the post's entry in
`posts.ts` and the template renders it under the body, so do not add a
`## FAQ` heading to the prose or the page ends up with two.

## Voice

Read `[[plain-marketing-copy]]` in memory if it is loaded; this is the same
rule set applied to a longer form.

**No em dashes. Anywhere.** Use a comma, a colon, brackets, or two sentences.
This is a standing instruction and it is the first thing that gets noticed. En
dashes in numeric ranges (`$18–$24`) are fine.

**Short, plain sentences, second person.** The repo's code comments are long
and discursive and that voice is wrong here. Do not carry it over.

**Directive, not neutral.** Tell the reader which tool is for them rather than
laying out options and leaving them to work it out. "If you are sending a bug
to one colleague, use Loom and stop there" beats "Loom is suited to quick
asynchronous communication."

**First person for the description.** The excerpt in `posts.ts` drives the SEO
description, the OG card and the standfirst on the page, all from one field.
Write it as us: "We tried 12 of the best screen recorders for Mac, and here is
our ranking."

## Positioning Prequel

Prequel is number one. That is the premise, not a finding, and the post does
not argue itself into it.

**Never name a Prequel shortcoming.** No "the catch" paragraph, no "it is the
newest thing here", no conceding a feature to a rival. If a competitor genuinely
beats us on something, leave it out rather than write it down.

**Work a factual Prequel win into every competitor section.** One or two
sentences, woven into the prose rather than bolted on as a verdict. It has to be
true and checkable, because the surrounding facts are:

- 4K at up to 120 fps, on every plan. Most of the category stops at 60.
- No watermark, on any plan or during the trial.
- No cap on the length of a take.
- Renders locally. No upload, no queue, nothing leaves the Mac unasked.
- $29 once, against subscriptions and against far dearer one-off licences.
- A camera re-framed after the take, because the sources are recorded separately.
- The code is on GitHub (github.com/haxzie/prequel), under FSL-1.1-ALv2, which
  becomes Apache 2.0 two years after each release. Say "the code is on GitHub"
  and name the licence; do not write "open source" bare, which a GPL or MIT
  user will dispute, and never claim an OSI licence.

Pick the one that actually contrasts with the tool in that section. Against a
free tool, price is not the win, so use the fact that it arrives edited.

**The one thing that stays in: system requirements.** Apple Silicon, macOS 14 or
later, stated as a requirement rather than a limitation. This is not
self-criticism, it is whether the thing runs on the reader's machine, and
suppressing it produces a refund and a one-star review rather than a sale.

**Prequel's price is green** in the TL;DR table, using the `--positive` token:

```mdx
| 1 | **Prequel** | <span className="font-medium text-positive">$29 once, or $9/mo</span> | ... |
```

Bold stays too, so the row still reads as the winner in plain text and anywhere
the class is stripped.

## Facts

Every price in the post is a claim about somebody else's business that a reader
can check in one click, and a wrong one discredits every other number on the
page. `competitors.ts` states this rule for the comparison pages and it applies
here with more force, because a roundup carries ten times as many numbers.

- For the six with a comparison page, take the figures from `competitors.ts`.
  They carry `verifiedOn` and `sources` already.
- For anyone else, fetch the vendor's own pricing page and read it. Do not
  write a price from memory. They move, and the post is dated.
- Put the check date under the table.
- Prefer the vendor's own page over a review site, and prefer the detail
  endpoint over a summary; they disagree more often than you would expect.

## Links

**Never link a competitor's site.** Not in prose, not on their name, not in the
image. The screenshots are hosted locally precisely so the post does not have
to. The citation hosts are the only outbound links: reddit.com,
news.ycombinator.com, x.com, g2.com (and github.com or producthunt.com for a
scale figure). The check script flags anything else.

`mdx-components.tsx` gives any `http(s)` link `target="_blank"` and
`rel="noreferrer noopener"` off the href, so nothing needs setting per link.

Link internally to `/alternatives/<slug>` at the end of any section where that
page exists. Today that is `screen-studio`, `loom`, `camtasia`, `screenflow`,
`descript` and `tella`. Close with `/pricing`.

## Screenshots

One per tool, of their landing page, plus one of Prequel. They live in a single
`blog/tools/` pool keyed by tool rather than per post, because the same twelve
sites turn up across every roundup and a copy per post is both repo weight and
twelve places to refresh when somebody redesigns. Check whether the shot already
exists before capturing.

Every consent banner has to go: a post whose illustrations are eleven cookie walls looks careless,
and the banner is the largest thing in several of these frames.

Start Chrome with the protocol open, then run the capturer:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --no-first-run \
  --user-data-dir=/tmp/shots-profile --remote-debugging-port=9222 &

node .claude/skills/comparison-posts/scripts/capture-sites.mjs /tmp/shots \
  '{"screen-studio":"https://screen.studio","loom":"https://www.loom.com"}'
```

It navigates, waits, strips consent walls and chat widgets twice (some mount
after first paint), and writes a 1440x900 PNG at 2x per slug.

The consent remover finds banners **by their buttons** rather than by CSS
position or class name. Position heuristics miss the ones rendered in normal
flow, and class-name heuristics miss generated class names; an "Allow all
cookies" button is the one reliable signal. It removes the node rather than
clicking anything, so no consent is given either way.

Then down to what the post ships:

```bash
for f in /tmp/shots/*.png; do
  magick "$f" -resize 1440x900 -strip -quality 78 \
    "apps/web/public/blog/tools/$(basename "$f" .png).webp"
done
```

That lands around 50 KB each. **Look at every one before shipping.** A banner
that survived, a hero mid-animation with half a headline, or a page that served
a variant are all things only your eyes catch.

**A `WALL` line means the capture is an interstitial, not the page.** Review
sites and anything behind Cloudflare answer 200 to a headless browser and serve
"Access is temporarily restricted" instead of content, which screenshots
perfectly and reports success. The script probes the page text and flags it.
Never ship a file it warned about. G2, Capterra and Trustpilot are all blocked
this way, to `curl` and to headless Chrome alike.

**Reddit is reachable, but only through Firecrawl, and only for search.**
`firecrawl_search` with `includeDomains: ["reddit.com"]` returns real threads
with titles, snippets and URLs. `firecrawl_scrape` refuses the domain outright
("we do not support this site"), and plain Chrome gets a 403, so there is no way
to capture comment text or a screenshot of a thread.

That is enough for a citation and not enough for a screenshot, which settles how
this evidence is used:

- **Screenshot the real thread, through the user's own Chrome.** Headless Chrome
  cannot: Reddit serves it a "Prove your humanity" challenge, and getting round
  that is off the table. A logged-in human browser loads it normally, so the
  claude-in-chrome extension is the route.

  Per thread: open it, then run this to switch the page to Reddit's light
  palette (local DOM only, no account setting is written), drop attached media,
  and measure the post so the crop is exact.

  ```js
  const html = document.documentElement;
  html.classList.remove("theme-dark");
  html.classList.add("theme-light");
  html.style.colorScheme = "light";
  const post = document.querySelector("shreddit-post");
  post.querySelectorAll("img, video, figure, [slot='post-media-container']").forEach((n) => {
    if (!n.closest("[slot='credit-bar']")) n.remove();
  });
  const r = post.getBoundingClientRect();
  ({ scale: 1456 / window.innerWidth, rect: [r.x, r.y, r.width, r.height] });
  ```

  Then screenshot with `save_to_disk`, and crop with the returned rect scaled by
  `scale`. **Measure that scale every time**: the extension returned 1456px for
  a 1512px viewport on most captures and 1512px on one, and a hardcoded factor
  silently misaligns the crop.

  ```bash
  magick shot.jpg -crop 720x196+335+62 +repage -strip -quality 88 out.webp
  ```

  Three things the crop is doing, all of them necessary. It removes the left
  rail, which shows **the user's own account and recently visited subreddits**;
  never ship an uncropped capture. It removes attached media, which is usually
  the other vendor's marketing artwork rather than evidence. And it removes the
  promoted post Reddit injects under the thread.

  Write the file at its cropped size. Do not pad it onto a 16:10 canvas: the
  `img` override in `mdx-components.tsx` sizes on the image's own proportions,
  so padding just shrinks the content inside a large empty frame.

- **Prefer a genuine complaint to a launch post.** Several Loom threads that
  surface in search are founders announcing their own alternative. The title
  reads like a user grievance and the body is an advert.

- **Or draw the card from the thread's real data.** Since 2026-09-16 there is
  `alternatives-posts/scripts/render-quote-card.mjs`: read the title, sub,
  author, score and first paragraph from the open thread and it renders a
  clean card with no rail to crop. Every field copied verbatim, the link
  under the image. That is a rendering of a real post, which is fine.

- **Never synthesise the missing post.** A card holding content that did not
  come from a verifiable URL is a fabricated review attached to a named
  company, and it discredits every checked price on every one of these
  pages. The renderer makes this easier to do by accident, which is why the
  link under the card is not optional.

**Some banners will not die.** Screen Studio's survived three passes of the
remover, which is a good moment to stop rewriting selectors: it is one image,
and the banner sits below the hero. Crop a 16:10 window above it instead. Find
the y where the banner starts, take that as the height, multiply by 1.6 for the
width, and centre it:

```bash
# banner starts at y=1418 in a 2880x1800 capture
magick shot.png -crop 2269x1418+305+0 +repage \
  -resize 1440x900 -strip -quality 78 out.webp
```

The result is a tighter hero crop that looks deliberate rather than salvaged,
so this is a fine outcome rather than a fallback to feel bad about.

Prequel's own shot is its landing page, captured the same way as everyone
else's so the row of screenshots reads as one set. Asked for on 2026-09-16;
before that it was the editor screenshot padded onto 16:10, which looked
like the odd one out. The dev server is the source, and `next dev` draws its
"N" badge in the bottom-left corner, which is painted over because that spot
is plain white:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --no-first-run \
  --force-device-scale-factor=2 --window-size=1440,900 \
  --screenshot=/tmp/prequel-site.png "http://localhost:3111/"
magick /tmp/prequel-site.png -fill white -draw "rectangle 20,1660 140,1790" \
  -resize 1440x900 -strip -quality 82 apps/web/public/blog/tools/prequel.webp
```

Check the corner afterwards; if the landing page ever gets a dark footer
there, the rectangle needs a different colour.

## Registering the post

Add an entry to `ENTRIES` in `posts.ts`. `readingMinutes` is written by hand;
count roughly 200 words a minute. The sitemap picks it up from `posts`, so
there is nothing else to add.

`faq` is required, so a post cannot ship without one; that is deliberate, since
"remember to add an FAQ" as a convention is forgotten on the next post. The
template renders it after the conclusion and emits it as `FAQPage` structured
data off the same array, so the visible answers and the JSON-LD cannot drift.

Write six or so for a roundup, fewer for a short post. Two things matter more
than the count:

- **Answer the query, not the article.** These are the questions somebody types
  into a search box: "what is the best free screen recorder for Mac", "does X
  watermark exports", "how much does Y cost". A question only a reader of this
  post would ask is a question nobody searches.
- **Each answer stands alone.** They get extracted and shown without the post
  around them, by search engines and by assistants, so an answer that depends
  on the paragraph above it is an answer nobody sees. Repeat the subject, name
  the price again, and work Prequel into the answer where it belongs.

The rest of the structured data is automatic: `BlogPosting`, `FAQPage` and
`BreadcrumbList` on every post, `Blog` and `BreadcrumbList` on the index, plus
the site-wide `Organization` and `WebSite` from the root layout. Metadata,
canonical and the OG card all come from `pageMetadata` off the same entry.
Nothing to add per post.

## Before it ships

```bash
.claude/skills/blog-review/scripts/check-post.sh <slug>   # exits with the blocker count
pnpm --filter @prequel/web typecheck
npx prettier --write apps/web/src/content/blog/<slug>.mdx
```

The script is the mechanical half of `[[blog-review]]`: em dashes, outside
hosts, the claims that may not be made, dead links, a duplicate definitional
question, the `posts.ts` entry. Run the skill itself for the read.

Then load the page and read it. Check that every screenshot resolves, that each
`/alternatives/` link is a real route (`typedRoutes` catches a dead one at
build, but only for `<Link>`, not for markdown), and that the images have
actually decoded before you judge them: they are lazy-loaded, so one screenshot
taken mid-scroll shows an empty box that is not a bug.
