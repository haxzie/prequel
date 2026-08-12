/**
 * The editing rules, without a window.
 *
 * Two behaviours here are worth more than the rest: a cut must never leave a
 * slice that cannot be drawn or grabbed, and writing a setting must land where
 * the selection says it does — anything cleverer silently discards an edit the
 * user made.
 */
import { describe, expect, it } from "vitest";

import { newProject, overriddenKeys, resolveSettings } from "../../../shared/project";
import {
  activeSettings,
  editorReducer,
  initialState,
  MIN_SLICE_NS,
  projectDuration,
  selectedSlice,
  slicesOf,
  type EditorAction,
  type EditorState,
} from "./state";

const S = 1_000_000_000;
const RECORDING = "2026-08-11T12-00-00";

function start(): EditorState {
  return initialState(newProject(RECORDING, 10 * S));
}

function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}

describe("splitting", () => {
  it("cuts the slice under the playhead in two", () => {
    const state = run(start(), { type: "split", at: 4 * S });
    const slices = slicesOf(state.project);

    expect(slices).toHaveLength(2);
    expect(slices[0]!.source).toEqual({ start: 0, end: 4 * S });
    expect(slices[1]!.source).toEqual({ start: 4 * S, end: 10 * S });
  });

  it("loses no time across the cut", () => {
    const before = projectDuration(start().project);
    const after = projectDuration(run(start(), { type: "split", at: 4 * S }).project);

    expect(after).toBe(before);
  });

  it("selects the new half so the next edit lands on it", () => {
    const state = run(start(), { type: "split", at: 4 * S });
    expect(state.selectedSliceId).toBe(slicesOf(state.project)[1]!.id);
  });

  it("gives the new half its own copy of the overrides", () => {
    // Sharing the object would make editing one half silently edit the other.
    const state = run(
      start(),
      { type: "setSetting", section: "layout", key: "cameraX", value: 0.85 },
      { type: "split", at: 4 * S },
    );
    const [first, second] = slicesOf(state.project);

    expect(second!.overrides.layout?.cameraX).toBe(0.85);
    expect(second!.overrides).not.toBe(first!.overrides);
  });

  it("declines a cut on an existing boundary", () => {
    const once = run(start(), { type: "split", at: 4 * S });
    const twice = run(once, { type: "split", at: 4 * S });

    expect(slicesOf(twice.project)).toHaveLength(2);
  });

  it("declines a cut outside the edit", () => {
    expect(slicesOf(run(start(), { type: "split", at: 0 }).project)).toHaveLength(1);
    expect(slicesOf(run(start(), { type: "split", at: 10 * S }).project)).toHaveLength(1);
    expect(slicesOf(run(start(), { type: "split", at: 99 * S }).project)).toHaveLength(1);
  });

  it("declines a cut that would leave an ungrabbable sliver", () => {
    // A slice shorter than the minimum can only be fixed by deleting it.
    const state = run(start(), { type: "split", at: MIN_SLICE_NS / 2 });
    expect(slicesOf(state.project)).toHaveLength(1);
  });

  it("cuts the right slice when there are already several", () => {
    const state = run(start(), { type: "split", at: 4 * S }, { type: "split", at: 7 * S });
    const slices = slicesOf(state.project);

    expect(slices).toHaveLength(3);
    expect(slices.map((slice) => slice.source)).toEqual([
      { start: 0, end: 4 * S },
      { start: 4 * S, end: 7 * S },
      { start: 7 * S, end: 10 * S },
    ]);
  });
});

