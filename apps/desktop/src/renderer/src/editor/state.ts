/**
 * Every edit the user can make, as one pure reducer.
 *
 * Deliberately free of any React import, so the rules can be tested without a
 * window — the same reason `prequel-session` has no Apple dependencies.
 *
 * State lives in the editor renderer rather than in main, which is the opposite
 * of how the recorder's panel works. That is not an inconsistency: the panel is
 * main-owned because several surfaces render it and must never disagree, and
 * nothing else in the app renders a slice list. Meanwhile dragging a slider is
 * a 60 Hz stream of edits, and an IPC round trip per frame would be both janky
 * and hard on the disk.
 */
import {
  clearSection,
  DEFAULT_ZOOM,
  DEFAULT_ZOOM_LENGTH,
  resolveSettings,
  setOverride,
  type Project,
  type SettingsSection,
  type Slice,
  type SliceSettings,
  type ZoomSlice,
} from "../../../shared/project";
import type { MediaTime } from "../../../shared/manifest";
import { place, totalDuration, type PlacedSlice } from "./timeline";

/** Shortest slice a cut may leave behind. Below this it cannot be grabbed. */
const MIN_SLICE_NS = 100_000_000;

/** Shortest zoom worth having. Below this the ease alone would fill it. */
const MIN_ZOOM_NS = 300_000_000;

export interface EditorState {
  project: Project;
  /** Which slice the inspector is editing, or null for the project defaults. */
  selectedSliceId: string | null;
  /**
   * Which zoom is selected, or null.
   *
   * Separate from the clip selection rather than one field holding either: a
   * zoom is not a clip, and every question the inspector asks about a clip —
   * what does it override, what does it inherit — has no answer for a zoom.
   */
  selectedZoomId: string | null;
  /** Bumped on every change that should be persisted. */
  revision: number;
}

export type EditorAction =
  | { type: "load"; project: Project }
  | { type: "select"; sliceId: string | null }
  | { type: "setFrame"; frame: Project["frame"] }
  | { type: "split"; at: MediaTime }
  | { type: "deleteSlice"; sliceId: string }
  | { type: "trimSlice"; sliceId: string; edge: "start" | "end"; source: MediaTime }
  | {
      type: "setSetting";
      section: SettingsSection;
      key: string;
      value: unknown;
    }
  | { type: "resetSection"; section: SettingsSection }
  | { type: "addZoom"; at: MediaTime }
  | { type: "setZooms"; zooms: ZoomSlice[] }
  | { type: "selectZoom"; zoomId: string | null }
  | { type: "deleteZoom"; zoomId: string }
  | { type: "setZoom"; zoomId: string; patch: Partial<ZoomSlice> }
  | { type: "moveZoom"; zoomId: string; start: MediaTime }
  | { type: "trimZoom"; zoomId: string; edge: "start" | "end"; source: MediaTime };

export function initialState(project: Project): EditorState {
  return {
    project,
    selectedSliceId: project.tracks[0]?.slices[0]?.id ?? null,
    selectedZoomId: null,
    revision: 0,
  };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "load":
      return initialState(action.project);

    case "select":
      // Not a change worth persisting, so the revision stays put. Selecting a
      // clip drops the zoom selection: the inspector shows one thing at a time,
      // and leaving both set would make "what am I editing" unanswerable.
      return { ...state, selectedSliceId: action.sliceId, selectedZoomId: null };

    case "selectZoom":
      return { ...state, selectedZoomId: action.zoomId, selectedSliceId: null };

    case "setFrame":
      return edit(state, (project) => ({ ...project, frame: action.frame }));

    case "split":
      return splitSlices(state, action.at);

    case "deleteSlice":
      return deleteSlice(state, action.sliceId);

    case "trimSlice":
      return trimSlice(state, action);

    case "setSetting":
      return writeSetting(state, action);

    case "resetSection":
      return editSelected(state, (overrides) => clearSection(overrides, action.section));

    case "addZoom":
      return addZoom(state, action.at);

    case "setZooms":
      // Replaces the list wholesale, which only the first cut does. It counts
      // as an edit, so the project is written and the cut is not remade next
      // time the recording is opened.
      return edit(state, (project) => ({ ...project, zooms: action.zooms }));

    case "deleteZoom":
      return {
        ...edit(state, (project) => ({
          ...project,
          zooms: project.zooms.filter((zoom) => zoom.id !== action.zoomId),
        })),
        selectedZoomId: null,
      };

    case "setZoom":
      return edit(state, (project) => ({
        ...project,
        zooms: project.zooms.map((zoom) =>
          zoom.id === action.zoomId ? { ...zoom, ...action.patch } : zoom,
        ),
      }));

    case "moveZoom":
      return moveZoom(state, action);

    case "trimZoom":
      return trimZoom(state, action);
  }
}

