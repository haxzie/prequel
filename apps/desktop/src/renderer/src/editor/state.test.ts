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
  canUndo,
  editorReducer,
  initialState,
  MIN_SLICE_NS,
  projectDuration,
  selectedSlice,
  settingsOf,
  slicesOf,
  placedSlices,
  type EditorAction,
  type EditorState,
} from "./state";
import { toSourceTime, totalDuration } from "./timeline";

const S = 1_000_000_000;
const RECORDING = "2026-08-11T12-00-00";

/** A ten-second recording, and a state that knows it is ten seconds long. */
function start(): EditorState {
  return initialState(newProject(RECORDING, 10 * S), 10 * S);
}

function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}

describe("the end of the recording", () => {
  it("will not let a clip claim footage that was never recorded", () => {
    // The drag reports wherever the pointer is, which on a zoomed-in timeline
    // is easily seconds past the last frame. Left unclamped the slice described
    // ten seconds of a six-second file, and nothing downstream objected: the
    // player simply runs out and holds the last frame, so it reads as a clip
    // that freezes rather than as a trim that went too far.
    const only = slicesOf(start().project)[0]!;
    const state = run(start(), {
      type: "trimSlice",
      sliceId: only.id,
      edge: "end",
      source: 30 * S,
    });

    expect(slicesOf(state.project)[0]!.source.end).toBe(10 * S);
  });

  it("still lets an edge move anywhere inside the recording", () => {
    // The clamp has to be a ceiling and not a freeze — the same drag one frame
    // short of the end is an ordinary trim.
    const only = slicesOf(start().project)[0]!;
    const state = run(start(), {
      type: "trimSlice",
      sliceId: only.id,
      edge: "end",
      source: 6 * S,
    });

    expect(slicesOf(state.project)[0]!.source.end).toBe(6 * S);
  });

  it("keeps the start edge off the front of the recording", () => {
    // The floor was always here. Asserted alongside the ceiling so a rewrite
    // that introduces one cannot quietly drop the other.
    const only = slicesOf(start().project)[0]!;
    const state = run(start(), {
      type: "trimSlice",
      sliceId: only.id,
      edge: "start",
      source: -5 * S,
    });

    expect(slicesOf(state.project)[0]!.source.start).toBe(0);
  });

  it("will not let a zoom run past the recording either", () => {
    // Zooms were bounded by `sourceEnd` — the furthest any *clip* reached — so
    // while clips could overrun, a zoom could follow them off the end.
    const added = run(start(), { type: "addZoom", at: 2 * S });
    const zoom = added.project.zooms[0]!;
    const state = run(added, {
      type: "trimZoom",
      zoomId: zoom.id,
      edge: "end",
      source: 30 * S,
    });

    expect(state.project.zooms[0]!.source.end).toBeLessThanOrEqual(10 * S);
  });
});

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
      { type: "setSetting", section: "layout", key: "cameraHeight", value: 0.5 },
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
      key: "cameraHeight",
      value: 0.5,
    });

    expect(activeSettings(state).layout.cameraHeight).toBe(0.5);
  });

  it("shows the project defaults when nothing is selected", () => {
    const state = run(
      start(),
      { type: "setSetting", section: "layout", key: "cameraHeight", value: 0.5 },
      { type: "select", sliceId: null },
    );

    expect(activeSettings(state).layout.cameraHeight).toBe(
      state.project.defaults.layout.cameraHeight,
    );
  });
});

