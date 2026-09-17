/**
 * Texts on their rows.
 *
 * The rules the timeline leans on: a row never holds two texts over one
 * moment, a row exists only because something is on it, adding never conjures
 * more than one row at a time, and every other edit leaves the texts alone.
 * The lane rules are run over zooms and texts alike, because they are one
 * piece of code and the test is what keeps them so.
 */
import { describe, expect, it } from "vitest";

import { MAX_TEXT_TRACKS, newProject } from "../../../shared/project";
import {
  canUndo,
  editorReducer,
  findText,
  initialState,
  laneMoved,
  laneSpanAt,
  laneSpanNear,
  laneTrimmed,
  textCopySpan,
  textSpanNear,
  type EditorAction,
  type EditorState,
} from "./state";

const S = 1_000_000_000;
const RECORDING = "2026-08-11T12-00-00";

function start(): EditorState {
  return initialState(newProject(RECORDING, 10 * S), 10 * S);
}

function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}

const spans = (state: EditorState, track = 0) =>
  (state.project.texts[track]?.slices ?? []).map((text) => [text.source.start, text.source.end]);

describe("adding a text", () => {
  it("lands where it was pressed, on the row it was pressed on, and is selected", () => {
    const state = run(start(), { type: "addText", track: 0, at: 2 * S });
    expect(spans(state)).toEqual([[2 * S, 5 * S]]);
    expect(state.selectedTextId).toBe(state.project.texts[0]!.slices[0]!.id);
    expect(state.selectedSliceId).toBeNull();
  });

  it("takes the span that was drawn out, in either direction", () => {
    const state = run(start(), { type: "addText", track: 0, at: 6 * S, to: 3 * S });
    expect(spans(state)).toEqual([[3 * S, 6 * S]]);
  });

  it("declines to land on another text", () => {
    const one = run(start(), { type: "addText", track: 0, at: 2 * S });
    const two = run(one, { type: "addText", track: 0, at: 3 * S });
    expect(two).toBe(one);
  });

  it("makes the row above when pressed there, and never one further", () => {
    // With no rows the spare row is the first; a press two rows up is a press
    // on nothing.
    const none = run(start(), { type: "addText", track: 1, at: 2 * S });
    expect(none.project.texts).toHaveLength(0);

    const one = run(start(), { type: "addText", track: 0, at: 2 * S });
    const two = run(one, { type: "addText", track: 1, at: 2 * S });
    expect(two.project.texts).toHaveLength(2);

    const three = run(two, { type: "addText", track: 3, at: 2 * S });
    expect(three).toBe(two);
  });

  it("stops at the last row", () => {
    let state = start();
    for (let track = 0; track < MAX_TEXT_TRACKS + 1; track += 1) {
      state = run(state, { type: "addText", track, at: 2 * S });
    }
    expect(state.project.texts).toHaveLength(MAX_TEXT_TRACKS);
  });

  it("starts from the template it was asked for", () => {
    const state = run(start(), { type: "addText", track: 0, at: S, templateId: "lower-third" });
    const text = state.project.texts[0]!.slices[0]!;
    expect(text.templateId).toBe("lower-third");
    expect(text.fields.map((field) => field.role)).toEqual(["heading", "subheading"]);
  });
});

describe("adding a text at the playhead", () => {
  it("uses the first row with room", () => {
    const one = run(start(), { type: "addTextNear", at: 2 * S });
    const two = run(one, { type: "addTextNear", at: 3 * S });
    // The first row is full at 3 s, so the second row takes it — beside the
    // moment, not somewhere else on the first row.
    expect(two.project.texts).toHaveLength(2);
    expect(spans(two, 1)).toEqual([[3 * S, 6 * S]]);
    // Both rows are taken at 3 s now, so the spare row is next.
    expect(textSpanNear(two.project, 3 * S)?.track).toBe(2);
    // Off to one side of both, the first row has room again.
    expect(textSpanNear(two.project, 7 * S)?.track).toBe(0);
  });

  it("lands against the end of the edit when the playhead is past it", () => {
    const state = run(start(), { type: "addTextNear", at: 20 * S });
    expect(spans(state)).toEqual([[7 * S, 10 * S]]);
  });
});

