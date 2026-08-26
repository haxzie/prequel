/**
 * Every Prequel API, in one Worker.
 *
 * The web app on Vercel is pages and nothing else — it has no route handlers at
 * all any more. Two reasons, and only the first is about this feature: D1 and R2
 * are only fast with native bindings, which Vercel cannot hold, and Vercel's
 * 4.5 MB function body limit is not something video can be moved through. The
 * second is simply that one place to look for a handler beats two.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";

import { createAuth } from "./auth.ts";
import { scheduled } from "./cron.ts";
import type { Env } from "./env.ts";
import billing from "./routes/billing.ts";
import desktop from "./routes/desktop.ts";
import events from "./routes/events.ts";
import me from "./routes/me.ts";
import publicRoutes from "./routes/public.ts";
import transcribe from "./routes/transcribe.ts";
import updates from "./routes/updates.ts";
import videos from "./routes/videos.ts";
import waitlist from "./routes/waitlist.ts";
import dodoWebhook from "./routes/webhooks/dodo.ts";

const app = new Hono<{ Bindings: Env }>();

/**
 * CORS, with credentials.
 *
 * The origin is echoed from configuration rather than answered with `*`, which
 * is not a style choice: a browser refuses to send credentials to a wildcard
 * origin, so `*` would sign every dashboard user out. Localhost is listed so the
 * Next dev server can call `wrangler dev` — the two are the same site as far as
 * cookies are concerned, since cookies ignore the port.
 */
app.use("*", (c, next) =>
  cors({
    origin: [c.env.APP_URL, "http://localhost:3000"],
    allowHeaders: ["content-type", "authorization", "x-prequel-install"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
    maxAge: 86_400,
  })(c, next),
);

/**
 * Better Auth owns everything under here — Google, magic links, teams,
 * invitations, sessions. Mounted with `on` over every method because the
 * handler routes internally and a `GET`-only mount silently 404s the callbacks.
 */
app.on(["GET", "POST"], "/api/auth/*", (c) =>
  // The execution context goes in because the organization hooks buy and
  // release seats, and a Dodo round trip does not belong in front of somebody
  // clicking Accept in an invitation email.
  createAuth(c.env, c.executionCtx).handler(c.req.raw),
);

app.route("/v1/me", me);
app.route("/v1/videos", videos);
app.route("/v1/desktop", desktop);
app.route("/v1/transcribe", transcribe);
app.route("/v1/events", events);
app.route("/v1/billing", billing);

/**
 * Dodo Payments, verified by signature rather than by a session.
 *
 * Mounted at the top level rather than under `/v1` alongside the rest: every
 * `/v1` router but the public ones sits behind `authenticate`, and a webhook has
 * no credential to offer.
 */
app.route("/v1/webhooks/dodo", dodoWebhook);

/** The desktop app's update feed. Unauthenticated, and called before sign-in. */
app.route("/v1/updates", updates);
app.route("/v1/waitlist", waitlist);

/** What `/v/<slug>` on the site reads. Public, and the only unauthenticated read. */
app.route("/p", publicRoutes);

app.get("/health", (c) => c.json({ ok: true }));

/**
 * The last line of defence.
 *
 * A thrown error otherwise reaches the client as Cloudflare's own 1101 page,
 * which is HTML, tells the user nothing and — because it is not JSON — makes
 * every client parse it as a failure of a completely different kind. The
 * message is deliberately not the error's: `required()` throws with the name of
 * a missing secret in it, and that belongs in the log, not the response.
 */
app.onError((error, c) => {
  console.error("unhandled", error);
  return c.json({ message: "Something went wrong." }, 500);
});

app.notFound((c) => c.json({ message: "No such endpoint." }, 404));

/**
 * A `fetch` and a `scheduled`, where this used to export the Hono app itself.
 *
 * `app.fetch` is already bound, so the tests calling `app.fetch(req, env, ctx)`
 * on the default export keep working unchanged. The cron is the only thing that
 * needs the second handler — see `cron.ts` for what it is for.
 */
export default {
  fetch: app.fetch,
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(scheduled(env));
  },
};
