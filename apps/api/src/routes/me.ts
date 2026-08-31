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
  const [[account], teams, devices] = await Promise.all([
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
  });
});

export default me;
