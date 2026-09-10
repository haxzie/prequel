---
name: site-copy
description: Write or edit the words on the marketing site: a landing page headline or lede, a feature card, an FAQ answer, a section heading, a button label, a use-case page, pricing copy, a meta description or an OG title. Use this whenever someone asks to reword, tighten, rewrite or add copy anywhere under apps/web, or says the site reads badly. Covers the voice, the section shape, where every string lives, the claims that may not be made, and the checks before it ships.
---

# Site copy

The words a stranger reads on `apps/web`. Not blog posts that rank tools
against each other, which are `[[comparison-posts]]` and a different genre with
its own shape.

The full guide is `apps/web/COPY.md` and it is the canonical one. **Read it
before writing anything.** What follows is the operating procedure around it.

```bash
cat apps/web/COPY.md
```

## The trap this skill exists to stop

This repo's code comments are long, discursive, and full of em dashes, and
`AGENTS.md` rewards that on purpose. That voice is wrong for the site and it
leaks constantly, because the file you are editing is nine parts comment to one
part string. A `lede` written in the comment voice compiles, reads as competent
prose, and loses the visitor at the third clause.

Every string on the page is being read by somebody deciding in five seconds
whether to download a screen recorder.

## Before writing

1. Read `apps/web/COPY.md`.
2. Read the memory notes if they are loaded: `[[plain-marketing-copy]]`,
   `[[no-dead-air-claim]]`. They are the user's own corrections and outrank
   anything inferred from the existing page.
3. Read the section you are changing **and the two either side of it**. The
   landing page is one argument in eight sections and a heading that works alone
   often repeats the one above it.

## What is shared with what

`LandingBody` is rendered by `/` **and by all sixteen `/create/<slug>` pages**.
Editing a feature card or a section lede changes seventeen pages. That is the
intent, so do not fork a string to make one page read differently. Only the
hero title, the hero lede and the FAQ array differ per page, and the use-case
ones live in `src/content/use-cases.ts`.

`src/lib/faq.ts` is rendered twice from one array: as visible copy and as
`FAQPage` structured data. Never edit an answer in only one place, and never
introduce a second array.

Anything said on more than one page belongs in `src/lib/site.ts`. Anything said
once belongs with the section that says it, because a constant used once is just
indirection.

## The section shape

```
Eyebrow      One or two words, small caps. A category, not a claim.
Heading      One line. Two beats if it wants them, second beat shorter.
Lede         Two sentences. Three only if the third is short.
Cards        3 to 6. Bare noun-phrase title, then one or two sentences.
```

`SectionHeading` takes `eyebrow`, `title`, `lede`, `cta` and `align`. Every
`cta` links to `/download`; the words differ per section because the same six
words repeated down a page read as one banner. Write the ask the section has
earned, not the ask the hero made.

## The rules, in short

Full reasoning is in `COPY.md`. The ones that get broken:

- **No em dashes in any string.** Comma, colon, brackets, or two sentences.
  `aria-label` counts as a string.
- **British spelling.** Colour, normalised, behaviour, centred.
- **Prequel is the subject and does the verb.** No `we` in product copy, no
  passive where the actor is the product.
- **Second person for everything the reader owns.** Your take, your camera,
  your Mac.
- **No hedging.** Not "helps you", not "designed to", not "can".
- **Concrete nouns.** Cursor, padding, waveform, playhead. Never workflow,
  experience, solution, platform.
- **Value is work not done.** Already placed, nothing to import, opens by
  itself, no upload step.
- **Card titles are labels.** Sentence case, no full stop, no title case.

## Claims that may not be made

**Prequel does not cut, trim or remove silences.** The automatic first pass is
exactly the five things in `ALREADY_DONE` in `LandingBody.tsx`: zooms placed,
camera framed, background applied, audio balanced, cursor cleaned up. Cutting is
a manual pass on the timeline. Never write "dead air". This is the overclaim
that produces refunds, and it has been rejected by name before.

**No Prequel shortcoming goes on the page.** No "the catch", no conceding a
feature to a rival, no hedging about maturity.

**Compatibility is the exception and stays.** Apple Silicon, macOS 14 or later,
the Screen Recording permission. Stated as a requirement, not an apology.

Check any spec you are about to write rather than recalling it. The exact
figures are in `LandingBody.tsx` (`SPECS`) and `lib/faq.ts`.

## Before it ships

```bash
# Em dashes in strings. Comment lines are filtered out; anything left is a bug.
grep -rn "—" apps/web/src --include="*.tsx" --include="*.ts" --include="*.mdx" \
  | grep -vE ":[0-9]+: *(\*|//|/\*)"

# American spellings, which arrive with competitor research.
grep -rniE "normaliz|customiz|behavior|centered" apps/web/src/lib apps/web/src/content

# The claim we do not make.
grep -rni "dead air\|removes silence\|cuts silence" apps/web/src

pnpm --filter @prequel/web typecheck
```

The dev server is already running in most sessions; do not `pnpm build` to see a
copy change. Read the section out loud before calling it done: if you run out of
breath inside one sentence, it is two sentences.
