---
name: alternatives-posts
description: Write a "best <competitor> alternatives" post for the Prequel blog: "Loom alternatives", "best Screen Studio alternatives for Mac", "what to use instead of Camtasia". Use this whenever someone asks for a post built around leaving one named tool, or asks to refresh, extend or re-source an existing one. Covers the full section-by-section shape, the proof that goes in the "why people leave" section (Reddit, G2, Hacker News, X, rendered as cards that link back), the methodology block, the per-tool pros, cons, honest take and pricing, how Prequel closes, and the FAQ sourced from real threads.
---

# Alternatives posts

A post for somebody who has already decided to leave a tool and is choosing
where to go. That is a narrower reader than the roundup's ("best screen
recorders for Mac", `[[comparison-posts]]`), and a more decided one: they
know the competitor, they have a grievance, and they want proof that other
people share it before they trust a list. So this genre is built on evidence
in a way the roundup is not. Every reason to leave is somebody else saying
it, with a link.

`/alternatives/<slug>` pages are the head-to-head comparisons governed by
`competitors.ts`. This is the wide post that links to one of them.

## Where things go

| Path                                                              | What it is                                                       |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| `apps/web/src/content/blog/<competitor>-alternatives.mdx`         | The prose. No frontmatter, no `#`; start at `##`.                |
| `apps/web/src/content/posts.ts`                                   | Title, excerpt, date, tag `Comparison`, reading time, FAQ.       |
| `apps/web/public/blog/tools/<tool>.webp`                          | Landing page shots, shared across posts. Check before capturing. |
| `apps/web/public/blog/quotes/<slug>.webp`                         | Quote cards, indexed in `quotes.json`.                           |
| `.claude/skills/comparison-posts/assets/quotes.json`              | Every citation captured so far: slug, where, title, URL.         |
| `.claude/skills/alternatives-posts/scripts/render-quote-card.mjs` | Draws a card from a real post's data.                            |
| `.context/research/<slug>.md`                                     | The brief from `[[blog-research]]`. Run it first.                |

## Before writing

Run `[[blog-research]]` for the competitor. It comes back with every price
dated, the complaint threads found, the six-tool facts from `competitors.ts`,
and FAQ candidates from real threads. A post in this genre names ten prices
and quotes five strangers; none of that is written from memory.

Then read `loom-alternatives-mac.mdx`, which is the nearest existing post, and
`[[comparison-posts]]` for the screenshot and cropping procedure, which is
shared.

## The shape

```
## TL;DR
<table: rank, tool, price, why you would switch>
Prices checked on <date>.

<intro: the competitor by the numbers, then the one-line answer>

## What is <competitor>?
<two paragraphs; the first stands alone>

## Why do people look for a <competitor> alternative?
### <reason 1>
<card>  [Read it on r/<sub>](url)
### <reason 2>
<card>  [Read the review on G2](url)
### <reason 3>
...

## The best <competitor> alternatives
### How we picked
<the methodology, four or five bullets>

### 1. Prequel
<screenshot>
<what it is, sold>
**Pros** / **Requires** / **Our take** / **Price**

### 2. <tool>
<screenshot>
<what it is, fairly>
**Pros** / **Cons** / **Our take** / **Price**
[Prequel vs <tool> →](/alternatives/<slug>)     <- only if that page exists

...

## Which one should you switch to?
<use-case blocks, then Prequel in detail>
[See what Prequel costs →](/pricing)
```

The FAQ is not in the MDX. It lives on the `posts.ts` entry and the template
renders it under the body.

### TL;DR

Lead with the table. Somebody who searched "<competitor> alternatives" wants
the list before the argument. Columns: rank, tool, price, why you would
switch. Prequel is row one with its price in green:

```mdx
| 1 | **Prequel** | <span className="font-medium text-positive">$29 once, or $9/mo</span> | The video arrives edited, and the file is yours |
```

"Why you would switch" is a specific claim, not a descriptor. "Open source,
self-hostable storage" is one. "Easy to use" is not. Put the check date under
the table.

### Intro

Three short paragraphs. The first is the competitor by the numbers, and it is
what makes the post read as researched rather than written: founding year,
what it was built for, and whatever scale figure the brief could source.
Users or downloads if the vendor has published one, G2 rating and review
count, Product Hunt votes, GitHub stars for an open source tool, a funding
round or an acquisition if there has been one.

Every number here carries a link or a check date. G2, GitHub and Product Hunt
are linkable (see Links). A figure that only exists on the vendor's own site
is stated with "as of <month year>" and no link, because a competitor is
never linked; the brief holds the URL for whoever refreshes the post.

The second paragraph is fair to the competitor: what it is genuinely good at,
in one or two sentences. The reader has used it, and a post that opens by
sneering at a tool they chose loses them. The third is the one-line answer
and what the post covers.

