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
  DEFAULT_TEXT_LENGTH,
  MIN_TEXT_LENGTH,
  DEFAULT_ZOOM,
  DEFAULT_ZOOM_LENGTH,
  FALLBACK_BACKGROUND,
  MAX_SPEED,
  MAX_TEXT_TRACKS,
  MIN_SPEED,
  resolveSettings,
  setOverride,
  type Background,
  type LayoutPreset,
  type Project,
  type SettingsSection,
  type Slice,
  type SliceSettings,
  type TextSlice,
  type TextStyle,
  type TextTrack,
  type ZoomSlice,
} from "../../../shared/project";
import {
  DEFAULT_STILL_TEMPLATE,
  DEFAULT_TEXT_TEMPLATE,
  retemplated,
  textFromTemplate,
  textTemplate,
} from "../../../shared/text-templates";
import type { Annotation, AnnotationKind, Point } from "../../../shared/annotations";
import {
  DEFAULT_COLOUR,
  DEFAULT_WIDTH,
  HIGHLIGHT_COLOUR,
  newAnnotation,
} from "../../../shared/annotations";
import {
  DEFAULT_MUSIC_FADE,
  MAX_MUSIC_FADE,
  MAX_MUSIC_VOLUME,
  MIN_MUSIC_LENGTH,
  type MusicFile,
  type MusicSlice,
} from "../../../shared/music";
import type { ScenePreset } from "../../../shared/scene-presets";
import type { MediaTime } from "../../../shared/manifest";
import type { TranscriptWord } from "../../../shared/transcript";
import { presetFitsFrame } from "../../../shared/layout";
import {
  place,
  spanInProject,
  toProjectTime,
  toProjectTimeThrough,
  toSourceTime,
  toSourceTimeThrough,
  totalDuration,
  type PlacedSlice,
} from "./timeline";

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

/** Shortest text worth having: the same floor as a zoom, for the same reason. */
const MIN_TEXT_NS = 300_000_000;

/**
 * What a press on the timeline does.
 *
 * Two, and deliberately no more. `select` is everything the strip has always
 * done — pick a bar, carry it, scrub inside a clip, drag an edge — and `slice`
 * replaces all of it with one thing: cut whatever is under the pointer, there.
 *
 * A cut at the playhead is still a press of S and a button in the transport,
 * because that is the cut you make while watching. This is the other one: the
 * cut you make while looking at the strip, aimed at a bar rather than at the
 * clock, and on a row the playhead cannot act on at all — a zoom and a title
 * had no way to be cut in two before this.
 */
export type TimelineTool = "select" | "slice";

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
  /** Which text is selected, or null. Separate for the reason the zoom is. */
  selectedTextId: string | null;
  /**
   * Which bed on the music row is selected, or null.
   *
   * Its own field for the reason the zoom's and the text's are: a bed is not a
   * clip, and none of a clip's questions — what does it override, what does it
   * inherit — apply to a piece of music.
   */
  selectedMusicId: string | null;
  /**
   * Which mark on a screenshot is selected, or null.
   *
   * Its own field for the reason the zoom and the text have theirs: a mark is
   * not a clip, and none of a clip's questions — what does it override, what
   * does it inherit — apply to an arrow.
   */
  selectedAnnotationId: string | null;
  /**
   * Which drawing tool is in hand, or null for the pointer.
   *
   * In the reducer rather than in the toolbar that shows it, because two other
   * things read it: the overlay, which draws rather than selects while a tool is
   * held, and the Escape key, which puts the tool down from anywhere. Not an
   * edit — it bumps no revision and is never saved, like a selection.
   */
  tool: AnnotationKind | null;
  /**
   * What a press on the timeline does — the pointer, or the blade.
   *
   * Beside `tool` rather than folded into it: that one is the hand on a
   * screenshot and this one is the hand on the strip, the two surfaces are
   * never on screen together, and one field would have to answer "is a blade a
   * kind of arrow" for every reader of either. Not an edit, like `tool`: it
   * bumps no revision and is never saved.
   */
  timelineTool: TimelineTool;
  /**
   * The colour and thickness the next mark gets.
   *
   * Beside the tool and not on the project, because it describes the hand
   * rather than the picture: somebody who draws three red arrows wants the
   * fourth red too, and that preference should not be written into a file and
   * reloaded a week later as part of the edit.
   *
   * `highlight` is the highlighter's own colour, kept apart from the strokes'.
   * The two tools want different inks — a marker is yellow and an arrow is red —
   * and one field would mean picking up the highlighter after drawing an arrow
   * gave a translucent red box. There is no second *width*: a band is not a
   * stroke weight, and the highlighter sets its own.
   */
  ink: { color: string; width: number; highlight: string };
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
  /**
   * Source times the recording was extended at, one per take after the first.
   *
   * Held for the reason `duration` is: a reducer with only the project cannot
   * tell a trim that has run into the next take from one that has not. A slice
   * must resolve to exactly one file per kind, so a trim that grew one across a
   * seam would leave a clip playing the earlier take's file over footage from
   * the later one — see `cutAtSeams`.
   */
  seams: readonly MediaTime[];
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
  | { type: "load"; project: Project; duration: MediaTime; seams: readonly MediaTime[] }
  | { type: "select"; sliceId: string | null }
  | { type: "setFrame"; frame: Project["frame"] }
  | { type: "setOutput"; output: Project["output"] }
  | { type: "setMicDenoise"; level: Project["micDenoise"] }
  | { type: "split"; at: MediaTime }
  /**
   * Cuts the zoom at a source time in two, which is the blade on that row.
   *
   * In source time, like everything else about a zoom, and by time rather than
   * by id: there is one zoom row and no two zooms cover the same moment, so the
   * moment names the zoom.
   */
  | { type: "splitZoom"; at: MediaTime }
  /**
   * Cuts a text in two at a project time, which is the blade on its row.
   *
   * Named by id as well as by time, unlike the zoom: there are up to five rows
   * of texts and a moment names one on each of them. In project time because
   * that is the clock a text's length is measured on — see `TextSlice`.
   */
  | { type: "splitText"; textId: string; at: MediaTime }
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
  | { type: "setSliceSpeed"; sliceId: string; speed: number }
  /**
   * Moves a clip to sit before `before`, or to the end when it is null.
   *
   * By neighbour rather than by index. A drag knows what it was dropped in
   * front of, and an index has to be read against a list that the drag itself
   * shortens the moment the clip leaves its old place — off by one in one
   * direction and not the other, which is the classic way a reorder lands
   * beside where it was aimed.
   */
  | { type: "moveSlice"; sliceId: string; before: string | null }
  /** The words as corrected, or null to go back to the generated transcript. */
  | { type: "setTranscript"; words: TranscriptWord[] | null }
  /**
   * Puts the default background on a gradient, its picture having turned out not
   * to be there — see `provideBackground` in `main/editor-session.ts`.
   *
   * Neither an edit nor history. Main used to repair the project before the
   * editor was seeded from it, which it can no longer do: finding the picture can
   * mean a screenshot of the desktop, and the editor is drawn before that
   * finishes. So the answer arrives at a reducer that already holds a project,
   * and it has to land without bumping the revision — it is a fact about the disk
   * and not something the user did, so it must neither be undoable nor saved, and
   * a recording whose wallpaper turns up later goes back to using it.
   *
   * Only the defaults, and only an image. A slice that overrides its background
   * chose that deliberately, and the override may name a picture that is
   * perfectly present.
   */
  | { type: "backgroundMissing" }
  /**
   * Points every use of one drawn background at the file it has just been
   * re-drawn into — see `usePatternRedraw` in `Editor.tsx`.
   *
   * Its own action rather than a `setSetting` because it is not a setting
   * anybody changed: the frame changed size, so the picture behind it was
   * drawn again at that size, and the path has to follow. `setSetting` writes
   * wherever the selection points, which is the wrong place — a pattern on a
   * clip nobody has selected still needs its path moving — so this matches on
   * the old path instead and changes it everywhere it appears.
   *
   * It does bump the revision: the project on disk has to name the file that
   * is actually there, or reopening the recording would look for the old size.
   */
  | { type: "patternRedrawn"; was: string; path: string }
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
  /**
   * Slides a zoom along the timeline, to a moment in *project* time.
   *
   * The one action on a zoom that is not in source time, and deliberately:
   * what a drag preserves is the length on screen. See `moveZoom`.
   */
  | { type: "moveZoom"; zoomId: string; start: MediaTime; snap?: MediaTime }
  | { type: "trimZoom"; zoomId: string; edge: "start" | "end"; source: MediaTime }
  /**
   * Lays a text on a row. `track` may be one past the last row, which makes
   * the row — that is how the spare row the timeline shows becomes real.
   * `at` and `to` are source times, as `addZoom`'s are.
   */
  | { type: "addText"; track: number; at: MediaTime; to?: MediaTime; templateId?: string }
  /** The transport's Add Text: project time, the first row with room. */
  /**
   * Adds a text near a moment.
   *
   * `still` takes the entrance and the exit off it, and that is not a
   * simplification for a simpler editor — it is what makes the text *visible*.
   * A screenshot is drawn at one fixed moment, `STILL_AT`, and a text added
   * there begins its span exactly there: the first key of an entrance is the
   * text not yet arrived, so the one frame a still has is the frame before it
   * appears. On a clock nobody can scrub, an animation is a text that is never
   * seen.
   */
  | { type: "addTextNear"; at: MediaTime; templateId?: string; still?: boolean }
  | { type: "selectText"; textId: string | null }
  | { type: "deleteText"; textId: string }
  /** Picks up a drawing tool, or puts it down with null. */
  /**
   * Lays a bed on the music row, at the nearest gap to `at`.
   *
   * The file comes in whole rather than by name: it has just been fetched or
   * copied into the recording, and registering it and placing the bed in one
   * action is what keeps a single press of Add Audio a single step of undo.
   * A file already listed is not listed twice.
   *
   * `duration` is the edit's own length, which the reducer does not hold —
   * `state.duration` is the *recording's*, and a bed is measured against the
   * finished video. See `MusicSlice`.
   */
  | { type: "addMusic"; at: MediaTime; source: MusicFile; duration: MediaTime }
  /**
   * Sets one clip's two track volumes, by id.
   *
   * By id rather than through `setSetting`, which writes to whatever is
   * selected: the volume line is dragged on a clip, and a line that wrote to
   * the *selected* clip would quietly change a different one whenever the two
   * were not the same. Both levels at once because the line is one line — see
   * `scaledAudio`.
   */
  | { type: "setSliceAudio"; sliceId: string; mic: number; system: number }
  | { type: "selectMusic"; musicId: string | null }
  /**
   * Points a bed at a different file — the dropdown at the top of its panel.
   *
   * Its own action rather than a `setMusic` patch because it is not only the
   * name that changes: the bed starts again from the top of the new song, and
   * a bed longer than it is no longer plays silence at the end.
   */
  | { type: "setMusicFile"; musicId: string; source: MusicFile }
  | { type: "setMusic"; musicId: string; patch: Partial<Omit<MusicSlice, "id" | "file">> }
  | { type: "moveMusic"; musicId: string; at: MediaTime; snap?: MediaTime }
  | { type: "trimMusic"; musicId: string; edge: "start" | "end"; at: MediaTime }
  | { type: "splitMusic"; musicId: string; at: MediaTime }
  | { type: "deleteMusic"; musicId: string }
  /**
   * Takes back every bed on one track, and the track itself.
   *
   * What a download that failed after the bed was laid runs — see `fetchTrack`
   * in `Editor`. By file rather than by id because the caller does not have
   * one: the bed was made by the reducer, which names it, and the thing the
   * caller knows is which song never arrived.
   */
  | { type: "dropMusicFile"; file: string }
  | { type: "pickTool"; tool: AnnotationKind | null }
  /** Picks up the pointer or the blade — see `TimelineTool`. */
  | { type: "pickTimelineTool"; tool: TimelineTool }
  /** What the next mark is drawn in. */
  | { type: "setInk"; ink: Partial<EditorState["ink"]> }
  | { type: "selectAnnotation"; annotationId: string | null }
  /**
   * Lands a mark the overlay has just drawn.
   *
   * The points arrive already resolved to fractions of the frame, because only
   * the overlay knows how big the picture is on screen — see
   * `shared/annotations.ts`. The reducer names it and keeps the order.
   */
  | { type: "addAnnotation"; kind: AnnotationKind; points: Point[] }
  | { type: "setAnnotation"; annotationId: string; patch: Partial<Annotation> }
  /**
   * Moves a mark by a fraction of each edge.
   *
   * A delta rather than new points, so a drag does not have to send the whole
   * stroke back on every pointer move — a freehand mark is a few hundred
   * samples, and the shape is not what a move changes.
   */
  | { type: "moveAnnotation"; annotationId: string; by: Point }
  | { type: "deleteAnnotation"; annotationId: string }
  /** Copies a text onto a fresh span in the first gap after it, on its row. */
  | { type: "duplicateText"; textId: string }
  /**
   * Copies a text to where an option-drag let go of it: a source time and a
   * row, which may be the spare one. Declined where nothing there will hold
   * it, the way a move between rows is.
   */
  | { type: "copyText"; textId: string; start: MediaTime; track: number }
  /** Position, timing and layout: everything but the fields. */
  | { type: "setText"; textId: string; patch: Partial<Omit<TextSlice, "id" | "source" | "fields">> }
  /** The words and the look of one field. */
  | {
      type: "setTextField";
      textId: string;
      index: number;
      patch: { text?: string; style?: Partial<TextStyle> };
    }
  /**
   * Every field's size at once — the corner drag in the preview.
   *
   * Absolute sizes rather than a ratio: a drag is a stream, and a ratio
   * applied to what the last move left would compound on every one.
   */
  | { type: "sizeText"; textId: string; sizes: number[] }
  | { type: "applyTextTemplate"; textId: string; templateId: string }
  /**
   * Slides a text along its row, or onto another one.
   *
   * `track` is the row the pointer is over, which may be the spare row one
   * past the last; left out, the text stays on its own. A row with no room
   * at that moment declines the move and the text stays where it was,
   * which is what a drag that has not found a home should look like.
   */
  | { type: "moveText"; textId: string; start: MediaTime; track?: number; snap?: MediaTime }
  /**
   * Drops the empty rows above the last text, once a drag between rows has
   * ended. Not part of `moveText` itself: a row pruned the moment it empties
   * shifts every row under the pointer, so the next move lands the bar on
   * the spare row that reappears, which adds the row back — and the bar
   * flickers between two rows for as long as the pointer moves.
   */
  | { type: "tidyTexts" }
  /** `at` is project time: the edge is dragged on the strip. */
  | { type: "trimText"; textId: string; edge: "start" | "end"; at: MediaTime }
  | { type: "undo" }
  /**
   * A new drag is starting, so it must not join the previous one's undo entry.
   *
   * Dispatched on pointer-down by anything that then streams edits. Two drags of
   * the same edge produce identical coalesce keys, and without this they would
   * merge into a single undo step.
   */
  | { type: "beginEdit" };

