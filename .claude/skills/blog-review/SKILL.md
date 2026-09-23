---
name: blog-review
description: Review a blog post draft against the Prequel blog's rules before it ships, and report blockers, warnings and fixes without rewriting it. Use this whenever someone asks to check, review, validate or proofread a post, asks whether a draft is ready, asks if a post reads as AI-written, or when guide-posts, comparison-posts or alternatives-posts reach the "before it ships" step. Covers the check script, the read, the claims that may not be made, the shapes that read as machine-written, and the report format.
---

# Blog review

The half of shipping a post that the writer cannot do, because the writer has
read every sentence six times and no longer sees it. This skill diagnoses and
directs: it names the line, says what is wrong and what the fix is, and does
not rewrite. A review that rewrites is a second draft with nobody checking it.

Two halves. The script catches what a grep catches better than a person. The
read catches what only a person catches.

## The script

```bash
.claude/skills/blog-review/scripts/check-post.sh <slug>
```

Run from the repo root. It exits with the number of blockers. What it checks,
and why each one is there:

| Check                                             | Why                                                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Em dashes                                         | The first thing the user notices, every time. A blocker.                                     |
| American spellings                                | Arrive with competitor research and survive a read.                                          |
| "dead air", cuts silences                         | The first pass never trims. The one overclaim that produces refunds.                         |
| Shortcoming language                              | "the catch", "downside", "still early". None of it goes on the page.                         |
| Apple Silicon, macOS 14                           | The one requirement that stays in, so a buyer's Mac can run it.                              |
| Prices against `pricing.ts`                       | A price from memory is the number that is wrong.                                             |
| No `#` heading                                    | The `<h1>` is rendered from `posts.ts`.                                                      |
| Opens on the definitional question                | And that the question is unique across the blog.                                             |
| No body FAQ                                       | The template renders one from `posts.ts`; a second is a duplicate.                           |
| Title case headings                               | Two capitalised words after the first is what title case produces.                           |
| Outside hosts                                     | Citation hosts only (Reddit, HN, X, G2, GitHub, Product Hunt); a competitor is never linked. |
| Quote cards carry a link                          | A card with no link under it is a picture, not a citation.                                   |
| Internal links resolve                            | Markdown links are not `<Link>`, so `typedRoutes` cannot catch them.                         |
| `/alternatives/` pages exist                      | Six exist. A seventh is a 404.                                                               |
| Images exist, are WebP, have alt                  | Lazy-loaded, so a missing one is an empty box nobody sees locally.                           |
| `posts.ts` entry, FAQ count, pillar, reading time | Where the metadata lives, and what drifts.                                                   |

A warning is a judgement call the reviewer makes on the read. A blocker is
not.

Some of the existing posts warn. That is information about the posts, not
about the script: the rules were written after them, and a refresh is the
moment to bring one into line.

## The read

Read the post in the browser, not the MDX, at the width a reader gets. Then
go through these, in this order, because the first ones are the ones the
user rejects a draft over.

**1. Does it read as written by a person?** The shapes that give a draft
away, all of which have been rejected by name (`[[plain-marketing-copy]]`):

- "Not X, but Y", "X rather than Y", "X instead of Y" as a flourish. The
  script counts these; the read decides which are a factual contrast (fine)
  and which define a thing by what it is not (cut).
- Uniform sentence length. Three sentences in a row of the same shape is the
  most reliable tell there is. The fix is usually one short sentence.
- A closing sentence that summarises the paragraph it closes.
- Superlatives and reassurance. "Exports that hold up" says nothing; "it
  stays sharp at 4K" says something.
- Wind-ups before a fact: "Research confirms the gap is worse than most
  expect." Cut the announcement and let the number do the work.
- Adverbs hiding a mechanism: "handles this seamlessly", "works
  transparently". Say what happens.
- Trade jargon where a plain word exists: "in post" for "by hand".

Do not send it to a humaniser. The firecrawl-blogs repo this skill is adapted
from has one, and its remedy is colloquialisms, mid-sentence pivots and "in my
experience". That is a different tell in a different voice, and this blog's
voice is short, plain and directive. The fix for a machine-sounding paragraph
here is fewer words, not more personality.

**2. Is every claim about Prequel true?** Check against the source, not the
post before it:

- Spec figures against `SPECS` in `LandingBody.tsx`.
- What is automatic against `ALREADY_DONE` in the same file. Five things.
  Anything else described as happening on its own is an overclaim.
- Price and trial against `lib/pricing.ts`.
- Feature claims against `FEATURE_ROWS` in `competitors.ts`.
- **Never** cutting, trimming or silence removal. See `[[no-dead-air-claim]]`.

**3. Is every claim about somebody else's product checkable?** A price
carries a check date under the table. A Reddit, G2, HN or X citation links
the post and names the subreddit or handle under the card; a card alone is
not a citation, and a card whose words do not match the post at its link is
a fabricated review attached to a named company. Open two of the links and
compare the title word for word. A number with no primary source is cut. For the six in
`competitors.ts`, the post agrees with that file, or the file is wrong and
gets fixed first.

**4. Is Prequel positioned as the skill says?** Number one is the premise.
No shortcoming named, no feature conceded. In a roundup, one factual Prequel
win woven into every competitor section, true and checkable. In a guide, the
other routes described fairly and briefly, then Prequel. Requirements stated
once, near the pricing link, as a requirement.

**5. Does the shape match the genre?** `[[guide-posts]]` and
`[[comparison-posts]]` each have one. The definitional question opens a
guide and sits under the TL;DR on a roundup. The first paragraph under it
stands alone. Sections lead on the action. Headings say what the section
delivers, never "Overview", never two questions in a row.

**6. Does the FAQ answer searches, not the article?** Each question is one
somebody types into a search box. Each answer stands alone, repeats the
subject, names the price again if it names a price, and works Prequel in
where it belongs. An answer that depends on the paragraph above it is an
answer nobody sees.

**7. Does the excerpt state what the post contains?** Written as us, one
field driving the description, the OG card and the standfirst. Not a pitch,
not "Learn how to".

**8. Read one section aloud.** Any sentence that runs out of breath is two.

## What is not checked here

Rankings, traffic and Search Console are `[[seo]]`. Site copy outside the
blog is `[[site-copy]]`. A post's research is `[[blog-research]]`; if the
review finds a price it cannot verify, that is a research task, not a review
finding to guess at.

## The report

```
## Review: <title>

### Blockers
- <file>:<line> <what is wrong>. Fix: <the change>.

### Warnings
- <file>:<line> <what is wrong>. Fix: <the change>.

### Passes
- <one line each, brief>

### Fix in this order
1. ...
```

Line numbers from the MDX, so the writer can jump. A clean section is said
to be clean. Nothing is rewritten; the writer makes the change and runs the
script again.