describe("settingsOf", () => {
  /** Two clips, the second one given a layout of its own. */
  function cut(): EditorState {
    const state = run(start(), { type: "split", at: 5 * S });
    const second = slicesOf(state.project)[1]!;

    return run(
      state,
      { type: "select", sliceId: second.id },
      { type: "setSetting", section: "layout", key: "preset", value: "beside" },
    );
  }

  it("gives each slice its own layout", () => {
    const state = cut();
    const [first, second] = slicesOf(state.project);

    // The whole point of a per-slice override. This was already true of what
    // was saved and exported; what was broken was the preview asking for it.
    expect(settingsOf(state.project, first!.id).layout.preset).toBe(
      state.project.defaults.layout.preset,
    );
    expect(settingsOf(state.project, second!.id).layout.preset).toBe("beside");
  });

  it("does not follow the selection", () => {
    // The preview follows the playhead and the inspector follows the selection.
    // Resolving the picture from the selection is what made changing one clip
    // appear to change all of them — and it only showed up during playback,
    // where nothing re-resolved at all.
    const state = cut();
    const first = slicesOf(state.project)[0]!;

    expect(state.selectedSliceId).not.toBe(first.id);
    expect(settingsOf(state.project, first.id).layout.preset).toBe(
      state.project.defaults.layout.preset,
    );
  });

  it("keeps a muted clip muted while a zoom is selected", () => {
    // The bug this pins: adding or selecting a zoom clears the clip selection,
    // because the inspector shows one thing at a time. An audio mix that
    // followed the *selection* then fell back to the project defaults, so a clip
    // whose audio had been muted by hand played at full volume for the whole of
    // the zoom preview — while the mute stayed correctly saved and correctly
    // exported, which is what made it look like the mute had not worked.
    const only = slicesOf(start().project)[0]!;
    const state = run(
      start(),
      { type: "select", sliceId: only.id },
      { type: "setSetting", section: "audio", key: "micMuted", value: true },
      { type: "addZoom", at: 2 * S },
    );

    expect(state.selectedZoomId).not.toBeNull();
    expect(state.selectedSliceId).toBeNull();

    // What the mix used to ask, and the answer that caused it.
    expect(activeSettings(state).audio.micMuted).toBe(false);
    // What it asks now: the clip the playhead is in, which is still muted.
    expect(settingsOf(state.project, only.id).audio.micMuted).toBe(true);
  });

  it("falls back to the defaults for a slice that is not there", () => {
    // What the playhead resolves to past the end of the edit, and after an undo
    // has removed the slice it was sitting in.
    const state = cut();

    expect(settingsOf(state.project, null).layout.preset).toBe(
      state.project.defaults.layout.preset,
    );
    expect(settingsOf(state.project, "gone").layout.preset).toBe(
      state.project.defaults.layout.preset,
    );
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

  it("can be stretched to the end of a recording that has been cut", () => {
    // The bug this pins: the strip measures *project* time and zooms are stored
    // in *source* time, so a drag has to be mapped across the cuts. Dragging the
    // end handle to the far right lands on the last pixel of the edit, which
    // belongs to no clip — and a mapping that falls through to the raw project
    // time there returns a source value short by everything that was cut away.
    // The zoom then jumps backwards instead of reaching the end of the take.
    // One 10s take with 4s-6s removed: 8s of edit over 10s of recording.
    const edit = run(start(), { type: "split", at: 4 * S }, { type: "split", at: 6 * S });
    const middle = slicesOf(edit.project)[1]!;
    const trimmed = run(edit, { type: "deleteSlice", sliceId: middle.id });

    const placed = placedSlices(trimmed.project);
    expect(totalDuration(placed)).toBe(8 * S);

    const zoomed = run(trimmed, { type: "addZoom", at: 7 * S });
    const zoom = zoomed.project.zooms[0]!;

    // What the strip does when the pointer is dragged past its right edge.
    const dragged = run(zoomed, {
      type: "trimZoom",
      zoomId: zoom.id,
      edge: "end",
      source: toSourceTime(placed, totalDuration(placed))!,
    });

    expect(dragged.project.zooms[0]!.source.end).toBe(10 * S);
  });

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

describe("undo", () => {
  /** Applies a sequence of actions, as the editor would dispatch them. */
  const run = (state: EditorState, ...actions: EditorAction[]): EditorState =>
    actions.reduce(editorReducer, state);

  it("has nothing to offer on a freshly opened recording", () => {
    // Which is what hides the button: an untouched timeline has no step back.
    expect(canUndo(start())).toBe(false);
    // And asking anyway must be a no-op rather than a crash.
    expect(editorReducer(start(), { type: "undo" }).project).toEqual(start().project);
  });

  it("steps a cut back", () => {
    const before = start();
    const cut = run(before, { type: "split", at: 5 * S });
    expect(slicesOf(cut.project)).toHaveLength(2);
    expect(canUndo(cut)).toBe(true);

    const back = run(cut, { type: "undo" });
    expect(slicesOf(back.project)).toHaveLength(1);
    expect(back.project).toEqual(before.project);
    expect(canUndo(back)).toBe(false);
  });

  it("steps back through several cuts one at a time", () => {
    const state = run(start(), { type: "split", at: 3 * S }, { type: "split", at: 7 * S });
    expect(slicesOf(state.project)).toHaveLength(3);

    const once = run(state, { type: "undo" });
    expect(slicesOf(once.project)).toHaveLength(2);

    const twice = run(once, { type: "undo" });
    expect(slicesOf(twice.project)).toHaveLength(1);
    expect(canUndo(twice)).toBe(false);
  });

  it("collapses one trim drag into a single step", () => {
    // A drag dispatches on every pointer move. Without coalescing this would
    // bank an entry per pixel and undo would crawl back through the drag.
    const before = start();
    const slice = slicesOf(before.project)[0]!;

    let dragged = run(before, { type: "beginEdit" });
    for (let at = 9; at >= 5; at -= 1) {
      dragged = run(dragged, {
        type: "trimSlice",
        sliceId: slice.id,
        edge: "end",
        source: at * S,
      });
    }

    expect(dragged.history).toHaveLength(1);
    expect(run(dragged, { type: "undo" }).project).toEqual(before.project);
  });

  it("keeps two separate drags as two steps", () => {
    // `beginEdit` is the only thing distinguishing them: both produce the same
    // coalesce key, so without it the second would join the first.
    const before = start();
    const slice = slicesOf(before.project)[0]!;
    const trim = (source: number): EditorAction => ({
      type: "trimSlice",
      sliceId: slice.id,
      edge: "end",
      source,
    });

    const state = run(
      before,
      { type: "beginEdit" },
      trim(9 * S),
      { type: "beginEdit" },
      trim(7 * S),
    );

    expect(state.history).toHaveLength(2);
    // One undo returns to where the first drag left it, not all the way back.
    expect(slicesOf(run(state, { type: "undo" }).project)[0]!.source.end).toBe(9 * S);
  });

  it("records nothing for an edit the reducer declined", () => {
    // Cutting on a boundary is refused. An undo step that visibly does nothing
    // is worse than no step at all.
    const state = run(start(), { type: "split", at: 0 });

    expect(state.history).toHaveLength(0);
    expect(canUndo(state)).toBe(false);
  });

  it("ignores selection and appearance, which are not the timeline", () => {
    const state = run(
      start(),
      { type: "select", sliceId: null },
      { type: "setSetting", section: "background", key: "padding", value: 0.2 },
    );

    expect(canUndo(state)).toBe(false);
  });

  it("persists what it restored", () => {
    // The revision is what makes the project reach the disk. Without bumping it,
    // reopening the recording would bring back the undone edit.
    const cut = run(start(), { type: "split", at: 5 * S });
    const back = run(cut, { type: "undo" });

    expect(back.revision).toBeGreaterThan(cut.revision);
  });

  it("drops a selection the undo removed", () => {
    // The second half of a cut only exists in the edit being undone, and the
    // inspector cannot show settings for a slice that is no longer there.
    const cut = run(start(), { type: "split", at: 5 * S });
    const created = slicesOf(cut.project)[1]!;
    const selected = run(cut, { type: "select", sliceId: created.id });

    const back = run(selected, { type: "undo" });

    expect(back.selectedSliceId).toBeNull();
  });

  it("starts over when another recording is opened", () => {
    const cut = run(start(), { type: "split", at: 5 * S });
    const loaded = run(cut, {
      type: "load",
      project: newProject("other", 5 * S),
      duration: 5 * S,
    });

    // Undoing into the previous recording's project would be a different film.
    expect(canUndo(loaded)).toBe(false);
  });
});
