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
  /**
   * How much recording there actually is, in source time.
   *
   * Held because nothing else in reach knows it. A `Project` is a description
   * of an edit and carries no duration — `sanitiseProject` is handed one at
   * load and clamps against it, then forgets it — so a reducer with only the
   * project cannot tell a trim that has run off the end of the media from one
   * that has not. Without this, dragging a clip's end past the last frame
   * produced a slice describing footage that does not exist.
   */
  duration: MediaTime;
  /** Bumped on every change that should be persisted. */
  revision: number;
  /**
   * Projects to step back through, oldest first.
   *
   * Whole projects rather than inverse operations. A cut, a trim and a zoom
   * move all have different inverses, several of them lossy — undoing a delete
   * has to put the slice back *in its place* — and a project is small enough
   * that keeping copies is cheaper than getting five inverses right.
   */
  history: Project[];
  /**
   * What the last undoable edit was, so a drag collapses into one entry.
   *
   * Trimming an edge dispatches on every pointer move: without this a single
   * drag would bank a hundred entries and undo would step back through the
   * drag one pixel at a time. Matching keys reuse the entry already pushed,
   * which holds the project as it was before the drag started.
   */
  coalesce: string | null;
}

export type EditorAction =
  | { type: "load"; project: Project; duration: MediaTime }
  | { type: "select"; sliceId: string | null }
  | { type: "setFrame"; frame: Project["frame"] }
  | { type: "setOutput"; output: Project["output"] }
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
  | { type: "trimZoom"; zoomId: string; edge: "start" | "end"; source: MediaTime }
  | { type: "undo" }
  /**
   * A new drag is starting, so it must not join the previous one's undo entry.
   *
   * Dispatched on pointer-down by anything that then streams edits. Two drags of
   * the same edge produce identical coalesce keys, and without this they would
   * merge into a single undo step.
   */
  | { type: "beginEdit" };

export function initialState(project: Project, duration: MediaTime = 0): EditorState {
  return {
    project,
    selectedSliceId: project.tracks[0]?.slices[0]?.id ?? null,
    selectedZoomId: null,
    // Zero until a recording is opened, which is the honest answer: the
    // placeholder project this starts on describes no media at all. Every trim
    // is clamped against it, and clamping to zero is harmless because there is
    // nothing on the timeline to drag yet.
    duration,
    revision: 0,
    history: [],
    coalesce: null,
  };
}

/**
 * How deep undo goes.
 *
 * A project is a few kilobytes, so this is a bounded cost rather than a tuned
 * one — deep enough to cover a session's worth of cutting, capped so a long
 * afternoon of trimming cannot grow without limit.
 */
const HISTORY_LIMIT = 100;

/**
 * Every edit, with the undo history maintained around the outside.
 *
 * Kept here rather than in each case so that adding an action cannot forget to
 * record it: `undoStep` is the single list of what is undoable, and the cases
 * below stay pure edits that know nothing about history.
 */
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  if (action.type === "undo") {
    const previous = state.history.at(-1);
    if (previous === undefined) return state;

    return {
      ...state,
      project: previous,
      history: state.history.slice(0, -1),
      // A fresh entry for whatever comes next, or the edit after an undo would
      // coalesce into the entry the undo just consumed.
      coalesce: null,
      // Counts as a change: the restored project has to reach the disk, or
      // reopening the recording would bring back what was undone.
      revision: state.revision + 1,
      // A slice or zoom that only existed in the undone edit is no longer there
      // to be selected, and the inspector cannot show settings for it.
      selectedSliceId: selectionSurvives(previous, state.selectedSliceId)
        ? state.selectedSliceId
        : null,
      selectedZoomId: previous.zooms.some((zoom) => zoom.id === state.selectedZoomId)
        ? state.selectedZoomId
        : null,
    };
  }

  if (action.type === "beginEdit") return { ...state, coalesce: null };

  const next = apply(state, action);
  const step = undoStep(action);

  // `revision` is the reducer's own answer to "did anything change" — a declined
  // cut or an overlapping zoom returns the state untouched. Recording those
  // would leave undo steps that visibly do nothing.
  if (step === null || next.revision === state.revision) return next;

  return {
    ...next,
    history:
      step.coalesce !== null && step.coalesce === state.coalesce
        ? state.history
        : [...state.history, state.project].slice(-HISTORY_LIMIT),
    coalesce: step.coalesce,
  };
}

/** Whether a slice id still exists, so a selection can be kept across an undo. */
function selectionSurvives(project: Project, sliceId: string | null): boolean {
  return sliceId !== null && slicesOf(project).some((slice) => slice.id === sliceId);
}

