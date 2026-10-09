/**
 * The X video resolver.
 *
 * Asserted without a network. The upstream is undocumented and will change
 * shape without telling anybody, so the properties worth pinning are the ones
 * that must hold whatever it answers: that only X's own hosts are ever fetched,
 * that a playlist is never offered as a file, and that a missing field degrades
 * to a message rather than a throw.
 *
 * The payload below is the shape of a real response, trimmed to the fields that
 * are read.
 */
import {
  applyD1Migrations,
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import app from "../src/index.ts";
import { postIdFrom, resolvePost } from "../src/lib/x-video.ts";

// The route spends an allowance, which is a table.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

// Miniflare keeps one database per suite, so a count left behind by the test
// before would show up here as an allowance already partly spent.
beforeEach(async () => {
  await env.DB.exec("DELETE FROM rate_limit");
});

afterEach(() => vi.unstubAllGlobals());

const VIDEO_PAYLOAD = {
  __typename: "Tweet",
  id_str: "1988283207138324487",
  text: "a post with a video in it",
  user: { name: "Someone", screen_name: "someone" },
  mediaDetails: [
    {
      type: "video",
      media_url_https: "https://pbs.twimg.com/amplify_video_thumb/1/img/poster.jpg",
      video_info: {
        duration_millis: 106_333,
        aspect_ratio: [16, 9],
        variants: [
          { content_type: "application/x-mpegURL", url: "https://video.twimg.com/a/pl/x.m3u8" },
          {
            content_type: "video/mp4",
            bitrate: 832_000,
            url: "https://video.twimg.com/amplify_video/1/vid/avc1/640x360/b.mp4",
          },
          {
            content_type: "video/mp4",
            bitrate: 10_368_000,
            url: "https://video.twimg.com/amplify_video/1/vid/avc1/1920x1080/a.mp4",
          },
        ],
      },
    },
  ],
};

/** Stubs the upstream, and records every URL the code under test asked for. */
function stubSyndication(body: unknown, status = 200): { fetched: string[] } {
  const fetched: string[] = [];

  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    fetched.push(typeof input === "string" ? input : input.toString());
    return Promise.resolve(
      new Response(status === 200 ? JSON.stringify(body) : "<!DOCTYPE html>", {
        status,
        headers: { "content-type": status === 200 ? "application/json" : "text/html" },
      }),
    );
  });

  return { fetched };
}

describe("reading the post id out of a link", () => {
  it("takes the links X hands out today", () => {
    expect(postIdFrom("https://x.com/someone/status/1988283207138324487")).toBe(
      "1988283207138324487",
    );
  });

  it("still takes a twitter.com link, because old ones are still in circulation", () => {
    expect(postIdFrom("https://twitter.com/someone/status/20")).toBe("20");
    expect(postIdFrom("https://mobile.twitter.com/someone/statuses/20")).toBe("20");
  });

  it("ignores the tracking parameters a share sheet appends", () => {
    expect(postIdFrom("https://x.com/someone/status/20?s=46&t=abc")).toBe("20");
  });

  it("takes a link pasted without its scheme", () => {
    expect(postIdFrom("x.com/someone/status/20")).toBe("20");
  });

  it("takes the bare id, which is what retyping from a URL produces", () => {
    expect(postIdFrom("  20  ")).toBe("20");
  });

  /**
   * The one that matters. Without the host check this is a fetcher for any URL
   * a caller supplies, running on our egress — so it is asserted rather than
   * left to the reader of the regex.
   */
  it("refuses a host that is not X", () => {
    expect(postIdFrom("https://example.com/someone/status/20")).toBeNull();
    expect(postIdFrom("https://x.com.evil.test/someone/status/20")).toBeNull();
    expect(postIdFrom("https://notx.com/status/20")).toBeNull();
  });

  it("refuses a link to something other than a post", () => {
    expect(postIdFrom("https://x.com/someone")).toBeNull();
    expect(postIdFrom("not a url at all")).toBeNull();
  });
});