/**
 * Drops a zoom on the timeline at `at`.
 *
 * Declines where one already is. Two zooms covering the same moment have no
 * defined answer — which of the two is the picture supposed to be? — so
 * overlapping is made unreachable rather than resolved after the fact.
 *
 * Fitted into the gap when there is not room for a full-length one, and
 * declined outright when the gap is too small to grab afterwards.
 */
function addZoom(state: EditorState, at: MediaTime): EditorState {
  const span = zoomSpanAt(state.project, at);
  if (!span) return state;

  const zoom: ZoomSlice = {
    id: `zoom-${String(state.revision)}-${String(state.project.zooms.length)}`,
    source: span,
    ...DEFAULT_ZOOM,
  };

  return {
    ...edit(state, (project) => ({
      ...project,
      zooms: [...project.zooms, zoom].sort((a, b) => a.source.start - b.source.start),
    })),
    // Selected on the way in, because the whole point of adding one is to say
    // where it should go.
    selectedZoomId: zoom.id,
    selectedSliceId: null,
  };
}

/**
 * The span a zoom dropped at `at` would occupy, or null if none would be.
 *
 * The single rule behind both the action and the ghost the timeline draws under
 * the pointer — the same arrangement `splitPointAt` has, and for the same
 * reason: a preview that promises something the reducer then declines is worse
 * than no preview.
 *
 * Fitted into the gap when there is not room for a full-length zoom, and null
 * where one already is or the gap is too small to grab afterwards.
 */
export function zoomSpanAt(
  project: Project,
  at: MediaTime,
): { start: MediaTime; end: MediaTime } | null {
  const { zooms } = project;
  const duration = sourceEnd(project);

  const start = Math.max(0, Math.min(at, duration));
  if (zooms.some((zoom) => start >= zoom.source.start && start < zoom.source.end)) return null;

  const next = zooms.find((zoom) => zoom.source.start > start);
  const end = Math.min(start + DEFAULT_ZOOM_LENGTH, next?.source.start ?? duration, duration);

  return end - start < MIN_ZOOM_NS ? null : { start, end };
}

/**
 * Slides a whole zoom along the timeline.
 *
 * Its length is preserved and its neighbours are not: a move that would collide
 * stops against them rather than pushing them along or overlapping, so the
 * invariant that no two zooms cover the same moment holds without the caller
 * having to know about it.
 */
function moveZoom(
  state: EditorState,
  action: Extract<EditorAction, { type: "moveZoom" }>,
): EditorState {
  const { zooms } = state.project;
  const index = zooms.findIndex((zoom) => zoom.id === action.zoomId);
  const zoom = zooms[index];
  if (!zoom) return state;

  const length = zoom.source.end - zoom.source.start;
  const floor = zooms[index - 1]?.source.end ?? 0;
  const ceiling = zooms[index + 1]?.source.start ?? sourceEnd(state.project);

  const start = clampTo(action.start, floor, Math.max(floor, ceiling - length));

  return edit(state, (project) => ({
    ...project,
    zooms: project.zooms.map((candidate) =>
      candidate.id === action.zoomId
        ? { ...candidate, source: { start, end: start + length } }
        : candidate,
    ),
  }));
}

