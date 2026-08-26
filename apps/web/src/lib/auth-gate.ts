/**
 * The two facts `middleware.ts` and the pages have to agree on.
 *
 * Both sides decide who is signed in, and they decide it from different
 * evidence: middleware has the raw cookie jar at the edge, a page has the
 * Worker's answer. That is deliberate — only the Worker can say whether a
 * session is *valid* — but the cheap half of the question has to be asked the
 * same way in both places, or the two gates disagree and bounce a request
 * between them.
 */

/**
 * Better Auth's cookie name, and its `__Secure-` production form.
 *
 * The prefix is added automatically once cookies are marked secure, so checking
 * only the bare name signs every production user out at the door.
 */
export const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];

/**
 * Marks a `/login` that a stale session was just turned away from.
 *
 * Without it the two gates form a loop. Middleware sends a request carrying a
 * session cookie away from `/login`, and a page whose `getMe()` comes back null
 * sends it back — and a cookie that is present but expired satisfies the first
 * rule and fails the second, so the pair volley it forever. The flag is how the
 * page tells middleware "I have already asked the Worker about this one, let it
 * through".
 *
 * Safe to arrive on a hand-typed URL: it only skips the fast path, and the page
 * behind it still asks the Worker and still redirects a genuinely valid session
 * to the library.
 */
export const EXPIRED_PARAM = "expired";

/** Whether a request carries something that claims to be a session. */
export function hasSessionCookie(jar: { has(name: string): boolean }): boolean {
  return SESSION_COOKIES.some((name) => jar.has(name));
}