### What is <competitor>?

Two paragraphs, the first standing alone: a search engine or an assistant
will lift it out with nothing around it. The question is unique across the
blog, so `grep -h "^## What is" apps/web/src/content/blog/*.mdx` before
writing it. It is not "What is a screen recorder?"; the pillar owns that.

### Why do people look for an alternative?

The section the genre exists for. Three to five reasons, each a `###` with
a plain heading in the reader's words ("The free plan caps videos at five
minutes", "It became a subscription"), one or two sentences of prose, and
**proof**.

Proof is a real post by a real person, shown as a card and linked under it:

```mdx
![A thread on r/macapps about Screen Studio's move to a subscription](/blog/quotes/screen-studio-pricing.webp)

[Read it on r/macapps](https://www.reddit.com/r/macapps/comments/1ga3o3k/...)
```

Where the proof comes from, in the order to try:

- **Reddit.** Search with `firecrawl_search` and `includeDomains:
["reddit.com"]`; the results carry title, snippet and URL. Prefer a
  grievance from a user to a launch post from a founder, and prefer a thread
  with comments to one without. Check `quotes.json` first; a thread already
  captured has a card already.
- **G2.** Reviews with a star rating and a date. The two- and three-star ones
  are where the specific complaints live; a one-star review is usually about
  billing support and reads as an outlier.
- **Hacker News.** Threads on a launch or a pricing change. Practitioner
  complaints, usually the sharpest.
- **X.** A post from a named account with a handle. Weakest as proof unless
  the account is recognisable, so use it last and never alone.

**Every reason has at least one card.** A reason with no proof is an opinion
and gets cut, however true it is. Spread the sources: three Reddit cards in a
row read as one subreddit's mood.

### Cards

Reddit, G2 and HN all refuse a headless browser in different ways, and a
capture through your own browser shows your account in the rail. So cards are
**drawn from the real post's data** rather than screenshotted. Open the thread
in the claude-in-chrome extension, read the title, subreddit or handle,
author, age, score, comment count and the first paragraph, then render:

```bash
node .claude/skills/alternatives-posts/scripts/render-quote-card.mjs \
  apps/web/public/blog/quotes/<slug>.webp \
  '{"kind":"reddit","where":"r/macapps","author":"u/name","age":"1y ago",
    "title":"<exact title>","body":"<first paragraph, verbatim, short>",
    "score":"212","comments":"87","url":"https://www.reddit.com/r/..."}'
```

`kind` is `reddit`, `hn`, `x` or `g2`. Then add the entry to `quotes.json`
so the next post finds it.

Three rules, all of them about what makes the card evidence rather than
decoration:

- **Every field is copied from the open post.** Title verbatim, numbers as
  shown, nothing rounded up. The card is only proof because a reader can open
  the link and see the same words.
- **The link is always under the card**, on its own line, naming where it
  goes: "Read it on r/macapps", "Read the review on G2", "Read the thread on
  Hacker News". The image is not the citation; the link is.
- **Never a card for a post that does not exist.** A card holding content
  that did not come from a verifiable URL is a fabricated review attached to
  a named company, and it discredits every checked price on every page of
  the blog. Nothing in this genre is worth that.

### How we picked

Four or five bullets under the list heading, before the first tool. This is
what separates a list somebody trusts from one they scroll past, and it also
has to be true of the list that follows:

- What was tested and how: installed on a Mac, recorded the same take,
  exported, compared the file.
- What was checked: prices from the vendor's own page on the date under the
  table; feature claims against the current build.
- What was excluded and why: Windows-only tools, tools with no camera track,
  tools discontinued in the last year.
- What counted: the reasons people leave, from the section above. A list
  built to answer the complaint it just documented.

### Per tool

Numbered `###`, Prequel first, then the rest in the order the reader would
try them. Each:

**Screenshot** of the landing page from the pool, first thing under the
heading. Prequel's is `prequel.webp`.

**What it is**, two or three sentences, fair. What it is actually good at,
who built it, and the one sentence that says how it differs from the
competitor being left.

**Pros.** Three or four bullets, specific. "Exports 4K at 60 fps on the free
plan" is a pro. "Powerful editor" is not.

**Cons.** Two or three bullets, factual and checkable. A price is a fact;
"overpriced" is an opinion. A cap is a fact; "limited" is not. Where a con is
a complaint from the section above, say so and it carries its own weight.

**Our take.** Two or three sentences, first person plural, directive: who
this tool is for and who should keep scrolling. "If you send one bug report a
week to one colleague, use this and stop reading." Then the sentence that
does the work: one factual point where Prequel comes out ahead, woven in,
true and checkable:

- 4K at up to 120 fps on every plan. Most of the category stops at 60.
- No watermark, on any plan or during the trial.
- No cap on the length of a take.
- Renders locally. No upload, no queue, nothing leaves the Mac unasked.
- $29 once, against subscriptions and against dearer one-off licences.
- A camera re-framed after the take, because the sources are recorded separately.
- The code is on GitHub (github.com/haxzie/prequel), under FSL-1.1-ALv2, which
  becomes Apache 2.0 two years after each release. Say "the code is on GitHub"
  and name the licence; do not write "open source" bare, which a GPL or MIT
  user will dispute, and never claim an OSI licence.

Pick the one that actually contrasts with this tool. Against a free tool the
price is not the win; use the fact that the video arrives edited.

**Price.** Every tier the reader would consider, with its billing period.
"$29/mo, or $9/mo billed yearly": both, always, because quoting only the
monthly figure reads as three times the real annual cost. For the six in
`competitors.ts`, the figures come from there. For anyone else, the vendor's
page, read on the date under the table.

Close the section with `[Prequel vs <tool> →](/alternatives/<slug>)` if that
page exists: `screen-studio`, `loom`, `camtasia`, `screenflow`, `descript`,
`tella`.

**Prequel's own entry is different in one way.** No **Cons**. In its place,
**Requires**: Apple Silicon, macOS 14 or later, the Screen Recording
permission, stated as requirements. That is not self-criticism, it is whether
the thing runs on the reader's machine, and leaving it out produces a refund
and a one-star review. Its **Our take** says who it is for and does not
hedge.

### Which one should you switch to?

Use-case blocks first, directive: "If you record for a client every week",
"If you never want to pay again", "If the recording has to stay on your
machine". Each names the tool and says why in one sentence.

Then Prequel in detail, four or five short paragraphs, because this is where
the reader who has read the whole thing decides. What happens when you stop
recording (the five things in `ALREADY_DONE`: zooms placed, camera framed,
background applied, audio balanced, cursor cleaned up). What the editor is
for (the timeline is where you cut; nothing is cut for you). The export (4K,
up to 120 fps, rendered on the Mac, no upload). The price and the trial. The
requirements, once more. Close with `[See what Prequel costs →](/pricing)`.

Nothing in it is a shortcoming, a "catch", or a concession to a rival. If a
tool above genuinely beats Prequel on something, it is not in the post.
Never "dead air", never cuts silences; see `[[no-dead-air-claim]]`.

## FAQ

Six to eight, on the `posts.ts` entry, **sourced from the threads the
research found**. The questions people ask in r/macapps and on G2 before they
switch are the ones a search box sees: "does <competitor> have a free plan",
"can I export from <competitor> without a watermark", "what is the cheapest
<competitor> alternative", "is <competitor> worth it for <use>". Three that
this genre always has:

- One on price: what the competitor costs against the alternatives, with
  numbers.
- One on migration: what happens to the videos you already have there.
- One on whether the competitor is still the right choice for some reader.
  Answered fairly, naming the use, because a post that cannot say who should
  stay is not one anybody trusts about who should leave.

Each answer stands alone: repeats the subject, names the price again, and
works Prequel in where it belongs, because they are extracted and shown
without the post around them.

## Links

The citation hosts are the only outside links: `reddit.com`,
`news.ycombinator.com`, `x.com`, `g2.com`, plus `github.com` and
`producthunt.com` for a scale figure in the intro. **Never a competitor's
site**, not in prose, not on the name, not on the screenshot, not for a
price. Five or more links to other posts on the blog, `/alternatives/<slug>`
where it exists, `/pricing` to close.

## Voice

The rules in `[[comparison-posts]]` apply unchanged: no em dashes anywhere,
short plain sentences in the second person, directive, first person plural
for the excerpt and the takes, British spelling, no "not X but Y" as a
flourish, no buzzwords. Read `[[plain-marketing-copy]]` in memory if loaded.

## Registering the post

An entry in `ENTRIES` in `posts.ts`: tag `Comparison`, `readingMinutes` at
about 200 words a minute (this genre runs 1,800 to 2,500 words), `pillar:
"screen-recording-on-mac"` unless the user says otherwise, the excerpt as us
("We tried the six tools people move to from Loom, and here is where each one
fits"), and the FAQ above.

## Before it ships

```bash
.claude/skills/blog-review/scripts/check-post.sh <competitor>-alternatives
pnpm --filter @prequel/web typecheck
npx prettier --write apps/web/src/content/blog/<competitor>-alternatives.mdx
```

Then `[[blog-review]]` for the read. Two things it looks for that are
particular to this genre: that every reason in "why people leave" has a card
with a link under it, and that every card's title matches the post at that
link word for word.
