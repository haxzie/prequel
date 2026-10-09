/**
 * What a pasted X link resolves to, for the free tool on the site.
 *
 * No authentication: the page it serves is a public tool, and the thing it
 * returns is already public to anyone who opens the post. What stands in for a
 * credential is the CORS allow-list in `index.ts` — a browser on another origin
 * cannot read this response — and the allowance below, which is what keeps a
 * script from using our egress to enumerate X.
 *
 * It answers metadata only. The `video.twimg.com` URLs go to the browser and the
 * browser fetches them from X directly, so no video passes through here. See the
 * note at the top of `lib/x-video.ts` for why that is deliberate rather than an
 * optimisation left for later.
 */
import { Hono } from "hono";

import { database } from "../db.ts";
import type { Env } from "../env.ts";
import { sha256 } from "../lib/ids.ts";
import { sweep, take } from "../lib/rate-limit.ts";
import { resolvePost, type ResolveFailure } from "../lib/x-video.ts";

const xVideo = new Hono<{ Bindings: Env }>();

/**
 * Per hour, per address.
 *
 * Generous for the person it is for — paste a link, pick a size, done — and far
 * below what scraping a timeline would need. A resolve is one CDN read, so the
 * limit is guarding against being made into somebody's crawler rather than
 * against cost.
 */
const ALLOWANCE = { limit: 60, windowSeconds: 60 * 60 };

/** The longest input worth parsing. A URL this long is not one. */
const MAX_INPUT = 500;

/** What each failure says on the page, and the status it says it with. */
const FAILURES: Record<ResolveFailure["reason"], { status: 400 | 404 | 502; message: string }> = {
  "bad-url": { status: 400, message: "That isn't a link to a post on X." },
  "not-found": {
    status: 404,
    // One message for deleted, protected, suspended and age-restricted, because
    // the upstream does not distinguish them and guessing which it was would be
    // inventing detail. It also avoids confirming that a protected account's
    // post exists, which a more specific message would.
    message: "We can't see that post. It may be deleted, private or restricted.",
  },
  "no-video": { status: 404, message: "That post doesn't have a video in it." },
  upstream: { status: 502, message: "We couldn't reach X just now. Try again in a moment." },
};

xVideo.get("/", async (c) => {
  const input = c.req.query("url");
  if (!input || input.length > MAX_INPUT) {
    return c.json({ message: FAILURES["bad-url"].message }, 400);
  }

  const db = database(c.env);

  // Hashed, because the limiter's table has no reason to be a list of the
  // addresses that have used a public tool. The same call `transcribe` makes
  // about an install id.
  const address = c.req.header("cf-connecting-ip") ?? "unknown";
  if (!(await take(db, `x-video:${await sha256(address)}`, ALLOWANCE))) {
    return c.json({ message: "Too many links in the last hour. Try again later." }, 429);
  }

  c.executionCtx.waitUntil(sweep(db, ALLOWANCE.windowSeconds));

  const result = await resolvePost(input);

  if (!result.ok) {
    const failure = FAILURES[result.reason];
    return c.json({ message: failure.message }, failure.status);
  }

  return c.json(result.post);
});

export default xVideo;
