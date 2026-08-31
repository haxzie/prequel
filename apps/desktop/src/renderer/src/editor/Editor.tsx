import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
} from "react";

import { CURSOR_FILES, mayExport, type EditorSession } from "../../../shared/contract";
import type { TrackKind } from "../../../shared/manifest";
import { mediaUrl, recordingName } from "../../../shared/media-url";
import { newProject, outputFrame, type Project, type ZoomSlice } from "../../../shared/project";
import { augmentZooms, autoZooms, type Moment } from "../../../shared/autoedit";
import { AUTO_PRESET_ID, evenSize } from "../../../shared/presets";
import { cn } from "../lib/cn";
import { FolderIcon, TrashIcon, WandIcon } from "./icons";
import type { Images } from "./webgl";
import { ExportButton } from "./ExportButton";
import { ExportDialog } from "./ExportDialog";
import { UpgradeDialog } from "./UpgradeDialog";
import { FrameBar } from "./FrameBar";
import { Inspector, PANEL_WIDTH } from "./Inspector";
import { PlaybackControls } from "./PlaybackControls";
import { Preview, type Grab } from "./Preview";
import { useCaptions } from "./useCaptions";
import { useCaptionImages } from "./useCaptionImages";
import { useTranscription } from "./useTranscription";
import {
  settingsOf,
  canUndo,
  editorReducer,
  initialState,
  slicesOf,
  zoomInProject,
  type EditorAction,
  type EditorState,
} from "./state";
import { CLIP_H, TimelineStrip } from "./TimelineStrip";
import { useEditorPlayback } from "./useEditorPlayback";
import { useExport } from "./useExport";
import { useFilmstrip } from "./useFilmstrip";
import { useLicence } from "../hooks/useLicence";
import { useWaveforms } from "./useWaveforms";

/** How long editing pauses before the project is written. */
const SAVE_DEBOUNCE_MS = 600;

/**
 * How long a zoom's controls sit still before its span is played back.
 *
 * Long enough to cover the gap between two deliberate changes — nudging a slider
 * with the arrow keys, or picking a preset and then adjusting it — and short
 * enough that letting go of a drag is followed by the preview rather than by a
 * wait for it.
 */
const ZOOM_PREVIEW_SETTLE_MS = 400;

/**
 * The editor, one of the app window's two screens.
 *
 * The session is handed in rather than fetched: `Workspace` above owns which
 * recording is on show, and subscribing here as well would mean the push
 * arriving before this had mounted on a switch between two recordings.
 *
 * Mounted under a key of the recording's directory, so opening a second
 * recording is a fresh editor rather than a reducer carrying the first one's
 * selection, history and playhead into it.
 */
