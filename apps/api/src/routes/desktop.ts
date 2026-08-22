/**
 * The desktop sign-in handshake.
 *
 * The app cannot hold the session cookie — it is not a browser, and the cookie
 * is scoped to a domain it never visits — so it ends up holding a bearer token
 * instead. Getting that token to it is the whole problem: the only channel
 * between a browser and a native app on macOS is a URL, and a URL is not a
 * private place. `open` logs it, and any other app that registers the scheme
 * can be handed it instead.
 *
 * So the URL carries a code that is worthless alone. Redeeming it needs the
 * verifier, which never left the app's memory. This is PKCE, applied to the
 * problem it was invented for.
 */
import { and, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { schema } from "@prequel/db";

import { database } from "../db.ts";
import { bearerToken, deviceToken, id, sha256, timingSafeEqual } from "../lib/ids.ts";
import { authenticate, type AppContext } from "../middleware.ts";

const desktop = new Hono<AppContext>();

/** Five minutes: the time between pressing the button and the app being open. */
const CODE_TTL_MS = 5 * 60 * 1000;

const Authorize = z.object({
  /** base64url(SHA-256(verifier)), from the app. Opaque to the browser. */
  challenge: z.string().min(43).max(64),
});

/**
 * Mints a one-time code for the signed-in user.
 *
 * Cookie-authenticated, so this is only reachable from a browser that has
 * already signed in — which is what ties the code to a person. The page calling
 * it is `/desktop/auth`, behind the normal login gate.
 */
desktop.post("/authorize", authenticate, async (c) => {
  const parsed = Authorize.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ message: "That request isn't valid." }, 400);

  const { userId, teamId } = c.get("identity");
  const code = id("dac");

  await c
    .get("db")
    .insert(schema.desktopAuthCode)
    .values({
      code,
      challenge: parsed.data.challenge,
      userId,
      teamId,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });

  return c.json({ code });
});

const Exchange = z.object({
  code: z.string().min(1).max(64),
  /** The random string the challenge was derived from. */
  verifier: z.string().min(43).max(128),
  /** The Mac's hostname, so a device can be named when it is revoked. */
  label: z.string().min(1).max(120).default("Mac"),
});

/**
 * Trades a code and its verifier for a device token.
 *
 * Unauthenticated by necessity — the app has no credential yet, which is the
 * entire point. What stands in for one is that the caller can produce a string
 * whose hash matches a challenge submitted by a signed-in browser minutes ago.
 */
desktop.post("/token", async (c) => {
  const parsed = Exchange.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ message: "That request isn't valid." }, 400);

  const db = database(c.env);
  const { code, verifier, label } = parsed.data;

  const [row] = await db
    .select()
    .from(schema.desktopAuthCode)
    .where(
      and(
        eq(schema.desktopAuthCode.code, code),
        isNull(schema.desktopAuthCode.consumedAt),
        gt(schema.desktopAuthCode.expiresAt, new Date()),
      ),
    )
    .limit(1);

  // One message for "no such code", "already used" and "expired". Telling them
  // apart here would confirm to somebody guessing codes that a given one exists,
  // which is the only thing they would need this endpoint for.
  if (!row) return c.json({ message: "That sign-in link has expired." }, 400);

  if (!timingSafeEqual(await sha256(verifier), row.challenge)) {
    return c.json({ message: "That sign-in link has expired." }, 400);
  }

  // Consumed before the token is issued, and conditioned on it still being
  // unconsumed. Two deep links firing at once — which macOS will happily do if
  // the user presses the button twice — otherwise both pass the check above and
  // both get a token.
  const claimed = await db
    .update(schema.desktopAuthCode)
    .set({ consumedAt: new Date() })
    .where(and(eq(schema.desktopAuthCode.code, code), isNull(schema.desktopAuthCode.consumedAt)))
    .returning({ code: schema.desktopAuthCode.code });

  if (claimed.length === 0) return c.json({ message: "That sign-in link has expired." }, 400);

  const token = deviceToken();

  await db.insert(schema.deviceToken).values({
    id: id("dev"),
    tokenHash: await sha256(token),
    userId: row.userId,
    label,
  });

  const [user] = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      image: schema.user.image,
    })
    .from(schema.user)
    .where(eq(schema.user.id, row.userId))
    .limit(1);

  const team = row.teamId
    ? ((
        await db
          .select({ id: schema.organization.id, name: schema.organization.name })
          .from(schema.organization)
          .where(eq(schema.organization.id, row.teamId))
          .limit(1)
      )[0] ?? null)
    : null;

  // The only time the plaintext token is ever transmitted. Nothing stores it
  // but the Mac it is being sent to.
  return c.json({ token, user, team });
});

/** Signs this Mac out. The token is dead the moment this returns. */
desktop.post("/revoke", authenticate, async (c) => {
  const bearer = bearerToken(c.req.header("authorization"));
  if (!bearer) return c.json({ message: "Not signed in on a device." }, 400);

  await c
    .get("db")
    .update(schema.deviceToken)
    .set({ revokedAt: new Date() })
    .where(eq(schema.deviceToken.tokenHash, await sha256(bearer)));

  return c.json({ ok: true });
});

export default desktop;
