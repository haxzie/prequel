# @prequel/web

Next.js 16 (App Router, React 19, Turbopack) marketing scaffold.

```bash
pnpm dev:web    # http://localhost:3000
```

**Not part of the product surface.** Prequel is the desktop app; this exists so
there is somewhere for a landing page to go, and to prove `@prequel/env` works
identically in a Next server component, a Next client component and the
Electron main process.

`src/instrumentation.ts` calls `validateEnv()`, so a missing or malformed
environment variable fails at boot with the offending name rather than at the
first request.

`@prequel/env` ships raw TypeScript rather than a compiled `dist`, so it is
listed in `transpilePackages`. Do not import it from `next.config.ts` — that
file is loaded by Node before transpilation applies.

## AGENTS.md

`apps/web/AGENTS.md` is generated and re-added by `next dev`. Do not hand-edit
it; committing it alongside your work is the way to keep the tree clean.
