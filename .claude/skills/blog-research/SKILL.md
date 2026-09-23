---
name: blog-research
description: Research a blog topic before anyone writes it. Use this whenever someone asks to research a subject for the Prequel blog, find what people are saying about a screen recording tool or problem, gather sources, find angles, check what a competitor charges today, or says "research and write" (run this first, then hand to guide-posts or comparison-posts). Covers the topic map, the Firecrawl search streams, where Prequel's own facts come from, what a usable citation is, and the shape of the brief the writing skills expect.
---

# Blog research

A brief is the difference between a post that states things and a post that
states things somebody can check. Every price, every quoted complaint and every
"most tools stop at 60 fps" in the blog is a claim about somebody else's
product, and a wrong one discredits every right one on the page. This skill
produces the checked list the writer works from, and nothing else: it does not
write the post.

The Prequel facts do **not** come from the web. They come from the repo, and
the first section below says where. Searching for "Prequel screen recorder"
finds a stale review or a different product with the same name.

## Where things go

| Path                                                 | What it is                                          |
| ---------------------------------------------------- | --------------------------------------------------- |
| `.context/research/<slug>.md`                        | The brief. Gitignored; scaffolding, not shipped.    |
| `apps/web/src/content/competitors.ts`                | Verified prices and features for the six with pages |
| `.claude/skills/comparison-posts/assets/quotes.json` | Every Reddit citation already captured              |
| `apps/web/src/content/posts.ts`                      | What the blog already covers                        |

The brief is not committed because the post carries its own evidence: prices
under the table with a check date, Reddit threads linked at the citation, and
anything that has to outlive the post moved into `competitors.ts` or
`quotes.json`. A committed brief goes stale the first time a price moves and
nobody updates it, and then it is a second source of truth that disagrees with
the page.

## Phase 1: the topic map

Before searching anything, write down what the post is and confirm it. Three
lines, in the reply:

- **The search it answers.** "screen recorder mac no watermark", "how to
  record system audio on mac". The post is built for this query, and it decides
  the slug, the definitional question and the FAQ.
- **The genre.** A roundup goes to `[[comparison-posts]]`; a "best
  <competitor> alternatives" post to `[[alternatives-posts]]`; a how-to,
  explainer or pillar to `[[guide-posts]]`. They want different
  research: a roundup needs prices for ten tools, a guide needs the macOS
  facts and the complaints.
- **The definitional question.** Every post opens a `## What is <thing>?`
  section and the question has to be unique across the blog. Grep the existing
  posts before proposing one:

  ```bash
  grep -h "^## What is\|^## How do you" apps/web/src/content/blog/*.mdx
  ```

Then the pillar it sits under, from `posts.ts`. Today there are three:
`screen-recording-on-mac`, `product-demo-videos`,
`screen-recording-for-youtube`. A post with no pillar is a pillar, and that is
a decision for the user, not the brief.

Present this and wait. Research on the wrong genre is an hour wasted.

## Phase 2: Prequel's own facts, from the repo

Read these before the web, so the brief contrasts competitors against what
Prequel actually ships rather than against what a search engine remembers:

| Fact                               | Source                                                          |
| ---------------------------------- | --------------------------------------------------------------- |
| Resolution, fps, codecs, output    | `SPECS` in `apps/web/src/components/landing/LandingBody.tsx`    |
| What the automatic first pass does | `ALREADY_DONE` in the same file. **Nothing else is automatic.** |
| Price, trial length                | `apps/web/src/lib/pricing.ts`, never a number from memory       |
| Product answers                    | `apps/web/src/lib/faq.ts`                                       |
| Feature rows and what we claim     | `FEATURE_ROWS` in `competitors.ts`                              |
| Requirements                       | Apple Silicon, macOS 14 or later, Screen Recording grant        |

Two rules from `[[no-dead-air-claim]]` and `[[site-copy]]` apply to the brief
as much as to the post. Prequel does not cut, trim or remove silences; cutting
is a manual pass on the timeline. And nothing goes in the brief as a Prequel
shortcoming: where a rival genuinely wins on something, the brief records it
so the writer knows not to raise the subject, marked **do not write**.

## Phase 3: the search streams

Firecrawl is the search tool. `firecrawl_search` returns titles, snippets and
URLs; `firecrawl_scrape` fetches a page as markdown; `firecrawl_map` lists a
site's pages when a vendor hides pricing three clicks down. Run the streams
that the genre needs, in parallel as subagents when there are more than three
tools to cover, inline otherwise.

