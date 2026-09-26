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

import { DEFAULT_TEXT_LENGTH, MAX_TEXT_TRACKS, newProject } from "../../../shared/project";
import {
  canUndo,
  editorReducer,
  findText,
  initialState,
  laneMoved,
  laneSpanAt,
  laneSpanNear,
  laneTrimmed,
  placedSlices,
  slicesOf,
  textCopySpan,
  textInProject,
  textSpanAt,
  textSpanNear,
  type EditorAction,
  type EditorState,
} from "./state";
import { spanInProject } from "./timeline";

const S = 1_000_000_000;
const RECORDING = "2026-08-11T12-00-00";

function start(): EditorState {
  return initialState(newProject(RECORDING, 10 * S), 10 * S);
}

function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}

/**
 * Each text's span in the finished video, which is the clock they are measured
 * on. On these fixtures nothing has been cut, so it reads the same as the
 * recording's — which is what keeps the numbers below meaning what they did.
 */
const spans = (state: EditorState, track = 0) =>
  (state.project.texts[track]?.slices ?? []).map((text) => {
    const span = textInProject(state.project, text)!;
    return [span.start, span.end];
  });

/** One text's span, by row and index. */
const spanOf = (state: EditorState, track: number, index: number) => {
  const text = state.project.texts[track]!.slices[index]!;
  return textInProject(state.project, text)!;
};

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
    expect(spanOf(after, 1, 0)).toEqual({ start: 0.5 * S, end: 3.5 * S });

    // Too close to the text already there: held back against it, not over it.
    const nudged = run(state, { type: "moveText", textId: lower!, start: 3 * S, track: 1 });
    expect(spanOf(nudged, 1, 0)).toEqual({ start: 2 * S, end: 5 * S });
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
        expect(spanOf(after, 1, index).start).toBeGreaterThanOrEqual(
          spanOf(after, 1, index - 1).end,
        );
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
    expect(spans(after)).toEqual([
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
    expect(spanOf(after, 1, 0)).toEqual({ start: S, end: 4 * S });
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
    // `laneMoved` is the zoom's rule now, and a zoom stays between the two
    // either side of it: `project.zooms` is held sorted and `laneTrimmed`
    // reads its neighbours by index, so one allowed to cross would leave the
    // list out of order behind it.
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

describe("the two clocks a text is measured on", () => {
  /**
   * A recording cut down to fragments, which is the shape the model exists for.
   *
   * Split at 2 s and 4 s, then the middle clip deleted: what is left is 0-2 s
   * and 4-10 s of the recording, playing as 0-8 s of the finished video. A
   * second of project time past the seam is three seconds of source time.
   */
  function cut(): EditorState {
    const state = run(start(), { type: "split", at: 2 * S }, { type: "split", at: 4 * S });
    const middle = slicesOf(state.project)[1]!;
    return run(state, { type: "deleteSlice", sliceId: middle.id });
  }

  it("gives a new text its whole length however short the clip is", () => {
    // The bug this model was built for: a three-second text added onto a
    // two-second clip used to be measured on the recording, so it took the
    // clip's width and the rest of it sat in footage nobody would ever see.
    const state = run(cut(), { type: "addText", track: 0, at: 0.5 * S });
    const text = state.project.texts[0]!.slices[0]!;

    expect(text.length).toBe(DEFAULT_TEXT_LENGTH);
    // And it reads that long on the strip, running straight over the cut at
    // two seconds rather than stopping at it.
    expect(textInProject(state.project, text)).toEqual({ start: 0.5 * S, end: 3.5 * S });
  });

  it("pins a text to the footage under where it was added", () => {
    // Added at 3 s of the finished video, which is 5 s of the recording — the
    // seam at 2 s swallowed two seconds of it.
    const state = run(cut(), { type: "addText", track: 0, at: 3 * S });

    expect(state.project.texts[0]!.slices[0]!.at).toBe(5 * S);
  });

  it("carries a text with its clip when the order changes", () => {
    // The half of this that is about the footage. A title pinned to the second
    // clip travels with it, which is what a callout on a screen recording has
    // to do — and is why the anchor is on the recording's clock at all.
    const state = run(cut(), { type: "addText", track: 0, at: 3 * S });
    const [first, second] = slicesOf(state.project).map((slice) => slice.id);
    const pinnedAt = state.project.texts[0]!.slices[0]!.at;

    const moved = run(state, { type: "moveSlice", sliceId: second!, before: first! });
    const text = moved.project.texts[0]!.slices[0]!;

    // Pinned to the same frame of the recording, and now reached earlier in
    // the edit because the clip it is on plays first.
    expect(text.at).toBe(pinnedAt);
    expect(textInProject(moved.project, text)!.start).toBe(S);
  });

  it("keeps a text's length when the clip it sits on is reordered", () => {
    const state = run(cut(), { type: "addText", track: 0, at: 3 * S });
    const [first, second] = slicesOf(state.project).map((slice) => slice.id);
    const before = state.project.texts[0]!.slices[0]!.length;

    const moved = run(state, { type: "moveSlice", sliceId: second!, before: first! });
    expect(moved.project.texts[0]!.slices[0]!.length).toBe(before);
  });

  it("loses a text whose footage was deleted", () => {
    // The price of pinning, and the same price a zoom pays: delete the footage
    // a title was about and the title has nowhere to be.
    const state = run(cut(), { type: "addText", track: 0, at: 3 * S });
    const text = state.project.texts[0]!.slices[0]!;
    const onIt = slicesOf(state.project)[1]!;

    const gone = run(state, { type: "deleteSlice", sliceId: onIt.id });
    expect(textInProject(gone.project, text)).toBeNull();
  });
});

describe("what the text row offers on a cut edit", () => {
  /** 0-2 s and 4-10 s of the recording, playing as 0-8 s of the film. */
  function cut(): EditorState {
    const state = run(start(), { type: "split", at: 2 * S }, { type: "split", at: 4 * S });
    const middle = slicesOf(state.project)[1]!;
    return run(state, { type: "deleteSlice", sliceId: middle.id });
  }

  it("answers in the clock the strip asks in", () => {
    // Both the outline the row draws and the text a press lays down come from
    // here, so this is where a mix-up between the two clocks shows. Six seconds
    // into the film is eight into the recording, and asking with either number
    // has to give an answer on the film's.
    expect(textSpanAt(cut().project, 0, 6 * S)).toEqual({ start: 6 * S, end: 8 * S });
  });

  it("offers a span over a cut rather than stopping at it", () => {
    // A press just before the seam at two seconds. The text runs its full
    // three, straight over the join — which is the whole point of measuring a
    // length in the finished video.
    expect(textSpanAt(cut().project, 0, 1.5 * S)).toEqual({ start: 1.5 * S, end: 4.5 * S });
  });

  it("shortens what it offers at the very end rather than refusing", () => {
    // A second from the end of an eight-second edit: there is room for one
    // second, and an outline that vanished here would read as the row being
    // dead just where it is most obviously alive.
    expect(textSpanAt(cut().project, 0, 7 * S)).toEqual({ start: 7 * S, end: 8 * S });
  });
});

describe("the clock a ghost is drawn on", () => {
  /**
   * A recording whose first ten seconds have been cut away, so the finished
   * edit's clock and the recording's no longer agree anywhere.
   */
  function trimmed(): EditorState {
    const state = initialState(newProject(RECORDING, 16 * S), 16 * S);
    const split = run(state, { type: "split", at: 10 * S });
    const first = slicesOf(split.project)[0]!;
    return run(split, { type: "deleteSlice", sliceId: first.id });
  }

  it("answers where a text would go on the finished edit, not on the recording", () => {
    // The timeline draws the outline of the text a click would add straight
    // from this span. It used to put it through `spanInProject` first, which
    // reads a span as source time and looks for the clips covering it — so on
    // an edit like this one it found none and hid the outline altogether. That
    // presents as the feature missing rather than as an outline in the wrong
    // place, which is why it survived a look.
    const state = trimmed();
    const span = textSpanAt(state.project, 0, 1 * S)!;
    expect(span).not.toBeNull();
    expect(span.start).toBe(1 * S);

    // The proof that the span is already on the strip's clock: read as source
    // time it names footage this edit does not contain.
    expect(spanInProject(placedSlices(state.project), span)).toBeNull();
  });

  it("answers the same for the copy an option-drag would leave", () => {
    const state = run(trimmed(), { type: "addText", track: 0, at: 0 });
    const text = state.project.texts[0]!.slices[0]!;

    const span = textCopySpan(state.project, text.id, 1 * S, 1)!;
    expect(span).not.toBeNull();
    expect(span.start).toBe(1 * S);
    expect(spanInProject(placedSlices(state.project), span)).toBeNull();
  });
});

describe("reordering a row of texts", () => {
  /** Three texts on one row, with room in front of the first. */
  function row(): EditorState {
    let state = initialState(newProject(RECORDING, 30 * S), 30 * S);
    for (const at of [5 * S, 10 * S, 15 * S]) {
      state = run(state, { type: "addText", track: 0, at });
    }
    return state;
  }

  const starts = (state: EditorState) =>
    state.project.texts[0]!.slices.map((text) => textInProject(state.project, text)!.start);

  it("sets up three texts on the one row", () => {
    expect(starts(row())).toEqual([5 * S, 10 * S, 15 * S]);
    expect(row().project.texts.filter((track) => track.slices.length > 0)).toHaveLength(1);
  });

  it("carries the last one to the front", () => {
    // The bug this is here for: a text could not pass a neighbour along its own
    // row, so the third one dragged towards the front stopped against the
    // second and sprang back to where it started.
    const state = row();
    const last = state.project.texts[0]!.slices.at(-1)!;

    const moved = run(state, { type: "moveText", textId: last.id, start: 0, track: 0 });
    expect(textInProject(moved.project, findText(moved.project, last.id)!)!.start).toBe(0);
    expect(starts(moved)).toEqual([0, 5 * S, 10 * S]);
  });

  it("carries the first one to the back", () => {
    const state = row();
    const first = state.project.texts[0]!.slices[0]!;

    const moved = run(state, { type: "moveText", textId: first.id, start: 26 * S, track: 0 });
    expect(textInProject(moved.project, findText(moved.project, first.id)!)!.start).toBe(26 * S);
    expect(starts(moved)).toEqual([10 * S, 15 * S, 26 * S]);
  });

  it("declines a drop onto another text rather than overlapping it", () => {
    // Free to travel is not free to land on top: a row never holds two texts
    // over one moment, and the bar stops following until there is room again.
    const state = row();
    const last = state.project.texts[0]!.slices.at(-1)!;

    const moved = run(state, { type: "moveText", textId: last.id, start: 11 * S, track: 0 });
    expect(starts(moved)).toEqual([5 * S, 10 * S, 15 * S]);
    expect(canUndo(moved)).toBe(canUndo(state));
  });

  it("leaves every text its own length", () => {
    const state = row();
    const lengths = state.project.texts[0]!.slices.map((text) => text.length);
    const last = state.project.texts[0]!.slices.at(-1)!;

    const moved = run(state, { type: "moveText", textId: last.id, start: 0, track: 0 });
    expect(moved.project.texts[0]!.slices.map((text) => text.length).sort()).toEqual(
      [...lengths].sort(),
    );
  });
});

describe("a row with nothing left to show", () => {
  /** 0-2 s and 4-10 s of the recording, playing as 0-8 s of the film. */
  function cut(): EditorState {
    const state = run(start(), { type: "split", at: 2 * S }, { type: "split", at: 4 * S });
    const middle = slicesOf(state.project)[1]!;
    return run(state, { type: "deleteSlice", sliceId: middle.id });
  }

  /** A row whose one text is pinned to footage the edit no longer plays. */
  function orphaned(): EditorState {
    const state = run(cut(), { type: "addText", track: 0, at: 3 * S });
    const onIt = slicesOf(state.project)[1]!;
    return run(state, { type: "deleteSlice", sliceId: onIt.id });
  }

  it("is dropped when the recording is opened", () => {
    const state = orphaned();
    // Still there while the session is running: undo has to be able to bring
    // the footage — and its title — back.
    expect(state.project.texts).toHaveLength(1);

    // Opened again, it is a row the timeline would draw empty for ever, under
    // the spare row it conjures for itself.
    expect(initialState(state.project, 10 * S).project.texts).toEqual([]);
  });

  it("is kept while anything on it is still on screen", () => {
    const state = run(cut(), { type: "addText", track: 0, at: 3 * S });

    expect(initialState(state.project, 10 * S).project.texts).toHaveLength(1);
  });

  it("leaves a row in the middle alone", () => {
    // Trailing only: a row is where it is because of the rows around it, and
    // closing the gap would move every text above it down a row.
    const first = run(cut(), { type: "addText", track: 0, at: 3 * S });
    const second = run(first, { type: "addText", track: 1, at: 0.5 * S });
    const onIt = slicesOf(second.project)[1]!;
    const gone = run(second, { type: "deleteSlice", sliceId: onIt.id });

    const opened = initialState(gone.project, 10 * S).project.texts;
    expect(opened).toHaveLength(2);
    expect(opened[0]!.slices).toHaveLength(1);
  });
});
