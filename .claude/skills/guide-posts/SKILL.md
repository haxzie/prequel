---
name: guide-posts
description: Write or edit a how-to, explainer or pillar post for the Prequel blog: "how to record system audio on a Mac", "how to add subtitles to a screen recording", "the complete guide to X", a settings guide, a use-case walkthrough. Use this whenever someone asks to write, draft, edit or tighten a blog post that is not a ranking of tools (those are comparison-posts). Covers the shape of a guide, the voice, how Prequel enters the post, figures, the pillar and cluster fields, registering it in posts.ts, and what to check before it ships.
---

# Guide posts

Posts that teach somebody to do a thing on their Mac, and show them that
Prequel does most of it for them. They sit in the blog beside the roundups and
are a different genre: a roundup answers "which tool", a guide answers "how",
and the reader arrives with a task rather than a shortlist.

Roundups, listicles and "X vs Y" are `[[comparison-posts]]`. Landing page and
use-case copy is `[[site-copy]]`. If a brief exists from `[[blog-research]]`
it is in `.context/research/<slug>.md`; read it first, and if there is none,
run that skill before writing a post that names a competitor's price.

## Where things go

| Path                                    | What it is                                              |
| --------------------------------------- | ------------------------------------------------------- |
| `apps/web/src/content/blog/<slug>.mdx`  | The prose. No frontmatter, no `#`; start at `##`.       |
| `apps/web/src/content/posts.ts`         | Title, excerpt, date, tag, reading time, FAQ, pillar.   |
| `apps/web/src/components/blog/`         | Drawn figures of the editor, one file per post.         |
| `apps/web/public/blog/tools/<tool>.webp` | Landing page shots, shared across every post.          |
| `apps/web/public/blog/quotes/`          | Cropped Reddit threads, indexed in `quotes.json`.       |
| `apps/web/src/mdx-components.tsx`       | Heading, image, table styling. Done; do not add.        |

The `<h1>` is rendered from `posts.ts`, so the MDX has no `#` heading. The
first line of the file is `## What is <thing>?`.

## The shape

Existing guides run 900 to 1,300 words. Read two before writing one:
`add-subtitles-to-screen-recording.mdx` for a feature walkthrough and
`screen-recording-for-youtube.mdx` for a settings guide. The order below is
what they share.

```
## What is <thing>?                      <- unique across the blog
<two short paragraphs; the first stands alone>

<the hook: the problem, in the reader's terms, two or three paragraphs>
<one sentence saying what the post covers>

## What macOS gives you                  <- when the task is one macOS half-does
<QuickTime and Cmd+Shift+5, plainly: what they do and do not do>
[Related post →](/blog/<slug>)

## <the decisions, or the steps>
### 1. <step as an action>
### 2. ...

## How to do it in Prequel               <- or "What Prequel does differently"
<figure>
<the steps, one control name per step, bold on the control>

## What to record with                   <- settings guides only
[Roundup →](/blog/...) · [Roundup →](/blog/...)
<one paragraph: the requirements this task narrows to, and that Prequel meets
them. Price, trial, Apple Silicon, macOS 14 or later.>
[See what Prequel costs →](/pricing)

## Where to go next
<one line of context, then a link, two or three times>
```

**The definitional question opens the post** and answers itself in two short
paragraphs, the first plain enough to survive being lifted out alone by a
search engine or an assistant. It has to be unique across the blog: two pages
answering "What is a screen recorder?" compete with each other for the same
result. Check before choosing:

```bash
grep -h "^## What is\|^## How do you" apps/web/src/content/blog/*.mdx
```

**The hook lands the problem before the fix.** "Most people who open your
screen recording will watch the first few seconds with the sound off" comes
before any mention of captions. A guide that opens with the solution has
nothing for the reader to want it for.

**Sections lead with the action.** "Turn the microphone on before you record"
beats "Before we look at captions, it is worth understanding how audio works".
Strip the run-up and start on the verb.

**Headings are sentence case and say what the section delivers.** Not
"Overview", not "Background", not a question unless the reader is actually
asking it, and never two questions in a row. Numbered `###` steps in the
Prequel section, each named for what the reader does.

**The FAQ is not in the MDX.** It lives on the post's entry in `posts.ts` and
the template renders it under the body. A `## FAQ` heading in the prose puts
two on the page.

## Voice

Read `[[plain-marketing-copy]]` in memory if it is loaded. It is the user's
own correction and it outranks anything inferred from an older post.

**No em dashes. Anywhere.** Comma, colon, brackets, or two sentences. En
dashes in numeric ranges (`60–120 fps`) are fine.

**Short, plain sentences, second person.** Your take, your camera, your Mac.
This repo's code comments are long and discursive and that voice leaks into
prose constantly; a paragraph that reads like `recorder.rs` is wrong here.

**Directive.** Tell the reader what to do: "Record at 4K even if you publish
at 1080p." Not "you may wish to consider a higher capture resolution."

**Concrete nouns, checked numbers.** Cursor, waveform, playhead, 120 fps.
Never workflow, experience, solution, platform. Never "fast" where a number
exists.