export function Editor({ session, onBack }: { session: EditorSession; onBack: () => void }) {
  const [state, dispatch] = useReducer(editorReducer, newProject("", 0), initialState);
  const [images, setImages] = useState<Images>(new Map());
  // Shown by default: the panel is where the editing happens, and an editor
  // that opens with its controls put away is a puzzle.
  const [panelOpen, setPanelOpen] = useState(true);
  /**
   * What the panel is showing, and so what brings it back.
   *
   * The panel's own close button is the only way to put it away, and closing it
   * clears the selection — so selecting anything again is both the natural way
   * to want it back and proof that it is wanted. Without this, a click on a clip
   * put that clip's settings somewhere the user could no longer reach, and the
   * click read as doing nothing at all.
   */
  const selected = state.selectedSliceId ?? state.selectedZoomId;
  const [exportOpen, setExportOpen] = useState(false);
  /**
   * The upgrade prompt, which stands in for the export dialog rather than
   * sitting over it. Only one of the two is ever open.
   */
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const { entitlement, check: checkLicence } = useLicence();
  /** A still of the composition, taken when the export dialog opens. */
  const [poster, setPoster] = useState<string | null>(null);
  const grab = useRef<Grab | null>(null);

  // The manifest's duration, which is the only place the recording's real
  // length is known — the project itself does not carry one, and every trim is
  // clamped against this. Re-run when the session changes because main re-sends
  // it on every load, which is what restores the edit after an HMR round trip.
  useEffect(() => {
    dispatch({ type: "load", project: session.project, duration: session.manifest.duration });
  }, [session]);

  const slices = useMemo(() => slicesOf(state.project), [state.project]);
  const media = useEditorPlayback(session, slices);

  // Off the manifest, so it is fixed for the recording. Recomputing it per
  // render would rebuild an array of every click on every slider drag.
  const autoMoments = useMemo(() => momentsOf(session), [session]);

  const present = useMemo(
    () => new Set<TrackKind>(session.media.map((track) => track.kind)),
    [session],
  );

  // The settings the playhead is currently under, which is not necessarily the
  // ones the inspector is showing — the preview follows the video, the panel
  // follows the selection.
  //
  // Keyed off `media.sliceId`, which the playback loop updates as the playhead
  // crosses a cut. It used to read `playback.position()` inside a memo that
  // depended on the project, so it was resolved once per edit and then frozen:
  // every clip after the first drew with whatever layout happened to be under
  // the playhead when the project last changed. Per-slice layouts were being
  // saved and exported correctly the whole time and simply never shown.
  const previewSettings = useMemo(
    () => settingsOf(state.project, media.sliceId),
    [state.project, media.sliceId],
  );

  /**
   * What the slice under the playhead is arriving from.
   *
   * Null on the first slice, which has nothing behind it to travel from. The
   * plan is rebuilt every frame from this, so the camera's move is drawn by the
   * preview and rasterised by the exporter off the same keyframes — the
   * transition is in the plan rather than in either renderer.
   */
  const previewEnter = useMemo(() => {
    const index = slices.findIndex((slice) => slice.id === media.sliceId);
    const previous = index > 0 ? slices[index - 1] : undefined;
    const current = index >= 0 ? slices[index] : undefined;

    if (!previous || !current) return null;
    return { from: settingsOf(state.project, previous.id), source: current.source };
  }, [state.project, slices, media.sliceId]);

  // Latest, so the debounced preview below plays the zoom as it is when the
  // timer fires rather than as it was when the first change landed.
  const zoomToPreview = useRef<ZoomSlice | null>(null);
  zoomToPreview.current =
    state.project.zooms.find((candidate) => candidate.id === state.selectedZoomId) ?? null;

  const previewTimer = useRef<number | null>(null);

  /**
   * Plays the selected zoom's span once, a moment after its controls settle.
   *
   * Debounced because a slider is a stream of changes, not one: playing on each
   * would restart the span sixty times a second and never show any of it. The
   * wait is what makes this read as "let go and watch it" rather than as
   * playback fighting the drag.
   */
  const previewZoom = useCallback(() => {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);

    previewTimer.current = window.setTimeout(() => {
      previewTimer.current = null;

      const zoom = zoomToPreview.current;
      if (!zoom) return;

      // Null where the zoom straddles a cut, and there is no single span to play.
      const span = zoomInProject(state.project, zoom);
      if (span) media.playback.playRange(span.start, span.end);
    }, ZOOM_PREVIEW_SETTLE_MS);
  }, [state.project, media.playback]);

  // Or a preview fires against an editor that has already been left.
  useEffect(
    () => () => {
      if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    },
    [],
  );

  // Drawn against the export frame rather than the editor's, so one set of
  // bitmaps serves the preview and the export and the preview only samples
  // them down. `useExport` lays its plan out in this frame too.
  const captionFrame = useMemo(
    () => outputFrame(state.project.frame, state.project.output.shortEdge),
    [state.project.frame, state.project.output.shortEdge],
  );

  const transcription = useTranscription(session);
  // The project defaults rather than the playhead's settings: captions are
  // project-wide, and reading them off whichever clip the playhead is under
  // would re-rasterise every cue on every cut.
  const captions = useCaptions(session, state.project.defaults.captions, captionFrame);
  useCaptionImages(session, captions.cues, media, setImages);

  const exportState = useExport(session, state.project, state.project.output, captions);

  /**
   * Opens the dialog, then fills its picture in.
   *
   * The still cannot be taken by the dialog itself — it has to come out of the
   * preview's own draw loop, which is the only place the WebGL buffer still
   * holds anything. Opening first rather than awaiting first is deliberate: the
   * grab resolves on the next drawn frame, and a preview that is not drawing
   * would otherwise mean a button that does nothing at all.
   */
  const showExport = useCallback(async () => {
    setExportOpen(true);
    setPoster((await grab.current?.()) ?? null);
  }, []);

  /**
   * The upgrade dialog getting out of the way.
   *
   * Signing in or paying happens in a browser and comes back as a broadcast
   * minutes later, in a window nobody is looking at. Leaving the prompt up with
   * an Upgrade button that is no longer true would read as the payment having
   * failed — so the moment the answer says otherwise, this becomes the export
   * the user pressed for in the first place.
   */
  useEffect(() => {
    if (!upgradeOpen || !mayExport(entitlement)) return;
    setUpgradeOpen(false);
    void showExport();
  }, [upgradeOpen, entitlement, showExport]);

  /**
   * What the Export button actually does: ask whether it may, then do it.
   *
   * The licence is checked here rather than watched continuously, because this
   * is the one moment the answer decides anything — and it is the moment
   * somebody has just paid on the website and come back. A stale "expired"
   * shown to a paying customer is the worst version of this feature, and it
   * costs one request against a click that already waits for a frame.
   */
  const openExport = async () => {
    const licence = await checkLicence();

    if (!mayExport(licence)) {
      setUpgradeOpen(true);
      return;
    }

    await showExport();
  };
  // Against the recording's own length rather than the edit's: the peaks are
  // indexed by source time, so cutting the edit shorter must not move them.
  const peaks = useWaveforms(session.media, session.manifest.duration);
  // Indexed by source time for the same reason, so a cut neither moves the
  // thumbnails nor asks for them to be extracted again.
  const filmstrip = useFilmstrip(session.media, session.manifest.duration, CLIP_H);

  // The span the camera actually covers, not just whether one was recorded.
  // It opens a few hundred ms after the screen, so a clip cut from the very
  // start of the take genuinely has no camera in it and should not claim to.
  const cameraSpan = useMemo(() => {
    const track = session.media.find((candidate) => candidate.kind === "camera");
    return track ? { start: track.offset, end: track.offset + track.duration } : null;
  }, [session]);

  // From the manifest rather than the video element: the inspector needs it to
  // shape the `wide` bubble before the element has necessarily loaded.
  const cameraSource = useMemo(() => {
    const track = session.media.find((candidate) => candidate.kind === "camera");
    return track?.width && track.height ? { width: track.width, height: track.height } : null;
  }, [session]);

  const screenSource = useMemo(() => {
    const track = session.media.find((candidate) => candidate.kind === "screen");
    return track?.width && track.height ? { width: track.width, height: track.height } : null;
  }, [session]);

  useAutoFrame(state.project.frame, screenSource, dispatch);
  useFirstCut(session, state, dispatch);
  usePersistence(session, state.project, state.revision);
  useAudioMix(media, state, session);
  useEditorImages(session, state.project, setImages);
  useShortcuts(media, dispatch, state);

  useEffect(() => {
    if (selected !== null) setPanelOpen(true);
  }, [selected]);

  return (
    <Shell
      name={session.name}
      onBack={onBack}
      actions={
        <>
          {/* Runs the automatic pass again over the edit as it stands. Enabled
              only when the recording gave it something to work from — with no
              clicks and no typing there is nothing to find, and a button that
              visibly does nothing is worse than one that says it cannot. */}
          <button
            type="button"
            disabled={autoMoments.length === 0}
            title={
              autoMoments.length === 0
                ? "Nothing to work from: this recording has no clicks or typing"
                : "Add zooms for anything not already covered"
            }
            aria-label="Add zooms automatically"
            className="no-drag grid size-7 place-items-center rounded-lg text-editor-muted hover:bg-white/10 hover:text-editor-fg disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4"
            onClick={() =>
              dispatch({
                type: "setZooms",
                zooms: augmentZooms(state.project.zooms, autoMoments, {
                  duration: session.manifest.duration,
                  hasCursor: session.cursor !== null,
                }),
              })
            }
          >
            <WandIcon />
          </button>
          <button
            type="button"
            title="Move this recording to the Trash"
            aria-label="Move this recording to the Trash"
            className="no-drag grid size-7 place-items-center rounded-lg text-editor-muted hover:bg-cut/20 hover:text-editor-fg [&_svg]:size-4"
            onClick={() => void window.prequel.projects.delete(session.dir)}
          >
            <TrashIcon />
          </button>
          <ExportButton onOpen={() => void openExport()} />
        </>
      }
    >
      {/* The transport and the timeline run the full width under both panes.
          A timeline is a ruler for the whole edit, and boxing it into the
          column beside the inspector made it narrower than the thing it
          measures — the zoom had to work harder for no reason. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          {/* `min-h-0` as well as `min-w-0`: a flex item defaults to
            `min-height: auto`, so this column refuses to shrink below its
            content — and the canvas reports an intrinsic 1920×1080. Without it
            the column grows past the row and the timeline is clipped away by
            the shell's `overflow-hidden`. */}
          {/* The frame bar and the composition share one surface, so the bar
              reads as part of the canvas rather than as chrome above it. */}
          <div className="dot-grid flex min-h-0 min-w-0 flex-1 flex-col bg-editor-bg">
            <FrameBar
              frame={state.project.frame}
              recorded={screenSource}
              onChange={(frame) => dispatch({ type: "setFrame", frame })}
            />
            <Preview
              frame={state.project.frame}
              settings={previewSettings}
              enter={previewEnter}
              media={media}
              images={images}
              cursor={session.cursor}
              zooms={state.project.zooms}
              cues={captions.cues}
              grab={grab}
              onLayout={(patch) => {
                // One dispatch per key, because that is what the override
                // bookkeeping counts in: a gesture that writes five keys has to
                // mark five keys as set for this clip, or resetting one of them
                // would take its neighbours with it.
                for (const [key, value] of Object.entries(patch)) {
                  dispatch({ type: "setSetting", section: "layout", key, value });
                }
              }}
            />
          </div>

          {/* Always mounted, so it has something to animate out of. Width is
              what moves rather than a transform: the composition beside it has
              to take the space back as it goes, and a panel that slid away
              leaving a gap would be worse than one that simply vanished.
              `overflow-hidden` keeps the content its full width throughout, so
              nothing reflows on the way past. */}
          <div
            aria-hidden={!panelOpen}
            className={cn(
              "flex flex-none overflow-hidden transition-[width,opacity] duration-200 ease-out",
              panelOpen ? "opacity-100" : "pointer-events-none opacity-0",
            )}
            style={{ width: panelOpen ? PANEL_WIDTH : 0 }}
          >
            <Inspector
              state={state}
              dispatch={dispatch}
              present={present}
              hasCursor={session.cursor !== null}
              captions={transcription}
              frame={state.project.frame}
              cameraSource={cameraSource}
              onPreviewZoom={previewZoom}
              // Deselects both kinds, rather than working out which one the
              // panel is showing: only one can be set at a time, and clearing
              // the other is free where asking which is live is a branch that
              // has to be kept right.
              onClose={() => {
                dispatch({ type: "select", sliceId: null });
                dispatch({ type: "selectZoom", zoomId: null });
                setPanelOpen(false);
              }}
              // Everything the panels draw comes out of the session
              // directory: the desktop picture, the background images copied
              // in when they were chosen, and every pointer image, which
              // `cursorLayer` copies whether or not it is the chosen one. The
              // same files the preview composites, rather than second copies
              // bundled for the panel to show.
              fileUrl={(file) => mediaUrl(recordingName(session.dir), file)}
              onPickWallpaper={async () => {
                const result = await window.prequel.editor.wallpaper(session.dir);
                if (result.ok && result.value) {
                  dispatch({
                    type: "setSetting",
                    section: "background",
                    key: "background",
                    value: { kind: "image", source: "wallpaper", path: result.value.path },
                  });
                }
              }}
              onPickPreset={async (presetId) => {
                const result = await window.prequel.editor.presetImage(session.dir, presetId);
                if (result.ok && result.value) {
                  dispatch({
                    type: "setSetting",
                    section: "background",
                    key: "background",
                    value: { kind: "image", source: "preset", path: result.value.path },
                  });
                }
              }}
              onPickImage={async () => {
                const result = await window.prequel.editor.pickImage(session.dir);
                if (result.ok && result.value) {
                  dispatch({
                    type: "setSetting",
                    section: "background",
                    key: "background",
                    value: { kind: "image", source: "file", path: result.value.path },
                  });
                }
              }}
            />
          </div>
        </div>

        <PlaybackControls
          media={media}
          // Both act on the selection, and the two are mutually exclusive —
          // only one of them is ever the thing being removed.
          canSplit={state.selectedSliceId !== null}
          canDelete={state.selectedSliceId !== null || state.selectedZoomId !== null}
          canUndo={canUndo(state)}
          onSplit={() => dispatch({ type: "split", at: media.playback.position() })}
          onDelete={() => {
            if (state.selectedZoomId) {
              dispatch({ type: "deleteZoom", zoomId: state.selectedZoomId });
            } else if (state.selectedSliceId) {
              dispatch({ type: "deleteSlice", sliceId: state.selectedSliceId });
            }
          }}
          onUndo={() => dispatch({ type: "undo" })}
          dispatch={dispatch}
        />
        <TimelineStrip
          state={state}
          dispatch={dispatch}
          media={media}
          peaks={peaks}
          filmstrip={filmstrip}
          cameraSpan={cameraSpan}
        />
      </div>

      {/* Off screen rather than hidden: a `display: none` video is not
          guaranteed to decode, and the compositor draws from these elements.

          `crossOrigin` on every one of them. `prequel-media:` is a different
          origin from the renderer, and without this the element loads in
          no-CORS mode and is tainted whatever headers come back — which costs
          the audio entirely, because a tainted element routed through
          `createMediaElementSource` outputs silence rather than failing. The
          video elements are marked too: they are drawn to a canvas, and a
          tainted one poisons anything that later reads pixels back off it. */}
      <div className="pointer-events-none absolute -top-px size-px overflow-hidden opacity-0">
        {session.media.map((track) =>
          track.kind === "screen" || track.kind === "camera" ? (
            <video
              key={track.kind}
              ref={media.register(track.kind)}
              src={track.url}
              crossOrigin="anonymous"
              muted
              playsInline
              preload="auto"
            />
          ) : (
            <audio
              key={track.kind}
              ref={media.register(track.kind)}
              src={track.url}
              crossOrigin="anonymous"
              preload="auto"
            />
          ),
        )}
      </div>

      {/* Unmounted when closed rather than hidden. Its preview is a playing
          `<video>` of the finished export, and one left decoding behind a
          dismissed dialog is a whole media element's worth of work spent on
          something nobody can see. */}
      {upgradeOpen && (
        <UpgradeDialog
          entitlement={entitlement}
          onUpgrade={() => void window.prequel.licence.upgrade()}
          onSignIn={() => void window.prequel.auth.signIn()}
          onClose={() => setUpgradeOpen(false)}
        />
      )}

      {exportOpen && (
        <ExportDialog
          state={exportState}
          output={state.project.output}
          poster={poster}
          onChange={(output) => dispatch({ type: "setOutput", output })}
          onClose={() => {
            setExportOpen(false);
            // A render still going keeps its progress, so pressing Export again
            // reopens onto it rather than onto a fresh set of options. A
            // finished one has been seen — closing is the acknowledgement, and
            // without this the next open would still be showing the last file.
            if (!exportState.running) exportState.dismiss();
          }}
        />
      )}
    </Shell>
  );
}