describe("deleting", () => {
  it("removes a slice and shortens the edit", () => {
    const state = run(
      start(),
      { type: "split", at: 4 * S },
      { type: "deleteSlice", sliceId: "take" },
    );

    expect(slicesOf(state.project)).toHaveLength(1);
    expect(projectDuration(state.project)).toBe(6 * S);
  });

  it("refuses to remove the last slice", () => {
    // An edit with no slices has nothing to show and nothing to export.
    const state = run(start(), { type: "deleteSlice", sliceId: "take" });
    expect(slicesOf(state.project)).toHaveLength(1);
  });

  it("moves the selection to a neighbour", () => {
    // Emptying it would silently switch the inspector to the project defaults.
    const state = run(
      start(),
      { type: "split", at: 4 * S },
      { type: "select", sliceId: "take" },
      { type: "deleteSlice", sliceId: "take" },
    );

    expect(state.selectedSliceId).toBe(slicesOf(state.project)[0]!.id);
    expect(selectedSlice(state)).toBeDefined();
  });

  it("ignores a slice that is not there", () => {
    const state = run(start(), { type: "split", at: 4 * S });
    expect(run(state, { type: "deleteSlice", sliceId: "ghost" })).toBe(state);
  });
});

describe("trimming", () => {
  it("moves an edge", () => {
    const state = run(start(), {
      type: "trimSlice",
      sliceId: "take",
      edge: "start",
      source: 2 * S,
    });

    expect(slicesOf(state.project)[0]!.source.start).toBe(2 * S);
    expect(projectDuration(state.project)).toBe(8 * S);
  });

  it("will not let an edge cross its opposite", () => {
    const state = run(start(), {
      type: "trimSlice",
      sliceId: "take",
      edge: "start",
      source: 20 * S,
    });
    const slice = slicesOf(state.project)[0]!;

    expect(slice.source.start).toBeLessThan(slice.source.end);
    expect(slice.source.end - slice.source.start).toBeGreaterThanOrEqual(MIN_SLICE_NS);
  });

  it("will not trim a slice below the minimum", () => {
    const state = run(start(), { type: "trimSlice", sliceId: "take", edge: "end", source: 0 });
    const slice = slicesOf(state.project)[0]!;

    expect(slice.source.end - slice.source.start).toBeGreaterThanOrEqual(MIN_SLICE_NS);
  });

  it("never trims to a negative source time", () => {
    const state = run(start(), {
      type: "trimSlice",
      sliceId: "take",
      edge: "start",
      source: -5 * S,
    });
    expect(slicesOf(state.project)[0]!.source.start).toBe(0);
  });

  it("is a no-op when the edge does not move", () => {
    const state = start();
    expect(run(state, { type: "trimSlice", sliceId: "take", edge: "start", source: 0 })).toBe(
      state,
    );
  });
});

describe("writing settings", () => {
  it("edits the project defaults when nothing is selected", () => {
    const state = run(
      start(),
      { type: "select", sliceId: null },
      { type: "setSetting", section: "layout", key: "cameraX", value: 0.85 },
    );

    expect(state.project.defaults.layout.cameraX).toBe(0.85);
    // The slice has no override, so it follows.
    expect(slicesOf(state.project)[0]!.overrides.layout).toBeUndefined();
  });

  it("overrides only the selected slice", () => {
    const state = run(
      start(),
      { type: "split", at: 4 * S },
      { type: "setSetting", section: "layout", key: "cameraVisible", value: false },
    );
    const [first, second] = slicesOf(state.project);

    expect(resolveSettings(state.project.defaults, second!.overrides).layout.cameraVisible).toBe(
      false,
    );
    expect(resolveSettings(state.project.defaults, first!.overrides).layout.cameraVisible).toBe(
      true,
    );
  });

  it("records an override that happens to equal the default", () => {
    // Otherwise the next change to the defaults moves a slice the user had
    // already decided about.
    const state = run(start(), {
      type: "setSetting",
      section: "layout",
      key: "cameraVisible",
      value: true,
    });

    expect(overriddenKeys(selectedSlice(state)!.overrides, "layout").has("cameraVisible")).toBe(
      true,
    );
  });

  it("resets a whole section", () => {
    const state = run(
      start(),
      { type: "setSetting", section: "layout", key: "cameraSize", value: 0.5 },
      { type: "setSetting", section: "audio", key: "micMuted", value: true },
      { type: "resetSection", section: "layout" },
    );
    const overrides = selectedSlice(state)!.overrides;

    expect(overrides.layout).toBeUndefined();
    expect(overrides.audio).toBeDefined();
  });
});

