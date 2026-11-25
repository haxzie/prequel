/**
 * How `@opennextjs/cloudflare` turns `next build` into a Worker.
 *
 * One setting, and it is not optional however static the site looks. A page
 * built by `generateStaticParams` is not written into the assets directory as
 * HTML — it goes into `.open-next/cache`, and the server function reads it back
 * through whatever incremental cache is configured here. With none configured
 * there is nothing to read from, and every prerendered page under a `[slug]`
 * answers 404 while the index above it renders fine, because that one is built
 * on demand. `/glossary/bitrate` and `/alternatives/loom` did exactly that on
 * the first deploy.
 *
 * `staticAssetsIncrementalCache` is the read-only one: it puts the cache
 * entries in the assets bundle and serves them through the `ASSETS` binding.
 * That is the right shape here precisely because nothing on this site
 * revalidates — no `revalidate`, no `revalidateTag`, no `"use cache"` — so
 * there is never a write, and a KV or R2 cache would be a binding that only
 * ever gets read from. The pages change when the site is rebuilt, which is the
 * same moment the assets change.
 */
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import incrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

export default defineCloudflareConfig({ incrementalCache });