function Shell({
  name,
  onBack,
  actions,
  children,
}: {
  name: string;
  onBack: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    // `min-h-0 flex-1` rather than `h-full`: this is a flex child of `#root`,
    // and a flex item that cannot shrink below its content pushes the bottom of
    // the window out of view instead of letting the middle give way.
    <div className="editor-theme relative flex min-h-0 flex-1 flex-col overflow-hidden bg-editor-bg text-editor-fg">
      {/* Dragging the bar moves the window, and the inset traffic lights need
          the room on the left. */}
      <header className="drag flex h-[38px] flex-none items-center gap-1.5 border-b border-editor-line pr-3 pl-20">
        {/* `no-drag`, or this moves the window instead of navigating — the one
            mistake this bar makes easy to make. */}
        <button
          type="button"
          onClick={onBack}
          title="Back to Projects"
          className="no-drag flex flex-none items-center gap-1.5 rounded-lg px-1.5 py-1 text-[13px] text-editor-muted hover:bg-white/10 hover:text-editor-fg [&_svg]:size-3.5"
        >
          <FolderIcon />
          Projects
        </button>
        <span aria-hidden className="flex-none text-[13px] text-editor-muted/50">
          /
        </span>
        <span className="flex-1 truncate pr-1.5 text-[13px] font-medium">{name}</span>
        {actions}
      </header>
      {children}
    </div>
  );
}