/** Moves one edge of a zoom, without letting it cross its neighbours. */
function trimZoom(
  state: EditorState,
  action: Extract<EditorAction, { type: "trimZoom" }>,
): EditorState {
  const { zooms } = state.project;
  const index = zooms.findIndex((zoom) => zoom.id === action.zoomId);
  const zoom = zooms[index];
  if (!zoom) return state;

  const floor = zooms[index - 1]?.source.end ?? 0;
  const ceiling = zooms[index + 1]?.source.start ?? sourceEnd(state.project);

  const source =
    action.edge === "start"
      ? {
          start: clampTo(action.source, floor, zoom.source.end - MIN_ZOOM_NS),
          end: zoom.source.end,
        }
      : {
          start: zoom.source.start,
          end: clampTo(action.source, zoom.source.start + MIN_ZOOM_NS, ceiling),
        };

  if (source.end - source.start < MIN_ZOOM_NS) return state;

  return edit(state, (project) => ({
    ...project,
    zooms: project.zooms.map((candidate) =>
      candidate.id === action.zoomId ? { ...candidate, source } : candidate,
    ),
  }));
}

/** The furthest source time any clip reaches. Zooms live on that timeline. */
function sourceEnd(project: Project): MediaTime {
  return slicesOf(project).reduce((furthest, slice) => Math.max(furthest, slice.source.end), 0);
}

