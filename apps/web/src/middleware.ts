/**
 * The cheap half of the auth gate, in both directions.
 *
 * Checks that a session cookie exists — nothing more. Whether it is *valid* is
 * the Worker's answer to give, and asking it here would put a round-trip to
 * Cloudflare in front of every navigation, including the ones that go on to ask
 * again in the page itself.
 *
 * So this catches the two common cases and the pages still call `getMe()` and
 * act on the real answer. A cookie that is present but expired reaches the page
 * and is redirected there. Treating this as authorisation on its own would be a
 * hole; treating it as a fast path is what it is for.
 *
 * The `/login` direction is the one that is visible. A signed-in visitor
 * clicking "Sign in" in the marketing nav used to commit the navigation, render
 * the empty `(auth)` shell, wait on a round-trip to the Worker and only then
 * bounce to the library — a blank screen with a logo on it, for the length of a
 * request to Cloudflare. The nav cannot know who is reading it, because the
 * pages it sits on are static and cached for everyone; deciding here is the
 * earliest the question can be asked at all.
 */
import { NextResponse, type NextRequest } from "next/server";

import { EXPIRED_PARAM, hasSessionCookie } from "@/lib/auth-gate";

export function middleware(request: NextRequest) {
  const signedIn = hasSessionCookie(request.cookies);

  if (request.nextUrl.pathname === "/login") {
    return signedIn && !turnedAway(request) ? redirectTo("/app", request) : NextResponse.next();
  }

  if (signedIn) return NextResponse.next();

  const login = new URL("/login", request.url);
  // Carried through so the user lands where they were going rather than on a
  // generic dashboard, which matters most for a share link opened by someone
  // who happens to be signed out.
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

/**
 * Whether this `/login` is one the fast path must keep its hands off.
 *
 * Two cases, and both mean the same thing: somebody who knows more than a cookie
 * jar has already decided this request belongs on the form.
 *
 * `expired` is a page saying the Worker rejected the session — see
 * `lib/auth-gate.ts` for the loop that follows without it. `next` is a flow with
 * a destination of its own: the desktop handoff sends people here to come back
 * somewhere specific, and `/app` is not it. Those are
 * left to the page, which resolves them with the Worker's answer rather than a
 * guess — and they are not the case that was flashing, which carries no query at
 * all.
 */
function turnedAway(request: NextRequest): boolean {
  const { searchParams } = request.nextUrl;
  return searchParams.has(EXPIRED_PARAM) || searchParams.has("next");
}

function redirectTo(path: string, request: NextRequest): NextResponse {
  return NextResponse.redirect(new URL(path, request.url));
}

export const config = {
  // `/v/[slug]` is deliberately absent: a share link must work for somebody with
  // no account, which is the entire point of it.
  matcher: ["/app/:path*", "/onboarding", "/desktop/auth", "/login"],
};