describe("removing a text", () => {
  it("drops the empty rows left above the last text", () => {
    const state = run(
      start(),
      { type: "addText", track: 0, at: S },
      { type: "addText", track: 1, at: S },
    );
    const upper = state.project.texts[1]!.slices[0]!.id;
    const after = run(state, { type: "deleteText", textId: upper });
    expect(after.project.texts).toHaveLength(1);
    expect(after.selectedTextId).toBeNull();
  });

  it("keeps an emptied row that has a row above it", () => {
    const state = run(
      start(),
      { type: "addText", track: 0, at: S },
      { type: "addText", track: 1, at: S },
    );
    const lower = state.project.texts[0]!.slices[0]!.id;
    const after = run(state, { type: "deleteText", textId: lower });
    expect(after.project.texts).toHaveLength(2);
    expect(after.project.texts[0]!.slices).toHaveLength(0);
  });

  it("copies a text into the gap after it, on its own row", () => {
    const state = run(
      start(),
      { type: "addText", track: 0, at: 8 * S },
      { type: "addText", track: 1, at: S },
    );
    const id = state.project.texts[1]!.slices[0]!.id;
    const after = run(state, { type: "duplicateText", textId: id });
    expect(spans(after, 1)).toEqual([
      [S, 4 * S],
      [4 * S, 7 * S],
    ]);
    expect(after.project.texts[0]!.slices).toHaveLength(1);
    expect(after.selectedTextId).not.toBe(id);
  });
});

describe("editing a text", () => {
  const withText = () => {
    const state = run(start(), { type: "addText", track: 0, at: S, templateId: "title-subtitle" });
    return { state, id: state.project.texts[0]!.slices[0]!.id };
  };

  it("changes one field and leaves the other alone", () => {
    const { state, id } = withText();
    const after = run(state, {
      type: "setTextField",
      textId: id,
      index: 1,
      patch: { text: "changed", style: { color: "#ff0000" } },
    });
    const text = findText(after.project, id)!;
    expect(text.fields[1]!.text).toBe("changed");
    expect(text.fields[1]!.style.color).toBe("#ff0000");
    expect(text.fields[1]!.style.weight).toBe(500);
    expect(text.fields[0]).toEqual(findText(state.project, id)!.fields[0]);
  });

  it("sets every field's size together, within what the panel can show", () => {
    const { state, id } = withText();
    const before = findText(state.project, id)!;
    const sizes = before.fields.map((field) => field.style.size * 1.5);
    const after = findText(run(state, { type: "sizeText", textId: id, sizes }).project, id)!;
    after.fields.forEach((field, index) => {
      expect(field.style.size).toBeCloseTo(sizes[index]!);
    });

    const huge = findText(run(state, { type: "sizeText", textId: id, sizes: [9, 9] }).project, id)!;
    expect(huge.fields[0]!.style.size).toBe(0.5);
  });

  it("keeps the words when the template changes", () => {
    const { state, id } = withText();
    const typed = run(state, {
      type: "setTextField",
      textId: id,
      index: 0,
      patch: { text: "Keep me" },
    });
    const after = findText(
      run(typed, { type: "applyTextTemplate", textId: id, templateId: "section" }).project,
      id,
    )!;
    expect(after.templateId).toBe("section");
    expect(after.fields.find((field) => field.role === "heading")!.text).toBe("Keep me");
    expect(after.enter).toBe("blur");
  });

  it("banks typing as one undo step until the edit is begun again", () => {
    const { state, id } = withText();
    const typed = run(
      state,
      { type: "setTextField", textId: id, index: 0, patch: { text: "a" } },
      { type: "setTextField", textId: id, index: 0, patch: { text: "ab" } },
      { type: "setTextField", textId: id, index: 0, patch: { text: "abc" } },
    );
    expect(typed.history.length).toBe(state.history.length + 1);

    const again = run(
      typed,
      { type: "beginEdit" },
      { type: "setTextField", textId: id, index: 0, patch: { text: "abcd" } },
    );
    expect(again.history.length).toBe(typed.history.length + 1);

    // A style change through the same action is a slider, and is not banked.
    const styled = run(again, {
      type: "setTextField",
      textId: id,
      index: 0,
      patch: { style: { size: 0.1 } },
    });
    expect(styled.history.length).toBe(again.history.length);
  });

  it("drops the selection when an undo removes the text", () => {
    const { state, id } = withText();
    expect(state.selectedTextId).toBe(id);
    expect(canUndo(state)).toBe(true);
    const undone = run(state, { type: "undo" });
    expect(undone.project.texts).toHaveLength(0);
    expect(undone.selectedTextId).toBeNull();
  });
});

