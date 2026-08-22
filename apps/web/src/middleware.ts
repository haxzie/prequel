/**
 * The cheap half of the dashboard's auth gate.
 *
 * Checks that a session cookie exists — nothing more. Whether it is *valid* is
 * the Worker's answer to give, and asking it here would put a round-trip to
 * Cloudflare in front of every navigation, including the ones that go on to ask
 * again in the page itself.
 *
 * So this catches the common case (no cookie at all, redirect straight to
 * `/login`) and the pages still call `getMe()` and act on the real answer. A
 * cookie that is present but expired reaches the page and is redirected there.
 * Treating this as authorisation on its own would be a hole; treating it as a
 * fast path is what it is for.
 */
import { NextResponse, type NextRequest } from "next/server";

/**
 * Better Auth's cookie name, and its `__Secure-` production form.
 *
 * The prefix is added automatically once cookies are marked secure, so checking
 * only the bare name signs every production user out at the door.
 */
const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];

export function middleware(request: NextRequest) {
  const signedIn = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (signedIn) return NextResponse.next();

  const login = new URL("/login", request.url);
  // Carried through so the user lands where they were going rather than on a
  // generic dashboard, which matters most for a share link opened by someone
  // who happens to be signed out.
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  // `/v/[slug]` is deliberately absent: a share link must work for somebody with
  // no account, which is the entire point of it.
  matcher: ["/app/:path*", "/onboarding", "/desktop/auth"],
};
