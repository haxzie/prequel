# prequel

A macOS screen recorder. Electron shell over a native Rust capture core built on
ScreenCaptureKit and VideoToolbox.

```
apps/
  web/        Next.js 16 (App Router, React 19, Turbopack)
  desktop/    Electron 43 + Vite + React 19 — tray, picker, controls, library
packages/
  recorder/   @prequel/recorder — napi-rs addon exposing the Rust core to Node
  env/        Zod-validated environment variables  ← edit src/env.ts
  typescript-config/  Shared tsconfig presets
crates/
  prequel-capture/    ScreenCaptureKit: permissions, target enumeration, SCStream
```

Target: **Apple Silicon, macOS 14+**. The capture core is Rust because Electron's
`desktopCapturer` + `MediaRecorder` cannot hit the quality bar — software VP8/VP9
encoding, dropped frames above ~1080p60, no per-window capture exclusion, and
system-audio loopback that is broken in Electron on macOS 15+.

## Getting started

```bash
pnpm install     # also creates .env from .env.example
pnpm build       # builds the Rust addon, then the apps
pnpm dev:desktop # Electron window
pnpm dev:web     # http://localhost:3000
```

Requires the Rust toolchain (`rustup`, stable) and Xcode Command Line Tools.
`ffmpeg` is needed only for the recorded-output tests.

| Command                                  | What it does                                  |
| ---------------------------------------- | --------------------------------------------- |
| `pnpm build`                             | Rust addon + every app                        |
| `pnpm test`                              | `cargo test` then vitest across the workspace |
| `pnpm test:rust`                         | Rust unit tests only                          |
| `pnpm typecheck`                         | `tsc --noEmit` across the workspace           |
| `pnpm format`                            | Prettier over the repo                        |
| `pnpm clean`                             | Removes build output                          |
| `pnpm --filter @prequel/desktop package` | Builds installers into `apps/desktop/release` |

Turbo caches `build`, `test` and `typecheck`; `dev` is uncached and persistent.

## Screen Recording permission

Capture needs the macOS Screen Recording grant. It is a **TCC permission, not an
entitlement** — no codesign flag turns it on, and macOS prompts at most once per
app.

In development the grant is attached to the Electron binary, so grant it once:

> System Settings ▸ Privacy & Security ▸ Screen Recording → enable **Electron**

then fully quit and relaunch the app. Without it, `listTargets()` fails with
`SCREEN_ACCESS_DENIED` (ScreenCaptureKit `SCStreamErrorDomain -3801`) and the app
shows a prompt to fix it.

Re-signing the app with a different identity silently revokes the grant, which is
a classic "it worked yesterday" bug.

## Environment variables

There is one `.env` at the repo root. Root scripts load it with `dotenv-cli` and
Turbo passes it down to both apps, so you never keep per-app copies in sync.

Everything is declared in **`packages/env/src/env.ts`** — one file, two schemas:

```ts
export const server = {
  DATABASE_URL: z.url().optional(),
  API_SECRET: z.string().min(1).optional(),
};

export const client = {
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default("Prequel"),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
};
```

### Adding a variable

1. Add it to `server` (secret) or `client` (safe to expose) in `env.ts`.
2. Add the matching `runtimeEnv` line in the same file — bundlers only inline
   env accesses written out literally, so `FOO: process.env.FOO` is required.
3. Document it in `.env.example`.

### Reading it

```ts
import { env } from "@prequel/env";

env.DATABASE_URL; // string | undefined, fully typed
```

Works in Next server components, Next client components, the Electron main
process, and plain Node scripts. The Electron **renderer** is a browser context
with no `process`, so it builds its own from the shared `client` schema in
`apps/desktop/src/renderer/src/env.ts`.

### What it guarantees

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

Set `SKIP_ENV_VALIDATION=1` to bypass validation for lint/CI/Docker builds.

## Notes

- The `@prequel/env` package ships raw TypeScript rather than a compiled `dist`,
  so edits apply instantly with no build step. `apps/web` lists it in
  `transpilePackages`. Do not import it from `next.config.ts` — that file is
  loaded by Node before transpilation applies.
- No linter is wired up (`next lint` was removed in Next 16). Add ESLint or
  Biome as a `lint` script per package and `turbo run lint` will pick it up.