export function initialState(
  project: Project,
  duration: MediaTime = 0,
  seams: readonly MediaTime[] = [],
): EditorState {
  // Tidied on the way in, which is the one place a row can be judged against
  // the edit: `sanitiseProject` reads the file without the clips and says so
  // itself. A project that has not been changed is not written back, so this
  // costs nothing until the next edit saves it.
  const texts = withoutTrailingUnseen(project);

  return {
    project: texts.length === project.texts.length ? project : { ...project, texts },
    selectedSliceId: project.tracks[0]?.slices[0]?.id ?? null,
    selectedZoomId: null,
    selectedTextId: null,
    selectedMusicId: null,
    selectedAnnotationId: null,
    // Pointer, not a tool. Opening a screenshot is for looking at it first;
    // somebody who wants to draw reaches for the tool that does.
    tool: null,
    // The same reasoning on the timeline: an editor opens able to pick things
    // up, and the blade is picked up for the stretch of cutting it is wanted
    // for and put down again.
    timelineTool: "select",
    ink: { color: DEFAULT_COLOUR, width: DEFAULT_WIDTH, highlight: HIGHLIGHT_COLOUR },
    // Zero until a recording is opened, which is the honest answer: the
    // placeholder project this starts on describes no media at all. Every trim
    // is clamped against it, and clamping to zero is harmless because there is
    // nothing on the timeline to drag yet.
    duration,
    // Empty until a recording is opened, like `duration`: the placeholder
    // project this starts on describes no media, so there is nothing to cross.
    seams,
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
      selectedTextId: findText(previous, state.selectedTextId) ? state.selectedTextId : null,
      selectedMusicId: previous.music.some((bed) => bed.id === state.selectedMusicId)
        ? state.selectedMusicId
        : null,
      selectedAnnotationId: previous.annotations.some(
        (mark) => mark.id === state.selectedAnnotationId,
      )
        ? state.selectedAnnotationId
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
    // One press of the blade each, on the other three rows.
    case "splitZoom":
    case "splitText":
    case "splitMusic":
    case "deleteSlice":
    // One drop, however far it was dragged: the order is only read when the
    // clip is let go, so there is no stream of them to bury the history under.
    case "moveSlice":
    case "deleteRange":
    case "addZoom":
    case "addZoomNear":
    case "deleteZoom":
    case "duplicateZoom":
    case "setZooms":
    case "addText":
    case "addTextNear":
    case "deleteText":
    case "duplicateText":
    case "copyText":
    // One click that rewrites every field's look, like a preset.
    case "applyTextTemplate":
    // Drawing a mark and deleting one are each one gesture — a drag's shape is
    // only read when the pointer is let go, so there is no stream of them.
    case "addAnnotation":
    case "deleteAnnotation":
    // One press each, on the music row.
    case "addMusic":
    case "setMusicFile":
    case "deleteMusic":
    case "dropMusicFile":
      return { coalesce: null };

    // Dragged, so they stream: one entry per mark per gesture rather than one
    // per pointer move. Keyed by id, so moving two marks in turn is two steps.
    case "moveAnnotation":
      return { coalesce: `move-annotation:${action.annotationId}` };

    // Likewise, because the thickness is a slider.
    case "setAnnotation":
      return { coalesce: `set-annotation:${action.annotationId}` };

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
    case "setSliceSpeed":
      return { coalesce: `setSliceSpeed:${action.sliceId}` };
    case "moveZoom":
      return { coalesce: `moveZoom:${action.zoomId}` };
    case "trimZoom":
      return { coalesce: `trimZoom:${action.zoomId}:${action.edge}` };
    case "moveText":
      return { coalesce: `moveText:${action.textId}` };
    case "trimText":
      return { coalesce: `trimText:${action.textId}:${action.edge}` };
    case "moveMusic":
      return { coalesce: `moveMusic:${action.musicId}` };
    case "trimMusic":
      return { coalesce: `trimMusic:${action.musicId}:${action.edge}` };
    // A slider, so it streams — and keyed by the bed, so shaping two in turn
    // is two steps rather than one that puts both back.
    case "setMusic":
      return { coalesce: `setMusic:${action.musicId}` };
    // Typing into a field is a stream, like the transcript. Only the words:
    // a style change through the same action is a slider, and is not banked.
    case "setTextField":
      return "text" in action.patch ? { coalesce: `text:${action.textId}:${action.index}` } : null;
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
      return initialState(action.project, action.duration, action.seams);

    case "backgroundMissing": {
      const background = state.project.defaults.background.background;
      if (background.kind !== "image") return state;

      return {
        ...state,
        project: {
          ...state.project,
          defaults: {
            ...state.project.defaults,
            background: { ...state.project.defaults.background, background: FALLBACK_BACKGROUND },
          },
        },
      };
    }

    case "patternRedrawn": {
      const move = (background: Background): Background =>
        background.kind === "image" &&
        background.source === "pattern" &&
        background.path === action.was
          ? { ...background, path: action.path }
          : background;

      return edit(state, (project) => {
        // The slices first, then the defaults over the top. `withSlices` hands
        // back a whole project, so spreading it *after* a changed `defaults`
        // would quietly put the old background back.
        const next = withSlices(
          project,
          slicesOf(project).map((slice) => {
            const background = slice.overrides.background?.background;
            if (!background) return slice;

            const moved = move(background);
            if (moved === background) return slice;

            return {
              ...slice,
              overrides: {
                ...slice.overrides,
                background: { ...slice.overrides.background, background: moved },
              },
            };
          }),
        );

        return {
          ...next,
          defaults: {
            ...next.defaults,
            background: {
              ...next.defaults.background,
              background: move(next.defaults.background.background),
            },
          },
        };
      });
    }

    case "select":
      // Not a change worth persisting, so the revision stays put. Selecting a
      // clip drops the zoom selection: the inspector shows one thing at a time,
      // and leaving both set would make "what am I editing" unanswerable.
      return {
        ...state,
        selectedSliceId: action.sliceId,
        selectedZoomId: null,
        selectedTextId: null,
        selectedMusicId: null,
        selectedAnnotationId: null,
      };

    case "selectZoom":
      return {
        ...state,
        selectedZoomId: action.zoomId,
        selectedSliceId: null,
        selectedTextId: null,
        selectedMusicId: null,
        selectedAnnotationId: null,
      };

    case "selectText":
      return {
        ...state,
        selectedTextId: action.textId,
        selectedSliceId: null,
        selectedZoomId: null,
        selectedMusicId: null,
        selectedAnnotationId: null,
      };

    case "setSliceAudio":
      return edit(state, (project) => ({
        ...project,
        tracks: project.tracks.map((track) => ({
          ...track,
          slices: track.slices.map((slice) =>
            slice.id === action.sliceId
              ? {
                  ...slice,
                  // Through `setOverride` rather than written flat, so the
                  // panel's "is this overridden" dot and its reset button go on
                  // meaning what they say — a volume dragged on the timeline is
                  // an override on that clip like any other.
                  overrides: setOverride(
                    setOverride(slice.overrides, "audio", "micVolume", clampTo(action.mic, 0, 2)),
                    "audio",
                    "systemVolume",
                    clampTo(action.system, 0, 2),
                  ),
                }
              : slice,
          ),
        })),
      }));

    case "selectMusic":
      return {
        ...state,
        selectedMusicId: action.musicId,
        selectedSliceId: null,
        selectedZoomId: null,
        selectedTextId: null,
        selectedAnnotationId: null,
      };

    case "addMusic":
      return addMusic(state, action.at, action.source, action.duration);

    case "setMusicFile":
      return setMusicFile(state, action.musicId, action.source);

    case "setMusic": {
      const bed = state.project.music.find((entry) => entry.id === action.musicId);
      if (!bed) return state;

      return edit(state, (project) => ({
        ...project,
        music: project.music.map((entry) =>
          entry.id === action.musicId
            ? {
                ...entry,
                ...action.patch,
                // Through the same clamps the file's sanitiser uses, so a
                // control with a bad range cannot write a project that will
                // not load the way it was saved.
                volume: clampTo(action.patch.volume ?? entry.volume, 0, MAX_MUSIC_VOLUME),
                fadeIn: clampTo(action.patch.fadeIn ?? entry.fadeIn, 0, MAX_MUSIC_FADE),
                fadeOut: clampTo(action.patch.fadeOut ?? entry.fadeOut, 0, MAX_MUSIC_FADE),
              }
            : entry,
        ),
      }));
    }

    case "moveMusic":
      return moveMusic(state, action.musicId, action.at, action.snap ?? 0);

    case "trimMusic":
      return trimMusic(state, action.musicId, action.edge, action.at);

    case "splitMusic":
      return splitMusic(state, action.musicId, action.at);

    case "deleteMusic":
      return deleteMusic(state, action.musicId);

    case "dropMusicFile":
      return dropMusicFile(state, action.file);

    case "selectAnnotation":
      return {
        ...state,
        selectedAnnotationId: action.annotationId,
        selectedSliceId: null,
        selectedZoomId: null,
        selectedTextId: null,
        selectedMusicId: null,
      };

    case "pickTool":
      // Picking a tool drops the selection. The ring belongs to the pointer —
      // it says what the next gesture acts on — and with a tool in hand the
      // next gesture draws something new.
      return {
        ...state,
        tool: action.tool,
        ...(action.tool === null ? {} : { selectedAnnotationId: null }),
      };

    // The selection is deliberately left alone, where picking a drawing tool
    // drops it. A blade adds nothing, so there is no new object for the ring to
    // belong to — and the transport's Delete and the inspector are both still
    // reading the selection while the cutting is going on.
    case "pickTimelineTool":
      return { ...state, timelineTool: action.tool };

    case "setInk":
      return { ...state, ink: { ...state.ink, ...action.ink } };

    case "setFrame":
      return edit(state, (project) => framed({ ...project, frame: action.frame }));

    // Persisted with the rest of the edit rather than kept in the dialog: a
    // recording exported once as a GIF is nearly always exported as a GIF the
    // next time, and re-picking the format on every open is the sort of small
    // repeated cost nobody reports.
    case "setOutput":
      return edit(state, (project) => ({ ...project, output: action.output }));

    // On the project rather than a slice's overrides: the level names a file
    // beside the recording, and one clip of a take cannot play a different one
    // — see `Project.micDenoise`.
    case "setMicDenoise":
      return edit(state, (project) => ({ ...project, micDenoise: action.level }));

    case "split":
      return splitSlices(state, action.at);

    case "splitZoom":
      return splitZoom(state, action.at);

    case "splitText":
      return splitText(state, action.textId, action.at);

    case "deleteSlice":
      return deleteSlice(state, action.sliceId);

    case "deleteRange":
      return deleteRange(state, action.source);

    case "trimSlice":
      return trimSlice(state, action);

    case "setSliceSpeed":
      return setSliceSpeed(state, action);

    case "moveSlice":
      return moveSlice(state, action);

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

    case "addText":
      return addText(state, action.track, action.at, action.to, action.templateId);

    case "addTextNear":
      return addTextNear(state, action.at, action.templateId, action.still);

    case "deleteText":
      return deleteText(state, action.textId);

    case "addAnnotation":
      return addAnnotation(state, action.kind, action.points);

    case "setAnnotation":
      return mapAnnotations(state, (mark) =>
        mark.id === action.annotationId ? { ...mark, ...action.patch } : mark,
      );

    case "moveAnnotation":
      return mapAnnotations(state, (mark) =>
        mark.id === action.annotationId
          ? {
              ...mark,
              points: mark.points.map((point) => ({
                x: point.x + action.by.x,
                y: point.y + action.by.y,
              })),
            }
          : mark,
      );

    case "deleteAnnotation":
      return {
        ...edit(state, (project) => ({
          ...project,
          annotations: project.annotations.filter((mark) => mark.id !== action.annotationId),
        })),
        selectedAnnotationId:
          state.selectedAnnotationId === action.annotationId ? null : state.selectedAnnotationId,
      };

    case "duplicateText":
      return duplicateText(state, action.textId);

    case "copyText":
      return copyText(state, action);

    case "setText":
      return editText(state, action.textId, (text) => ({ ...text, ...action.patch }));

    case "setTextField":
      return editText(state, action.textId, (text) => ({
        ...text,
        fields: text.fields.map((field, index) =>
          index === action.index
            ? {
                ...field,
                ...action.patch,
                style: { ...field.style, ...(action.patch.style ?? {}) },
              }
            : field,
        ),
      }));

    case "sizeText":
      return editText(state, action.textId, (text) => ({
        ...text,
        fields: text.fields.map((field, index) => ({
          ...field,
          // Held to what the style's own clamp allows, so a corner dragged
          // off the frame cannot store a size the panel then cannot show.
          style: {
            ...field.style,
            size: clampTo(action.sizes[index] ?? field.style.size, 0.01, 0.5),
          },
        })),
      }));

    case "applyTextTemplate":
      return editText(state, action.textId, (text) =>
        retemplated(text, textTemplate(action.templateId)),
      );

    case "moveText":
      return moveText(state, action);

    case "tidyTexts": {
      const texts = withoutTrailingUnseen(state.project);
      // Nothing to tidy is not an edit, or every drop would bump the revision.
      if (texts.length === state.project.texts.length) return state;
      return edit(state, (project) => ({ ...project, texts }));
    }

    case "trimText":
      return trimText(state, action);
  }
}

