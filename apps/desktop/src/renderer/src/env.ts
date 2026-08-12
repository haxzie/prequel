/**
 * Renderer-side env.
 *
 * The renderer is a browser context: it has no `process.env`, and it must never
 * see server secrets. So it reuses the shared `client` schema from
 * `packages/env/src/env.ts` and validates Vite's statically-inlined
 * `import.meta.env` against it.
 */
import { client, CLIENT_PREFIX, createEnv } from "@prequel/env";

export const env = createEnv({
  client,
  clientPrefix: CLIENT_PREFIX,
  runtimeEnv: import.meta.env,
  isServer: false,
});