/**
 * Keeps an automatic frame the size of the recording.
 *
 * The frame is stored as dimensions, not as a rule, because everything
 * downstream — the plan, the exporter, the preview — wants a number. This is
 * what turns the rule back into numbers, once, when the recording opens and
 * again if it is ever reopened at a different size.
 *
 * Revision 0 is the project as loaded, so filling the size in here does not
 * count as an edit and does not create a `project.json` for a recording nobody
 * has touched — `usePersistence` ignores it.
 */
function useAutoFrame(
  frame: Project["frame"],
  recorded: { width: number; height: number } | null,
  dispatch: Dispatch<EditorAction>,
) {
  useEffect(() => {
    if (frame.presetId !== AUTO_PRESET_ID || !recorded) return;

    const width = evenSize(recorded.width);
    const height = evenSize(recorded.height);
    // Guarded, or this dispatches on every render — the reducer returns a new
    // project each time and the effect would see a new frame object.
    if (frame.width === width && frame.height === height) return;

    dispatch({ type: "setFrame", frame: { width, height, presetId: AUTO_PRESET_ID } });
  }, [frame, recorded, dispatch]);
}

/**
 * What happened in the recording, in the form the automatic pass reads.
 *
 * Shared by the first cut and the wand, so the two can never disagree about
 * what counts as a moment.
 */