**Contrast without the flourish.** "Not X, but Y", "X rather than Y" and "X
instead of Y" used as rhetorical shapes read as machine-written and were
banned by name on 2026-09-10. A factual contrast is fine ("QuickTime records
the microphone. It does not record system audio."); defining a thing by what
it is not is the pattern to cut.

**No buzzwords, no superlatives, no filler.** "Seamless", "powerful",
"it is worth noting", "in today's". A sentence that reassures rather than
informs goes.

**Names.** The automatic zooms are **zoom and pan**. The camera picture is the
camera, not the webcam overlay, except in a post whose search query says
"webcam overlay". Control names in bold, as they read in the app.

## How Prequel enters the post

A guide is honest about the task and then shows that Prequel does most of it.
The order matters: the reader trusts the recommendation because the three
paragraphs before it were true about macOS and about the other routes.

**Say what the other routes are, briefly and fairly.** "Type them by hand in
Final Cut", "upload it to Descript". Name what each costs the reader in work
or in privacy, then move on. This is where a guide differs from a roundup:
other tools are routes, not rivals, and get no screenshot, no price and no
verdict.

**Never name a Prequel shortcoming.** No "the catch", no feature conceded, no
hedging about maturity. If the task is one Prequel does not do, the post is
about a different task.

**Only the passes that exist.** The automatic first pass is exactly the five
things in `ALREADY_DONE` in `LandingBody.tsx`: zooms placed, camera framed,
background applied, audio balanced, cursor cleaned up. Cutting is manual, on
the timeline. Never "dead air", never "removes silences"; see
`[[no-dead-air-claim]]`.

**Check every spec against the source, not memory.** Resolution and frame
rate are `SPECS` in `LandingBody.tsx`; price and trial are `lib/pricing.ts`;
the product answers are `lib/faq.ts`. The figure that is wrong is always the
one written from recall.

**Requirements stay in.** Apple Silicon, macOS 14 or later, the Screen
Recording grant. Stated as a requirement, once, near the pricing link. A
reader who buys something that cannot run on their Mac is a refund and a
one-star review.

## Figures

**The editor is drawn, not screenshotted.** `CaptionShots.tsx` is the model:
React components built from the same labels, order and default values the
panel ships, exported as named figures and imported at the top of the MDX.
A PNG of the editor is stale the first time a label moves, and nobody
notices until a reader points at a control that is no longer there.

Each figure is `role="img"` with a full sentence as its label and its
internals hidden. Read one node at a time, a slider track is noise; the
sentence on the wrapper is the whole of what is worth reaching.

The components are **redrawn, not imported** from `apps/desktop`. The rule is
in `AGENTS.md` and the reason is that a marketing consumer is a second reason
for the editor's components to change.

**Other tools' landing pages** come from the shared pool in
`public/blog/tools/`, captured and cropped by the procedure in
`[[comparison-posts]]`. Check the pool before capturing; the same twelve sites
turn up in every post.

**Reddit threads** are the only outside evidence with a picture, cropped by
the procedure in `[[comparison-posts]]` and indexed in `quotes.json`. Never a
synthesised card, and never an uncropped capture: the left rail shows the
user's own account.

Every image has alt text that says what is in it, in a sentence.

## Links

**Citation hosts only**: reddit.com, news.ycombinator.com, x.com, g2.com.
Not a vendor, not Apple, not a review aggregator. The macOS facts are stated,
not linked; the research brief holds the URL for whoever refreshes the post. `mdx-components.tsx` gives any `http(s)` link
`target="_blank"` and `rel="noreferrer noopener"`, so nothing needs setting.

**Five or more internal links to other posts**, as `[Title →](/blog/<slug>)`
on its own line where the reader would follow it, and inline on a phrase
where the sentence carries it. `/pricing` closes the Prequel section.
`/alternatives/<slug>` only where the page exists: `screen-studio`, `loom`,
`camtasia`, `screenflow`, `descript`, `tella`.

A `/blog/` link to a slug with no MDX file is a 404 that `typedRoutes` does
not catch, because markdown links are not `<Link>`. The check script below
resolves every one.

## Registering the post

Add an entry to `ENTRIES` in `posts.ts`. `tag` is `Guide`. `readingMinutes`
is by hand, at roughly 200 words a minute. The sitemap and the index pick it
up from `posts`, and `BlogPosting`, `FAQPage` and `BreadcrumbList` are
emitted off the same entry, so nothing else is added.

**`excerpt` is written as us.** It drives the SEO description, the OG card and
the standfirst from one field: "Here is what macOS gives you (nothing), the
three ways people actually add subtitles, and how to correct the words as
text." It states what the post contains, not why to read it.

**`pillar` is the slug of the guide this one sits under.** One field, both
directions: the template renders a "Part of" link at the top of the post and
lists the post on the pillar page, so the two cannot disagree. A post without
a pillar is a pillar, and that is a decision to make with the user, not
alone.

**`faq` is required**, which is deliberate: "remember to add one" is a
convention that is forgotten on the next post. Four to six for a guide. Each
question is one somebody types into a search box ("can macOS record the screen
and webcam at the same time"), and each answer stands alone, repeating the
subject and naming Prequel where it belongs, because they are extracted and
shown without the post around them. Take the candidates from the brief.

## Before it ships

```bash
.claude/skills/blog-review/scripts/check-post.sh <slug>
pnpm --filter @prequel/web typecheck
npx prettier --write apps/web/src/content/blog/<slug>.mdx
```

The script is the mechanical half of `[[blog-review]]`: em dashes, outside
hosts, the claims that may not be made, dead internal links, a duplicate
definitional question, the `posts.ts` entry. Run the skill itself for the
read.

Then load the page (the dev server is usually already running; do not build
to see a post) and read it out loud. A sentence that runs out of breath is
two sentences. Scroll past every figure and let it decode before judging it;
images are lazy-loaded and a screenshot taken mid-scroll shows an empty box
that is not a bug.
