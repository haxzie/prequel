# Changesets

One file in here per user-visible change, written on the branch that makes the
change. `pnpm changeset` writes one, or write it by hand — the shape is tiny:

```md
---
"@prequel/desktop": minor
---

Record, render and edit from a terminal with the new `prequel` command.
```

That sentence is the changelog entry. It is published verbatim to
`apps/web/src/content/changelog/<version>.mdx` when the release is versioned, so
write it in the changelog's voice — one sentence, about twenty words, what
somebody can now do, in the words on the buttons. The `changeset` skill in
`.claude/skills` has the rules and the examples; the `changelog` skill beside it
is where that voice is defined.

## Why only `@prequel/desktop`

It is the only thing with a version. The `prequel` command is a file inside the
app bundle and ships with it — `prequel version` reads the app's own
`package.json` — so one version covers both, and a second one would be a number
that could disagree with the thing it names. Every other package in the
workspace is listed in `ignore` for the same reason: the site and the Worker
deploy continuously and have no version anybody could hold.

A change to the command line is therefore a `@prequel/desktop` changeset. If it
changes the _wire_ — the request or response shapes in `shared/cli.ts` — bump
`CLI_PROTOCOL` there in the same commit. That number is not a release version;
it is what lets an old `prequel` and a new app recognise each other.

## What happens to this file

Nothing. `changeset version` deletes the `.md` files it consumed and leaves this
and `config.json` alone.

## The two changelogs

`apps/desktop/CHANGELOG.md` is changesets' own, and it exists because
`changesets/action` reads it to write the body of the release pull request —
with no file there the action fails with an `ENOENT` naming a path nobody asked
for. Nothing reads it afterwards.

The published one is `apps/web/src/content/changelog/<version>.mdx`, written by
`scripts/version-packages.mjs` from the same changesets. They cannot drift: both
are generated from these files, by the same command, in the same commit.

## Nothing to add is a normal answer

Refactors, tests, build fixes and fixes to features that never shipped belong in
no release. A branch with no changeset is a branch that changed nothing a user
can see — say so in the pull request rather than writing an entry for it.
