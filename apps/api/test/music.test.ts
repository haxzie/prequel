/**
 * The music library.
 *
 * What the desktop app leans on: the catalogue comes back with a path per
 * track, a bad upload fails here rather than as a blank picker, a file name
 * that is not a bare name is refused, and a track the app already has costs a
 * 304 rather than two megabytes.
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import app from "../src/index.ts";
import { MUSIC_CONFIG_KEY, MUSIC_RAW_PREFIX } from "../src/lib/music.ts";

async function call(path: string, headers: Record<string, string> = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`https://api.prequel.sh${path}`, { headers }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

const CONFIG = {
  version: 1,
  updated: "2026-10-20T00:00:00Z",
  categories: [{ id: "ambient", label: "Ambient" }],
  tracks: [
    {
      id: "slow-wander",
      label: "Slow Wander",
      category: "ambient",
      file: "slow-wander.m4a",
      md5: "a".repeat(32),
      bytes: 2048,
      duration: 142_000_000_000,
      attribution: "",
    },
  ],
};

/** An MP4's `ftyp` box and a little padding: a file, not a song. */
const BYTES = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);

beforeEach(async () => {
  await env.MEDIA.delete(MUSIC_CONFIG_KEY);
  await env.MEDIA.delete(`${MUSIC_RAW_PREFIX}/slow-wander.m4a`);
});

describe("the catalogue", () => {
  it("is a 404 until one has been uploaded", async () => {
    expect((await call("/v1/music")).status).toBe(404);
  });

  it("hands every track a path to fetch it by", async () => {
    await env.MEDIA.put(MUSIC_CONFIG_KEY, JSON.stringify(CONFIG));

    const response = await call("/v1/music");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=86400");

    const body = (await response.json()) as { tracks: { raw: string; duration: number }[] };
    expect(body.tracks[0]!.raw).toBe("/v1/music/raw/slow-wander.m4a");
    // The length travels in the catalogue so a bed can be laid at the right
    // width before the file has finished downloading.
    expect(body.tracks[0]!.duration).toBe(142_000_000_000);
  });

  it("fails loudly on a catalogue that does not parse", async () => {
    await env.MEDIA.put(MUSIC_CONFIG_KEY, JSON.stringify({ ...CONFIG, tracks: [{ id: "x" }] }));
    expect((await call("/v1/music")).status).toBe(500);
  });
});

describe("a track", () => {
  it("is served as audio with an immutable cache", async () => {
    await env.MEDIA.put(`${MUSIC_RAW_PREFIX}/slow-wander.m4a`, BYTES);

    const response = await call("/v1/music/raw/slow-wander.m4a");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mp4");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES);
  });

  it("answers 304 to a matching etag", async () => {
    await env.MEDIA.put(`${MUSIC_RAW_PREFIX}/slow-wander.m4a`, BYTES);
    const first = await call("/v1/music/raw/slow-wander.m4a");

    const again = await call("/v1/music/raw/slow-wander.m4a", {
      "if-none-match": first.headers.get("etag")!,
    });
    expect(again.status).toBe(304);
  });

  it("refuses anything but a bare track name", async () => {
    for (const name of ["../config.json", "slow-wander.mp3", "a/b.m4a", "slow wander.m4a"]) {
      expect((await call(`/v1/music/raw/${encodeURIComponent(name)}`)).status).toBe(404);
    }
  });

  it("is a 404 when the bucket has no such track", async () => {
    expect((await call("/v1/music/raw/nope.m4a")).status).toBe(404);
  });
});
