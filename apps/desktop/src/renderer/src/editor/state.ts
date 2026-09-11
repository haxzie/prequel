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
  clearOverride,
  clearSection,
  DEFAULT_ZOOM,
  DEFAULT_ZOOM_LENGTH,
  resolveSettings,
  setOverride,
  type LayoutPreset,
  type Project,
  type SettingsSection,
  type Slice,
  type SliceSettings,
  type ZoomSlice,
} from "../../../shared/project";
import type { ScenePreset } from "../../../shared/scene-presets";
import type { MediaTime } from "../../../shared/manifest";
import type { TranscriptWord } from "../../../shared/transcript";
import { presetFitsFrame } from "../../../shared/layout";
import { place, toSourceTime, totalDuration, type PlacedSlice } from "./timeline";

/** Shortest slice a cut may leave behind. Below this it cannot be grabbed. */
const MIN_SLICE_NS = 100_000_000;

/**
 * Shortest zoom worth having.
 *
 * The moves in and out live outside the slice, so this is no longer the ease
 * needing room — it is how briefly the picture can sit in close and still read
 * as having gone somewhere rather than as a twitch.
 */
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
  /**
   * Takes a stretch of the recording out of the edit, wherever it lies.
   *
   * In source time rather than project time, because it comes from the
   * captions editor and a word knows only when it was said. The stretch may
   * cross a cut that already exists, so this is not "split twice and delete
   * the middle": every clip loses whatever part of it the stretch covers.
   */
  | { type: "deleteRange"; source: { start: MediaTime; end: MediaTime } }
  | { type: "trimSlice"; sliceId: string; edge: "start" | "end"; source: MediaTime }
  /** The words as corrected, or null to go back to the generated transcript. */
  | { type: "setTranscript"; words: TranscriptWord[] | null }
  | {
      type: "setSetting";
      section: SettingsSection;
      key: string;
      value: unknown;
    }
  /**
   * Applies a saved look.
   *
   * One action rather than a burst of `setSetting`s, because a burst would be
   * three revisions, three debounced saves and — worse — a window in which the
   * frame is the preset's and the layout is still the old one. A partial look
   * is a state nobody asked for and cannot name.
   */
  | { type: "applyPreset"; preset: ScenePreset }
  /**
   * Gives every clip the selected one's settings for a section.
   *
   * `keys` narrows it the way `resetSection`'s does, and for the same reason:
   * `background` is shown across two panels, and a button in one of them must
   * not carry the other's half.
   */
  | { type: "applyToAll"; section: SettingsSection; keys?: string[] }
  | {
      type: "resetSection";
      section: SettingsSection;
      /**
       * Only these keys, for a section shown across more than one panel.
       *
       * `background` holds both the paint and the frame around the picture, and
       * they sit under separate headers with a Reset each. Without this, the
       * Frame header's Reset would put back the background image too, which
       * reads as the button having done something else entirely.
       */
      keys?: string[];
    }
  /**
   * Lays a zoom on the timeline. `to` is where a drag that drew it out ended.
   *
   * Two source times rather than a length, because the press and the release
   * are what the strip actually knows and either may be the earlier of the two
   * — a zoom drawn leftwards is the same zoom.
   */
  | { type: "addZoom"; at: MediaTime; to?: MediaTime }
  /**
   * Lays a zoom at `at`, or in the nearest gap that will hold one when a zoom
   * is already there. The transport's Add Zoom button, which has a playhead
   * rather than a pointer: a click on the row over an existing zoom selects
   * it, but a button that does nothing has no such excuse.
   *
   * `at` is *project* time, like `split`'s and unlike `addZoom`'s: both come
   * from the playhead, and the strip is the only caller that already thinks
   * in source time.
   */
  | { type: "addZoomNear"; at: MediaTime }
  | { type: "setZooms"; zooms: ZoomSlice[] }
  | { type: "selectZoom"; zoomId: string | null }
  | { type: "deleteZoom"; zoomId: string }
  /** Copies a zoom's look onto a fresh span, in the first gap after it. */
  | { type: "duplicateZoom"; zoomId: string }
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
 * along it — and the words of the captions. Appearance settings are
 * deliberately absent: they are the inspector's, they stream from sliders at
 * 60 Hz, and an undo button beside the cut tools that stepped back through
 * colour changes would be a different feature wearing the same icon.
 *
 * The words are the exception because deleting a caption *is* a cut, and the
 * two interleave: retype a word, delete a sentence, retype another. A separate
 * undo for the text would step those back in the wrong order, putting words
 * back into footage that is still cut or the other way round.
 *
 * `coalesce: null` means "always its own step" — one-shot actions, where two in
 * a row are two separate things the user did.
 */