// ── Texts ───────────────────────────────────────────────────────────────────

/** A text by id, wherever its row. */
export function findText(project: Project, textId: string | null): TextSlice | undefined {
  if (textId === null) return undefined;
  for (const track of project.texts) {
    const found = track.slices.find((text) => text.id === textId);
    if (found) return found;
  }
  return undefined;
}

/** Which row holds a text, or -1. */
function trackOf(project: Project, textId: string): number {
  return project.texts.findIndex((track) => track.slices.some((text) => text.id === textId));
}

/**
 * A row's texts as the finished video sees them.
 *
 * Every question the lane arithmetic answers — does this fit, what is it
 * bounded by, where is the next gap — is a question about the edit, because
 * that is the clock a length is measured on. A text is *pinned* to the
 * recording, so each anchor is resolved through the clips first.
 *
 * A text whose anchor was cut away has nowhere to be and is left out. That is
 * the rule for the whole feature: delete the footage a title was pinned to and
 * the title goes with it, the same way a zoom does.
 */
function lanedTexts(placed: readonly PlacedSlice[], lane: readonly TextSlice[]): Laned[] {
  return lane
    .flatMap((text) => {
      const start = toProjectTime(placed, text.at);
      return start === null ? [] : [{ id: text.id, source: { start, end: start + text.length } }];
    })
    .sort((a, b) => a.source.start - b.source.start);
}