function momentsOf(session: EditorSession): Moment[] {
  return [
    ...(session.manifest.clicks ?? []).map((click) => ({ ...click, kind: "click" as const })),
    // The middle of the field, which is what a zoom would frame anyway.
    ...(session.manifest.typing ?? []).map((span) => ({
      at: span.at,
      x: span.x + span.width / 2,
      y: span.y + span.height / 2,
      kind: "typing" as const,
    })),
  ];
}

/**
 * Makes the first cut, once.
 *
 * Only on a project nobody has touched: revision 0, and no zooms of its own.
 * Both conditions matter — the first stops it running again on every reopen,
 * and the second means a recording whose zooms were all deleted stays that way
 * rather than growing them back, which would be the app arguing.
 *
 * Everything it adds is an ordinary zoom, so disagreeing with it is dragging or
 * deleting, not undoing something opaque.
 */
function useFirstCut(
  session: EditorSession | null,
  state: EditorState,
  dispatch: Dispatch<EditorAction>,
) {
  const made = useRef(false);

  useEffect(() => {
    if (!session || made.current) return;
    if (state.revision !== 0 || state.project.zooms.length > 0) return;

    const moments = momentsOf(session);

    // Marked before dispatching rather than after: `zooms.length > 0` only
    // becomes true on the next render, and without this the effect would run
    // again in between and add them twice.
    made.current = true;
    if (moments.length === 0) return;

    const zooms = autoZooms(moments, {
      duration: session.manifest.duration,
      hasCursor: session.cursor !== null,
    });
    if (zooms.length > 0) dispatch({ type: "setZooms", zooms });
  }, [session, state.revision, state.project.zooms.length, dispatch]);
}

