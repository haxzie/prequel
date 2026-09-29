import { describe, expect, it } from "vitest";

import { cleanName } from "./voice";

/**
 * The name a cleaned track takes is the whole cache — there is no record
 * anywhere of what a file was made with, so the name has to carry it. Two
 * things follow, and both are here: the level is in the name, and the file
 * lands beside the take it belongs to.
 */
describe("cleanName", () => {
  it("names the level, so two levels are two files", () => {
    expect(cleanName("mic.m4a", "light")).toBe("mic.clean-light.m4a");
    expect(cleanName("mic.m4a", "strong")).toBe("mic.clean-strong.m4a");
  });

  it("stays in the take's own directory", () => {
    // A recording extended with a second take holds `2/mic.m4a`. Cleaning it
    // into the session root would put both takes' cleaned tracks under one
    // name, and the second would overwrite the first.
    expect(cleanName("2/mic.m4a", "strong")).toBe("2/mic.clean-strong.m4a");
  });

  it("always writes an .m4a, whatever went in", () => {
    // The pass encodes AAC regardless of what it read, so the extension is
    // the writer's rather than the source's.
    expect(cleanName("mic.wav", "light")).toBe("mic.clean-light.m4a");
  });
});
