import { AcceptInvitation } from "@/components/dashboard/AcceptInvitation";
import { pageMetadata } from "@/lib/seo";
import { getMe } from "@/lib/session";

export const metadata = pageMetadata({
  title: "Join a team",
  description: "Accept an invitation to a Prequel team.",
  path: "/invite",
  robots: { index: false, follow: false },
});

export const dynamic = "force-dynamic";

/**
 * Accepting an invitation.
 *
 * Not behind `middleware.ts`, deliberately. The person clicking this has almost
 * never signed in — the invitation is usually how they hear about Prequel at
 * all — and bouncing them to a login page loses the token on the way. So the
 * page renders either way and the client carries the invitation through
 * whichever sign-in it needs first.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const me = await getMe();
  const { token } = await params;

  return (
    <div className="mx-auto w-full max-w-sm px-5 py-12">
      <AcceptInvitation invitationId={token} signedIn={me !== null} />
    </div>
  );
}