describe("moving a text between rows", () => {
  const two = () =>
    run(start(), { type: "addText", track: 0, at: S }, { type: "addText", track: 1, at: 5 * S });
  const ids = (state: EditorState) =>
    state.project.texts.map((track) => track.slices.map((text) => text.id));

  it("lands on the row it was dragged to, at the moment it was dropped", () => {
    const state = two();
    const [[lower], [upper]] = ids(state) as [string[], string[]];
    const after = run(state, { type: "moveText", textId: lower!, start: 0.5 * S, track: 1 });
    expect(ids(after)).toEqual([[], [lower, upper]]);
    expect(after.project.texts[1]!.slices[0]!.source).toEqual({ start: 0.5 * S, end: 3.5 * S });

    // Too close to the text already there: held back against it, not over it.
    const nudged = run(state, { type: "moveText", textId: lower!, start: 3 * S, track: 1 });
    expect(nudged.project.texts[1]!.slices[0]!.source).toEqual({ start: 2 * S, end: 5 * S });
  });

  it("makes the spare row real, and never a row past it", () => {
    const state = two();
    const [[lower]] = ids(state) as [string[]];
    const up = run(state, { type: "moveText", textId: lower!, start: S, track: 2 });
    expect(up.project.texts).toHaveLength(3);
    expect(ids(up)[2]).toEqual([lower]);

    const far = run(state, { type: "moveText", textId: lower!, start: S, track: 3 });
    expect(far).toBe(state);
  });

  it("declines a drop onto a text already there, and stays put", () => {
    const state = two();
    const [[lower]] = ids(state) as [string[]];
    const after = run(state, { type: "moveText", textId: lower!, start: 6 * S, track: 1 });
    expect(after).toBe(state);
  });

  it("keeps an emptied row until the drag ends, then drops it", () => {
    const state = two();
    const [, [upper]] = ids(state) as [string[], string[]];
    const down = run(state, { type: "moveText", textId: upper!, start: 5 * S, track: 0 });
    // Still two rows mid-drag: pruning now would move the rows under the
    // pointer and the bar would hop back up on the next move.
    expect(down.project.texts).toHaveLength(2);
    expect(ids(down)[0]).toHaveLength(2);

    const dropped = run(down, { type: "tidyTexts" });
    expect(dropped.project.texts).toHaveLength(1);
    expect(run(dropped, { type: "tidyTexts" })).toBe(dropped);
  });

  it("never lets two texts on the target row cover one moment, wherever it is dropped", () => {
    const state = two();
    const [[lower]] = ids(state) as [string[]];
    for (let at = 0; at <= 10 * S; at += S / 4) {
      const after = run(state, { type: "moveText", textId: lower!, start: at, track: 1 });
      const row = after.project.texts[1]!.slices;
      for (let index = 1; index < row.length; index += 1) {
        expect(row[index]!.source.start).toBeGreaterThanOrEqual(row[index - 1]!.source.end);
      }
    }
  });
});

describe("copying a text by dragging", () => {
  const one = () => run(start(), { type: "addText", track: 0, at: S });
  const id = (state: EditorState) => state.project.texts[0]!.slices[0]!.id;

  it("lands a copy where it was let go, on the row it was let go on", () => {
    const state = one();
    const after = run(state, { type: "copyText", textId: id(state), start: 6 * S, track: 0 });
    expect(
      after.project.texts[0]!.slices.map((text) => [text.source.start, text.source.end]),
    ).toEqual([
      [S, 4 * S],
      [6 * S, 9 * S],
    ]);
    // The copy is its own text, selected, with its own fields.
    const [original, copy] = after.project.texts[0]!.slices;
    expect(copy!.id).not.toBe(original!.id);
    expect(after.selectedTextId).toBe(copy!.id);
    expect(copy!.fields).toEqual(original!.fields);
    expect(copy!.fields[0]).not.toBe(original!.fields[0]);
  });

  it("can land on the spare row, over the original", () => {
    const state = one();
    const after = run(state, { type: "copyText", textId: id(state), start: S, track: 1 });
    expect(after.project.texts).toHaveLength(2);
    expect(after.project.texts[1]!.slices[0]!.source).toEqual({ start: S, end: 4 * S });
  });

  it("is declined where the ghost would have been declined", () => {
    const state = one();
    expect(textCopySpan(state.project, id(state), 2 * S, 0)).toBeNull();
    expect(run(state, { type: "copyText", textId: id(state), start: 2 * S, track: 0 })).toBe(state);
    expect(run(state, { type: "copyText", textId: id(state), start: 2 * S, track: 2 })).toBe(state);
  });

  it("is one undo step", () => {
    const state = one();
    const after = run(state, { type: "copyText", textId: id(state), start: 6 * S, track: 0 });
    expect(run(after, { type: "undo" }).project.texts[0]!.slices).toHaveLength(1);
  });
});

