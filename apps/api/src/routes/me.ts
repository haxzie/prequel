/**
 * Who the caller is, and what they can see.
 *
 * Also the last place a missing team is fixed. Teams are created with the
 * account now, so a signed-in user without one is a sign-up hook that failed —
 * and there is no onboarding page to send them to any more. Every dashboard
 * page blocks on this call, so it is the one read that can guarantee the answer
 * rather than reporting a state nothing downstream knows how to render.
 */
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { schema } from "@prequel/db";

import { AVATAR_MAX_BYTES, removeAvatar, sniffImage, storeAvatar } from "../lib/avatars.ts";
import { enabled, setSubscribed } from "../lib/mails.ts";
import { ensureTeam } from "../lib/teams.ts";
import { trialEndsAt, trialStatus } from "../lib/trial.ts";
import { authenticate, type AppContext } from "../middleware.ts";

const me = new Hono<AppContext>();

me.use("*", authenticate);

me.get("/", async (c) => {
  const db = c.get("db");
  const { userId } = c.get("identity");
  let { teamId } = c.get("identity");

  /**
   * Three reads, started together.
   *
   * None of them needs anything from the others — `userId` comes off the
   * identity the middleware already resolved — and this handler is what every
   * dashboard page waits on before it renders anything at all. Run one after
   * the other, they were three serial hops to D1 sitting in front of every
   * navigation; the slowest of the three is now the whole cost.
   *
   * `account` is still checked before the rest is used, below. Racing the reads
   * does not mean trusting them.
   */
  const [[account], teams, devices, [emails]] = await Promise.all([
    db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        image: schema.user.image,
        // Read for the trial below and then dropped from the payload. It is the
        // account's sign-up date, which is the trial's anchor, and nothing in
        // the dashboard has any other use for it.
        createdAt: schema.user.createdAt,
      })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1),

    db
      .select({
        id: schema.organization.id,
        name: schema.organization.name,
        slug: schema.organization.slug,
        plan: schema.organization.plan,
        storageQuotaBytes: schema.organization.storageQuotaBytes,
        role: schema.member.role,
      })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id))
      .where(eq(schema.member.userId, userId))
      .orderBy(schema.member.createdAt),

    db
      .select({
        id: schema.deviceToken.id,
        label: schema.deviceToken.label,
        lastUsedAt: schema.deviceToken.lastUsedAt,
        createdAt: schema.deviceToken.createdAt,
        revokedAt: schema.deviceToken.revokedAt,
      })
      .from(schema.deviceToken)
      .where(eq(schema.deviceToken.userId, userId))
      .orderBy(desc(schema.deviceToken.createdAt))
      .limit(20),

    // A fourth read into the same race, for the same reason the three above are
    // there. Most accounts have no row — no row means subscribed, see
    // `email_preference` in the schema — so this is usually an index probe that
    // finds nothing, and serialising it behind the others would put a whole D1
    // round trip in front of every dashboard navigation to learn that.
    db
      .select({ marketing: schema.emailPreference.marketing })
      .from(schema.emailPreference)
      .where(eq(schema.emailPreference.userId, userId))
      .limit(1),
  ]);

  /**
   * A valid session for a user who is not there.
   *
   * `authenticate` can say yes to this. Sessions are cookie-cached — a signed
   * snapshot in the cookie, good for five minutes without a database read — so
   * for that window a session outlives the row it belongs to, and any session
   * orphaned by a deleted user does so indefinitely.
   *
   * Answering 200 with no `user` is the worst of the options: the dashboard
   * reads `me.user.name` off a payload that parsed fine and crashes. 401 is the
   * truth, and the caller already knows what to do with it.
   */
  if (!account) return c.json({ message: "Sign in to continue." }, 401);

  const { createdAt, ...user } = account;

  /**
   * A user with no team, which should not happen and is cheap to fix here.
   *
   * `ensureTeam` re-checks membership before it writes, so two of these racing
   * cost a wasted read rather than a second team. It is only reachable at all
   * when the sign-up hook failed, and the alternative — answering with an empty
   * `teams` and letting the dashboard work out what that means — is the shape
   * of the bug this whole change exists to remove.
   */
  if (teams.length === 0) {
    const created = await ensureTeam(db, { id: userId, name: user.name, email: user.email }).catch(
      (error: unknown) => {
        console.error("could not create a team on /v1/me", userId, error);
        return null;
      },
    );

    if (created) {
      const [team] = await db
        .select({
          id: schema.organization.id,
          name: schema.organization.name,
          slug: schema.organization.slug,
          plan: schema.organization.plan,
          storageQuotaBytes: schema.organization.storageQuotaBytes,
        })
        .from(schema.organization)
        .where(eq(schema.organization.id, created))
        .limit(1);

      if (team) {
        teams.push({ ...team, role: "owner" });
        teamId = team.id;
      }
    }
  }

  /**
   * The trial, resolved against the team the dashboard is about to render.
   *
   * The end date belongs to the account and the plan belongs to a team, so a
   * verdict needs both — and `activeTeam` in `lib/session.ts` picks the same row
   * this does, because `identity.teamId` falls back to the oldest membership and
   * `teams` above is ordered by exactly that. Picking differently here would
   * count down a trial beside the name of another team.
   */
  const active = teams.find((team) => team.id === teamId) ?? teams[0] ?? null;

  return c.json({
    user,
    teams,
    activeTeamId: teamId,
    trial: trialStatus(active?.plan ?? "free", trialEndsAt(createdAt)),
    devices: devices.filter((device) => device.revokedAt === null),
    // Defaulted here rather than in the component, so the dashboard and the
    // route cannot disagree about what a missing row means.
    emails: { marketing: emails?.marketing ?? true },
  });
});