describe("resolving a post", () => {
  it("asks only X, and only for the id in the link", async () => {
    const { fetched } = stubSyndication(VIDEO_PAYLOAD);
    await resolvePost("https://x.com/someone/status/1988283207138324487");

    expect(fetched).toHaveLength(1);
    expect(new URL(fetched[0]!).hostname).toBe("cdn.syndication.twimg.com");
    expect(new URL(fetched[0]!).searchParams.get("id")).toBe("1988283207138324487");
    // Derived from the id, so it is present without anything having been issued.
    expect(new URL(fetched[0]!).searchParams.get("token")).toBeTruthy();
  });

  it("offers the files and not the playlist", async () => {
    stubSyndication(VIDEO_PAYLOAD);
    const result = await resolvePost("https://x.com/someone/status/1988283207138324487");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [media] = result.post.media;
    expect(media!.variants).toHaveLength(2);
    expect(media!.variants.every((variant) => variant.url.endsWith(".mp4"))).toBe(true);
  });

  it("puts the best quality first, labelled by height rather than bitrate", async () => {
    stubSyndication(VIDEO_PAYLOAD);
    const result = await resolvePost("https://x.com/someone/status/1988283207138324487");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.post.media[0]!.variants.map((variant) => variant.label)).toEqual([
      "1080p",
      "360p",
    ]);
  });

  it("every file it offers is served by X", async () => {
    stubSyndication(VIDEO_PAYLOAD);
    const result = await resolvePost("https://x.com/someone/status/1988283207138324487");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const variant of result.post.media[0]!.variants) {
      expect(new URL(variant.url).hostname).toBe("video.twimg.com");
    }
  });

  it("calls a looping post a GIF, which is what X shows", async () => {
    stubSyndication({
      ...VIDEO_PAYLOAD,
      mediaDetails: [
        {
          type: "animated_gif",
          media_url_https: "https://pbs.twimg.com/tweet_video_thumb/x.jpg",
          video_info: {
            variants: [
              {
                content_type: "video/mp4",
                url: "https://video.twimg.com/tweet_video/320x240/x.mp4",
              },
            ],
          },
        },
      ],
    });

    const result = await resolvePost("https://x.com/someone/status/20");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.post.media[0]!.kind).toBe("gif");
    expect(result.post.media[0]!.variants[0]!.label).toBe("GIF");
  });

  it("says there is no video when the post is only text", async () => {
    stubSyndication({ ...VIDEO_PAYLOAD, mediaDetails: [] });
    const result = await resolvePost("https://x.com/someone/status/20");

    expect(result).toMatchObject({ ok: false, reason: "no-video" });
  });

  it("says there is no video when the post is a photo", async () => {
    stubSyndication({ ...VIDEO_PAYLOAD, mediaDetails: [{ type: "photo" }] });
    const result = await resolvePost("https://x.com/someone/status/20");

    expect(result).toMatchObject({ ok: false, reason: "no-video" });
  });

  it("treats a tombstone as unreachable, since that is what it is", async () => {
    stubSyndication({ __typename: "TweetTombstone" });
    const result = await resolvePost("https://x.com/someone/status/20");

    expect(result).toMatchObject({ ok: false, reason: "not-found" });
  });

  it("treats a deleted or private post as unreachable", async () => {
    stubSyndication(null, 404);
    const result = await resolvePost("https://x.com/someone/status/20");

    expect(result).toMatchObject({ ok: false, reason: "not-found" });
  });

  /**
   * The upstream is undocumented, so this is the realistic failure: it keeps
   * answering 200 and stops carrying something that was read. The page should
   * say it found no video, not fail.
   */
  it("degrades to no-video when the shape changes under it", async () => {
    stubSyndication({ __typename: "Tweet", mediaDetails: [{ type: "video" }] });
    const result = await resolvePost("https://x.com/someone/status/20");

    expect(result).toMatchObject({ ok: false, reason: "no-video" });
  });

  it("drops a variant whose URL carries no resolution to read", async () => {
    stubSyndication({
      ...VIDEO_PAYLOAD,
      mediaDetails: [
        {
          type: "video",
          video_info: {
            variants: [
              { content_type: "video/mp4", bitrate: 1, url: "https://video.twimg.com/x.mp4" },
            ],
          },
        },
      ],
    });

    const result = await resolvePost("https://x.com/someone/status/20");
    expect(result).toMatchObject({ ok: false, reason: "no-video" });
  });

  it("reports X being unreachable as upstream rather than throwing", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("network")));
    const result = await resolvePost("https://x.com/someone/status/20");

    expect(result).toMatchObject({ ok: false, reason: "upstream" });
  });
});

describe("the route", () => {
  async function call(query: string, address = "203.0.113.1"): Promise<Response> {
    const ctx = createExecutionContext();
    const response = await app.fetch(
      new Request(`https://api.prequel.sh/v1/x-video?${query}`, {
        headers: { "cf-connecting-ip": address },
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return response;
  }

  it("answers the post and its files", async () => {
    stubSyndication(VIDEO_PAYLOAD);
    const response = await call("url=https://x.com/someone/status/1988283207138324487");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { author: { handle: string }; media: unknown[] };
    expect(body.author.handle).toBe("someone");
    expect(body.media).toHaveLength(1);
  });

  it("refuses a link that is not to X", async () => {
    stubSyndication(VIDEO_PAYLOAD);
    const response = await call("url=https://example.com/someone/status/20");

    expect(response.status).toBe(400);
  });

  it("refuses an absurdly long input without parsing it", async () => {
    const { fetched } = stubSyndication(VIDEO_PAYLOAD);
    const response = await call(`url=${"x".repeat(600)}`);

    expect(response.status).toBe(400);
    expect(fetched).toHaveLength(0);
  });

  it("asks for a link when none was sent", async () => {
    const response = await call("");
    expect(response.status).toBe(400);
  });

  it("stops answering an address that is working through a list", async () => {
    stubSyndication(VIDEO_PAYLOAD);

    // One address, past the hourly allowance. The last call is the one asserted;
    // the limiter is covered on its own in `rate-limit.test.ts`.
    const address = "203.0.113.99";
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await call("url=https://x.com/someone/status/20", address);
    }

    const response = await call("url=https://x.com/someone/status/20", address);
    expect(response.status).toBe(429);
  });
});
