import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { peaksName, readCache, writeCache } from "./peaks";

/**
 * The name is the whole cache key, the way `cleanName` is for the cleaned
 * microphone: there is no index of what has been made, so the file has to
 * sit beside its source under a name only that source produces.
 */
describe("peaksName", () => {
  it("sits beside the file it describes", () => {
    expect(peaksName("mic.m4a")).toBe("mic.peaks");
    expect(peaksName("2/system.m4a")).toBe("2/system.peaks");
  });

  it("keeps the cleaned microphone's peaks apart from the raw one's", () => {
    // Different file, different shape. One answering for the other would
    // draw the noise the cleaning removed.
    expect(peaksName("mic.clean-strong.m4a")).toBe("mic.clean-strong.peaks");
    expect(peaksName("mic.clean-strong.m4a")).not.toBe(peaksName("mic.m4a"));
  });
});

describe("the cache file", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "prequel-peaks-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads back exactly what was written", async () => {
    const path = join(dir, "mic.peaks");
    const peaks = Float32Array.from({ length: 1_000 }, (_, index) => (index % 97) / 97);

    await writeCache(path, peaks);
    const back = await readCache(path);

    expect(back).not.toBeNull();
    expect(Array.from(back!)).toEqual(Array.from(peaks));
  });

  it("is absent rather than empty when there is no file", async () => {
    expect(await readCache(join(dir, "none.peaks"))).toBeNull();
  });

  it("refuses a file that is not a whole number of floats", async () => {
    // A write that never finished. Trusting it would draw a shape that stops
    // partway along the recording, and nothing would ever remake it.
    const path = join(dir, "mic.peaks");
    await writeFile(path, Buffer.from([0, 0, 128, 63, 1]));
    expect(await readCache(path)).toBeNull();
  });

  it("leaves nothing under the real name while writing", async () => {
    // The partial file carries another name until the move; a quit between
    // the two leaves `.partial`, which the next read ignores.
    const path = join(dir, "mic.peaks");
    await writeCache(path, new Float32Array([0.5]));
    expect(await readCache(`${path}.partial`)).toBeNull();
    expect(await readCache(path)).toEqual(new Float32Array([0.5]));
  });
});
