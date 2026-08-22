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

  WAITLIST_ENDPOINT: string;
  WAITLIST_FIELD: string;

  SES_REGION: string;
  SES_FROM: string;

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