/**
 * A new profile picture, as bytes.
 *
 * Through the Worker rather than a presigned URL, unlike a video: the
 * dashboard crops to 256×256 before sending, so this is tens of kilobytes,
 * and passing it through is what lets the type be read off the bytes and the
 * old object be removed in the same breath.
 */
me.put("/avatar", async (c) => {
  const length = Number(c.req.header("content-length") ?? "0");
  if (length > AVATAR_MAX_BYTES) {
    return c.json({ message: "That picture is too large. Crop it to 256 pixels." }, 413);
  }

  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > AVATAR_MAX_BYTES) {
    return c.json({ message: "That picture is too large. Crop it to 256 pixels." }, 413);
  }

  const type = sniffImage(bytes);
  if (!type) return c.json({ message: "That isn't a PNG, JPEG or WebP." }, 415);

  const image = await storeAvatar(c.env, c.get("db"), c.get("identity").userId, bytes, type);
  return c.json({ image });
});

me.delete("/avatar", async (c) => {
  await removeAvatar(c.env, c.get("db"), c.get("identity").userId);
  return c.json({ image: null });
});

/**
 * Whether this account wants product email.
 *
 * **Mails first, our row second.** The suppression list is what actually stops
 * a send, so a 200 here has to mean Mails accepted it — a route that wrote the
 * row first would answer "Saved" to somebody who then keeps receiving the mail
 * they just switched off, and the only record of the discrepancy would be our
 * own copy insisting otherwise.
 *
 * 502 rather than 500 when Mails refuses: nothing here is wrong, somewhere else
 * is unreachable, and the dashboard says so and leaves the toggle where it was.
 *
 * A deployment with no Mails key is the exception — `setSubscribed` answers
 * false without making a request, the same silence the rest of the integration
 * keeps — so the preference is recorded locally and the switch works. Nothing
 * is sending them email either way.
 */
me.put("/emails", async (c) => {
  const { userId } = c.get("identity");
  const db = c.get("db");

  const body = await c.req.json<{ marketing?: unknown }>().catch(() => ({}) as const);
  const marketing = (body as { marketing?: unknown }).marketing;

  // Explicitly a boolean. An absent or mistyped field read as `false` would
  // unsubscribe somebody on a malformed request, which is the one direction
  // here that is not recoverable from the settings screen for a bounced address.
  if (typeof marketing !== "boolean") {
    return c.json({ message: "Say whether you want product email." }, 400);
  }

  const [account] = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);

  if (!account) return c.json({ message: "Sign in to continue." }, 401);

  if (enabled(c.env) && !(await setSubscribed(c.env, account.email, marketing))) {
    return c.json({ message: "That didn't save. Try again in a moment." }, 502);
  }

  await db
    .insert(schema.emailPreference)
    .values({ userId, marketing, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.emailPreference.userId,
      set: { marketing, updatedAt: new Date() },
    });

  return c.json({ marketing });
});

export default me;
