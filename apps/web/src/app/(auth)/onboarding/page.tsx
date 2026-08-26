import { redirect } from "next/navigation";

import { OnboardingForm } from "@/components/dashboard/OnboardingForm";
import { pageMetadata } from "@/lib/seo";
import { EXPIRED_PARAM } from "@/lib/auth-gate";
import { getMe } from "@/lib/session";

export const metadata = pageMetadata({
  title: "Create your team",
  description: "Name your team to start sharing recordings.",
  path: "/onboarding",
  robots: { index: false, follow: false },
});

export const dynamic = "force-dynamic";

/**
 * The one step between signing in and the dashboard.
 *
 * Deliberately not skipped with an auto-created personal team. Everything in
 * the product belongs to a team — a video's storage, its share link, who can
 * delete it — and a team somebody named is one they understand owning. A silent
 * "Musthaq's Team" is a thing users discover later and cannot explain.
 *
 * Anyone who already has a team is sent on, so a bookmarked `/onboarding` is not
 * a way to accumulate them.
 */
export default async function OnboardingPage() {
  const me = await getMe();
  // `expired`, not a bare `/login`: this page is only reachable with a session
  // cookie, so a null `me` means the Worker refused it — and middleware would
  // send a bare `/login` carrying that cookie straight back here.
  if (!me) redirect(`/login?${EXPIRED_PARAM}=1`);
  if (me.teams.length > 0) redirect("/app");

  return (
    <div className="mx-auto w-full max-w-md px-5 py-12">
      <p className="mb-4 font-mono text-xs tracking-[0.18em] text-muted uppercase">
        One last thing
      </p>
      <h1 className="text-2xl font-medium tracking-tight text-fg">Create your team</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Recordings you share belong to a team, so everyone in it can find them. You can invite
        people now or later.
      </p>

      <OnboardingForm defaultName={suggestName(me.user.name, me.user.email)} />
    </div>
  );
}

/**
 * A name to start from, so the field is never blank.
 *
 * From the email's domain where that domain is the user's employer, and from
 * their own name where it is not — "Gmail" is not a team anybody works at, and
 * offering it as a default would be worse than offering nothing.
 */
function suggestName(name: string, email: string): string {
  const CONSUMER = new Set([
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "yahoo.com",
    "icloud.com",
    "me.com",
    "proton.me",
    "protonmail.com",
    "fastmail.com",
  ]);

  const domain = email.split("@")[1]?.toLowerCase() ?? "";

  if (domain && !CONSUMER.has(domain)) {
    const label = domain.split(".")[0] ?? "";
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  const first = name.trim().split(/\s+/)[0];
  return first ? `${first}'s team` : "My team";
}