**Stream 1, vendor facts.** For every tool the post names: the vendor's own
pricing page, scraped and read. Record every tier with its billing period,
because a monthly figure quoted without the annual one is the single most
damaging error a comparison can make, and it is checkable in one click. Record
the date. If the page is JS-rendered and `firecrawl_scrape` returns a shell,
say so and fetch it with headless Chrome (`[[headless-chrome-screenshots]]` in
memory). For the six in `competitors.ts`, compare against what is there and
flag any drift; the fix is an edit to that file, not a number in the brief.

The facts that matter for this blog, per tool, because they are the ones
Prequel wins on: highest resolution and frame rate on each plan, watermark on
the free tier or trial, cap on recording length, whether rendering is local or
uploaded, one-off licence or subscription, whether the camera is a separate
track that can be re-framed after the take.

**Stream 2, what people complain about.** Reddit through
`firecrawl_search` with `includeDomains: ["reddit.com"]`, plus Hacker News,
G2 (the two- and three-star reviews, where the specific complaints are) and
X. For an alternatives post, record enough of each to draw a card: title
verbatim, subreddit or handle, author, age, score, comment count, first
paragraph. `[[alternatives-posts]]` renders these.
`firecrawl_scrape` refuses reddit.com outright, so a thread's title, snippet
and URL are all that comes back, and that is enough for a citation. Queries
that work: `"<tool> pricing" reddit`, `"<tool> alternatives"`, `"<tool>
watermark"`, `"<tool> slow"`, `record system audio mac reddit`.

Prefer a genuine grievance to a launch post. Several Loom threads in search
are founders announcing their own alternative with a title that reads like a
complaint. Check `quotes.json` first: a thread already captured there has a
screenshot in `public/blog/quotes/` and needs no new work.

**Stream 3, what the blog already says.** Read `posts.ts` and the existing
MDX for anything on the topic. The brief lists the posts the new one should
link to (five or more, with the anchor text), the pillar, and any sentence in
an existing post that the new one would contradict. Two posts disagreeing
about Loom's free tier is worse than either being wrong alone.

**Stream 4, the macOS facts.** For a guide, what QuickTime and Cmd+Shift+5 can
and cannot do on the current macOS, from Apple's own support pages, with the
URL. These change by release and the blog states them as fact.

**Stream 5, numbers.** Any statistic the post might lean on (watch time with
sound off, demo video completion rates) traced to its primary source, dated,
and dropped if older than three years or if the trail ends at another blog. A
number the writer cannot link is a number the writer cannot use.

## What a source has to pass

- Live, and loading the content the brief says it does. `firecrawl_scrape` it;
  a 200 that serves "Access is temporarily restricted" is not a source. G2,
  Capterra and Trustpilot all answer this way to a headless fetch and are not
  usable here.
- Vendor page over review site. Detail page over summary. They disagree more
  often than you would expect.
- Dated. Prices, stats and macOS behaviour all carry the date checked.
- A Reddit or HN citation is the thread URL plus the subreddit or handle. A
  paraphrase with no link is not a citation, and a screenshot is not one
  either.
- **Nothing the post will link.** The blog links citation hosts only:
  reddit.com, news.ycombinator.com, x.com, g2.com, and github.com or
  producthunt.com for a scale figure. Vendor URLs go in the brief for
  verification and nowhere else.

## Phase 4: the brief

```
# Research brief: <working title>

Search query: <the query>
Genre: guide | roundup | comparison | pillar
Definitional question: ## What is <thing>?     (confirmed unique)
Pillar: <slug> | none (this is a pillar)

## Prequel facts used
<bullets, each naming the file it came from>

## Do not write
<any point where a rival beats Prequel, so the writer avoids the subject>

## Tools
### <tool>
Price: <every tier and billing period>. Checked <date>. <vendor URL>
Facts: <resolution, fps, watermark, length cap, local or upload, licence>
Prequel wins on: <the one contrast this section should carry>
Complaints: <thread title> (r/<sub>) <URL>    <- in quotes.json? yes/no

## macOS facts
<bullets, each with Apple's URL and the date>

## Numbers
<stat> <primary source URL> <published date>

## Existing posts to link
/blog/<slug>  "<anchor text>"  (why it fits)

## Contradictions
<anything an existing post says that this one would disagree with>

## FAQ candidates
<question as somebody types it into a search box> (from: thread URL or PAA)

## Angles
<three to five, from the gaps between what people ask and what exists>
```

Write it to `.context/research/<slug>.md` and end with the one question the
writer needs answered: which skill takes it next, `[[guide-posts]]` or
`[[comparison-posts]]`, and whether the angle list needs trimming first.
