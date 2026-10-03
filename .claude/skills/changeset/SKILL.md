---
name: changeset
description: Write the changeset that ships a change. Use whenever work is about to be pushed to main or put in a PR against main, when asked to add a changeset, bump a version, or cut a release, or when told a release is missing an entry. Covers which changes need one, the bump to pick, the voice the sentence is written in, and what happens to it afterwards.
---

# Changeset

**Before work reaches `main`, it carries a changeset** — or you say out loud
that it needs none. One file under `.changeset`, one sentence, written on the
branch that makes the change.

That sentence is published verbatim as the changelog entry. There is no second
place to write one: `apps/web/src/content/changelog/<version>.mdx` is generated
from these files when the release is versioned, and a release is nothing but the
changesets that went into it.

## The file

```md
---
"@prequel/desktop": minor
---

Record, render and edit from a terminal with the new `prequel` command.
```

`pnpm changeset` writes one interactively. Writing it by hand is faster and the
shape is the whole format. Name it after the change — `window-framing.md`, not
`chatty-pandas-tickle.md` — so a pending release reads as a list of what is in
it.

**Always `"@prequel/desktop"`.** It is the only package with a version. The
`prequel` command is a file inside the app bundle and ships with it, so one
version covers both; the site and the Worker deploy continuously and have no
version anybody could hold. Every other package is in `ignore` in
`.changeset/config.json`, and a changeset naming one fails the release.

## Which bump

- **patch** — a fix, or a small addition to something that already exists. This
  is almost everything.
- **minor** — a new surface: a command, a panel, a setting somebody will go
  looking for. The release's headline.
- **major** — reserved. Nothing here is 1.0 yet and the number is not free.

The bump is the only thing that moves the version, so it is the only thing that
decides whether this release is `0.0.36` or `0.1.0`. If you are unsure, patch:
a release can always be re-cut a version higher, and a minor nobody expected is
a number in every user's About box.

## The sentence

Exactly the changelog's rules, because it _is_ the changelog — read the
`changelog` skill for the voice, and follow it:

- **One sentence**, about twenty words, in the words on the buttons.
- **What somebody can now do**, not what changed in the code. No file names, no
  APIs, no "it used to".
- **No mechanism.** "A window recording is framed properly when the pointer was
  somewhere else" — not "the zoom's aim is clamped to the source rectangle".

If the change deserves two sentences, it is usually two changesets.

## The headline

One changeset in a release may name the release, in a comment the generator
reads and nothing else renders:

```md
Record, render and edit from a terminal with the new `prequel` command.

<!-- highlight: Record from the command line -->
```

A fragment, no full stop — it sits in a pill on the home page. Without one, the
most significant changeset's sentence is used, which is usually right; write the
comment when it is not.

## Nothing to add is a normal answer

Refactors, tests, build fixes, internal renames, and fixes to features that
never shipped belong in no release. Say so in the pull request rather than
inventing an entry: a changelog padded with work nobody can see is how it stops
being read.

## What happens next

Nothing you have to do. On `main`, `release.yml` collects every pending
changeset into a pull request called "Release x.y.z" which carries the version
bump, the generated `.mdx` and the deletion of the changesets it consumed.
Merging that is the decision to ship: the workflow tags the commit, and the tag
builds, notarises, publishes and mirrors the release that every installed copy
updates to.

So: **never edit `apps/desktop/package.json`'s version, never write a
`changelog/<version>.mdx` by hand, and never `git tag`.** All three are
generated, and a hand-made one will be overwritten or will fight the tag check
in `build.yml`.

## If the command line changed

A CLI change is a `@prequel/desktop` changeset like any other. One extra thing
to check: if the _wire_ changed — the request or response shapes in
`shared/cli.ts` — bump `CLI_PROTOCOL` in the same commit. That number is not a
release version; it is what lets an old `prequel` and a new app recognise each
other instead of hanging.
