/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  This is the file you edit to add an environment variable.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  1. Add it to `server` (secret) or `client` (safe to expose).
 *  2. Add the matching line to `runtimeEnv` below — bundlers only inline env
 *     accesses they can see written out literally.
 *  3. Document it in the root `.env.example`.
 *
 *  Then read it anywhere with:  import { env } from "@prequel/env"
 */
import { z } from "zod";

import { createEnv } from "./create-env.ts";

/** Public variables must carry this prefix so Next.js/Vite will expose them. */
export const CLIENT_PREFIX = "NEXT_PUBLIC_";

/**
 * Never sent to the browser or the Electron renderer.
 *
 * Nearly empty, and deliberately so. Every API Prequel has — auth, the library,
 * uploads, transcription, the waitlist — is a Cloudflare Worker in `apps/api`,
 * which is handed its configuration through bindings rather than `process.env`
 * and declares it in `apps/api/src/env.ts`. Nothing the Next app runs holds a
 * database URL, an OpenAI key or a signing credential any more.
 *
 * Adding a server secret here is therefore worth a second thought: if the thing
 * reading it is an API, it belongs in the Worker.
 */
export const server = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
};

/** Safe to ship to the client. Treat everything here as public. */
export const client = {
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default("Prequel"),
  /**
   * The site's own origin, and the one source for every absolute URL.
   *
   * Canonicals, the sitemap, `robots.txt`, both share cards and every share
   * link the Worker hands back derive from this — so a wrong value here is not
   * one broken link, it is a sitemap full of them.
   *
   * Defaulted to production rather than to localhost. The default is what
   * applies when nothing sets it, which is a deploy or a CI build that forgot —
   * and `http://localhost:3000` in a live sitemap is a worse failure than a dev
   * machine generating production canonicals. `.env` pins it to localhost for
   * local work, which is where it belongs.
   */
  NEXT_PUBLIC_APP_URL: z.url().default("https://prequel.sh"),

  /**
   * Where the API lives.
   *
   * A different origin to the site above, and not a path on it — `apps/api` is a
   * Cloudflare Worker so that D1 and R2 can be reached through bindings instead
   * of over the wire, and so that an upload is not bounded by a serverless
   * function's request body limit.
   *
   * The two are the same *site*, which is what lets one session cookie cover
   * both. Pointing this at an origin outside `prequel.sh` would leave the
   * dashboard permanently signed out, since the cookie would no longer be sent.
   */
  NEXT_PUBLIC_API_URL: z.url().default("https://api.prequel.sh"),

  /**
   * PostHog's project token — the `phc_…` one.
   *
   * Public by construction: it is write-only, cannot read a single event back
   * out of the project, and is served to every browser that loads the site. It
   * is here rather than in `server` for that reason, not by oversight.
   *
   * Defaulted to empty rather than to the real token, which is the opposite of
   * the two URLs above. The default is what applies to a build that forgot, and
   * a build that forgot should be silent — sending a deploy's traffic to the
   * project under whatever `environment` it happens to compute is worse than
   * sending nothing. The desktop app never reads this at all: it posts to
   * `/v1/events` and the Worker holds the token.
   */
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: z.string().default(""),
  /** PostHog's ingestion host. US Cloud unless the project is moved. */
  NEXT_PUBLIC_POSTHOG_HOST: z.url().default("https://us.i.posthog.com"),
};

function build() {
  return createEnv({
    server,
    client,
    clientPrefix: CLIENT_PREFIX,
    // Written out one-by-one on purpose: this is what makes the bundler
    // inline the NEXT_PUBLIC_* values into the client bundle.
    runtimeEnv: {
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
      NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    },
    skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
  });
}

export type Env = ReturnType<typeof build>;

let cached: Env | undefined;

/**
 * Validates immediately and returns the env. Call this at process startup
 * (next.config.ts, Electron main) so a bad config fails the build/boot rather
 * than the first request.
 */
export function validateEnv(): Env {
  cached ??= build();
  return cached;
}

/**
 * The environment, validated on first property access.
 *
 * Access is lazy so that merely importing this module from a context without
 * `process` — the Electron renderer, a browser bundle — does not blow up. Those
 * contexts build their own env from the exported `client` schema instead.
 */
export const env: Env = new Proxy({} as Env, {
  get: (_target, prop) => Reflect.get(validateEnv() as object, prop),
  has: (_target, prop) => prop in (validateEnv() as object),
  ownKeys: () => Reflect.ownKeys(validateEnv() as object),
  getOwnPropertyDescriptor: (_target, prop) =>
    Reflect.getOwnPropertyDescriptor(validateEnv() as object, prop),
});
