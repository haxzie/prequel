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
import { captureServer } from "../lib/posthog.ts";
import { sweep, take } from "../lib/rate-limit.ts";
import { deliver, describe, personById } from "../lib/slack.ts";
import { trialEndsAt } from "../lib/trial.ts";
import { authenticate, optionalIdentity, type AppContext } from "../middleware.ts";

const desktop = new Hono<AppContext>();

/** Five minutes: the time between pressing the button and the app being open. */
const CODE_TTL_MS = 5 * 60 * 1000;

/**
 * The longest bug report this will take.
 *
 * Slack truncates a message around 40 KB and reads badly long before that. This
 * is roughly a screen of typing, which is more than anybody writes into a box in
 * a dialog and far less than a pasted log.
 */
const MAX_FEEDBACK = 4_000;

/**
 * The most of a log one report may carry.
 *
 * The app sends the last 12 KB and this leaves room around it, rather than
 * matching exactly: a cap the client sits precisely on is one that starts
 * refusing reports the day either number is changed on its own.
 */
const MAX_LOG = 16_000;

/** Enough for somebody having a bad afternoon; not enough to flood the channel. */
const FEEDBACK_ALLOWANCE = { limit: 10, windowSeconds: 60 * 60 };

/**
 * The longest note somebody may leave beside a rating.
 *
 * A quarter of what the bug report box takes, because this is a different kind
 * of writing: a sentence about an export that just finished, typed with the
 * file still on screen. A box that invited a page of it would be the bug report
 * box with stars on top.
 */
const MAX_NOTE = 1_000;

/**
 * Looser than the bug report allowance, and counted the same way.
 *
 * A rating is one press and a sentence, and somebody exporting a batch of clips
 * may well rate several in an afternoon. The limit is against a script, not a
 * person.
 */
const RATING_ALLOWANCE = { limit: 30, windowSeconds: 60 * 60 };

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

  // Emitted here rather than from the app: this is the moment the account and
  // the Mac are joined, and it is the one place that knows both halves. The
  // app's own `signed_in` event is what carries the anonymous install id across
  // to the account — the two are complementary, not duplicates.
  captureServer(c.env, c.executionCtx, {
    event: "device_authorised",
    userId: row.userId,
    teamId: row.teamId,
  });

  // The only time the plaintext token is ever transmitted. Nothing stores it
  // but the Mac it is being sent to.
  return c.json({ token, user, team });
});

/**
 * The two facts the app needs to decide whether it may export.
 *
 * Facts, not a verdict. This returns when the trial ends and whether the team
 * is paying; `main/licence.ts` turns those into "trial", "paid" or "expired" in
 * one place. Computing the verdict here as well would put the same rule on both
 * sides of the wire, and the two would disagree the first time either changed.
 *
 * **The trial runs from the account, not from the install.** Seven days from
 * `user.createdAt`, which is a row this app cannot write — anchoring it to
 * anything on the Mac would restart it with a deleted file, and reinstalling to
 * get another week is not a trial.
 *
 * `authenticate` without `requireTeam`: somebody who has signed in and not yet
 * finished onboarding has no team, and that is `free` on a running trial, not
 * an error. A 403 there would leave the app to interpret a refusal, and the
 * safe reading of an ambiguous refusal is to let the export run.
 */
desktop.get("/entitlement", authenticate, async (c) => {
  const db = c.get("db");
  const { userId, teamId } = c.get("identity");

  const [account] = await db
    .select({ createdAt: schema.user.createdAt })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);

  // A valid session for a user who is not there — `/v1/me` documents how that
  // happens. There is no sign-up date to answer with, and inventing `now` would
  // hand out a fresh week to exactly the sessions that should not have one.
  if (!account) return c.json({ message: "Sign in to continue." }, 401);

  const [team] = teamId
    ? await db
        .select({ plan: schema.organization.plan })
        .from(schema.organization)
        .where(eq(schema.organization.id, teamId))
        .limit(1)
    : [];

  return c.json({
    /**
     * `lifetime` is answered as `pro`, deliberately.
     *
     * The Mac app's only question is whether this account may export, and the
     * builds already in the field parse exactly two values — `main/licence.ts`
     * reads anything else as "not paid" and shows the paywall to somebody who
     * has paid. Widening the wire is not worth doing to a client that cannot be
     * updated retroactively, and the app has no use for the distinction: the
     * two tiers differ only in how much may be *uploaded*, which the share
     * endpoint decides on its own.
     */
    plan: team?.plan === "lifetime" ? "pro" : (team?.plan ?? "free"),
    // Milliseconds, because `Date` on the other side takes milliseconds and a
    // unit that has to be remembered is a unit that gets forgotten.
    trialEndsAt: trialEndsAt(account.createdAt),
  });
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

  const { userId, teamId } = c.get("identity");
  captureServer(c.env, c.executionCtx, { event: "device_revoked", userId, teamId });

  return c.json({ ok: true });
});

/**
 * A bug report, typed into the editor and read by a person.
 *
 * Straight to Slack and nowhere else. There is no table behind this on purpose:
 * a report is only worth anything while somebody is still reading it, and a
 * `feedback` row nobody queries is a place for reports to go and be lost. If
 * that changes, the channel is the archive.
 *
 * **Awaited, unlike every other Slack call in this Worker.** `notify` is for
 * telling somewhere about something that already happened, where the request
 * must not wait; this is a person watching a dialog for the word "Sent", and
 * answering 200 over a message Slack refused is the one outcome worse than an
 * error. So `deliver`, and its verdict is the response.
 *
 * Behind `authenticate` without `requireTeam`: a report needs somebody to reply
 * to, which is the whole point of the button, and it needs no team at all.
 */