describe("activeSettings", () => {
  it("shows the selected slice's resolved settings", () => {
    const state = run(start(), {
      type: "setSetting",
      section: "layout",
      key: "cameraSize",
      value: 0.5,
    });

    expect(activeSettings(state).layout.cameraSize).toBe(0.5);
  });

  it("shows the project defaults when nothing is selected", () => {
    const state = run(
      start(),
      { type: "setSetting", section: "layout", key: "cameraSize", value: 0.5 },
      { type: "select", sliceId: null },
    );

    expect(activeSettings(state).layout.cameraSize).toBe(state.project.defaults.layout.cameraSize);
  });
});

describe("revision", () => {
  it("advances on a change worth saving", () => {
    const state = start();
    expect(run(state, { type: "split", at: 4 * S }).revision).toBe(state.revision + 1);
  });

  it("does not advance on selection", () => {
    // Which slice is highlighted is not something to write to disk.
    const state = start();
    expect(run(state, { type: "select", sliceId: null }).revision).toBe(state.revision);
  });
});

describe("zooms", () => {
  /** Two zooms with a two-second gap between them, for the edge cases. */
  const pair = () => run(start(), { type: "addZoom", at: 1 * S }, { type: "addZoom", at: 5 * S });

  const zoomsOf = (state: ReturnType<typeof start>) => state.project.zooms;

  it("drops one where the timeline was pressed", () => {
    const state = run(start(), { type: "addZoom", at: 3 * S });

    expect(zoomsOf(state)).toHaveLength(1);
    expect(zoomsOf(state)[0]!.source.start).toBe(3 * S);
    // Selected on the way in: the point of adding one is to say where it goes.
    expect(state.selectedZoomId).toBe(zoomsOf(state)[0]!.id);
    expect(state.selectedSliceId).toBeNull();
  });

  it("declines to add one on top of another", () => {
    // Two zooms covering the same moment have no defined answer, so overlaps
    // are made unreachable rather than resolved afterwards.
    const state = run(start(), { type: "addZoom", at: 3 * S }, { type: "addZoom", at: 3.5 * S });
    expect(zoomsOf(state)).toHaveLength(1);
  });

  it("fits one into the gap before the next", () => {
    const state = run(start(), { type: "addZoom", at: 5 * S }, { type: "addZoom", at: 4.5 * S });
    const [first] = zoomsOf(state);

    expect(first!.source.end).toBe(5 * S);
  });

  it("moves one without changing how long it is", () => {
    const state = pair();
    const [first] = zoomsOf(state);
    const length = first!.source.end - first!.source.start;

    const moved = run(state, { type: "moveZoom", zoomId: first!.id, start: 2.5 * S });
    const [after] = zoomsOf(moved);

    expect(after!.source.start).toBe(2.5 * S);
    expect(after!.source.end - after!.source.start).toBe(length);
  });

  it("stops a move against its neighbour rather than overlapping it", () => {
    const state = pair();
    const [first, second] = zoomsOf(state);

    const moved = run(state, { type: "moveZoom", zoomId: first!.id, start: 9 * S });
    const [after] = zoomsOf(moved);

    expect(after!.source.end).toBeLessThanOrEqual(second!.source.start);
  });

  it("keeps a move inside the recording", () => {
    const state = run(start(), { type: "addZoom", at: 3 * S });
    const [zoom] = zoomsOf(state);

    expect(
      zoomsOf(run(state, { type: "moveZoom", zoomId: zoom!.id, start: -5 * S }))[0]!.source.start,
    ).toBe(0);
  });

  it("will not trim one across its neighbour", () => {
    const state = pair();
    const [first, second] = zoomsOf(state);

    const trimmed = run(state, {
      type: "trimZoom",
      zoomId: first!.id,
      edge: "end",
      source: 9 * S,
    });

    expect(zoomsOf(trimmed)[0]!.source.end).toBeLessThanOrEqual(second!.source.start);
  });

  it("clears the zoom selection when a clip is selected", () => {
    // The inspector shows one thing at a time; both set would make "what am I
    // editing" unanswerable.
    const state = pair();
    const selected = run(state, { type: "select", sliceId: slicesOf(state.project)[0]!.id });

    expect(selected.selectedZoomId).toBeNull();
  });
});
