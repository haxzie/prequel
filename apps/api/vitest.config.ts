/**
 * Tests run inside `workerd`, not Node.
 *
 * That is what makes the D1 binding real, and the rate limiter is the reason it
 * has to be: its correctness is entirely about what SQLite does with two
 * concurrent statements, and a mock would only prove that the mock agrees with
 * itself.
 */
import { join } from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// The same SQL a deploy applies, read from the same directory `wrangler d1
// migrations apply` reads. Building the tables inline instead would test a
// schema nothing else ever uses.
const migrations = await readD1Migrations(join(import.meta.dirname, "migrations"));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          // Handed to `applyD1Migrations` in each suite's `beforeAll`.
          TEST_MIGRATIONS: migrations,
          // Present so `required()` does not throw. Nothing here signs anything
          // a real service will see.
          BETTER_AUTH_SECRET: "test-secret-not-a-real-one",
          R2_ACCOUNT_ID: "test",
          R2_ACCESS_KEY_ID: "test",
          R2_SECRET_ACCESS_KEY: "test",
          R2_BUCKET: "prequel",
        },
      },
    }),
  ],
});
