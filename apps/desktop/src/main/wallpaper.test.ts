/**
 * How a chosen background gets its name.
 *
 * One test, for one bug that shipped. Every upload was written as
 * `background-custom.png`, so choosing a second picture wrote new bytes to a
 * path the project was already holding — and nothing downstream noticed. The
 * renderer loads images from the *set of paths* a project names, so an
 * unchanged set means the effect never re-runs and the first photograph stays
 * on the canvas; Chromium would have answered that URL from its cache besides.
 *
 * The name is what makes both of those notice, so the name is what is pinned.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ dialog: { showOpenDialog: async () => ({ canceled: true }) } }));
vi.mock("./media-protocol.js", () => ({
  mediaUrl: (dir: string, name: string) => `${dir}/${name}`,
}));
vi.mock("./recorder.js", () => ({ getRecorder: () => null }));

const { fingerprint } = await import("./wallpaper.js");

const DIR = mkdtempSync(join(tmpdir(), "prequel-wallpaper-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

function picture(name: string, bytes: string): string {
  const path = join(DIR, name);
  writeFileSync(path, bytes);
  return path;
}

describe("naming a chosen background", () => {
  it("gives two different pictures two different names", async () => {
    // The bug. One name for every upload meant the project's stored path did
    // not change, so the picture on screen did not either.
    const first = await fingerprint(picture("a.png", "first photograph"));
    const second = await fingerprint(picture("b.png", "second photograph"));

    expect(first).not.toBe(second);
  });

  it("gives the same picture the same name, whatever it is called", async () => {
    // What makes re-choosing one free: the file is already in the recording, so
    // there is nothing to convert and nothing to copy.
    const once = await fingerprint(picture("c.png", "same bytes"));
    const again = await fingerprint(picture("d.png", "same bytes"));

    expect(again).toBe(once);
  });

  it("still answers for a file it cannot read", async () => {
    // Only the skip-if-present shortcut is lost. A name that is merely unique
    // is still enough to keep the reload honest, and the conversion would have
    // failed on that file anyway.
    expect(await fingerprint(join(DIR, "not-here.png"))).not.toBe("");
  });

  it("is a bare name the media protocol will serve", async () => {
    // It becomes a file name inside the recording and reaches `prequel-media://`
    // as one path segment, so it may not carry a path.
    expect(await fingerprint(picture("e.png", "bytes"))).toMatch(/^[a-z0-9]+$/);
  });
});