/** A project span back to what a text stores, or null when it cannot be pinned. */
function pinned(
  placed: readonly PlacedSlice[],
  span: { start: MediaTime; end: MediaTime },
): { at: MediaTime; length: MediaTime } | null {
  const at = toSourceTime(placed, span.start);
  return at === null ? null : { at, length: Math.max(span.end - span.start, MIN_TEXT_LENGTH) };
}

/**
 * The span a text pressed at `at` on a row would occupy, or null if none would.
 *
 * In project time, in and out: `at` is where the pointer is on the strip, and
 * the answer is what the bar would cover there.
 *
 * `laneSpanAt` over that row. A row one past the last is empty by definition,
 * which is what lets the timeline's spare row take a press.
 */
export function textSpanAt(
  project: Project,
  track: number,
  at: MediaTime,
  to?: MediaTime,
): { start: MediaTime; end: MediaTime } | null {
  // One past the last row is the spare row; further than that is nothing.
  if (track < 0 || track > project.texts.length || track >= MAX_TEXT_TRACKS) return null;
  const placed = placedSlices(project);
  const lane = lanedTexts(placed, project.texts[track]?.slices ?? []);
  return laneSpanAt(lane, totalDuration(placed), MIN_TEXT_LENGTH, DEFAULT_TEXT_LENGTH, at, to);
}

/**
 * Where a text added at the playhead would go, in project time, or null.
 *
 * The first row that has room *at the playhead* — the spare row included,
 * which is what the rows are for: a second title over the same moment goes
 * above the first, not somewhere else on its row. Only when every row is
 * taken at that moment does it look sideways, the way a zoom does, along the
 * first row.
 */
export function textSpanNear(
  project: Project,
  at: MediaTime,
): { track: number; span: { start: MediaTime; end: MediaTime } } | null {
  const placed = placedSlices(project);
  const duration = totalDuration(placed);
  const rows = Math.min(project.texts.length + 1, MAX_TEXT_TRACKS);
  for (let track = 0; track < rows; track += 1) {
    const lane = lanedTexts(placed, project.texts[track]?.slices ?? []);
    const span = laneSpanAt(lane, duration, MIN_TEXT_LENGTH, DEFAULT_TEXT_LENGTH, at);
    if (span) return { track, span };
  }

  const span = laneSpanNear(
    lanedTexts(placed, project.texts[0]?.slices ?? []),
    duration,
    MIN_TEXT_LENGTH,
    DEFAULT_TEXT_LENGTH,
    at,
  );
  return span ? { track: 0, span } : null;
}

function addText(
  state: EditorState,
  track: number,
  at: MediaTime,
  to: MediaTime | undefined,
  templateId: string | undefined,
): EditorState {
  const span = textSpanAt(state.project, track, at, to);
  if (!span) return state;
  // Pinned to whatever footage its beginning lands on — which is what "hooks
  // into the clip below" means, and all of it that is about the footage. How
  // long it shows for is the edit's business.
  const place = pinned(placedSlices(state.project), span);
  if (!place) return state;
  return placeNewText(
    state,
    track,
    textFromTemplate(textTemplate(templateId ?? "title"), nextTextId(state), place),
  );
}

function addTextNear(
  state: EditorState,
  at: MediaTime,
  templateId: string | undefined,
  still = false,
): EditorState {
  // `at` is already project time — the playhead's own clock, and the one the
  // row's spans are measured on.
  const found = textSpanNear(state.project, at);
  if (!found) return state;
  const place = pinned(placedSlices(state.project), found.span);
  if (!place) return state;
  // A screenshot's own look rather than the video set's first, which is a
  // title that rises into frame — see `STILL_MOTION`.
  const template = templateId
    ? textTemplate(templateId)
    : still
      ? DEFAULT_STILL_TEMPLATE
      : DEFAULT_TEXT_TEMPLATE;
  const text = textFromTemplate(template, nextTextId(state), place);

  // The look already carries that — see `STILL_MOTION` — and this is the
  // belt: a template named by id from somewhere else is not guaranteed to be
  // one of the still looks, and a text that arrives on a still is a text
  // nobody can see.
  return placeNewText(
    state,
    found.track,
    still ? { ...text, enter: "none", exit: "none", enterMs: 0, exitMs: 0 } : text,
  );
}

/**
 * Lands a mark the overlay drew, selected.
 *
 * Appended rather than inserted, because the list is drawing order: a mark made
 * now goes over everything already there, which is what somebody who has just
 * drawn it expects to see.
 *
 * Selected on the way in, as a zoom and a text are: the point of drawing one is
 * usually to then say what colour it is or to nudge it into place.
 */
function addAnnotation(state: EditorState, kind: AnnotationKind, points: Point[]): EditorState {
  const mark = newAnnotation(
    `mark-${String(state.revision)}-${String(state.project.annotations.length)}`,
    kind,
    points,
    // Whichever ink this tool draws in. The width goes along for every kind but
    // the highlighter, which takes its own — see `newAnnotation`.
    { color: inkFor(state, kind), width: state.ink.width },
  );

  return {
    ...edit(state, (project) => ({
      ...project,
      annotations: [...project.annotations, mark],
    })),
    selectedAnnotationId: mark.id,
    selectedSliceId: null,
    selectedZoomId: null,
    selectedTextId: null,
  };
}

/**
 * The colour a tool draws in.
 *
 * Two inks rather than one, because the two tools want different ones: picking
 * up the highlighter after drawing an arrow should not give a translucent red
 * box, and picking the arrow back up should not give a yellow one.
 */
export function inkFor(state: EditorState, kind: AnnotationKind): string {
  return kind === "highlight" ? state.ink.highlight : state.ink.color;
}

/** Rewrites the marks, keeping their order. */
function mapAnnotations(state: EditorState, change: (mark: Annotation) => Annotation): EditorState {
  return edit(state, (project) => ({ ...project, annotations: project.annotations.map(change) }));
}

/** The selected mark, or undefined. */
export function selectedAnnotation(state: EditorState): Annotation | undefined {
  return state.project.annotations.find((mark) => mark.id === state.selectedAnnotationId);
}

function nextTextId(state: EditorState): string {
  const count = state.project.texts.reduce((sum, track) => sum + track.slices.length, 0);
  return `text-${String(state.revision)}-${String(count)}`;
}

/** Lays a text on a row, making the row where it is one past the last. */
function placeNewText(state: EditorState, track: number, text: TextSlice): EditorState {
  return {
    ...edit(state, (project) => {
      const texts = project.texts.map((row) => ({ ...row, slices: [...row.slices] }));
      while (texts.length <= track) texts.push({ id: `texts-${String(texts.length)}`, slices: [] });
      const row = texts[track]!;
      row.slices = [...row.slices, text].sort((a, b) => a.at - b.at);
      return { ...project, texts };
    }),
    // Selected on the way in, as a zoom is: the point of adding one is to say
    // what it should read.
    selectedTextId: text.id,
    selectedSliceId: null,
    selectedZoomId: null,
  };
}

/**
 * Removes a text, and any empty rows left above the last one with a text.
 *
 * Rows below stay even when emptied: a row is where it is because of what is
 * on the rows around it, and closing a gap would move every text above it
 * down a row.
 */
function deleteText(state: EditorState, textId: string): EditorState {
  if (!findText(state.project, textId)) return state;
  return {
    ...edit(state, (project) => ({
      ...project,
      texts: withoutTrailingUnseen({ ...project, texts: withoutText(project.texts, textId) }),
    })),
    selectedTextId: state.selectedTextId === textId ? null : state.selectedTextId,
  };
}

function withoutText(texts: TextTrack[], textId: string): TextTrack[] {
  return texts.map((track) => ({
    ...track,
    slices: track.slices.filter((text) => text.id !== textId),
  }));
}

/**
 * The rows with the trailing ones dropped, asking the *finished video* whether
 * a row is empty rather than asking the row.
 *
 * A text is pinned to a moment in the recording, so footage the edit no longer
 * plays takes its texts off the screen with it — cut the clip a title sat on,
 * and the title is nowhere, while its row stays for ever. What that leaves is a
 * row with nothing drawn on it, under the spare row the timeline conjures for
 * itself: two empty rows, one of which cannot be filled by dropping a text on
 * it, because it already holds one nobody can see.
 *
 * Trailing only: a row in the middle is where it is because of the rows around
 * it, and closing the gap would move every text above it down a row.
 *
 * Asked on open and nowhere else. It could be asked after every cut, and it is
 * deliberately not: a trim is a stream of edits, and a title that left the
 * picture halfway through a drag would be deleted before the pointer came back.
 */
function withoutTrailingUnseen(project: Project): TextTrack[] {
  const placed = placedSlices(project);
  const seen = (row: TextTrack): boolean =>
    row.slices.some((text) => toProjectTime(placed, text.at) !== null);

  const kept = [...project.texts];
  while (kept.length > 0 && !seen(kept[kept.length - 1]!)) kept.pop();
  return kept;
}

function duplicateText(state: EditorState, textId: string): EditorState {
  const source = findText(state.project, textId);
  if (!source) return state;
  const track = trackOf(state.project, textId);

  const placed = placedSlices(state.project);
  const from = toProjectTime(placed, source.at);
  if (from === null) return state;

  // Straight after itself, on the edit's clock — the gap it wants is measured
  // in the finished video like every other length here.
  const after = from + source.length;
  const span = textSpanAt(state.project, track, after, after + source.length);
  if (!span) return state;
  const place = pinned(placed, span);
  if (!place) return state;

  const copy: TextSlice = {
    ...source,
    id: nextTextId(state),
    ...place,
    fields: source.fields.map((field) => ({ ...field, style: { ...field.style } })),
  };
  return placeNewText(state, track, copy);
}