describe("selection", () => {
  it("shows one thing at a time", () => {
    const state = run(start(), { type: "addText", track: 0, at: S });
    const zoomed = run(state, { type: "addZoom", at: S });
    expect(zoomed.selectedTextId).toBeNull();
    expect(zoomed.selectedZoomId).not.toBeNull();

    const back = run(zoomed, { type: "selectText", textId: state.selectedTextId });
    expect(back.selectedZoomId).toBeNull();
    expect(back.selectedSliceId).toBeNull();
  });
});

describe("every other edit", () => {
  it("leaves the texts as they were", () => {
    const state = run(start(), { type: "addText", track: 0, at: S });
    const { texts } = state.project;
    const after = run(
      state,
      { type: "split", at: 4 * S },
      { type: "addZoom", at: 6 * S },
      { type: "setFrame", frame: { width: 1080, height: 1920, presetId: null } },
      { type: "applyToAll", section: "layout" },
      { type: "deleteRange", source: { start: 7 * S, end: 8 * S } },
    );
    expect(after.project.texts).toBe(texts);
  });
});

describe("lanes", () => {
  const lane = [
    { id: "a", source: { start: S, end: 3 * S } },
    { id: "b", source: { start: 5 * S, end: 6 * S } },
  ];
  const D = 10 * S;
  const MIN = 0.3 * S;
  const LEN = 2 * S;

  const overlaps = (span: { start: number; end: number }, except?: string) =>
    lane.some(
      (entry) =>
        entry.id !== except && span.start < entry.source.end && span.end > entry.source.start,
    );

  it("never hands back a span that touches a neighbour, wherever it is pressed", () => {
    for (let at = 0; at <= D; at += S / 10) {
      for (let to = 0; to <= D; to += S / 2) {
        const span = laneSpanAt(lane, D, MIN, LEN, at, to);
        if (!span) continue;
        expect(span.end - span.start).toBeGreaterThanOrEqual(MIN);
        expect(overlaps(span)).toBe(false);
        expect(span.start).toBeGreaterThanOrEqual(0);
        expect(span.end).toBeLessThanOrEqual(D);
      }
      const clicked = laneSpanAt(lane, D, MIN, LEN, at);
      if (clicked) expect(overlaps(clicked)).toBe(false);
    }
  });

  it("finds the nearest gap that fits from anywhere", () => {
    for (let at = 0; at <= D; at += S / 10) {
      const span = laneSpanNear(lane, D, MIN, LEN, at)!;
      expect(span).not.toBeNull();
      expect(overlaps(span)).toBe(false);
    }
    // Over the first entry: the gap after it is nearer its end than the one
    // before is to its start, from the middle rightwards.
    expect(laneSpanNear(lane, D, MIN, LEN, 2.5 * S)).toEqual({ start: 3 * S, end: 5 * S });
  });

  it("moves without changing length or crossing a neighbour", () => {
    for (let to = -S; to <= D + S; to += S / 10) {
      const moved = laneMoved(lane, "a", to, D)!;
      expect(moved.end - moved.start).toBe(2 * S);
      expect(overlaps(moved, "a")).toBe(false);
      expect(moved.start).toBeGreaterThanOrEqual(0);
    }
  });

  it("trims without crossing a neighbour or the far edge", () => {
    for (let to = -S; to <= D + S; to += S / 10) {
      for (const edge of ["start", "end"] as const) {
        const trimmed = laneTrimmed(lane, "b", edge, to, D, MIN)!;
        expect(trimmed.end - trimmed.start).toBeGreaterThanOrEqual(MIN);
        expect(overlaps(trimmed, "b")).toBe(false);
        expect(trimmed.end).toBeLessThanOrEqual(D);
      }
    }
  });
});