/**
 * Whether an action is undoable, and what collapses a drag of it into one step.
 *
 * Only what changes the shape of the timeline — cuts, trims, and the zooms laid
 * along it. Appearance settings are deliberately absent: they are the
 * inspector's, they stream from sliders at 60 Hz, and an undo button beside the
 * cut tools that stepped back through colour changes would be a different
 * feature wearing the same icon.
 *
 * `coalesce: null` means "always its own step" — one-shot actions, where two in
 * a row are two separate things the user did.
 */
function undoStep(action: EditorAction): { coalesce: string | null } | null {
  switch (action.type) {
    case "split":
    case "deleteSlice":
    case "addZoom":
    case "deleteZoom":
    case "setZooms":
      return { coalesce: null };

    // Dragged, so every one of these arrives as a stream keyed by what is being
    // dragged and which end of it.
    case "trimSlice":
      return { coalesce: `trimSlice:${action.sliceId}:${action.edge}` };
    case "moveZoom":
      return { coalesce: `moveZoom:${action.zoomId}` };
    case "trimZoom":
      return { coalesce: `trimZoom:${action.zoomId}:${action.edge}` };

    default:
      return null;
  }
}

/** Whether there is anything to step back to. */
export function canUndo(state: EditorState): boolean {
  return state.history.length > 0;
}

/**
 * The edits themselves, each one a pure change to the project.
 *
 * Typed without the two history actions so the switch below stays exhaustive:
 * `undo` and `beginEdit` touch only the history and are handled before this is
 * reached, and letting them in here would need two cases that do nothing.
 */
function apply(
  state: EditorState,
  action: Exclude<EditorAction, { type: "undo" } | { type: "beginEdit" }>,
): EditorState {
  switch (action.type) {
    case "load":
      return initialState(action.project, action.duration);

    case "select":
      // Not a change worth persisting, so the revision stays put. Selecting a
      // clip drops the zoom selection: the inspector shows one thing at a time,
      // and leaving both set would make "what am I editing" unanswerable.
      return { ...state, selectedSliceId: action.sliceId, selectedZoomId: null };

    case "selectZoom":
      return { ...state, selectedZoomId: action.zoomId, selectedSliceId: null };

    case "setFrame":
      return edit(state, (project) => ({ ...project, frame: action.frame }));

    // Persisted with the rest of the edit rather than kept in the dialog: a
    // recording exported once as a GIF is nearly always exported as a GIF the
    // next time, and re-picking the format on every open is the sort of small
    // repeated cost nobody reports.
    case "setOutput":
      return edit(state, (project) => ({ ...project, output: action.output }));

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
  // The next zoom, else the last frame of the edit — and never past the media
  // itself. `sourceEnd` is the furthest any *clip* reaches, so before clips
  // were bounded above it inherited their overrun and let a zoom follow them
  // off the end. Kept as the tighter of the two rather than replaced: a zoom
  // over a stretch no clip covers is a zoom that renders nothing.
  const ceiling = Math.min(
    zooms[index + 1]?.source.start ?? sourceEnd(state.project),
    state.duration,
  );

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
 * Where a zoom sits in project time, or null when the stretch it covers was cut.
 *
 * A zoom is stored in source time because that is what survives an edit — cutting
 * a clip earlier in the timeline must not move it — so anything that wants to put
 * the playhead on one has to map it back through the slices first.
 *
 * The end is matched inclusively. Slices are half-open, so a zoom that runs
 * exactly to the end of its clip would otherwise map to nothing, and a zoom
 * ending on a cut is the normal way to zoom out into one.
 */
export function zoomInProject(
  project: Project,
  zoom: ZoomSlice,
): { start: MediaTime; end: MediaTime } | null {
  const placed = placedSlices(project);

  const at = (source: MediaTime): MediaTime | null => {
    const slice = placed.find(
      (candidate) => source >= candidate.source.start && source <= candidate.source.end,
    );
    return slice ? slice.timelineStart + (source - slice.source.start) : null;
  };

  const start = at(zoom.source.start);
  const end = at(zoom.source.end);

  // Either edge landing in a cut means there is no one span to play: the zoom is
  // split across the gap, and picking one half would preview the wrong thing.
  return start === null || end === null ? null : { start, end };
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

  // Both ends of the media, not just the near one. The floor was here from the
  // start and the ceiling was not, so an end handle could be dragged past the
  // last frame — and the slice then claimed footage the file does not contain.
  // Nothing downstream complains: the player runs out and holds the last frame,
  // so it reads as a clip that mysteriously freezes rather than as a bad trim.
  const bounded = clampTo(source, 0, state.duration);
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
