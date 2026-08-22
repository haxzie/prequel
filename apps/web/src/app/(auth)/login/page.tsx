import { redirect } from "next/navigation";

import { LoginForm } from "@/components/dashboard/LoginForm";
import { getMe } from "@/lib/session";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Sign in",
  description: "Sign in to Prequel to share recordings with your team.",
  path: "/login",
  // A login page in a search index is noise at best; at worst it is the result
  // somebody clicks instead of the product page.
  robots: { index: false, follow: false },
});

/**
 * Dynamic, because it reads the session.
 *
 * Every other page in this app is static. This one has to run per request or a
 * signed-in visitor would be served a cached "sign in" page and bounce off it.
 */
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const me = await getMe();
  const { next } = await searchParams;

  if (me) redirect(me.teams.length === 0 ? "/onboarding" : destination(next));

  return (
    <div className="mx-auto w-full max-w-sm px-5 py-12">
      <h1 className="text-2xl font-medium tracking-tight text-fg">Sign in to Prequel</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        No password, and no separate signup — if this is your first time, the account is made as you
        sign in.
      </p>

      <LoginForm next={destination(next)} />
    </div>
  );
}

/**
 * Where to send somebody after signing in.
 *
 * Only same-site paths. Echoing an arbitrary `next` back into a redirect is an
 * open redirect — a link that looks like ours and lands on somebody else's login
 * form — and the check has to reject `//evil.com` as well as `https://evil.com`,
 * since a protocol-relative URL is absolute to a browser and looks like a path
 * to a naive test.
 */
function destination(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/app";
  return next;
}
