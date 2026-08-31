/**
 * Who is calling, and which team they are looking at.
 *
 * Two clients with nothing in common reach the same handlers. The dashboard
 * sends a session cookie; the desktop app cannot — its renderer's CSP forbids
 * remote requests entirely, so every call comes from Electron's main process,
 * which has no cookie jar worth the name and would not receive a
 * `.prequel.sh` cookie anyway.
 *
 * Resolving both here means no `/v1` handler has to care which one it got.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";

import { schema } from "@prequel/db";

import { createAuth } from "./auth.ts";
import { database, type Database } from "./db.ts";
import type { Env } from "./env.ts";
import { bearerToken, sha256 } from "./lib/ids.ts";

export interface Identity {
  userId: string;
  /** The team the caller is acting in. Null before onboarding has run. */
  teamId: string | null;
  via: "session" | "device";
}

export type AppContext = {
  Bindings: Env;
  Variables: { identity: Identity; db: Database };
};

export type App = Context<AppContext>;

/**
 * Rejects anything without a valid identity.
 *
 * A device token is checked before the cookie because the desktop app is the
 * only caller that sends one, and it never sends both — trying the cookie first
 * would mean a D1 read that cannot succeed on every call the app makes.
 */
export const authenticate: MiddlewareHandler<AppContext> = async (c, next) => {
  const identity = await optionalIdentity(c);

  if (!identity) return c.json({ message: "Sign in to continue." }, 401);

  c.set("identity", identity);
  await next();
};

/**
 * The same resolution, without the refusal.
 *
 * Two routes need to know who is calling and must still answer when nobody is.
 * `/v1/events` takes `app_launched` from an app that has never been signed in —
 * 401ing it would throw away the entire pre-sign-in funnel, which is the part
 * worth having. `/v1/transcribe` gives an anonymous install a smaller allowance
 * rather than none.
 *
 * Sets `db` on the context the way `authenticate` does, so a handler behind
 * either one reads it the same way.
 */
export async function optionalIdentity(c: App): Promise<Identity | null> {
  const db = database(c.env);
  c.set("db", db);

  const bearer = bearerToken(c.req.header("authorization"));

  return bearer ? fromDeviceToken(c, db, bearer) : fromSession(c);
}

/**
 * Requires a team as well as a user.
 *
 * Separate from `authenticate` because `/v1/me` has to answer for somebody who
 * has signed in and not yet made a team — that is precisely the state the
 * dashboard reads to decide whether to send them to onboarding, and 403ing it
 * would make the onboarding page unreachable.
 */
export const requireTeam: MiddlewareHandler<AppContext> = async (c, next) => {
  if (!c.get("identity").teamId) {
    return c.json({ message: "Create a team first.", code: "NO_TEAM" }, 403);
  }
  await next();
};

/**
 * Requires a team, and requires being in charge of it.
 *
 * The only server-side role check in this codebase. Everything else scopes by
 * team alone, which is enough while a team is one person — this guards the two
 * routes that spend money, where "enough for now" is not a thing to rely on.
 *
 * Membership and role in one read, so a member of another team gets the same
 * 403 as a member of this one, rather than leaking that the team exists.
 */
export const requireAdmin: MiddlewareHandler<AppContext> = async (c, next) => {
  const { userId, teamId } = c.get("identity");

  if (!teamId) return c.json({ message: "Create a team first.", code: "NO_TEAM" }, 403);

  const row = await membership(c.get("db"), userId, teamId);

  if (!row || !MANAGES.has(row.role)) {
    return c.json({ message: "Only an owner or admin can do that.", code: "NOT_ADMIN" }, 403);
  }

  await next();
};

/** The roles Better Auth's organization plugin lets manage a team. */
const MANAGES = new Set(["owner", "admin"]);

async function fromSession(c: App): Promise<Identity | null> {
  // A throw out of Better Auth is treated as "not signed in" rather than left to
  // reach the error floor. `optionalIdentity` has callers that must answer
  // whatever happens here, and for `authenticate` the difference is a login
  // redirect instead of a 500 page — which is the right thing to show somebody
  // whose session cannot be read.
  const session = await createAuth(c.env)
    .api.getSession({ headers: c.req.raw.headers })
    .catch(() => null);

  if (!session) return null;

  return {
    userId: session.user.id,
    // The plugin keeps the active team on the session, so a user in two teams
    // with two tabs open gets the right library in each.
    teamId: session.session.activeOrganizationId ?? (await firstTeam(c.get("db"), session.user.id)),
    via: "session",
  };
}

async function fromDeviceToken(c: App, db: Database, token: string): Promise<Identity | null> {
  const hash = await sha256(token);

  const [row] = await db
    .select()
    .from(schema.deviceToken)
    .where(and(eq(schema.deviceToken.tokenHash, hash), isNull(schema.deviceToken.revokedAt)))
    .limit(1);

  if (!row) return null;

  // Fire-and-forget through `waitUntil`: the account page wants to show when a
  // Mac last used its token, and nothing waits on that being current. Awaiting
  // it would put a D1 write in front of every desktop request.
  c.executionCtx.waitUntil(
    db
      .update(schema.deviceToken)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.deviceToken.id, row.id)),
  );

  return { userId: row.userId, teamId: await firstTeam(db, row.userId), via: "device" };
}

/**
 * The team a user belongs to, when nothing has said which.
 *
 * A device token carries no active team — the app is not a browser and has no
 * per-tab state — so the desktop shares into the team the account joined first.
 * Deterministic rather than arbitrary: the oldest membership is stable, where
 * an unordered `limit 1` could move between deploys and silently start
 * uploading somewhere else.
 */
async function firstTeam(db: Database, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: schema.member.organizationId })
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
    .orderBy(schema.member.createdAt)
    .limit(1);

  return row?.organizationId ?? null;
}

/** Whether a user is in a team, and with which role. */
export async function membership(db: Database, userId: string, teamId: string) {
  const [row] = await db
    .select()
    .from(schema.member)
    .where(and(eq(schema.member.userId, userId), eq(schema.member.organizationId, teamId)))
    .limit(1);

  return row ?? null;
}
