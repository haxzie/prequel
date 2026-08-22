# @prequel/env

Zod-validated environment variables, declared once and read everywhere.

There is one `.env` at the repo root. Root scripts load it with `dotenv-cli`
and Turbo passes it down to both apps, so there are no per-app copies to keep
in sync.

Everything is declared in **`src/env.ts`** — one file, two schemas:

```ts
export const server = {
  DATABASE_URL: z.url().optional(),
  API_SECRET: z.string().min(1).optional(),
};

export const client = {
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default("Prequel"),
  NEXT_PUBLIC_APP_URL: z.url().default("https://prequel.sh"),
};
```

## Adding a variable

1. Add it to `server` (secret) or `client` (safe to expose) in `env.ts`.
2. Add the matching `runtimeEnv` line in the same file. Bundlers only inline
   env accesses written out literally, so `FOO: process.env.FOO` is required —
   a computed lookup silently yields `undefined` in a bundle.
3. Document it in `.env.example`.

## Reading it

```ts
import { env } from "@prequel/env";

env.DATABASE_URL; // string | undefined, fully typed
```

Works in Next server components, Next client components, the Electron main
process and plain Node scripts. The Electron **renderer** is a browser context
with no `process`, so it builds its own from the shared `client` schema in
`apps/desktop/src/renderer/src/env.ts`.

## What it guarantees

- **Fails fast.** A missing or malformed value throws at startup with the
  offending variable named, not at the first request. `validateEnv()` is wired
  into `apps/web/src/instrumentation.ts` and the Electron main process.
- **Secrets stay server-side.** Reading a `server` variable from client code
  throws instead of silently shipping it. Server values are never bundled into
  client output.
- **Read-only.** Assigning to `env` throws.
- **Public vars need the prefix.** `client` keys must start with
  `NEXT_PUBLIC_`, which is what makes Next and Vite expose them. `envPrefix` in
  `electron.vite.config.ts` lets the desktop renderer use the same prefix.

Set `SKIP_ENV_VALIDATION=1` to bypass validation for lint, CI or Docker builds.

## Note

This package ships raw TypeScript rather than a compiled `dist`, so edits apply
instantly with no build step. `apps/web` lists it in `transpilePackages`.
