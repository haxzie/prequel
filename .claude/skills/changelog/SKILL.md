---
name: changelog
description: Write or edit a release entry in apps/web/src/content/changelog. Use whenever work is about to be pushed to main or put in a PR against main, when asked to add something to the changelog, update the draft, write release notes, or when told the changelog reads badly. Covers the voice, how short an entry has to be, what never goes in, and the rule that the changelog is written before the push and not after.
---

# Changelog

One line per thing a person using Prequel can now do, or no longer has to put
up with. Published at `/docs/changelog`, and the newest release's `highlight`
is the badge on the home page.

Not the marketing site's prose, which is `[[site-copy]]`. Not a commit log —
`apps/web/src/content/changelog.ts` says it plainly at the top of the file:

> A commit log is a record of work and a changelog is a record of what somebody
> using the app can now do, and most releases contain a good deal of the first
> and very little of the second. Anything that changed only for us stays out.

## The rule

**The changelog entry is written before the work reaches `main`** — in the same
branch, in the same PR, before the push. Not afterwards.

Written after the fact it gets written from `git log`, by someone reconstructing
what happened from commit subjects, which is exactly how a changelog turns into
a dev log. Written alongside the work, the question is still "what will somebody
notice?" rather than "what did I change?".

So: before `git push` to `main`, and before opening a PR that targets `main`,
check whether the branch changes anything a user can see. If it does and the
changelog does not mention it, stop and write the line.

Nothing to add is a normal answer. Refactors, tests, build fixes, internal
renames and fixes to features that never shipped all belong in no release.

## The trap

This repo's comments are long, discursive and full of em dashes, and `AGENTS.md`
rewards that on purpose. That voice is wrong here and it leaks constantly,
because you arrive at the `.mdx` straight from writing the code.

A changelog entry is read by somebody who has just updated and wants to know
whether anything they care about changed. They are scanning. Every clause that
explains _why_ the bug happened is a clause between them and the next entry.

## The shape

- **One sentence.** A second only for a genuine consequence they must act on —
  "recordings already in this state cannot be recovered". Never for the cause.
- **About twenty words.** If it will not fit, it is two entries or one smaller
  claim.
- **Say what they can do, in their words.** "Titles", not "text slices". The
  names on the buttons, not the names in the code.
- **No mechanism.** No file, type, API or framework. Not "ScreenCaptureKit
  returns -3808", not "the plan is resolved per clip". They cannot see any of it.
- **No "it used to".** Describing the old broken behaviour doubles the length and
  teaches a bug to somebody who never hit it. Say what it does now. The
  exception is when they may have _already been bitten_ and need to know.
- **Five to eight entries a release.** More than that and nothing stands out.
  Group the small related ones into one line.

`highlight` is the release in one fragment, no full stop — it sits in a pill.
"Text over the recording". "Filters, over the whole picture".

## Before and after

These are real entries from this repo, cut down. The left-hand column is what
the comment voice produces.

> A text is its own length. It used to take the length of the clip beneath it,
> so splitting a recording under a title, or trimming the footage there, changed
> how long the title was on screen. What you set is what it stays.

**→** A title stays the length you set it, whatever you do to the footage under it.

> Texts can be carried past one another along a row. A text that was third
> stayed third: dragging it towards the front stopped dead against its neighbour
> and sprang back. It goes wherever there is room on the row now, and it changes
> rows as you cross them rather than when you let go.

**→** Drag titles anywhere on their row, past each other, or onto another row.

> A take could come out unplayable if what you were recording went away — the
> window you were capturing was closed, or a display was unplugged. Stopping the
> take failed halfway and left the video and audio files unfinished, so the
> recording sat in the library, opened, and never played. Stopping now finishes
> the files whatever the capture did.

**→** Closing the window you were recording, or unplugging a display, no longer
breaks the take. Recordings already damaged by this cannot be recovered.

Note what survives: the thing they did, and the thing that now happens. The
sample rate, the missing moov atom and the error number are all gone, and
nothing a user needs went with them.

## Where it lives

One file per release, `apps/web/src/content/changelog/<version>.mdx`, an
ordinary Markdown list:

```mdx
export const date = "2026-09-25";
export const highlight = "Filters, over the whole picture";
export const draft = true;

- Put a filter over the whole picture: CRT, VHS, film, fish eye and seven more.
```

- `date` — ISO. The day it ships, not the day the first line was written.
- `highlight` — the fragment above. Every release has one.
- `draft` — `true` while the version is unreleased; `published()` keeps drafts
  off production and the page shows a "draft" pill in development. **Delete the
  line when the version is tagged.**
- Add the version to the top of `RELEASES` in
  `apps/web/src/content/changelog.ts`, which is what orders the page — a
  directory sorted as text puts `0.0.9` after `0.0.13`.

Adding to a release that is still a draft is normal: keep editing that file
until it ships rather than starting the next one.

## Check

```bash
npx prettier --check "apps/web/src/content/changelog/*.mdx"
pnpm --filter @prequel/web dev   # /docs/changelog
```

Then read the release as a stranger who has just updated. If any line makes you
ask "why are they telling me this?", cut it.
