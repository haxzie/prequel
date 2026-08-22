/**
 * Identifiers, and the difference between the two kinds.
 *
 * A row id only has to be unique. A share slug has to be *unguessable*, because
 * an unlisted link is the only thing protecting the video behind it — there is
 * no membership check on `/v/<slug>`. Both come from `crypto.getRandomValues`
 * for that reason; `Math.random` is seeded per isolate and is not a secret.
 */

/**
 * Base58: base64 without the characters that survive being read aloud, copied
 * out of a chat window, or double-clicked badly. No `0`/`O`, no `I`/`l`, and
 * nothing that needs escaping in a URL.
 */
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function random(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  // Modulo over 58 from a 256-value byte is very slightly biased towards the
  // first 24 characters. At 16 characters that is a rounding error against
  // ~10^28 possibilities, and rejection sampling here would buy nothing.
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

/** A row id. Prefixed so a stray identifier in a log says what it belongs to. */
export function id(prefix: string): string {
  return `${prefix}_${random(21)}`;
}

/**
 * The public part of a share link.
 *
 * Sixteen characters is ~94 bits. Enumerating it at a thousand guesses a second
 * takes longer than the heat death of the sun, which is the property this needs
 * — the whole security model of an unlisted link is that guessing does not work.
 */
export function slug(): string {
  return random(16);
}

/** A device token. Prefixed so one found in a log file is recognisable at sight. */
export function deviceToken(): string {
  return `${TOKEN_PREFIX}${random(40)}`;
}

const TOKEN_PREFIX = "prq_";

/**
 * Pulls a device token out of an `Authorization` header.
 *
 * One function rather than the same regex in three route files. The character
 * class has to agree with whatever `random` above emits, and three copies of
 * that agreement is three chances for a change of alphabet to start rejecting
 * every token silently — the app would simply appear signed out.
 *
 * Deliberately wider than base58 for the same reason: this only has to tell a
 * device token apart from a session, and the value is looked up by hash
 * immediately afterwards.
 */
export function bearerToken(header: string | undefined | null): string | null {
  const match = header?.match(/^Bearer\s+(\S+)$/);
  const token = match?.[1];

  return token && token.startsWith(TOKEN_PREFIX) ? token : null;
}

/** SHA-256, base64url. What is stored for a token, and what a PKCE challenge is. */
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64url(new Uint8Array(digest));
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Compares two strings without leaking where they diverge.
 *
 * Used on the auth code and on token hashes. A `===` on a secret returns as
 * soon as a byte differs, and the difference between "wrong at character 1" and
 * "wrong at character 30" is measurable over enough requests.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}