/**
 * Where a copy of a text let go at `start` on `track` would land, or null.
 *
 * The one rule behind both the ghost an option-drag draws and the drop that
 * ends it, so the outline never promises a copy the reducer then declines.
 */
export function textCopySpan(
  project: Project,
  textId: string,
  start: MediaTime,
  track: number,
): { start: MediaTime; end: MediaTime } | null {
  const text = findText(project, textId);
  if (!text) return null;
  if (track < 0 || track > project.texts.length || track >= MAX_TEXT_TRACKS) return null;
  const placed = placedSlices(project);
  const lane = lanedTexts(placed, project.texts[track]?.slices ?? []);
  return laneRoom(lane, text.length, start, totalDuration(placed));
}

function copyText(
  state: EditorState,
  action: Extract<EditorAction, { type: "copyText" }>,
): EditorState {
  const source = findText(state.project, action.textId);
  const span = textCopySpan(state.project, action.textId, action.start, action.track);
  if (!source || !span) return state;

  const place = pinned(placedSlices(state.project), span);
  if (!place) return state;

  const copy: TextSlice = {
    ...source,
    id: nextTextId(state),
    ...place,
    fields: source.fields.map((field) => ({ ...field, style: { ...field.style } })),
  };
  return placeNewText(state, action.track, copy);
}

function editText(
  state: EditorState,
  textId: string,
  change: (text: TextSlice) => TextSlice,
): EditorState {
  if (!findText(state.project, textId)) return state;
  return edit(state, (project) => ({
    ...project,
    texts: project.texts.map((track) => ({
      ...track,
      slices: track.slices.map((text) => (text.id === textId ? change(text) : text)),
    })),
  }));
}

function moveText(
  state: EditorState,
  action: Extract<EditorAction, { type: "moveText" }>,
): EditorState {
  const from = trackOf(state.project, action.textId);
  const lane = state.project.texts[from]?.slices;
  const text = lane?.find((entry) => entry.id === action.textId);
  if (!lane || !text) return state;

  // Every span here is on the edit's clock — `action.start` is where the bar
  // was let go on the strip — and only the answer is pinned back to the
  // footage. See `lanedTexts`.
  const placed = placedSlices(state.project);
  const limit = totalDuration(placed);
  const to = action.track ?? from;

  if (to === from) {
    // Its own row is no different from any other it could be dropped on, so it
    // asks the same question — `laneRoom`, over the row without itself in it.
    // `laneMoved` bounds an entry by the two either side of its own index,
    // which meant a text could never pass a neighbour along its own row: the
    // third on a row dragged towards the front stopped dead against the second
    // and sprang back, and a row could not be reordered at all. Carrying it up
    // to another row and back was the only way round, which is the tell that
    // the two paths had drifted. Zooms still go by `laneMoved`: they are
    // anchored to the footage under them, and `project.zooms` is held sorted.
    const others = lanedTexts(placed, lane).filter((entry) => entry.id !== action.textId);
    const span = laneRoom(others, text.length, action.start, limit, action.snap ?? 0);
    const place = span && pinned(placed, span);
    if (!place) return state;

    // Re-sorted, as the path onto another row already does. A text carried past
    // its neighbour has changed the row's order, and a row left out of order
    // would be put back in order by `sanitiseText` on the next load — so the
    // strip would redraw itself differently from how it was left.
    return edit(state, (project) => ({
      ...project,
      texts: project.texts.map((row, index) =>
        index === from
          ? {
              ...row,
              slices: row.slices
                .map((entry) => (entry.id === action.textId ? { ...entry, ...place } : entry))
                .sort((a, b) => a.at - b.at),
            }
          : row,
      ),
    }));
  }

  // Onto another row: the spare row is allowed, anything past it is not.
  if (to < 0 || to > state.project.texts.length || to >= MAX_TEXT_TRACKS) return state;
  const target = lanedTexts(placed, state.project.texts[to]?.slices ?? []);
  const span = laneRoom(target, text.length, action.start, limit);
  const place = span && pinned(placed, span);
  if (!place) return state;

  const moved: TextSlice = { ...text, ...place };
  return edit(state, (project) => {
    const texts = project.texts.map((row) => ({
      ...row,
      slices: row.slices.filter((entry) => entry.id !== action.textId),
    }));
    while (texts.length <= to) texts.push({ id: `texts-${String(texts.length)}`, slices: [] });
    const row = texts[to]!;
    row.slices = [...row.slices, moved].sort((a, b) => a.at - b.at);
    return { ...project, texts };
  });
}

/**
 * Where a span of `length` dropped at `start` lands in a lane it is not yet
 * on, or null when nothing there will hold it.
 *
 * `laneMoved` for an entry that is arriving rather than already there: the
 * gap the drop landed in bounds it, and a drop straight onto another entry
 * has no gap to be held in and is declined.
 */
export function laneRoom(
  lane: readonly Laned[],
  length: MediaTime,
  start: MediaTime,
  limit: MediaTime,
  /** How near an edge has to be before the span latches onto it. */
  snap: MediaTime = 0,
): { start: MediaTime; end: MediaTime } | null {
  // Before the test below, not after. A bar let go a few pixels *inside* a
  // neighbour is somebody aiming at its edge, and refusing the drop and then
  // snapping what is left would be a bar that springs back from the one place
  // it was being put.
  const at = clampTo(
    snappedStart(
      start,
      length,
      [...lane.flatMap((entry) => [entry.source.start, entry.source.end]), 0, limit],
      snap,
    ),
    0,
    limit,
  );
  if (lane.some((entry) => at >= entry.source.start && at < entry.source.end)) return null;

  const floor = lane.reduce(
    (edge, entry) => (entry.source.end <= at ? Math.max(edge, entry.source.end) : edge),
    0,
  );
  const ceiling = lane.reduce(
    (edge, entry) => (entry.source.start > at ? Math.min(edge, entry.source.start) : edge),
    limit,
  );
  if (ceiling - floor < length) return null;

  const from = clampTo(at, floor, ceiling - length);
  return { start: from, end: from + length };
}

function trimText(
  state: EditorState,
  action: Extract<EditorAction, { type: "trimText" }>,
): EditorState {
  const track = trackOf(state.project, action.textId);
  const lane = state.project.texts[track]?.slices;
  if (!lane) return state;

  // The edge is dragged on the strip, so it arrives in project time and the
  // lane is measured there — which is also what makes a trim change the length
  // and nothing else about where the text is pinned, unless the *start* moved.
  const placed = placedSlices(state.project);
  const trimmed = laneTrimmed(
    lanedTexts(placed, lane),
    action.textId,
    action.edge,
    action.at,
    totalDuration(placed),
    MIN_TEXT_LENGTH,
  );
  const place = trimmed && pinned(placed, trimmed);
  if (!place) return state;
  return editText(state, action.textId, (text) => ({ ...text, ...place }));
}

/**
 * Where a text sits in the finished video, or null when its anchor was cut.
 *
 * One conversion and an addition, where a zoom needs its whole span mapped:
 * only the anchor is on the recording's clock, and the length is already on
 * this one.
 */
export function textInProject(
  project: Project,
  text: TextSlice,
): { start: MediaTime; end: MediaTime } | null {
  const start = toProjectTime(placedSlices(project), text.at);
  return start === null ? null : { start, end: start + text.length };
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
    selectedTextId: null,
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
  return laneSpanAt(project.zooms, sourceEnd(project), MIN_ZOOM_NS, DEFAULT_ZOOM_LENGTH, at, to);
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
  return laneSpanNear(project.zooms, sourceEnd(project), MIN_ZOOM_NS, DEFAULT_ZOOM_LENGTH, at);
}

// ── Lanes ───────────────────────────────────────────────────────────────────
//
// A zoom row and a text row are the same thing to the timeline: a sorted list
// of spans in source time, none of which may cover the same moment. The rules
// below are written once over that shape and both rows call them, so the two
// cannot drift — a text that could be dragged over its neighbour while a zoom
// could not would be a bug that looks like a design choice.

/** What a lane holds: anything with a source span and an id. */
interface Laned {
  id: string;
  source: { start: MediaTime; end: MediaTime };
}

/**
 * The span a press at `at` would occupy in a lane, or null if none would.
 *
 * `to` is where a drag ended. Without it the span takes `length` forwards
 * from the press, which is what a click asks for. With it the span is
 * whatever was drawn out, in either direction — the press is one edge and
 * the release is the other, and which of them is the start falls out of the
 * two rather than out of a rule about dragging rightwards.
 *
 * Held inside the gap the press landed in, at both ends. Clamping only the far
 * end was enough while the length was fixed and grew forwards; a drag can run
 * back over the span behind it, and clamping the near end is what keeps "no
 * two cover the same moment" true without asking the caller.
 *
 * Null where something already is, or where what is left is too small to
 * grab afterwards.
 */
export function laneSpanAt(
  lane: readonly Laned[],
  duration: MediaTime,
  minimum: MediaTime,
  length: MediaTime,
  at: MediaTime,
  to?: MediaTime,
): { start: MediaTime; end: MediaTime } | null {
  const from = Math.max(0, Math.min(at, duration));
  if (lane.some((entry) => from >= entry.source.start && from < entry.source.end)) return null;

  // The gap the press landed in. `from` is inside it, so these two bound the
  // whole of what may be drawn without touching a neighbour.
  const floor = lane.reduce(
    (edge, entry) => (entry.source.end <= from ? entry.source.end : edge),
    0,
  );
  const ceiling = lane.find((entry) => entry.source.start > from)?.source.start ?? duration;

  const drawn = to === undefined ? from + length : Math.max(0, Math.min(to, duration));
  const start = Math.max(floor, Math.min(from, drawn));
  const end = Math.min(ceiling, Math.max(from, drawn));

  return end - start < minimum ? null : { start, end };
}