function undoStep(action: EditorAction): { coalesce: string | null } | null {
  switch (action.type) {
    case "split":
    case "deleteSlice":
    case "deleteRange":
    case "addZoom":
    case "addZoomNear":
    case "deleteZoom":
    case "duplicateZoom":
    case "setZooms":
      return { coalesce: null };

    // The two appearance changes that are undoable, which is a deliberate
    // widening of the rule above rather than an oversight.
    //
    // What that rule is about is *streams*: a slider dragged at 60 Hz would bury
    // the history under a hundred steps nobody made. Neither of these is a
    // stream. Applying a preset is one click that rewrites three sections, the
    // frame and the zoom defaults at once, and it is the largest single change
    // the editor can make — exactly the thing somebody wants back. And once
    // undoing a preset restores a frame, a frame changed by hand that could not
    // be undone would be an inconsistency people trip over; `framed()` is lossy
    // as well, so an arrangement it drops has nothing else to put it back.
    case "applyPreset":
    case "applyToAll":
    case "setFrame":
      return { coalesce: null };

    // Dragged, so every one of these arrives as a stream keyed by what is being
    // dragged and which end of it.
    case "trimSlice":
      return { coalesce: `trimSlice:${action.sliceId}:${action.edge}` };
    case "moveZoom":
      return { coalesce: `moveZoom:${action.zoomId}` };
    case "trimZoom":
      return { coalesce: `trimZoom:${action.zoomId}:${action.edge}` };
    // Typed, which is a stream too: one keystroke per action, and a burst of
    // them is one thing the user did. The editor sends `beginEdit` when the
    // typing pauses, so a correction made a while later is its own step.
    case "setTranscript":
      return { coalesce: "transcript" };

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
      return edit(state, (project) => framed({ ...project, frame: action.frame }));

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

    case "deleteRange":
      return deleteRange(state, action.source);

    case "trimSlice":
      return trimSlice(state, action);

    case "setTranscript":
      // Clearing what is already clear is not an edit: it would bank an undo
      // step that steps back to the same thing.
      if (action.words === null && state.project.transcript === null) return state;
      return edit(state, (project) => ({
        ...project,
        transcript: action.words === null ? null : { words: action.words },
      }));

    case "setSetting":
      return writeSetting(state, action);

    case "applyPreset":
      return applyPreset(state, action.preset);

    case "applyToAll":
      return applyToAll(state, action.section, action.keys);

    case "duplicateZoom":
      return duplicateZoom(state, action.zoomId);

    case "resetSection":
      return editSelected(state, (overrides) =>
        action.keys
          ? action.keys.reduce(
              (next, key) => clearOverride(next, action.section, key as never),
              overrides,
            )
          : clearSection(overrides, action.section),
      );

    case "addZoom":
      return addZoom(state, zoomSpanAt(state.project, action.at, action.to));

    case "addZoomNear": {
      const source = toSourceTime(placedSlices(state.project), action.at);
      return source === null ? state : addZoom(state, zoomSpanNear(state.project, source));
    }

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
 * Drops a zoom on the timeline over `span`, or declines when there is none.
 *
 * The span is decided by `zoomSpanAt` or `zoomSpanNear` before this is
 * reached, so that the two ways in share one rule about where a zoom may go.
 * Both decline where one already is: two zooms covering the same moment have
 * no defined answer — which of the two is the picture supposed to be? — so
 * overlapping is made unreachable rather than resolved after the fact. Both
 * fit into the gap when there is not room for a full-length one, and answer
 * null when the gap is too small to grab afterwards.
 */
function addZoom(
  state: EditorState,
  span: { start: MediaTime; end: MediaTime } | null,
): EditorState {
  if (!span) return state;

  const zoom: ZoomSlice = {
    id: `zoom-${String(state.revision)}-${String(state.project.zooms.length)}`,
    source: span,
    // `DEFAULT_ZOOM` under the project's own, in that order, so the constant
    // stays the floor: it carries `target`, `x` and `y`, which `zoomDefaults`
    // deliberately does not, and a key missing from the project's cannot arrive
    // here as undefined.
    ...DEFAULT_ZOOM,
    ...state.project.zoomDefaults,
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
 * The span a zoom pressed at `at` would occupy, or null if none would be.
 *
 * The single rule behind the action, the ghost the timeline draws under the
 * pointer, and the outline it draws while one is being dragged out — the same
 * arrangement `splitPointAt` has, and for the same reason: a preview that
 * promises something the reducer then declines is worse than no preview.
 *
 * `to` is where a drag ended. Without it the zoom takes its default length
 * forwards from the press, which is what a click asks for. With it the span is
 * whatever was drawn out, in either direction — the press is one edge and the
 * release is the other, and which of them is the start falls out of the two
 * rather than out of a rule about dragging rightwards.
 *
 * Held inside the gap the press landed in, at both ends. Clamping only the far
 * end was enough while the length was fixed and grew forwards; a drag can run
 * back over the zoom behind it, and clamping the near end is what keeps
 * "no two zooms cover the same moment" true without asking the caller.
 *
 * Null where a zoom already is, or where what is left is too small to grab
 * afterwards.
 */
export function zoomSpanAt(
  project: Project,
  at: MediaTime,
  to?: MediaTime,
): { start: MediaTime; end: MediaTime } | null {
  const { zooms } = project;
  const duration = sourceEnd(project);

  const from = Math.max(0, Math.min(at, duration));
  if (zooms.some((zoom) => from >= zoom.source.start && from < zoom.source.end)) return null;

  // The gap the press landed in. `from` is inside it, so these two bound the
  // whole of what may be drawn without touching a neighbour.
  const floor = zooms.reduce((edge, zoom) => (zoom.source.end <= from ? zoom.source.end : edge), 0);
  const ceiling = zooms.find((zoom) => zoom.source.start > from)?.source.start ?? duration;

  const drawn = to === undefined ? from + DEFAULT_ZOOM_LENGTH : Math.max(0, Math.min(to, duration));
  const start = Math.max(floor, Math.min(from, drawn));
  const end = Math.min(ceiling, Math.max(from, drawn));

  return end - start < MIN_ZOOM_NS ? null : { start, end };
}

/**
 * The span a zoom added at the playhead would occupy, or null if none would.
 *
 * `zoomSpanAt` answers for a pointer, which is always somewhere a zoom may or
 * may not go and can move if it may not. A playhead cannot: it stops wherever
 * playback was paused, and that is over an existing zoom as often as not. So
 * where `zoomSpanAt` declines, this looks sideways for the nearest gap that
 * will hold one — the closest empty stretch beside whatever is in the way —
 * and lays the zoom hard against the near end of it, so it sits next to the
 * moment asked for rather than somewhere in the middle of the gap.
 *
 * Every gap is a candidate, not just the two beside the playhead: a run of
 * back-to-back zooms, or a gap between them too small to grab, is skipped
 * over rather than stopping the search. The one chosen is the nearest, and on
 * a tie the later one — playback runs forwards, so that is the one about to
 * be seen.
 *
 * Null only when no gap anywhere is big enough, which is also the answer to
 * "can a zoom be added at all" — the same call from any `at` says so.
 */
export function zoomSpanNear(
  project: Project,
  at: MediaTime,
): { start: MediaTime; end: MediaTime } | null {
  const { zooms } = project;
  const duration = sourceEnd(project);

  // The empty stretches, in order: before the first zoom, between each pair,
  // and after the last. Zooms are kept sorted by start, so consecutive pairs
  // are neighbours.
  const edges = [0, ...zooms.flatMap((zoom) => [zoom.source.start, zoom.source.end]), duration];

  let best: { span: { start: MediaTime; end: MediaTime }; distance: MediaTime } | null = null;
  for (let index = 0; index < edges.length; index += 2) {
    const floor = edges[index]!;
    const ceiling = edges[index + 1]!;
    if (ceiling - floor < MIN_ZOOM_NS) continue;

    // The point in this gap closest to the playhead — the playhead itself when
    // it is inside. Forwards from there when there is room, the way a click
    // grows; otherwise backwards from the gap's far end, so the zoom still
    // finishes hard against whatever stopped it growing.
    const anchor = Math.max(floor, Math.min(at, ceiling));
    const span =
      ceiling - anchor >= MIN_ZOOM_NS
        ? zoomSpanAt(project, anchor)
        : zoomSpanAt(project, Math.max(floor, ceiling - DEFAULT_ZOOM_LENGTH), ceiling);
    if (!span) continue;

    const distance = Math.abs(at - anchor);
    if (best === null || distance <= best.distance) best = { span, distance };
  }

  return best?.span ?? null;
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
 * The settings a given slice renders with.
 *
 * The preview follows the playhead and the inspector follows the selection, so
 * the two ask this the same question about different slices. Separate from
 * `activeSettings` for exactly that reason: tying the picture to the selection
 * is what made changing one clip's layout appear to change every clip's.
 *
 * An id that names no slice resolves to the defaults, which is what a project
 * with nothing under the playhead should draw.
 */
export function settingsOf(project: Project, sliceId: string | null): SliceSettings {
  const slice = slicesOf(project).find((candidate) => candidate.id === sliceId);
  return resolveSettings(project.defaults, slice?.overrides);
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

/**
 * The project with any arrangement the frame cannot hold moved out of it.
 *
 * Only `over-column` is ever moved, and only into a frame that is not wider
 * than it is tall. The picker is what stops it being *picked* there; this is
 * the other way in — a recording arranged in 16:9 and then switched to 9:16
 * would otherwise sit in an arrangement whose cell is greyed out, which is a
 * state nothing on screen explains and only picking something else undoes.
 *
 * It lands in `over-padded`, which is the column with the standing camera taken
 * out of it: the recording keeps the size and the padding it already had, and
 * the camera falls back to the bubble. The same landing `detached` gives it
 * when the column is picked up in the preview.
 *
 * Slice overrides are walked as well as the defaults. A preset overridden on
 * one clip is exactly as unreachable as one in the defaults, and leaving it
 * would put a frame's worth of column back on screen at that cut.
 */
function framed(project: Project): Project {
  const fits = (preset: LayoutPreset) => presetFitsFrame(preset, project.frame);
  // Nothing to walk in a frame every arrangement fits, which is every landscape
  // one — and so is every frame the editor opens on unless someone changed it.
  if (fits("over-column")) return project;

  const kept = (preset: LayoutPreset): LayoutPreset => (fits(preset) ? preset : "over-padded");

  return {
    ...project,
    defaults: {
      ...project.defaults,
      layout: { ...project.defaults.layout, preset: kept(project.defaults.layout.preset) },
    },
    tracks: project.tracks.map((track) => ({
      ...track,
      slices: track.slices.map((slice) => {
        const preset = slice.overrides.layout?.preset;
        if (preset === undefined || fits(preset)) return slice;

        return {
          ...slice,
          overrides: {
            ...slice.overrides,
            layout: { ...slice.overrides.layout, preset: kept(preset) },
          },
        };
      }),
    })),
  };
}

function withSlices(project: Project, slices: Slice[]): Project {
  const [track] = project.tracks;
  if (!track) return project;
  return { ...project, tracks: [{ ...track, slices }] };
}

/**
 * Lays a saved look over the project.
 *
 * Honestly described: **a project-level action that also writes slice-level
 * settings**. The three sections go where a slider's value would go — on the
 * selected clip, or on the project defaults when nothing is selected, which is
 * `writeSetting`'s rule unchanged so "where did it go?" has one answer for
 * every control in the editor. The frame and the zoom defaults have nowhere
 * else to live and go on the project either way. A reader who believes the
 * shorter version of that sentence will eventually "fix" the frame write.
 *
 * Every key of every section is written, including the ones that already equal
 * what is there. That is `setOverride`'s doctrine — "always records it, even
 * when the value equals the default" — and it matters twice as much here: a
 * preset is a decision about the whole look, and a later change to the project
 * defaults must not move a clip somebody has already decided about.
 *
 * One key at a time rather than one section at a time, which is the detail that
 * compiles and draws correctly either way. `key in overrides[section]` is how
 * the panel answers "is this overridden?", so a section assigned whole would
 * still light every dot — but the per-control Reset beside each one would clear
 * its neighbours too. The drag that writes five layout keys carries the same
 * note in `Editor.tsx`.
 *
 * `framed()` last, and not optional: `presetFitsFrame` refuses `over-column` in
 * a frame that is not wider than it is tall, so a look authored in 16:9 and
 * applied into a portrait frame would otherwise leave the clip in an
 * arrangement whose picker cell is greyed out — a state nothing on screen
 * explains. It mostly self-heals, because a preset usually brings its own
 * landscape frame; that is what makes leaving it out dangerous rather than
 * obvious.
 */
function applyPreset(state: EditorState, preset: ScenePreset): EditorState {
  const sections = {
    layout: preset.layout,
    background: preset.background,
    watermark: preset.watermark,
    captions: preset.captions,
  } as const;

  return edit(state, (project) => {
    const withFrame: Project = {
      ...project,
      frame: preset.frame,
      zoomDefaults: preset.zoom,
    };

    if (!state.selectedSliceId) {
      return framed({
        ...withFrame,
        defaults: {
          ...project.defaults,
          layout: { ...preset.layout },
          background: { ...preset.background },
          watermark: { ...preset.watermark },
          // `captionsOn` is the recording's answer, not the preset's, so it is
          // taken from what is already there rather than carried.
          captions: { ...preset.captions, captionsOn: project.defaults.captions.captionsOn },
        },
      });
    }

    return framed(
      withSlices(
        withFrame,
        slicesOf(withFrame).map((slice) =>
          slice.id === state.selectedSliceId
            ? { ...slice, overrides: withPreset(slice.overrides, sections) }
            : slice,
        ),
      ),
    );
  });
}

/**
 * Copies a zoom, span and all, into the first gap that will hold it.
 *
 * Placed after the original rather than on top of it, because two zooms may
 * never overlap — `sanitiseZooms` drops the second of any pair that does, so a
 * copy laid over its source would vanish the next time the project was read
 * back. `zoomSpanAt` is what knows where a span may legally go, and it is the
 * same function the timeline asks when a zoom is drawn by hand.
 *
 * The copy keeps the original's length where there is room and takes whatever
 * the gap allows where there is not. Declined outright when the gap is too
 * small to grab afterwards — `zoomSpanAt` answers null — because a zoom nobody
 * can select is worse than no zoom.
 */
function duplicateZoom(state: EditorState, zoomId: string): EditorState {
  const source = state.project.zooms.find((zoom) => zoom.id === zoomId);
  if (!source) return state;

  const length = source.source.end - source.source.start;
  const span = zoomSpanAt(state.project, source.source.end, source.source.end + length);
  if (!span) return state;

  const copy: ZoomSlice = {
    ...source,
    id: `zoom-${String(state.revision)}-${String(state.project.zooms.length)}`,
    source: span,
  };

  return {
    ...edit(state, (project) => ({
      ...project,
      zooms: [...project.zooms, copy].sort((a, b) => a.source.start - b.source.start),
    })),
    // Selected on the way in, the way a freshly dropped one is: the point of
    // copying it is to put the copy somewhere.
    selectedZoomId: copy.id,
    selectedSliceId: null,
  };
}

/**
 * Spreads the selected clip's look across every clip.
 *
 * The *resolved* values, not the overrides: a clip that inherits a setting from
 * the project defaults still looks a particular way, and "make the others match
 * this one" is a statement about what is on screen rather than about which keys
 * happen to be set. Copying the overrides would leave every other clip on the
 * defaults and appear to do nothing.
 *
 * Written onto every clip including the one it came from — which is a no-op
 * there, and cheaper than a branch that has to stay right.
 *
 * One key at a time, for the reason `withPreset` above does it: `key in
 * overrides[section]` is how the panel answers "is this overridden?", so a
 * section assigned whole would light every dot and then have its per-control
 * Reset clear the neighbours.
 *
 * Does nothing with no clip selected. There is no "this one" to copy, and the
 * panel is editing the defaults every clip already follows.
 */
function applyToAll(state: EditorState, section: SettingsSection, keys?: string[]): EditorState {
  if (!state.selectedSliceId) return state;

  const source = selectedSlice(state);
  if (!source) return state;

  const settings = resolveSettings(state.project.defaults, source.overrides)[section];
  const wanted = keys ?? Object.keys(settings);

  return edit(state, (project) =>
    withSlices(
      project,
      slicesOf(project).map((slice) => {
        let overrides = slice.overrides;
        for (const key of wanted) {
          overrides = setOverride(
            overrides,
            section,
            key as never,
            (settings as unknown as Record<string, unknown>)[key] as never,
          );
        }
        return { ...slice, overrides };
      }),
    ),
  );
}

/** Every leaf of every section the preset carries, recorded one key at a time. */
function withPreset(
  overrides: Slice["overrides"],
  sections: {
    layout: ScenePreset["layout"];
    background: ScenePreset["background"];
    watermark: ScenePreset["watermark"];
    captions: ScenePreset["captions"];
  },
): Slice["overrides"] {
  let next = overrides;

  for (const [section, values] of Object.entries(sections)) {
    for (const [key, value] of Object.entries(values)) {
      next = setOverride(next, section as SettingsSection, key as never, value as never);
    }
  }

  return next;
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
 * Takes a stretch of source time out of every slice it touches.
 *
 * A slice the stretch runs through the middle of is cut in two; one it
 * overlaps at an end is trimmed; one it covers is removed. What is left of a
 * slice on either side is kept only if it is at least `MIN_SLICE_NS` — a
 * shorter remainder cannot be grabbed and could only be fixed by deleting it,
 * which is what the user was doing, so it goes with the cut.
 *
 * Refuses to empty the edit, for the reason `deleteSlice` does, and declines
 * when nothing changes so no undo step is banked for it.
 */
function deleteRange(
  state: EditorState,
  source: { start: MediaTime; end: MediaTime },
): EditorState {
  if (source.end <= source.start) return state;

  let changed = false;
  const kept: Slice[] = [];

  for (const slice of slicesOf(state.project)) {
    const from = Math.max(source.start, slice.source.start);
    const to = Math.min(source.end, slice.source.end);
    // No overlap. Touching at a boundary is not an overlap either.
    if (to <= from) {
      kept.push(slice);
      continue;
    }
    changed = true;

    const head = from - slice.source.start >= MIN_SLICE_NS;
    const tail = slice.source.end - to >= MIN_SLICE_NS;

    if (head) kept.push({ ...slice, source: { start: slice.source.start, end: from } });
    if (tail) {
      kept.push(
        head
          ? {
              // The same name `split` would give it, and the same reason for
              // the clone: shared overrides would make editing one half
              // silently edit the other.
              id: `${slice.id}-${state.revision + 1}`,
              source: { start: to, end: slice.source.end },
              overrides: structuredClone(slice.overrides),
            }
          : // A slice that only lost its front is still that slice.
            { ...slice, source: { start: to, end: slice.source.end } },
      );
    }
  }

  if (!changed || kept.length === 0) return state;

  const next = edit(state, (project) => withSlices(project, kept));

  // A selection that was swallowed moves to what now follows the cut, the
  // way `deleteSlice` moves to a neighbour. One that survived stays, and none
  // stays none: this comes from the captions editor with no clip in hand, and
  // selecting one would quietly turn the panel's edits into overrides.
  const survives = kept.some((slice) => slice.id === state.selectedSliceId);
  const selectedSliceId =
    state.selectedSliceId === null || survives
      ? state.selectedSliceId
      : (kept.find((slice) => slice.source.start >= source.end) ?? kept.at(-1))!.id;

  return { ...next, selectedSliceId };
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
