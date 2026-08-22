/**
 * Migration generation for D1.
 *
 * `driver: "d1-http"` is what lets `drizzle-kit` talk to a real D1 database over
 * Cloudflare's REST API for introspection and `push`. Day-to-day the only
 * command needed is `generate`, which reads the schema and writes SQL — applying
 * it is wrangler's job:
 *
 *     pnpm --filter @prequel/db generate
 *     pnpm --filter @prequel/api migrate         # local
 *     pnpm --filter @prequel/api migrate:remote  # deployed
 *
 * The three credentials below are only read by the `d1-http` driver, so
 * `generate` works without them.
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "d1-http",
  schema: "./src/schema.ts",
  // Written into the Worker's directory, because `wrangler d1 migrations apply`
  // resolves this path relative to the wrangler config it is run with. Keeping
  // the SQL beside the schema instead would mean passing the path on every
  // invocation, which is exactly the sort of thing that gets forgotten once.
  out: "../../apps/api/migrations",
  dbCredentials: {
    accountId: process.env["CLOUDFLARE_ACCOUNT_ID"] ?? "",
    databaseId: process.env["CLOUDFLARE_D1_DATABASE_ID"] ?? "",
    token: process.env["CLOUDFLARE_API_TOKEN"] ?? "",
  },
});
