# @prequel/db

The database schema, and nothing else. SQLite dialect, for Cloudflare D1.

Two consumers and one definition: `apps/api` builds its Drizzle client from
this at runtime, and `drizzle-kit` reads the same file to generate migrations.

```bash
pnpm --filter @prequel/db generate   # after any change to src/
pnpm --filter @prequel/api migrate   # apply to the local D1
```

`generate` writes SQL into **`apps/api/migrations`**, not into this package.
That is not a mistake: `wrangler d1 migrations apply` resolves `migrations_dir`
relative to the wrangler config, so putting the SQL beside the schema would mean
passing a path on every invocation — the sort of thing that gets forgotten once
and then quietly diverges.

## Layout

```
src/auth-schema.ts   the tables Better Auth owns
src/app-schema.ts    the tables Prequel owns
src/schema.ts        both, for the client and for drizzle-kit
```

Split so a Better Auth upgrade can be diffed against one file, without a rename
in their schema hiding inside a change to ours.

## The Better Auth half

Transcribed from Better Auth's own schema rather than generated in place. A
generated file nobody may edit is worse than one that is checked and commented;
regenerate the reference with `better-auth generate` after a major upgrade and
diff it against `auth-schema.ts`.

Three things there fail silently if you get them wrong:

**Property names are the contract, not column names.** The Drizzle adapter looks
fields up by the key on the exported object — `emailVerified`, never
`email_verified`. A mismatch is not a type error. It surfaces as a runtime
"field not found" on whichever flow touches that column first, which for most of
these is somebody's first login.

**Table exports are singular.** `usePlural` defaults to false, so a plural export
makes the adapter look for a table that is not there.

**One timestamp mode everywhere.** `mode: "timestamp"` is seconds and
`timestamp_ms` is milliseconds, the two are indistinguishable in the column, and
mixing them produces dates fifty thousand years apart.

## `organization` is a team

Called that because it is the table the plugin looks for. It is only ever
"team" in the interface, and renaming it would mean re-mapping every one of the
plugin's queries for a word the user never sees in a URL.

## Two kinds of identifier

`id()` only has to be unique. `slug()` has to be **unguessable** — it is what
`/v/<slug>` resolves, there is no membership check on that route, and the whole
security model of an unlisted link is that guessing does not work. Sixteen
base58 characters is about 94 bits.

Both come from `crypto.getRandomValues`, in `apps/api/src/lib/ids.ts`.
`Math.random` is seeded per isolate and is not a secret.

## Storage is checked, not assumed

`organization.storageQuotaBytes` exists from the first migration rather than
arriving with billing. Upload checks against it, and a column added later would
need every existing team backfilled before that check could be trusted.

Only `ready` rows count towards it. An upload in flight has reserved nothing and
a deleted one has had its objects removed — charging for either would drift away
from what R2 bills for and never come back.