const Feedback = z.object({
  message: z.string().trim().min(1).max(MAX_FEEDBACK),
  /**
   * The build it was written on.
   *
   * The single most useful line in any report and the one nobody remembers to
   * include, so the app sends it rather than asking. Optional, because an older
   * build that learns this endpoint later should still be able to reach it.
   */
  version: z.string().min(1).max(32).optional(),
  /**
   * The end of `main.log`, when it was asked for.
   *
   * Sent already redacted — the app runs it through the same function that
   * cleans an error report, so `/Users/dana` never arrives here in the first
   * place. This is not the place to redact it: by the time a string has crossed
   * the wire the account name has already left the Mac.
   */
  log: z.string().max(MAX_LOG).optional(),
});

desktop.post("/feedback", authenticate, async (c) => {
  const parsed = Feedback.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ message: "Write something first." }, 400);

  const db = c.get("db");
  const { userId, teamId } = c.get("identity");

  // Per account rather than per install: the limit is against somebody holding
  // the key down in the box, and a report is cheap enough that anything a
  // person types by hand is comfortably inside it.
  if (!(await take(db, `feedback:${userId}`, FEEDBACK_ALLOWANCE))) {
    return c.json({ message: "That is a lot of reports. Try again a bit later." }, 429);
  }

  c.executionCtx.waitUntil(sweep(db, FEEDBACK_ALLOWANCE.windowSeconds));

  const person = await personById(db, userId);
  const { message, version, log } = parsed.data;

  // Quoted with `>` so a report several lines long stays one block in the
  // channel rather than running into whatever is posted next.
  const quoted = message
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

  // The log after the words, fenced, so the report reads first and the tail is
  // something to scroll into rather than past. Slack takes 40 KB in a message
  // and both halves are capped well inside it.
  const attached = log ? `\n\`\`\`\n${log}\n\`\`\`` : "";

  const sent = await deliver(
    c.env,
    "events",
    `*Bug report* — ${describe(person)}${version ? ` on ${version}` : ""}\n${quoted}${attached}`,
  );

  if (!sent) {
    // 503 rather than 500: nothing is broken here — the deployment may simply
    // have no webhook — and what the app says is "we could not send this",
    // which is true and leaves the text in the box to try again.
    return c.json({ message: "Couldn't send that just now. Please try again." }, 503);
  }

  captureServer(c.env, c.executionCtx, { event: "feedback_sent", userId, teamId });

  return c.json({ ok: true });
});

/**
 * Five stars under a finished export, and whatever was typed under them.
 *
 * **Not behind `authenticate`, unlike the bug report above.** Exporting needs
 * no account, so the one moment this question gets asked is a moment plenty of
 * people are signed out — and a rating widget that opens a browser is a rating
 * widget nobody answers. The cost is that some of these arrive with nobody to
 * reply to, which is the right trade for a number: a bug report is a
 * conversation, a rating is a measurement.
 *
 * So the limiter counts the install rather than the account, the way
 * `/v1/transcribe` does, and for the same reason — it is the only thing an
 * anonymous caller has that identifies a machine. Hashed before it becomes a
 * key, because the limiter's table has no business being a list of installs.
 *
 * Awaited like the bug report: somebody is watching the button for the word
 * "Thanks", and saying it over a message Slack refused is the one outcome worth
 * avoiding here.
 */
const Rating = z.object({
  rating: z.number().int().min(1).max(5),
  /** Optional on purpose: a star on its own is still worth having. */
  message: z.string().trim().max(MAX_NOTE).optional(),
  /** The build it was exported from. The app sends it; nobody is asked. */
  version: z.string().min(1).max(32).optional(),
});

desktop.post("/rating", async (c) => {
  const parsed = Rating.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ message: "That request isn't valid." }, 400);

  // Resolves the caller where there is one and sets `db` either way.
  const identity = await optionalIdentity(c);
  const db = c.get("db");

  const install = c.req.header("x-prequel-install")?.slice(0, 64) ?? null;
  const subject = identity
    ? `rating:user:${identity.userId}`
    : install
      ? `rating:install:${await sha256(install)}`
      : null;

  // Neither a token nor an install header means a caller that is not the app.
  // Refused rather than let through unlimited: this posts into a channel.
  if (!subject) return c.json({ message: "That request isn't valid." }, 400);

  if (!(await take(db, subject, RATING_ALLOWANCE))) {
    return c.json({ message: "That is a lot of ratings. Try again a bit later." }, 429);
  }

  c.executionCtx.waitUntil(sweep(db, RATING_ALLOWANCE.windowSeconds));

  const { rating, message, version } = parsed.data;
  const person = identity ? await personById(db, identity.userId) : null;

  // Stars rather than "4/5" alone, so the channel can be skimmed — a row of
  // one-star messages is visible at a glance in a way a column of numbers is
  // not. The number follows for anybody counting.
  const stars = "\u2605".repeat(rating) + "\u2606".repeat(5 - rating);

  // Quoted like a bug report, so a note several lines long stays one block.
  const quoted = message
    ? "\n" +
      message
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")
    : "";

  const sent = await deliver(
    c.env,
    "events",
    `*Export rating* ${stars} ${String(rating)}/5 — ${describe(person)}${
      version ? ` on ${version}` : ""
    }${quoted}`,
  );

  // 503 for the same reason the bug report gives: nothing is broken, the
  // message did not arrive, and the dialog must not claim otherwise.
  if (!sent) return c.json({ message: "Couldn't send that just now. Please try again." }, 503);

  // No `captureServer` here, unlike every other handler in this file. Most of
  // these arrive with no account, and an event with no distinct id is dropped
  // on the floor — so the app sends `export_rated` itself, where the install id
  // makes an anonymous rating count as much as a signed-in one.

  return c.json({ ok: true });
});

export default desktop;
