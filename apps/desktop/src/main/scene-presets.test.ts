/**
 * The store behind the saved looks.
 *
 * Three things are worth asserting, and all three are refusals. A card arrives
 * as a string from a window, so anything that is not a picture this app made
 * must not be decoded and written. An id reaches `join`, so it must not be a
 * path. And a look whose folder will not delete must still leave the list, or
 * the picker keeps a cell that does nothing.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_BACKGROUND,
  DEFAULT_CAPTIONS,
  DEFAULT_LAYOUT,
  DEFAULT_WATERMARK,
  DEFAULT_ZOOM_LOOK,
} from "../shared/project.js";
import type { ScenePreset } from "../shared/scene-presets.js";

const USER_DATA = mkdtempSync(join(tmpdir(), "prequel-presets-"));
afterAll(() => rmSync(USER_DATA, { recursive: true, force: true }));

vi.mock("electron", () => ({ app: { getPath: () => USER_DATA } }));
vi.mock("./log.js", () => ({ log: () => undefined }));

const { applyImage, cardPath, mine, remove, renamePreset, save, thumbnailPath } =
  await import("./scene-presets.js");

/** A one-pixel JPEG, as the preview would hand one over. */
const CARD =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

function look(over: Partial<ScenePreset> = {}): ScenePreset {
  const { captionsOn: _dropped, ...captions } = DEFAULT_CAPTIONS;

  return {
    id: "kinetic",
    name: "Kinetic",
    savedAt: 1,
    frame: { width: 1920, height: 1080, presetId: "16:9" },
    layout: { ...DEFAULT_LAYOUT },
    background: { ...DEFAULT_BACKGROUND },
    captions,
    watermark: { ...DEFAULT_WATERMARK },
    zoom: { ...DEFAULT_ZOOM_LOOK },
    ...over,
  };
}

beforeEach(async () => {
  rmSync(join(USER_DATA, "scene-presets"), { recursive: true, force: true });
  // The module caches the list for the life of the process, so clear it through
  // the door the app uses rather than reaching inside.
  for (const preset of await mine()) await remove(preset.id);
});

describe("saving", () => {
  it("keeps the look and its card together, or neither", async () => {
    // One call, because a preset in the list whose card never arrived is a cell
    // that will not draw and nothing on screen to say why.
    const saved = await save(look(), CARD, null, null, null);

    expect(saved.map((preset) => preset.id)).toEqual(["kinetic"]);
    expect(readFileSync(cardPath("kinetic")!).subarray(0, 3)).toEqual(
      Buffer.from([0xff, 0xd8, 0xff]),
    );
  });

  it("refuses a card that is not a JPEG this app made", async () => {
    // Whatever `Buffer.from` made of it would be written to disk and served
    // back as an image. The same guard, and the same reason, as the library's
    // posters.
    expect(await save(look(), "https://example.test/evil.svg", null, null, null)).toEqual([]);
    expect(await save(look(), "data:text/html;base64,PHNjcmlwdD4=", null, null, null)).toEqual([]);
  });

  it("refuses a look it could not read back", async () => {
    // Sanitised on the way in as well as on the way out, so a list on disk
    // never holds something the picker cannot draw.
    expect(await save(look({ id: "../../evil" }), CARD, null, null, null)).toEqual([]);
    expect(await save(look({ name: "   " }), CARD, null, null, null)).toEqual([]);
  });

  it("carries a picture out of the recording it was chosen in", async () => {
    // Left where it was, the look would name a file inside one recording —
    // which means a different photograph in every other one.
    const session = mkdtempSync(join(tmpdir(), "prequel-take-"));
    writeFileSync(join(session, "background-custom.png"), "pixels");

    await save(look(), CARD, session, "background-custom.png", null);

    const target = mkdtempSync(join(tmpdir(), "prequel-other-"));
    const file = await applyImage("kinetic", target);

    // Named for the preset once it is inside, so two looks applied to one
    // recording cannot land on the same file.
    expect(file).toBe("preset-kinetic.png");
    expect(readFileSync(join(target, file!), "utf8")).toBe("pixels");

    rmSync(session, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  });
});

describe("the list", () => {
  it("puts the newest first", async () => {
    await save(look({ id: "old", savedAt: 1 }), CARD, null, null, null);
    const after = await save(look({ id: "new", savedAt: 9 }), CARD, null, null, null);

    expect(after.map((preset) => preset.id)).toEqual(["new", "old"]);
  });

  it("declines a blank rename, as renaming a recording does", async () => {
    await save(look(), CARD, null, null, null);

    expect((await renamePreset("kinetic", "  "))[0]!.name).toBe("Kinetic");
    expect((await renamePreset("kinetic", " Punchy "))[0]!.name).toBe("Punchy");
  });

  it("forgets one even when its folder will not go", async () => {
    // An orphan card in a cache directory is nothing. A cell for a preset that
    // is gone is a click that does nothing.
    await save(look(), CARD, null, null, null);
    expect(await remove("kinetic")).toEqual([]);
    expect(await mine()).toEqual([]);
  });

  it("serves a card only for a bare name", async () => {
    expect(cardPath("../../evil")).toBeNull();
    expect(thumbnailPath("../../evil.jpg")).toBeNull();
    expect(thumbnailPath("kinetic.png")).toBeNull();
  });
});
