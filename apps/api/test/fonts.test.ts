/**
 * The font catalogue.
 *
 * What the desktop app leans on: the catalogue comes back with a URL per
 * variant, a bad upload fails here rather than as a blank picker, a file name
 * that is not a bare name is refused, and a file the app already has costs a
 * 304 rather than a body.
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import app from "../src/index.ts";
import { FONTS_CONFIG_KEY, FONTS_FILE_PREFIX } from "../src/lib/fonts.ts";

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
  updated: "2026-09-16T00:00:00Z",
  categories: [{ id: "sans", label: "Sans" }],
  families: [
    {
      id: "inter",
      label: "Inter",
      category: "sans",
      variants: [
        { weight: 400, italic: false, file: "inter-400.woff2", md5: "a".repeat(32), bytes: 10 },
        {
          weight: 700,
          italic: true,
          file: "inter-700-italic.woff2",
          md5: "b".repeat(32),
          bytes: 10,
        },
      ],
    },
  ],
};

// `wOF2` and a little padding: enough to be a file, not enough to be a font.
const BYTES = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0, 0, 0]);

beforeEach(async () => {
  await env.MEDIA.delete(FONTS_CONFIG_KEY);
  await env.MEDIA.delete(`${FONTS_FILE_PREFIX}/inter-400.woff2`);
});

describe("the catalogue", () => {
  it("is a 404 until one has been uploaded", async () => {
    expect((await call("/v1/fonts")).status).toBe(404);
  });

  it("hands every variant a URL to fetch it by", async () => {
    await env.MEDIA.put(FONTS_CONFIG_KEY, JSON.stringify(CONFIG));

    const response = await call("/v1/fonts");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=86400");

    const body = (await response.json()) as { families: { variants: { url: string }[] }[] };
    expect(body.families[0]!.variants.map((variant) => variant.url)).toEqual([
      "/v1/fonts/file/inter-400.woff2",
      "/v1/fonts/file/inter-700-italic.woff2",
    ]);
  });

  it("fails loudly on a catalogue that does not parse", async () => {
    await env.MEDIA.put(FONTS_CONFIG_KEY, JSON.stringify({ ...CONFIG, families: [{ id: "x" }] }));
    expect((await call("/v1/fonts")).status).toBe(500);
  });
});

describe("a file", () => {
  it("is served with its type and an immutable cache", async () => {
    await env.MEDIA.put(`${FONTS_FILE_PREFIX}/inter-400.woff2`, BYTES);

    const response = await call("/v1/fonts/file/inter-400.woff2");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("font/woff2");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES);
  });

  it("answers 304 to a matching etag", async () => {
    await env.MEDIA.put(`${FONTS_FILE_PREFIX}/inter-400.woff2`, BYTES);
    const first = await call("/v1/fonts/file/inter-400.woff2");
    const etag = first.headers.get("etag")!;

    const again = await call("/v1/fonts/file/inter-400.woff2", { "if-none-match": etag });
    expect(again.status).toBe(304);
  });

  it("refuses anything but a bare font file name", async () => {
    for (const name of ["../config.json", "inter-400.png", "a/b.woff2", "inter 400.woff2"]) {
      expect((await call(`/v1/fonts/file/${encodeURIComponent(name)}`)).status).toBe(404);
    }
  });

  it("is a 404 when the bucket has no such file", async () => {
    expect((await call("/v1/fonts/file/nope.woff2")).status).toBe(404);
  });
});
