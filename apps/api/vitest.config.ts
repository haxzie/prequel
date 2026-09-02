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
          // Empty on purpose: `capture` returns without a request when there is
          // no token, so the suite exercises the "analytics is not configured"
          // path by default and a test that wants the other one stubs `fetch`
          // and overrides this itself.
          POSTHOG_PROJECT_TOKEN: "",
          POSTHOG_HOST: "https://us.i.posthog.com",
          // Billing, with nothing real behind it. Every suite that reaches a
          // billing route stubs `fetch`, so these only have to satisfy
          // `required()` — but they have to be here, or a suite that never
          // meant to touch Dodo throws from a missing secret instead.
          DODOPAYMENT_MODE: "test",
          DODOPAYMENT_BRAND_ID: "brand_test",
          DODOPAYMENT_PRO_PRODUCT_ID: "pdt_test_pro",
          DODOPAYMENT_LIFETIME_PRODUCT_ID: "pdt_test_life",
          DODOPAYMENT_API_KEY: "test_key",
          // Valid base64 after the prefix, because verification decodes it
          // before it can reject anything — a placeholder that is not base64
          // fails inside `atob` and every signature test errors instead of
          // failing.
          DODOPAYMENT_WEBHOOK_SECRET: "whsec_dGVzdC13ZWJob29rLXNlY3JldA==",
        },
      },
    }),
  ],
});