/**
 * Writes the project after editing pauses.
 *
 * Debounced because dragging a slider is a 60 Hz stream of changes, and a write
 * per frame would be hard on the disk for no benefit. Flushed on the way out so
 * leaving cannot lose the last edit — `beforeunload` is synchronous, which is
 * exactly what is needed when the window is closing.
 */
function usePersistence(session: EditorSession | null, project: unknown, revision: number) {
  const latest = useRef({ session, project, revision });
  latest.current = { session, project, revision };

  useEffect(() => {
    // Revision 0 is the project as loaded. Saving it would create a
    // `project.json` for a recording nobody has edited.
    if (!session || revision === 0) return;

    const timer = setTimeout(() => {
      void window.prequel.editor.saveProject(session.dir, project as never);
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [session, project, revision]);

  // Mounted once, deliberately: the cleanup *is* the unmount flush, and a
  // dependency here would make it run on every edit and undo the debounce
  // above. Everything it needs is read off the ref.
  useEffect(() => {
    const flush = () => {
      const { session: current, project: pending, revision: at } = latest.current;
      if (current && at > 0) {
        void window.prequel.editor.saveProject(current.dir, pending as never);
      }
    };

    window.addEventListener("beforeunload", flush);

    return () => {
      window.removeEventListener("beforeunload", flush);
      // Going back to the grid is not an unload, so `beforeunload` never fires
      // — and the debounce above cancels its own pending write on the way out.
      // Without this the last edit before the click is simply gone, which is
      // the kind of loss nobody notices until they reopen the recording.
      flush();
    };
  }, []);
}

/**
 * Pushes the resolved audio settings into the live graph.
 *
 * Keyed to the slice under the playhead, not the selected one. Following the
 * selection meant the mix answered a question nobody was asking: what is being
 * *edited*, rather than what is being *heard*. Two ways that showed:
 *
 * Selecting a zoom clears the clip selection — the inspector shows one thing at
 * a time — so the mix fell back to the project defaults, and a clip whose audio
 * had been muted played at full volume for the whole of the zoom preview. The
 * mute was still saved and still exported; only the thing you were listening to
 * ignored it.
 *
 * And during ordinary playback across a cut, the mix stayed on whichever clip
 * happened to be selected rather than the one making the sound.
 *
 * Nothing is lost by the change: a fader is dragged while paused, where there is
 * no audio either way, and once playing the clip you can hear is the one the
 * playhead is in. The gains are ramped in `AudioMixer.set`, so a change at a
 * boundary slides rather than clicks.
 */
function useAudioMix(
  media: ReturnType<typeof useEditorPlayback>,
  state: ReturnType<typeof initialState>,
  session: EditorSession | null,
) {
  const { audio } = settingsOf(state.project, media.sliceId);

  // The four values rather than the object they came out of: `settingsOf`
  // resolves a fresh one every render, so depending on it would push the whole
  // mix into the graph on every frame of every drag.
  useEffect(() => {
    if (!session) return;

    media.setGain("microphone", { volume: audio.micVolume, muted: audio.micMuted });
    media.setGain("system_audio", { volume: audio.systemVolume, muted: audio.systemMuted });
  }, [media, session, audio.micVolume, audio.micMuted, audio.systemVolume, audio.systemMuted]);
}

/**
 * Loads every image the plan will ask for.
 *
 * Backgrounds *and* the pointer, keyed by the path the plan names them by. Not
 * just the project default background either: a clip can override its own, and
 * loading only the default would leave that clip drawing a flat placeholder for
 * the whole of its span.
 *
 * The pointer belongs here for the same reason. The canvas skips an image it
 * was never given rather than drawing a black square, which is right — but it
 * means an omission shows up as something quietly missing from the picture and
 * nowhere else. That is exactly how the pointer came to be absent from both the
 * preview and the export while every other part of it worked.
 */
function useEditorImages(
  session: EditorSession | null,
  project: ReturnType<typeof newProject>,
  setImages: (images: Images) => void,
) {
  // Joined so the effect re-runs when the set changes rather than on every
  // edit — a project object is new on each keystroke.
  const paths = imagePaths(project, CURSOR_FILES).join("\u0000");

  useEffect(() => {
    if (!session || !paths) return;

    let cancelled = false;
    const loaded: Images = new Map();
    const wanted = paths.split("\u0000");

    for (const path of wanted) {
      const image = new Image();
      // Before `src`, or the request is already in flight without it. The same
      // reason the media elements carry it: `prequel-media:` is a different
      // origin, and an image fetched without CORS is tainted. Canvas 2D merely
      // taints the canvas back; WebGL *throws* on `texImage2D`, and the throw
      // takes the whole frame down with it — a blank preview, from a missing
      // attribute on a background nobody was looking at.
      image.crossOrigin = "anonymous";
      image.src = mediaUrl(recordingName(session.dir), path);

      image.onload = () => {
        if (cancelled) return;
        loaded.set(path, image);
        // A fresh Map each time, because the canvas reads it by identity.
        setImages(new Map(loaded));
      };
      image.onerror = () => console.warn(`[editor] could not load ${path}`);
    }

    return () => {
      cancelled = true;
    };
  }, [session, paths, setImages]);
}

/** Every distinct image path the plan can name, across defaults and clips. */
function imagePaths(project: ReturnType<typeof newProject>, cursors: readonly string[]): string[] {
  // Every pointer image, because which one is drawn is a setting that can change
  // without the recording changing — and the hand is not a setting at all — and
  // they are tiny.
  const paths = new Set<string>(cursors);

  const add = (background: { kind: string; path?: string } | undefined) => {
    if (background?.kind === "image" && background.path) paths.add(background.path);
  };

  add(project.defaults.background.background);
  for (const track of project.tracks) {
    for (const slice of track.slices) add(slice.overrides.background?.background);
  }

  return [...paths];
}

/** The shortcuts worth having before there is a menu bar. */
function useShortcuts(
  media: ReturnType<typeof useEditorPlayback>,
  dispatch: Dispatch<EditorAction>,
  state: EditorState,
) {
  // Read through a ref so the listener is bound once rather than rebound on
  // every edit — the selection and tool change constantly.
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Never while typing in a field, or a space would toggle playback instead
      // of being a space, and D would change tool mid-word.
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      // Before the guard below, which exists to keep single-key shortcuts from
      // firing on system chords — and ⌘Z is exactly such a chord.
      if ((event.metaKey || event.ctrlKey) && event.code === "KeyZ" && !event.shiftKey) {
        event.preventDefault();
        dispatch({ type: "undo" });
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;

      switch (event.code) {
        case "Space":
          event.preventDefault();
          media.onInteract();
          media.playback.toggle();
          return;

        // Cuts where the playhead is, which is the only place a cut happens
        // now that there is no blade to aim with.
        case "KeyS":
          event.preventDefault();
          dispatch({ type: "split", at: media.playback.position() });
          return;

        case "Backspace":
        case "Delete": {
          // Whichever of the two is selected — they are mutually exclusive, so
          // there is never a question of which one Backspace means.
          const { selectedSliceId, selectedZoomId } = latest.current;
          if (selectedZoomId) {
            event.preventDefault();
            dispatch({ type: "deleteZoom", zoomId: selectedZoomId });
            return;
          }
          if (!selectedSliceId) return;
          event.preventDefault();
          dispatch({ type: "deleteSlice", sliceId: selectedSliceId });
          return;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [media, dispatch]);
}
