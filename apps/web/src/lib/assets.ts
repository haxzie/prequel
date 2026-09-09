/**
 * Where the site's heavy media lives.
 *
 * The videos and the two large stills are in R2 rather than in `public/`, and
 * served off `assets.prequel.sh` — the same bucket and the same hostname the
 * release mirror puts each disk image on. They are a couple of megabytes that
 * change whenever the footage is re-cut, and a binary committed to git is there
 * for ever: the repository carries every version ever encoded, and the deploy
 * carries the current one into every build.
 *
 * Small media stays in `public/`. The blog screenshots belong beside the posts
 * that reference them and should be versioned with the MDX that does; the
 * competitor logos, the icons and the OG card are kilobytes.
 *
 * Written out rather than read from the environment. There is one bucket and one
 * hostname, and `download/route.ts` already hardcodes the same origin for the
 * disk image — a variable would be a second place to look for an answer that has
 * never had more than one.
 *
 * `/v1/` is part of the key, not decoration. The objects are served
 * `immutable` for a year, so a re-encode cannot reuse a path — Cloudflare would
 * go on serving the old bytes to anyone who had already fetched them. Bump the
 * segment, upload under the new one, and every reference moves at once. It is
 * also the escape hatch from a cached 404: an object uploaded to a path that has
 * already been requested and missed stays missing at the edge until that
 * negative cache expires.
 *
 * Uploaded with the credentials in `apps/api/.dev.vars`, which is where
 * `upload-backgrounds.ts` and `release-mirror.yml` both take theirs:
 *
 *   npx wrangler r2 object put prequel/site/v1/<file> --file=<file> \
 *     --content-type=<type> --cache-control="public, max-age=31536000, immutable" --remote
 */
export const ASSETS = "https://assets.prequel.sh/site/v1";
