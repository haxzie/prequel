/**
 * The scene-preset catalogue as it reaches an editor.
 *
 * Two things are worth asserting and neither is the happy path. A catalogue
 * that does not parse must fail *here*, loudly, rather than arriving in the app
 * as a picker with nothing in it — that is the version of the failure somebody
 * notices. And a card name is a path unless something stops it being one.
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import app from "../src/index.ts";
import { SCENE_PRESETS_CONFIG_KEY, SCENE_PRESETS_VERSION } from "../src/lib/scene-presets.ts";

const CONFIG = {
  version: SCENE_PRESETS_VERSION,
  updated: "2026-09-01T00:00:00.000Z",
  presets: [
    {
      id: "kinetic",
      name: "Kinetic",
      savedAt: 1,
      frame: { width: 1920, height: 1080, presetId: "16:9" },
      layout: { cameraShape: "circle" },
      background: { padding: 0.2 },
      captions: { captionStyle: "highlight" },
      zoom: { speed: 1.2 },
      md5: "0123456789abcdef0123456789abcdef",
      blurhash: "L6PZfSjE.AyE_3t7t7R**0o#DgR4",
    },
  ],
};

async function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await app.fetch(new Request(`https://api.test${path}`, { headers }), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

beforeEach(async () => {
  await env.MEDIA.delete(SCENE_PRESETS_CONFIG_KEY);
});

describe("the catalogue", () => {
  it("says there are none rather than failing when nothing is published", async () => {
    expect((await get("/v1/scene-presets")).status).toBe(404);
  });

  it("hands the app a path to each card rather than a bucket key", async () => {
    // So the layout of the bucket stays this Worker's business — the app never
    // learns where anything actually lives.
    await env.MEDIA.put(SCENE_PRESETS_CONFIG_KEY, JSON.stringify(CONFIG));

    const body = (await (await get("/v1/scene-presets")).json()) as {
      presets: { id: string; thumbnail: string; md5?: string }[];
    };

    expect(body.presets[0]!.thumbnail).toBe("/v1/scene-presets/thumbnail/kinetic.jpg");
    // The hash is the uploader's business — what to skip re-sending — and means
    // nothing to a picker.
    expect(body.presets[0]!.md5).toBeUndefined();
  });

  it("refuses a catalogue it cannot read rather than serving half of one", async () => {
    // The schema is the only thing standing between a bad upload and every
    // editor showing a short picker. Failing here is the visible version.
    await env.MEDIA.put(
      SCENE_PRESETS_CONFIG_KEY,
      JSON.stringify({ ...CONFIG, presets: [{ id: "no-name-or-frame" }] }),
    );

    expect((await get("/v1/scene-presets")).status).toBe(500);
  });

  it("refuses a preset carrying the automatic frame", async () => {
    // `auto` is not a size. Carried, the editor writes the recording's own size
    // straight back over it — the preset's frame is silently discarded and its
    // undo appears not to work.
    await env.MEDIA.put(
      SCENE_PRESETS_CONFIG_KEY,
      JSON.stringify({
        ...CONFIG,
        presets: [{ ...CONFIG.presets[0], frame: { width: 1920, height: 1080, presetId: "auto" } }],
      }),
    );

    expect((await get("/v1/scene-presets")).status).toBe(500);
  });
});

describe("a card", () => {
  it("refuses a name that is not a bare file", async () => {
    // There is no path in a bare name, so there is nothing to traverse.
    expect((await get("/v1/scene-presets/thumbnail/..%2F..%2Fconfig.json")).status).toBe(404);
    expect((await get("/v1/scene-presets/thumbnail/kinetic.png")).status).toBe(404);
  });

  it("404s one that has not been published", async () => {
    expect((await get("/v1/scene-presets/thumbnail/missing.jpg")).status).toBe(404);
  });
});
