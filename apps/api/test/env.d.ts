/**
 * Teaching `cloudflare:test` what this Worker's bindings are.
 *
 * The pool types its `env` as `Cloudflare.Env`, which is the interface
 * `wrangler types` would generate. Rather than generate and commit that file —
 * a second declaration of the bindings, to be kept in step with the first by
 * hand — the namespace is widened with the `Env` the app already defines.
 *
 * Without this every `env.DB` in a test is a type error while working perfectly
 * at runtime, which is the least useful way for a typecheck to fail.
 */
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

import type { Env as AppEnv } from "../src/env.ts";

declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {
      /** Read from `migrations/` by `vitest.config.ts` and applied per suite. */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
