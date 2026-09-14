import { ProfilePicture } from "@/components/dashboard/ProfilePicture";
import { pageMetadata } from "@/lib/seo";
import { requireTeam } from "@/lib/session";

export const metadata = pageMetadata({
  title: "Account",
  description: "Who you are on Prequel.",
  path: "/app/settings",
  robots: { index: false, follow: false },
});

export const dynamic = "force-dynamic";

/**
 * The account: the name, the address, and the picture.
 *
 * The first two are read-only for now — both come from the provider that
 * signed the person in, and a name typed here would be overwritten by the
 * next Google sign-in with `overrideUserInfo` on. The picture is the one thing
 * that is ours to keep, and the one thing on this page that can be changed.
 */
export default async function AccountPage() {
  const { me } = await requireTeam();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-medium tracking-tight text-fg">Account</h1>
      <p className="mt-1.5 text-sm text-muted">
        Who you are on Prequel, and how you appear to others.
      </p>

      <dl className="mt-8 grid grid-cols-[auto_1fr] gap-x-8 gap-y-3 text-sm">
        <dt className="text-muted">Name</dt>
        <dd className="text-fg">{me.user.name}</dd>
        <dt className="text-muted">Email</dt>
        <dd className="text-fg">{me.user.email}</dd>
      </dl>

      <ProfilePicture user={me.user} />
    </div>
  );
}
