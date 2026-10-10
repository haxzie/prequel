/**
 * The desktop app's update feed.
 *
 * `electron-updater` is pointed here rather than at where the files live, and
 * that indirection is the only reason the app survived the repository going
 * private: a release that turns out to be bad can be withheld from this Worker
 * in seconds, and where the bytes come from can be changed under every copy
 * already installed. See `lib/releases.ts` — the files are on
 * `assets.prequel.sh` now, not GitHub.
 *
 * Nothing here is authenticated. An app that cannot check for updates until
 * somebody signs in is an app that mostly cannot check for updates.
 */
import { Hono } from "hono";
import { z } from "zod";

import type { Env } from "../env.ts";
import { assetRedirect, notesForVersion } from "../lib/releases.ts";

const updates = new Hono<{ Bindings: Env }>();

/**
 * The platforms that have a feed.
 *
 * Apple Silicon only, matching the capture core. It is a path segment rather
 * than implied so that a second architecture is an entry in this set and not a
 * second endpoint — the feed URL baked into a shipped app cannot be changed
 * afterwards, so the shape has to allow for one now.
 *
 * A whole segment rather than `/darwin-:arch/`: Hono does not bind a parameter
 * that shares its segment with a literal prefix, and the handler silently gets
 * `undefined` rather than a routing error.
 */
const PLATFORMS = new Set(["darwin-arm64"]);

/**
 * Every file electron-updater asks for, redirected to the mirror.
 *
 * A 302 rather than the bytes. The zip is ~120 MB and Cloudflare is already
 * serving it; proxying would spend a Worker's whole duration budget to arrive at
 * the same file, more slowly.
 *
 * The updater appends `?noCache=<random>` to the channel file request, which
 * Hono's path matching ignores. Nothing here should ever read the raw URL.
 */
updates.get("/:platform/:file", (c) => {
  if (!PLATFORMS.has(c.req.param("platform"))) return c.notFound();

  const url = assetRedirect(c.env.MIRROR_URL, c.req.param("file"));

  // A name that is not a plain filename. Answered as a miss rather than a 400:
  // the only thing that ever reaches this route is the updater following a
  // channel file we wrote, so anything else is not a client to explain itself to.
  if (!url) return c.notFound();

  return c.redirect(url, 302);
});

const Notes = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/) });

/**
 * The release body for a version, so the update window has a changelog.
 *
 * Deliberately not an "is there an update?" endpoint. The channel file is
 * already the answer to that, and a second oracle can disagree with it — which
 * would show the user a version the updater then refuses to install. This is
 * called *after* the updater has named a version, and only to decorate it.
 */
updates.get("/notes", async (c) => {
  const parsed = Notes.safeParse(c.req.query());
  if (!parsed.success) return c.json({ message: "That request isn't valid." }, 400);

  const release = await notesForVersion(c.env.MIRROR_URL, parsed.data.version);

  // 200 with nothing in it, never an error. The caller has an update to offer
  // either way, and a failure here must not read to it as a broken check.
  return c.json({
    notes: release?.notes ?? null,
    publishedAt: release?.publishedAt ?? null,
  });
});

export default updates;
