/**
 * Who the caller is, and what they can see.
 *
 * Deliberately answers for a user with no team rather than 403ing. That state
 * is real and brief — between a first login and finishing onboarding — and it
 * is exactly what the dashboard reads to decide where to send them. A 403 here
 * would make the onboarding page unreachable for the only people who need it.
 */
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { schema } from "@prequel/db";

import { authenticate, type AppContext } from "../middleware.ts";

const me = new Hono<AppContext>();

me.use("*", authenticate);

me.get("/", async (c) => {
  const db = c.get("db");
  const { userId, teamId } = c.get("identity");

  const [user] = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      image: schema.user.image,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);

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
  if (!user) return c.json({ message: "Sign in to continue." }, 401);

  const teams = await db
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
    .orderBy(schema.member.createdAt);

  const devices = await db
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
    .limit(20);

  return c.json({
    user,
    teams,
    activeTeamId: teamId,
    devices: devices.filter((device) => device.revokedAt === null),
  });
});

export default me;
