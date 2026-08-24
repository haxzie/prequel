/**
 * Everything the Worker is handed at runtime.
 *
 * Deliberately not `@prequel/env`. That package validates `process.env` for
 * Node and Next; a Worker gets bindings on an argument instead, and there is no
 * `process` to read. Anything added to `wrangler.jsonc` — a var, a secret, a
 * binding — must be added here too or it is invisible to the code.
 *
 * Secrets are all optional in the type. A deploy missing one should fail on the
 * route that needs it, with a message naming it, rather than refusing to boot
 * and taking every other route down with it.
 */
export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;

  /** Where the web app lives. Sign-in redirects and share links are built off it. */
  APP_URL: string;
  /** This Worker's own origin, which OAuth callback URLs must match exactly. */
  API_URL: string;

  /**
   * The repository the desktop app updates from, as `owner/name`.
   *
   * A var rather than a constant so a fork can point the update feed at its own
   * releases without editing the code that builds the redirect.
   */
  GITHUB_REPO: string;

  WAITLIST_ENDPOINT: string;
  WAITLIST_FIELD: string;

  SES_REGION: string;
  SES_FROM: string;

  /**
   * PostHog's project token, and where to send it.
   *
   * A var rather than a secret, deliberately. The `phc_…` token is write-only —
   * it cannot read one event back out of the project — and `apps/web` serves it
   * to every browser that loads the site, so keeping a copy of it in `.dev.vars`
   * would protect nothing and split one value across two mechanisms.
   *
   * Empty disables analytics outright: `capture` returns without a request. That
   * is the state a deploy that has not been configured should be in, which is
   * why this is checked for emptiness rather than passed through `required()`.
   */
  POSTHOG_PROJECT_TOKEN: string;
  POSTHOG_HOST: string;

  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;

  /**
   * R2's S3-compatible credentials, which are *not* the bucket binding.
   *
   * A binding can read and write objects but cannot sign a URL for somebody
   * else to use, and presigned URLs are the whole upload and playback path —
   * they are what keeps hundreds of megabytes of video from passing through
   * this Worker in either direction.
   */
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;

  SES_ACCESS_KEY_ID?: string;
  SES_SECRET_ACCESS_KEY?: string;

  OPENAI_API_KEY?: string;

  /**
   * Optional, and only for the release-notes lookup.
   *
   * Public data either way — this raises GitHub's 60-per-hour limit for an
   * unauthenticated address, which a Worker shares with everything else on
   * Cloudflare. The download path never calls the API and needs no token.
   */
  GITHUB_TOKEN?: string;
}

/**
 * Reads a secret, or throws a message that names it.
 *
 * The alternative is a `fetch` to `undefined` or a signature computed with an
 * empty key, both of which fail much further downstream with an error about
 * something else entirely.
 */
export function required(env: Env, key: keyof Env): string {
  const value = env[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${String(key)} is not configured`);
  }
  return value;
}
