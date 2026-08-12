# @prequel/typescript-config

Shared `tsconfig` presets. Four files, no build step, no code.

| Preset               | Extends | For                                            |
| -------------------- | ------- | ---------------------------------------------- |
| `base.json`          | —       | The settings every project shares.             |
| `node.json`          | base    | Electron main and preload, plain Node scripts. |
| `react-library.json` | base    | The Electron renderer (`jsx: react-jsx`).      |
| `nextjs.json`        | base    | `apps/web` (`jsx: preserve`, the Next plugin). |

```jsonc
{ "extends": "@prequel/typescript-config/node.json" }
```

`apps/desktop` has two: `tsconfig.node.json` for main and preload,
`tsconfig.web.json` for the renderer. They are separate because the renderer is
a browser context with no `process` and no `node:` modules, and one merged
project would let a `node:fs` import into renderer code typecheck cleanly and
fail at runtime. `pnpm typecheck` runs both.

## The strictness that matters

Beyond `strict`, three flags are on because each catches a real class of bug:

- **`noUncheckedIndexedAccess`** — `array[i]` is `T | undefined`. This is why
  editor and layout code is full of `!` on indices already proven in range;
  the alternative is a `Slice` that is silently `undefined` at the end of a
  timeline scan.
- **`verbatimModuleSyntax`** — type-only imports must say `import type`. Import
  elision guessing wrong in an Electron main bundle produces a runtime
  `require` of something that only ever existed in the type system.
- **`rewriteRelativeImportExtensions`** with `allowImportingTsExtensions` —
  source imports carry the real extension and the compiler rewrites it, so
  `shared/` modules resolve identically from Vite, Vitest and `tsc`.