/**
 * The span an entry added at the playhead would occupy, or null if none would.
 *
 * `laneSpanAt` answers for a pointer, which is always somewhere a span may or
 * may not go and can move if it may not. A playhead cannot: it stops wherever
 * playback was paused, and that is over an existing span as often as not. So
 * where `laneSpanAt` declines, this looks sideways for the nearest gap that
 * will hold one — the closest empty stretch beside whatever is in the way —
 * and lays the span hard against the near end of it, so it sits next to the
 * moment asked for rather than somewhere in the middle of the gap.
 *
 * Every gap is a candidate, not just the two beside the playhead: a run of
 * back-to-back spans, or a gap between them too small to grab, is skipped
 * over rather than stopping the search. The one chosen is the nearest, and on
 * a tie the later one — playback runs forwards, so that is the one about to
 * be seen.
 *
 * Null only when no gap anywhere is big enough, which is also the answer to
 * "can one be added at all" — the same call from any `at` says so.
 */
export function laneSpanNear(
  lane: readonly Laned[],
  duration: MediaTime,
  minimum: MediaTime,
  length: MediaTime,
  at: MediaTime,
): { start: MediaTime; end: MediaTime } | null {
  // The empty stretches, in order: before the first, between each pair, and
  // after the last. Lanes are kept sorted by start, so consecutive pairs are
  // neighbours.
  const edges = [0, ...lane.flatMap((entry) => [entry.source.start, entry.source.end]), duration];

  let best: { span: { start: MediaTime; end: MediaTime }; distance: MediaTime } | null = null;
  for (let index = 0; index < edges.length; index += 2) {
    const floor = edges[index]!;
    const ceiling = edges[index + 1]!;
    if (ceiling - floor < minimum) continue;

    // The point in this gap closest to the playhead — the playhead itself when
    // it is inside. Forwards from there when there is room, the way a click
    // grows; otherwise backwards from the gap's far end, so the span still
    // finishes hard against whatever stopped it growing.
    const anchor = Math.max(floor, Math.min(at, ceiling));
    const span =
      ceiling - anchor >= minimum
        ? laneSpanAt(lane, duration, minimum, length, anchor)
        : laneSpanAt(lane, duration, minimum, length, Math.max(floor, ceiling - length), ceiling);
    if (!span) continue;

    const distance = Math.abs(at - anchor);
    if (best === null || distance <= best.distance) best = { span, distance };
  }

  return best?.span ?? null;
}

/**
 * Slides one entry of a lane so it starts at `start`, or as near as its
 * neighbours allow.
 *
 * Its length is preserved and its neighbours are not: a move that would
 * collide stops against them rather than pushing them along or overlapping,
 * so the invariant that no two cover the same moment holds without the
 * caller having to know about it. `limit` is the furthest the end may reach.
 */
/**
 * The music row as a lane, so the three rows share one set of rules.
 *
 * A bed is stored as a start and a length in project time; `Laned` wants a
 * span. The conversion is here and nowhere else, because the thing being
 * protected is the same invariant on all three rows — no two entries cover the
 * same moment — and a second implementation of "may this move here" is how a
 * row comes to allow an overlap the file format says cannot exist.
 */
function musicLane(music: readonly MusicSlice[]): Laned[] {
  return music.map((bed) => ({
    id: bed.id,
    source: { start: bed.at, end: bed.at + bed.length },
  }));
}

/** One bed by id, or undefined. */
export function findMusic(project: Project, musicId: string | null): MusicSlice | undefined {
  return musicId === null ? undefined : project.music.find((bed) => bed.id === musicId);
}

/**
 * Where a bed of `want` would go if one were added at `at`, or null.
 *
 * The same call answers both questions Add Audio asks: whether the row has
 * room at all — which is what greys the menu out — and, once a file has been
 * fetched, where to put it. Project time throughout.
 */
export function musicSpanNear(
  project: Project,
  duration: MediaTime,
  at: MediaTime,
  want: MediaTime,
): { start: MediaTime; end: MediaTime } | null {
  return laneSpanNear(musicLane(project.music), duration, MIN_MUSIC_LENGTH, want, at);
}

/**
 * Lays a bed down, registering its file if this project has not seen it.
 *
 * The bed is as long as the song, or as long as the gap it landed in, and no
 * shorter than the floor — a file longer than the video is the ordinary case
 * and is simply cut off at the end, which is what a bed under a video is.
 *
 * Both fades are on from the start. Music that begins at full level reads as a
 * mistake rather than as a choice, and the one thing everybody does by hand to
 * a bed they have just added is shape its ends.
 */
function addMusic(
  state: EditorState,
  at: MediaTime,
  source: MusicFile,
  duration: MediaTime,
): EditorState {
  const span = musicSpanNear(state.project, duration, at, source.duration);
  if (!span) return state;

  const bed: MusicSlice = {
    id: nextMusicId(state),
    at: span.start,
    length: span.end - span.start,
    file: source.file,
    offset: 0,
    volume: 1,
    muted: false,
    // Held to half the bed each, the way `musicGain` reads them: a bed shorter
    // than two default fades would otherwise never reach its own level.
    fadeIn: Math.min(DEFAULT_MUSIC_FADE, (span.end - span.start) / 2),
    fadeOut: Math.min(DEFAULT_MUSIC_FADE, (span.end - span.start) / 2),
    repeat: false,
  };

  return {
    ...edit(state, (project) => ({
      ...project,
      musicFiles: withMusicFile(project.musicFiles, source),
      music: [...project.music, bed].sort((a, b) => a.at - b.at),
    })),
    // Selected, so the panel that chooses a different song is already open on
    // the one just added — which is the next thing somebody does.
    selectedMusicId: bed.id,
    selectedSliceId: null,
    selectedZoomId: null,
    selectedTextId: null,
    selectedAnnotationId: null,
  };
}

/**
 * Points a bed at a different file.
 *
 * Back to the top of the new song — an offset into one file means nothing in
 * another — and no longer than it, unless the bed repeats, in which case its
 * length is what the person asked for and the file fills it.
 */
function setMusicFile(state: EditorState, musicId: string, source: MusicFile): EditorState {
  const bed = findMusic(state.project, musicId);
  if (!bed || bed.file === source.file) return state;

  const length = bed.repeat
    ? bed.length
    : Math.max(MIN_MUSIC_LENGTH, Math.min(bed.length, source.duration));

  return edit(state, (project) => ({
    ...project,
    musicFiles: withMusicFile(project.musicFiles, source),
    music: project.music.map((entry) =>
      entry.id === musicId ? { ...entry, file: source.file, offset: 0, length } : entry,
    ),
  }));
}

/**
 * Slides a bed along the finished video.
 *
 * The song itself does not move inside it — only where it is heard — so the
 * offset is left alone. That is the difference between this and trimming the
 * left edge, which is the other way to make a bed start later.
 */
function moveMusic(
  state: EditorState,
  musicId: string,
  at: MediaTime,
  snap: MediaTime,
): EditorState {
  const duration = projectDuration(state.project);
  const span = laneMoved(musicLane(state.project.music), musicId, at, duration, snap);
  if (!span) return state;

  return edit(state, (project) => ({
    ...project,
    music: project.music.map((bed) =>
      bed.id === musicId ? { ...bed, at: span.start, length: span.end - span.start } : bed,
    ),
  }));
}

/**
 * Moves one end of a bed.
 *
 * Dragging the left edge takes the offset with it, so the music under the
 * playhead does not change as the edge arrives at it — the bar reveals and
 * hides the beginning of the song rather than sliding the whole of it. The
 * right edge only shortens what is heard.
 *
 * The offset is held at zero: a bed dragged left past the start of its song
 * grows no further, because there is nothing before the first sample to show.
 */
function trimMusic(
  state: EditorState,
  musicId: string,
  edge: "start" | "end",
  at: MediaTime,
): EditorState {
  const bed = findMusic(state.project, musicId);
  if (!bed) return state;

  const duration = projectDuration(state.project);
  const limit =
    edge === "start"
      ? // No further left than the song has music before the bed's current
        // start. Without this the edge keeps travelling and the offset sticks
        // at zero, so the bar grows while the music inside it slides — which
        // reads as the drag having stopped working.
        Math.max(at, bed.at - bed.offset)
      : at;

  const span = laneTrimmed(
    musicLane(state.project.music),
    musicId,
    edge,
    limit,
    duration,
    MIN_MUSIC_LENGTH,
  );
  if (!span) return state;

  return edit(state, (project) => ({
    ...project,
    music: project.music.map((entry) =>
      entry.id === musicId
        ? {
            ...entry,
            at: span.start,
            length: span.end - span.start,
            offset: Math.max(0, entry.offset + (span.start - entry.at)),
          }
        : entry,
    ),
  }));
}

/**
 * Where a cut would fall inside a bed, or null if it would not.
 *
 * Project time at both ends, like everything about a bed. The halves are what
 * the two beds become: the first keeps the start and the offset it had, and
 * the second picks the song up exactly where the first left it — that is the
 * whole reason a cut here is not audible until something is done with one of
 * the halves.
 *
 * Null where either half would be shorter than a bed may be, which is the same
 * answer "may the blade land here" wants.
 */
export function musicSplitAt(
  project: Project,
  musicId: string,
  at: MediaTime,
): { first: Partial<MusicSlice>; second: Partial<MusicSlice> } | null {
  const bed = findMusic(project, musicId);
  if (!bed) return null;

  const into = at - bed.at;
  if (into < MIN_MUSIC_LENGTH) return null;
  if (bed.length - into < MIN_MUSIC_LENGTH) return null;

  return {
    first: { length: into },
    second: { at, length: bed.length - into, offset: bed.offset + into },
  };
}

