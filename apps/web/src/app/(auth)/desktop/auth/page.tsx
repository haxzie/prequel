import { DesktopHandoff } from "@/components/dashboard/DesktopHandoff";
import { pageMetadata } from "@/lib/seo";
import { requireTeam } from "@/lib/session";

export const metadata = pageMetadata({
  title: "Connect Prequel",
  description: "Finish signing in to the Prequel app.",
  path: "/desktop/auth",
  robots: { index: false, follow: false },
});

export const dynamic = "force-dynamic";

/**
 * The browser half of the desktop sign-in handshake.
 *
 * The app opened this URL with a challenge in the query. Once the visitor is
 * signed in here, this page trades that challenge for a one-time code and hands
 * it back over `prequel://`. The code alone is useless — redeeming it needs the
 * verifier, which never left the app.
 */
export default async function DesktopAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ challenge?: string; state?: string }>;
}) {
  const { challenge, state } = await searchParams;

  // Read the query first, so signing in comes back to *this* handshake rather
  // than to a bare `/desktop/auth`. A literal path here loses the challenge and
  // the state, and the page it returns to is the "Something is missing" one
  // below — a dead end reached by doing everything right. `middleware.ts` drops
  // the request here before this ever runs, so both halves have to carry it.
  const back = new URLSearchParams();
  if (challenge) back.set("challenge", challenge);
  if (state) back.set("state", state);

  const { me, team } = await requireTeam(`/desktop/auth?${back.toString()}`);

  if (!challenge || !state) {
    return (
      <div className="mx-auto w-full max-w-sm px-5 py-12">
        <h1 className="text-2xl font-medium tracking-tight text-fg">Something is missing</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Start again from the app — press Sign in there and this page will open with everything it
          needs.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-sm px-5 py-12">
      <DesktopHandoff
        challenge={challenge}
        state={state}
        email={me.user.email}
        teamName={team.name}
      />
    </div>
  );
}
