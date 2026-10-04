//! The project format's side of covering things.
import { describe, expect, it } from "vitest";

import { PROJECT_VERSION, sanitiseProject } from "./project";

const ID = "Prequel 2026-01-01 00-00-00";

function read(stored: Record<string, unknown>) {
  return sanitiseProject(
    { version: PROJECT_VERSION, recordingId: ID, ...stored },
    ID,
    10_000_000_000,
    [],
  );
}

describe("a project from before covers existed", () => {
  it("is not read again", () => {
    // The decision that matters. A recording somebody reviewed and exported
    // last month must not acquire a set of grey boxes because they opened it
    // again — so an older project reads back as *already* read, and scanning
    // one is a button rather than a consequence of arriving.
    const project = read({});

    expect(project?.masks).toEqual([]);
    expect(project?.redaction.scanned).toBe(true);
  });
});

describe("reading the covers back", () => {
  const key = { at: 0, x: 0.1, y: 0.2, width: 0.3, height: 0.1 };
  const mask = {
    id: "m1",
    origin: "auto",
    group: "financial",
    label: "Card number",
    preview: "•••• 4242",
    bucket: 7,
    source: { start: 0, end: 1_000_000_000 },
    mode: "pixelate",
    strength: 0.5,
    visible: true,
    keys: [key],
  };

  it("keeps one it can draw", () => {
    expect(read({ masks: [mask] })?.masks).toHaveLength(1);
  });

  it("drops one with nowhere to be, and keeps its neighbours", () => {
    // Per entry rather than all-or-nothing: one cover that cannot be read is
    // one thing uncovered, where dropping the list would uncover everything.
    const project = read({ masks: [{ ...mask, id: "broken", keys: [] }, mask] });

    expect(project?.masks.map((entry) => entry.id)).toEqual(["m1"]);
  });

  it("reads a missing switch as covering", () => {
    // A project from a build without the switch had every cover on. A missing
    // field must never uncover anything.
    const { visible: _dropped, ...without } = mask;
    expect(read({ masks: [without] })?.masks[0]?.visible).toBe(true);
  });

  it("reads an unknown style as a blur rather than dropping the cover", () => {
    // The cover still covers. It must never fall the other way.
    expect(read({ masks: [{ ...mask, mode: "liquify" }] })?.masks[0]?.mode).toBe("blur");
  });

  it("clamps a key into the recording's frame", () => {
    // An unclamped key is a cover that either vanishes or fills the picture
    // depending on which rasteriser drew it — which is how a preview and an
    // export come to disagree about what is hidden.
    const project = read({
      masks: [{ ...mask, keys: [{ ...key, x: -0.5, y: 2, width: 9, height: 0.1 }] }],
    });
    const found = project?.masks[0]?.keys[0];

    expect(found?.x).toBe(0);
    expect(found?.y).toBe(1);
    expect(found?.width).toBe(1);
  });

  it("sorts the keys by time", () => {
    // Both samplers walk them in order and would interpolate backwards.
    const project = read({
      masks: [
        {
          ...mask,
          keys: [
            { ...key, at: 500 },
            { ...key, at: 100 },
          ],
        },
      ],
    });

    expect(project?.masks[0]?.keys.map((entry) => entry.at)).toEqual([100, 500]);
  });
});