/**
 * Cuts a bed in two.
 *
 * The sound does not change: the second half starts where the first stopped,
 * so the song plays through the join. What changes is what can be done next —
 * delete the tail so the music stops partway, move one half somewhere else,
 * give the two different levels. That is the same bargain a cut clip makes.
 *
 * The fades are not divided between the halves. Each keeps the pair it had, so
 * a bed that faded in and out now does both twice; `musicGain` holds each to
 * half its own bed, so nothing can go louder than it was, and shaping the join
 * afterwards is two drags of controls that are already there. Splitting them
 * by hand would be this function deciding what somebody meant.
 */
function splitMusic(state: EditorState, musicId: string, at: MediaTime): EditorState {
  const halves = musicSplitAt(state.project, musicId, at);
  if (!halves) return state;

  const created = nextMusicId(state);

  return {
    ...edit(state, (project) => ({
      ...project,
      music: project.music
        .flatMap((bed) =>
          bed.id === musicId
            ? [
                { ...bed, ...halves.first },
                { ...bed, id: created, ...halves.second },
              ]
            : [bed],
        )
        .sort((a, b) => a.at - b.at),
    })),
    selectedMusicId: created,
    selectedSliceId: null,
    selectedZoomId: null,
    selectedTextId: null,
  };
}

/**
 * Takes a bed off the row.
 *
 * Its file stays in `musicFiles`. The list is what the picker offers, and a
 * song that disappeared from it the moment its bar was deleted would be the
 * one thing somebody wanted back.
 */
function deleteMusic(state: EditorState, musicId: string): EditorState {
  if (!findMusic(state.project, musicId)) return state;

  return {
    ...edit(state, (project) => ({
      ...project,
      music: project.music.filter((bed) => bed.id !== musicId),
    })),
    selectedMusicId: null,
  };
}

/**
 * Every bed on one track removed, and the track with them.
 *
 * The bed goes down before the song has arrived — a bar that shimmers is a
 * better answer to Add Audio than nothing happening for two megabytes — so
 * this is what runs when it never does. The file entry goes too: it describes
 * a song this machine does not have, and leaving it would offer it in the
 * picker as though it did.
 */
function dropMusicFile(state: EditorState, file: string): EditorState {
  if (!state.project.music.some((bed) => bed.file === file)) return state;

  return {
    ...edit(state, (project) => ({
      ...project,
      music: project.music.filter((bed) => bed.file !== file),
      musicFiles: project.musicFiles.filter((entry) => entry.file !== file),
    })),
    selectedMusicId: null,
  };
}

/** The list with `source` in it, replacing an entry of the same name. */
function withMusicFile(files: readonly MusicFile[], source: MusicFile): MusicFile[] {
  // Replaced rather than skipped: the same file re-imported has been probed
  // again, and the fresher length is the one to keep.
  return [...files.filter((entry) => entry.file !== source.file), source];
}

/** An id no bed on this row holds. The same counter the texts use. */
function nextMusicId(state: EditorState): string {
  let index = state.project.music.length;
  let id = `music-${String(index)}`;
  while (state.project.music.some((bed) => bed.id === id)) {
    index += 1;
    id = `music-${String(index)}`;
  }
  return id;
}

/**
 * Pulls a dragged span onto a neighbouring edge when it comes close to one.
 *
 * Both of its own edges are offered to every edge in `edges`: a bar's head can
 * land on a neighbour's tail, and its tail on a neighbour's head, and which of
 * the two somebody meant is whichever they got nearer to. The answer is still
 * a *start*, because that is what every mover here takes.
 *
 * The tolerance arrives in nanoseconds and is worked out from pixels at the
 * strip — see `SNAP_REACH`. It has to be, or a snap would be a different
 * distance on screen at every zoom level: generous at the wide end and
 * unshakeable at the narrow one, where a frame is several pixels across.
 *
 * Ties go to the first edge offered, so the answer does not depend on the
 * order two equally close candidates happened to be built in. Nothing is
 * clamped here — the callers all bound the result against their own lane, and
 * a candidate that lands outside is simply one they refuse.
 */
export function snappedStart(
  start: MediaTime,
  length: MediaTime,
  edges: readonly MediaTime[],
  snap: MediaTime,
): MediaTime {
  if (snap <= 0) return start;

  let best = start;
  let distance = snap;

  for (const edge of edges) {
    // The head on this edge, and the tail on it.
    for (const candidate of [edge, edge - length]) {
      const away = Math.abs(start - candidate);
      if (away < distance) {
        distance = away;
        best = candidate;
      }
    }
  }

  return best;
}

export function laneMoved(
  lane: readonly Laned[],
  id: string,
  start: MediaTime,
  limit: MediaTime,
  /** How near an edge has to be before the span latches onto it. */
  snap: MediaTime = 0,
): { start: MediaTime; end: MediaTime } | null {
  const index = lane.findIndex((entry) => entry.id === id);
  const entry = lane[index];
  if (!entry) return null;

  const length = entry.source.end - entry.source.start;
  const floor = lane[index - 1]?.source.end ?? 0;
  const ceiling = Math.min(lane[index + 1]?.source.start ?? limit, limit);

  // The two neighbours and the two ends of the edit. Butting a bar against the
  // one before it is the whole point; the start of the film and its end are
  // here because they are edges somebody aims at just as often, and landing a
  // frame short of either is the same miss.
  const at = snappedStart(start, length, [floor, ceiling, 0, limit], snap);

  const from = clampTo(at, floor, Math.max(floor, ceiling - length));
  return { start: from, end: from + length };
}

/** Moves one edge of an entry, without letting it cross its neighbours or
    leave less than `minimum` behind. */
export function laneTrimmed(
  lane: readonly Laned[],
  id: string,
  edge: "start" | "end",
  source: MediaTime,
  limit: MediaTime,
  minimum: MediaTime,
): { start: MediaTime; end: MediaTime } | null {
  const index = lane.findIndex((entry) => entry.id === id);
  const entry = lane[index];
  if (!entry) return null;

  const floor = lane[index - 1]?.source.end ?? 0;
  const ceiling = lane[index + 1]?.source.start ?? limit;

  const span =
    edge === "start"
      ? { start: clampTo(source, floor, entry.source.end - minimum), end: entry.source.end }
      : { start: entry.source.start, end: clampTo(source, entry.source.start + minimum, ceiling) };

  return span.end - span.start < minimum ? null : span;
}

/**
 * Slides a whole zoom along the timeline.
 *
 * **In project time, not source time.** A zoom is stored against the recording
 * and drawn against the edit, and a cut takes a stretch out of the middle of
 * the first. Moved by its source start, a zoom crossing a cut keeps the length
 * it has on the *recording* and loses the length it has on screen: the part
 * inside the cut is footage nobody can see, so the bar's head latches to the
 * edge of the clip and the rest of it shrinks in behind — measured on a
 * two-second zoom over a two-second cut, the bar drew 2.00s, 1.00s, 0.00s,
 * 1.00s, 2.00s while its source length never changed once. It reads as a zoom
 * resizing itself instead of moving, and it holds the bar at the join until
 * the pointer is well past.
 *
 * So the drag preserves what is on screen. The bar keeps the width it had, the
 * source span stretches to take in whatever was cut out underneath, and a zoom
 * longer than the clips under it moves like any other — which the rule this
 * replaced could not do, because it worked by fitting a zoom inside one clip
 * and that one fits in none.
 *
 * Nothing is rendered differently for a zoom whose span covers a cut: the
 * footage is not in the video, so neither is any of the shot over it.
 *
 * Its length is preserved and its neighbours are not: a move that would collide
 * stops against them rather than pushing them along or overlapping, so the
 * invariant that no two zooms cover the same moment holds without the caller
 * having to know about it. Checked on screen as well, because that is where
 * the move now happens.
 */
function moveZoom(
  state: EditorState,
  action: Extract<EditorAction, { type: "moveZoom" }>,
): EditorState {
  const zooms = state.project.zooms;
  const index = zooms.findIndex((candidate) => candidate.id === action.zoomId);
  const zoom = zooms[index];
  if (!zoom) return state;

  const placed = place(slicesOf(state.project));
  const span = spanInProject(placed, zoom.source);
  // A zoom whose every moment was cut away has no bar to drag, and no length
  // to preserve either.
  if (!span) return state;

  const length = span.end - span.start;
  const reach = totalDuration(placed);
  /** The neighbours, as they are drawn — the same clock this move is on. */
  const floor = index > 0 ? (spanInProject(placed, zooms[index - 1]!.source)?.end ?? 0) : 0;
  const ceiling =
    index < zooms.length - 1
      ? (spanInProject(placed, zooms[index + 1]!.source)?.start ?? reach)
      : reach;

  // Snapped before it is bounded, against the two neighbours and the two ends
  // of the edit — the same edges a bed latches onto, on the same clock the bar
  // is drawn on. See `snappedStart`.
  const wanted = snappedStart(
    action.start,
    length,
    [floor, Math.min(ceiling, reach), 0, reach],
    action.snap ?? 0,
  );

  const at = clampTo(wanted, floor, Math.max(floor, Math.min(ceiling, reach) - length));
  const from = toSourceTime(placed, at);
  const to = toSourceTimeThrough(placed, at + length);
  if (from === null || to === null || to <= from) return state;

  return edit(state, (project) => ({
    ...project,
    zooms: project.zooms.map((candidate) =>
      candidate.id === action.zoomId
        ? { ...candidate, source: { start: from, end: to } }
        : candidate,
    ),
  }));
}

