/**
 * The two things this protocol has to get right.
 *
 * The URL is entirely renderer-controlled, so every path it resolves has to be
 * proven inside the recordings directory before anything is opened. And without
 * correct range handling a `<video>` cannot seek — playback works until the
 * buffer runs out and then simply stops, with nothing to say why.
 */
import { assetUrl, permissionIconUrl } from "../shared/media-url.js";
import { PERMISSION_IDS } from "../shared/contract.js";
import { BACKGROUND_PRESETS } from "../shared/backgrounds.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  protocol: { handle: () => undefined },
  shell: { openPath: async () => "", showItemInFolder: () => undefined },
  app: { getPath: () => tmpdir() },
}));

const { mediaUrl, parseRange, resolveMediaPath, serveMedia } = await import("./media-protocol.js");

const ROOT = mkdtempSync(join(tmpdir(), "prequel-media-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const TAKE = "Prequel 2026-08-11 12-00-00";
const BODY = Buffer.from("0123456789");

mkdirSync(join(ROOT, TAKE), { recursive: true });
writeFileSync(join(ROOT, TAKE, "screen.mp4"), BODY);

// A file outside the recordings directory, for the traversal cases to aim at.
writeFileSync(join(ROOT, "..", "prequel-media-secret.mp4"), "secret");
afterAll(() => rmSync(join(ROOT, "..", "prequel-media-secret.mp4"), { force: true }));

describe("resolveMediaPath", () => {
  it("resolves a file inside a recording", () => {
    expect(resolveMediaPath(mediaUrl(join(ROOT, TAKE), "screen.mp4"), ROOT)).toBe(
      join(ROOT, TAKE, "screen.mp4"),
    );
  });

  it("refuses to climb out of the recordings directory", () => {
    // The obvious attack, and the reason paths are resolved before comparison:
    // as a raw string this looks like it is inside the root.
    const url = "prequel-media://recording/..%2F..%2Fetc/passwd.mp4";
    expect(resolveMediaPath(url, ROOT)).toBeNull();
  });

  it("refuses an encoded traversal in the file name", () => {
    const url = `prequel-media://recording/${encodeURIComponent(TAKE)}/${encodeURIComponent("../../prequel-media-secret.mp4")}`;
    expect(resolveMediaPath(url, ROOT)).toBeNull();
  });

  it("refuses a sibling directory that merely shares a prefix", () => {
    // `/tmp/root-evil` starts with `/tmp/root`, which is why the check appends
    // a separator rather than using a bare `startsWith`.
    const url = `prequel-media://recording/${encodeURIComponent("..")}/x.mp4`;
    expect(resolveMediaPath(url, ROOT)).toBeNull();
  });

  it("refuses a file type a recording never contains", () => {
    const url = `prequel-media://recording/${encodeURIComponent(TAKE)}/notes.txt`;
    expect(resolveMediaPath(url, ROOT)).toBeNull();
  });

  it("refuses a URL with the wrong number of path segments", () => {
    expect(resolveMediaPath("prequel-media://recording/screen.mp4", ROOT)).toBeNull();
    expect(resolveMediaPath(`prequel-media://recording/a/b/screen.mp4`, ROOT)).toBeNull();
  });
});

describe("parseRange", () => {
  it("reads a bounded range", () => {
    expect(parseRange("bytes=2-5", 10)).toEqual({ start: 2, end: 5 });
  });

  it("reads an open-ended range as running to the last byte", () => {
    expect(parseRange("bytes=4-", 10)).toEqual({ start: 4, end: 9 });
  });

  it("reads a suffix range as the last N bytes", () => {
    // `bytes=-3` means the final three bytes, not "up to byte 3". Getting this
    // backwards serves the wrong part of the file with a plausible 206.
    expect(parseRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
  });

  it("clamps an end past the file", () => {
    expect(parseRange("bytes=8-99", 10)).toEqual({ start: 8, end: 9 });
  });

  it("rejects a start past the file", () => {
    expect(parseRange("bytes=20-", 10)).toBeNull();
  });

  it("rejects nonsense and absence", () => {
    expect(parseRange(null, 10)).toBeNull();
    expect(parseRange("bytes=5-2", 10)).toBeNull();
    expect(parseRange("items=0-1", 10)).toBeNull();
  });
});

describe("serveMedia", () => {
  const url = () => mediaUrl(join(ROOT, TAKE), "screen.mp4");

  it("serves the whole file when nothing is asked for", async () => {
    const response = serveMedia(url(), null, ROOT);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe("10");
    // Advertised even on a full response: Chromium looks for it before it will
    // attempt a range request at all.
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(await response.text()).toBe("0123456789");
  });

  it("serves a partial response for a range", async () => {
    const response = serveMedia(url(), "bytes=2-5", ROOT);

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(response.headers.get("Content-Length")).toBe("4");
    expect(await response.text()).toBe("2345");
  });

  it("answers 404 for a path outside the recordings directory", () => {
    expect(
      serveMedia("prequel-media://recording/..%2F..%2Fetc/passwd.mp4", null, ROOT).status,
    ).toBe(404);
  });

  it("answers 404 for a recording that does not exist", () => {
    expect(serveMedia("prequel-media://recording/nope/screen.mp4", null, ROOT).status).toBe(404);
  });

  it("allows the renderer to read the media, not just play it", () => {
    // Without this the element is tainted: it plays, and
    // `createMediaElementSource` then feeds the mixer silence rather than
    // failing. The editor's audio disappears with nothing logged anywhere.
    // On the partial responses too — that is what a media element actually
    // fetches once it starts seeking.
    for (const range of [null, "bytes=2-5"]) {
      const response = serveMedia(url(), range, ROOT);

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Expose-Headers")).toContain("Content-Range");
    }
  });

  it("labels a video and an audio track differently", () => {
    writeFileSync(join(ROOT, TAKE, "mic.m4a"), BODY);

    expect(serveMedia(url(), null, ROOT).headers.get("Content-Type")).toBe("video/mp4");
    expect(
      serveMedia(mediaUrl(join(ROOT, TAKE), "mic.m4a"), null, ROOT).headers.get("Content-Type"),
    ).toBe("audio/mp4");
  });
});

describe("shipped assets", () => {
  it("serves a background preset by name", () => {
    // The picker draws its thumbnails over this route, and it is the only way
    // a renderer can see an image the app ships rather than one it recorded.
    const path = resolveMediaPath(assetUrl(BACKGROUND_PRESETS[0]!.file), ROOT);

    expect(path).not.toBeNull();
    expect(path).toContain("resources/backgrounds/");
  });

  it("refuses anything that is not one of ours", () => {
    // Matched against the list rather than sanitised, so there is no path here
    // to escape from in the first place.
    expect(resolveMediaPath(assetUrl("../../../etc/passwd"), ROOT)).toBeNull();
    expect(resolveMediaPath(assetUrl("secrets.jpg"), ROOT)).toBeNull();
    expect(resolveMediaPath("prequel-media://asset/a/b.jpg", ROOT)).toBeNull();
  });

  it("serves a permission icon for every permission the welcome window asks for", () => {
    // Every id, not a sample: the welcome window draws one row per id and a
    // name this route does not know is a row with a broken image in it.
    for (const id of PERMISSION_IDS) {
      const path = resolveMediaPath(permissionIconUrl(id), ROOT);

      expect(path).not.toBeNull();
      expect(path).toContain(`resources/permissions/${id}.png`);
    }
  });

  it("refuses a permission icon that is not a permission", () => {
    // The id is matched against `PERMISSION_IDS`, so the directory it names is
    // never built from anything the renderer chose. Traversal is spelled out
    // here because `permissions/` is a real directory to be walked out of,
    // which the single-file `app-icon.png` branch above is not.
    expect(resolveMediaPath(assetUrl("permission-secrets.png"), ROOT)).toBeNull();
    expect(resolveMediaPath(assetUrl("permission-../../../etc/passwd.png"), ROOT)).toBeNull();
    expect(resolveMediaPath(assetUrl("permission-.png"), ROOT)).toBeNull();
  });
});