function clampTo(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ── Derived views ───────────────────────────────────────────────────────────

export function slicesOf(project: Project): Slice[] {
  return project.tracks[0]?.slices ?? [];
}

export function placedSlices(project: Project): PlacedSlice[] {
  return place(slicesOf(project));
}

export function projectDuration(project: Project): MediaTime {
  return totalDuration(placedSlices(project));
}

/**
 * The settings the inspector is editing.
 *
 * With a slice selected, its resolved settings; with nothing selected, the
 * project defaults — which is also what a new slice will inherit.
 */
export function activeSettings(state: EditorState): SliceSettings {
  const slice = selectedSlice(state);
  return slice ? resolveSettings(state.project.defaults, slice.overrides) : state.project.defaults;
}

export function selectedSlice(state: EditorState): Slice | undefined {
  return slicesOf(state.project).find((slice) => slice.id === state.selectedSliceId);
}

/**
 * Where a cut at `at` would actually land, or null if it would not happen.
 *
 * The single rule behind both the split action and the line the slice tool
 * draws under the pointer. Shared deliberately: an indicator that promises a
 * cut the reducer then declines is worse than no indicator, and two copies of
 * "is this a legal cut" would drift the first time the minimum changed.
 *
 * Null on a boundary, outside the edit, or anywhere that would leave a slice
 * too short to grab afterwards.
 */
export function splitPointAt(
  project: Project,
  at: MediaTime,
): { slice: PlacedSlice; source: MediaTime } | null {
  const slice = placedSlices(project).find(
    (candidate) =>
      at > candidate.timelineStart && at < candidate.timelineStart + candidate.duration,
  );
  if (!slice) return null;

  const source = slice.source.start + (at - slice.timelineStart);
  if (source - slice.source.start < MIN_SLICE_NS) return null;
  if (slice.source.end - source < MIN_SLICE_NS) return null;

  return { slice, source };
}

// ── Editing ─────────────────────────────────────────────────────────────────

function edit(state: EditorState, change: (project: Project) => Project): EditorState {
  return { ...state, project: change(state.project), revision: state.revision + 1 };
}

function withSlices(project: Project, slices: Slice[]): Project {
  const [track] = project.tracks;
  if (!track) return project;
  return { ...project, tracks: [{ ...track, slices }] };
}

/**
 * Writes a setting where the selection says it belongs.
 *
 * With a slice selected the value becomes an override on that slice — always,
 * even when it equals the default. With nothing selected it edits the project
 * defaults, and every slice that has not overridden the key follows.
 */
function writeSetting(
  state: EditorState,
  action: Extract<EditorAction, { type: "setSetting" }>,
): EditorState {
  if (!state.selectedSliceId) {
    return edit(state, (project) => ({
      ...project,
      defaults: {
        ...project.defaults,
        [action.section]: { ...project.defaults[action.section], [action.key]: action.value },
      },
    }));
  }

  return editSelected(state, (overrides) =>
    setOverride(overrides, action.section, action.key as never, action.value as never),
  );
}

function editSelected(
  state: EditorState,
  change: (overrides: Slice["overrides"]) => Slice["overrides"],
): EditorState {
  if (!state.selectedSliceId) return state;

  return edit(state, (project) =>
    withSlices(
      project,
      slicesOf(project).map((slice) =>
        slice.id === state.selectedSliceId
          ? { ...slice, overrides: change(slice.overrides) }
          : slice,
      ),
    ),
  );
}

/**
 * Cuts the slice under the playhead in two.
 *
 * Declines on a boundary or outside the edit: a zero-length slice cannot be
 * drawn or rendered, and creating one silently would be worse than doing
 * nothing. The new half inherits the original's overrides, so a cut does not
 * quietly change how the second half looks.
 */
function splitSlices(state: EditorState, at: MediaTime): EditorState {
  const point = splitPointAt(state.project, at);
  if (!point) return state;

  const { slice: target, source } = point;
  const created = `${target.id}-${state.revision + 1}`;

  const next = edit(state, (project) =>
    withSlices(
      project,
      slicesOf(project).flatMap((slice) =>
        slice.id === target.id
          ? [
              { ...slice, source: { start: slice.source.start, end: source } },
              {
                id: created,
                source: { start: source, end: slice.source.end },
                // Structurally cloned: sharing the object would make editing
                // one half silently edit the other.
                overrides: structuredClone(slice.overrides),
              },
            ]
          : [slice],
      ),
    ),
  );

  // Selecting the new half is what makes "cut, then change this bit" work
  // without a second click.
  return { ...next, selectedSliceId: created };
}

/**
 * Removes a slice.
 *
 * Refuses to remove the last one: an edit with no slices has nothing to show,
 * nothing to export, and no way back other than undo.
 */
function deleteSlice(state: EditorState, sliceId: string): EditorState {
  const slices = slicesOf(state.project);
  if (slices.length <= 1) return state;

  const index = slices.findIndex((slice) => slice.id === sliceId);
  if (index === -1) return state;

  const next = edit(state, (project) =>
    withSlices(
      project,
      slicesOf(project).filter((slice) => slice.id !== sliceId),
    ),
  );

  // Selection follows to a neighbour rather than emptying, so the inspector
  // does not silently switch to editing the project defaults.
  const remaining = slicesOf(next.project);
  const neighbour = remaining[Math.min(index, remaining.length - 1)];

  return { ...next, selectedSliceId: neighbour?.id ?? null };
}

/**
 * Moves one edge of a slice.
 *
 * Clamped so an edge cannot cross its opposite or leave less than `MIN_SLICE_NS`
 * behind — a slice too short to grab is a slice that can only be fixed by
 * deleting it.
 */
function trimSlice(
  state: EditorState,
  action: Extract<EditorAction, { type: "trimSlice" }>,
): EditorState {
  const slice = slicesOf(state.project).find((candidate) => candidate.id === action.sliceId);
  if (!slice) return state;

  const source =
    action.edge === "start"
      ? Math.min(action.source, slice.source.end - MIN_SLICE_NS)
      : Math.max(action.source, slice.source.start + MIN_SLICE_NS);

  const bounded = Math.max(0, source);
  if (bounded === slice.source[action.edge]) return state;

  return edit(state, (project) =>
    withSlices(
      project,
      slicesOf(project).map((candidate) =>
        candidate.id === action.sliceId
          ? { ...candidate, source: { ...candidate.source, [action.edge]: bounded } }
          : candidate,
      ),
    ),
  );
}

export { MIN_SLICE_NS };