/** Moves one edge of a zoom, without letting it cross its neighbours. */
function trimZoom(
  state: EditorState,
  action: Extract<EditorAction, { type: "trimZoom" }>,
): EditorState {
  const source = laneTrimmed(
    state.project.zooms,
    action.zoomId,
    action.edge,
    action.source,
    sourceEnd(state.project),
    MIN_ZOOM_NS,
  );
  if (!source) return state;

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
  zoom: { source: { start: MediaTime; end: MediaTime } },
): { start: MediaTime; end: MediaTime } | null {
  const placed = placedSlices(project);
  const start = toProjectTimeThrough(placed, zoom.source.start);
  const end = toProjectTimeThrough(placed, zoom.source.end);

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

  // Scaled by `speed`, as `toSourceTime` does: a second of project time covers
  // `speed` seconds of footage, so on a sped-up clip the unscaled offset lands
  // short and the cut appears somewhere other than the playhead.
  const source = slice.source.start + (at - slice.timelineStart) * slice.speed;
  if (source - slice.source.start < MIN_SLICE_NS) return null;
  if (slice.source.end - source < MIN_SLICE_NS) return null;

  return { slice, source };
}

/**
 * Where a cut at a source time would fall inside a zoom, or null.
 *
 * `splitPointAt` for the zoom row, and shared with the strip for the same
 * reason: the blade lights a bar up only where the reducer will really cut it.
 *
 * Null outside every zoom, on either edge of one, and anywhere that would
 * leave a zoom too brief to read as having gone somewhere — `MIN_ZOOM_NS`,
 * which is the floor a zoom is added and trimmed against too.
 */
export function zoomSplitAt(
  project: Project,
  at: MediaTime,
): { zoom: ZoomSlice; source: MediaTime } | null {
  const zoom = project.zooms.find(
    (candidate) => at > candidate.source.start && at < candidate.source.end,
  );
  if (!zoom) return null;
  if (at - zoom.source.start < MIN_ZOOM_NS) return null;
  if (zoom.source.end - at < MIN_ZOOM_NS) return null;

  return { zoom, source: at };
}

/**
 * The two halves a cut at a project time would leave a text in, or null.
 *
 * `splitPointAt` for a text row, and the same bargain with the strip. It hands
 * back the halves rather than the point because a text is stored on two clocks
 * at once — pinned to the footage, measured in the finished video — so "where
 * does the second half begin" is a conversion rather than a subtraction, and
 * doing it twice is how the bar and the cut come to disagree.
 *
 * Null on either edge, on a text whose footage was cut away, and anywhere that
 * would leave a half below `MIN_TEXT_NS`. Null too where the cut lands on
 * footage the edit no longer plays: the far half has to be pinned to something.
 */
export function textSplitAt(
  project: Project,
  textId: string,
  at: MediaTime,
): {
  first: { at: MediaTime; length: MediaTime };
  second: { at: MediaTime; length: MediaTime };
} | null {
  const text = findText(project, textId);
  if (!text) return null;

  const placed = placedSlices(project);
  const start = toProjectTime(placed, text.at);
  if (start === null) return null;
  const end = start + text.length;

  if (at - start < MIN_TEXT_NS) return null;
  if (end - at < MIN_TEXT_NS) return null;

  // Pinned to whatever footage the cut landed on, exactly as a text added
  // there would be — the anchor is the one thing about a text that is on the
  // recording's clock.
  const pin = toSourceTime(placed, at);
  if (pin === null) return null;

  return {
    first: { at: text.at, length: at - start },
    second: { at: pin, length: end - at },
  };
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

/**
 * Puts a clip somewhere else in the order.
 *
 * Only the order changes. A clip keeps the footage it covers, its speed and its
 * own settings, and `place` derives every position from the order — so nothing
 * here touches a time.
 *
 * That is also what keeps the zooms and the texts where they were put: both are
 * stored against the *recording's* clock rather than the edit's, so a shot
 * placed over a moment of footage stays over that moment wherever in the film
 * the clip ends up. Anchoring them to the timeline instead would have meant
 * every reorder dragging a zoom onto whatever footage happened to arrive at the
 * same second.
 */
function moveSlice(
  state: EditorState,
  action: Extract<EditorAction, { type: "moveSlice" }>,
): EditorState {
  const slices = slicesOf(state.project);
  const from = slices.findIndex((slice) => slice.id === action.sliceId);
  if (from < 0) return state;

  // Dropped on itself, or into the gap it already fills. Both are no-ops, and
  // they are answered out here rather than inside `edit` because `edit` banks a
  // revision whatever the change turns out to be — so a drag that moved nothing
  // would leave a press of undo that appears to do nothing.
  if (action.before === action.sliceId) return state;
  if (action.before === (slices[from + 1]?.id ?? null)) return state;

  const moved = slices[from]!;
  const rest = slices.filter((slice) => slice.id !== action.sliceId);
  const at =
    action.before === null ? rest.length : rest.findIndex((slice) => slice.id === action.before);
  // A neighbour that is not there any more: dropped at the end rather than
  // refused, which is where a drag that outran its own list was heading.
  rest.splice(at < 0 ? rest.length : at, 0, moved);

  return edit(state, (project) => withSlices(project, rest));
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
    effects: preset.effects,
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
          // Carried whole, `filter: null` included: a preset that could only
          // ever add a look could never be used to take one off.
          effects: { ...preset.effects },
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
    selectedTextId: null,
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
                speed: slice.speed,
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
 * Cuts a zoom in two where the blade landed.
 *
 * Both halves keep the whole look — how far in, what it follows, the ease, the
 * tilt — so the only thing the cut changes is that there are now two moves
 * where there was one. That is visible and it is the point: the picture pulls
 * out at the cut and pushes back in, which is how "look here, then look there"
 * is built. Somebody who wanted one continuous shot would not have cut it.
 */
function splitZoom(state: EditorState, at: MediaTime): EditorState {
  const point = zoomSplitAt(state.project, at);
  if (!point) return state;

  const { zoom, source } = point;
  const created = `${zoom.id}-${String(state.revision + 1)}`;

  return {
    ...edit(state, (project) => ({
      ...project,
      zooms: project.zooms.flatMap((candidate) =>
        candidate.id === zoom.id
          ? [
              { ...candidate, source: { start: candidate.source.start, end: source } },
              { ...candidate, id: created, source: { start: source, end: candidate.source.end } },
            ]
          : [candidate],
      ),
    })),
    // The far half, the way a cut clip hands back its second: "cut, then change
    // this bit" without a second click.
    selectedZoomId: created,
    selectedSliceId: null,
    selectedTextId: null,
  };
}

/**
 * Cuts a text in two where the blade landed.
 *
 * Two titles on the row, each with the whole look and the words. Both keep
 * their entrance and their exit as well, so the words leave at the cut and
 * arrive again — the same bargain the zoom's halves make, and for the same
 * reason: cutting a title in half is how its second half comes to say
 * something else. `text-motion.ts` holds either animation to half the span it
 * has, so a short half is still seen rather than being all entrance.
 */
function splitText(state: EditorState, textId: string, at: MediaTime): EditorState {
  const halves = textSplitAt(state.project, textId, at);
  const text = findText(state.project, textId);
  if (!halves || !text) return state;

  const created = nextTextId(state);

  return {
    ...edit(state, (project) => ({
      ...project,
      texts: project.texts.map((row) =>
        row.slices.some((candidate) => candidate.id === textId)
          ? {
              ...row,
              slices: row.slices
                .flatMap((candidate) =>
                  candidate.id === textId
                    ? [
                        { ...candidate, ...halves.first },
                        {
                          ...candidate,
                          id: created,
                          ...halves.second,
                          // Structurally cloned, as a cut clip's overrides are:
                          // sharing the styles would make retyping one half
                          // silently retype the other.
                          fields: candidate.fields.map((field) => ({
                            ...field,
                            style: { ...field.style },
                          })),
                        },
                      ]
                    : [candidate],
                )
                .sort((a, b) => a.at - b.at),
            }
          : row,
      ),
    })),
    selectedTextId: created,
    selectedSliceId: null,
    selectedZoomId: null,
  };
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
              speed: slice.speed,
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
  //
  // And to the take the clip is in, not the whole recording. This is the only
  // gesture that can grow a slice's source range, so without the second clamp it
  // is the way a clip comes to span a seam — after which it plays its own take's
  // file over the next take's footage, which reads as the addition never having
  // been made.
  const take = takeAround(state.seams, slice, state.duration);
  const bounded = clampTo(source, take.start, take.end);
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

/**
 * Sets a slice's playback rate.
 *
 * A direct field, not a `writeSetting` call: speed moves where every later
 * slice, zoom and caption sits on the timeline, which the settings/overrides
 * system does not expect of anything it resolves.
 */
function setSliceSpeed(
  state: EditorState,
  action: Extract<EditorAction, { type: "setSliceSpeed" }>,
): EditorState {
  const slice = slicesOf(state.project).find((candidate) => candidate.id === action.sliceId);
  if (!slice) return state;

  const speed = clampTo(action.speed, MIN_SPEED, MAX_SPEED);
  if (speed === slice.speed) return state;

  return edit(state, (project) =>
    withSlices(
      project,
      slicesOf(project).map((candidate) =>
        candidate.id === action.sliceId ? { ...candidate, speed } : candidate,
      ),
    ),
  );
}

/**
 * The span of the take a slice sits in.
 *
 * From the seams rather than from any track's segment boundaries, which disagree
 * by however long each device took to open — see `Take` in the manifest. A slice
 * never spans a seam, so its start decides which take it is in.
 */
function takeAround(
  seams: readonly MediaTime[],
  slice: Slice,
  duration: MediaTime,
): { start: MediaTime; end: MediaTime } {
  let start = 0;
  let end = duration;

  for (const seam of seams) {
    if (seam <= slice.source.start) start = Math.max(start, seam);
    else end = Math.min(end, seam);
  }

  return { start, end };
}

export { MIN_SLICE_NS };
