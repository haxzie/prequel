import { useEffect, useMemo, useReducer, useRef, useState, type Dispatch } from "react";

import type { EditorSession } from "../../../shared/contract";
import type { TrackKind } from "../../../shared/manifest";
import { mediaUrl, recordingName } from "../../../shared/media-url";
import {
  newProject,
  resolveSettings,
  WALLPAPER_FILE_NAME,
  type Project,
} from "../../../shared/project";
import { autoZooms, type Moment } from "../../../shared/autoedit";
import { AUTO_PRESET_ID, evenSize } from "../../../shared/presets";
import { cn } from "../lib/cn";
import { PanelIcon, TrashIcon } from "./icons";
import type { Images } from "./webgl";
import { ExportBar } from "./ExportBar";
import { FrameBar } from "./FrameBar";
import { Inspector, PANEL_WIDTH } from "./Inspector";
import { PlaybackControls } from "./PlaybackControls";
import { Preview } from "./Preview";
import {
  activeSettings,
  editorReducer,
  initialState,
  placedSlices,
  selectedSlice,
  slicesOf,
  type EditorAction,
  type EditorState,
} from "./state";
import { TimelineStrip } from "./TimelineStrip";
import { useEditorPlayback } from "./useEditorPlayback";
import { useExport } from "./useExport";
import { useWaveforms } from "./useWaveforms";

/** How long editing pauses before the project is written. */
const SAVE_DEBOUNCE_MS = 600;

/** Stable, so the waveform hook does not see a new list on every render. */
const NO_MEDIA: EditorSession["media"] = [];

/**
 * The editor window.
 *
 * Opened by main when a recording stops, and from the tray's Open Recent. The
 * session arrives over IPC rather than in the route, so a reload restores it.
 */
export function Editor() {
  const [session, setSession] = useState<EditorSession | null>(null);
  const [state, dispatch] = useReducer(editorReducer, newProject("", 0), initialState);
  const [images, setImages] = useState<Images>(new Map());
  // Shown by default: the panel is where the editing happens, and an editor
  // that opens with its controls put away is a puzzle.
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(
    () =>
      window.prequel.editor.onOpen((opened) => {
        setSession(opened);
        dispatch({ type: "load", project: opened.project });
      }),
    [],
  );

  const slices = useMemo(() => slicesOf(state.project), [state.project]);
  const media = useEditorPlayback(session, slices);

  const present = useMemo(
    () => new Set<TrackKind>((session?.media ?? []).map((track) => track.kind)),
    [session],
  );

  // The settings the playhead is currently under, which is not necessarily the
  // ones the inspector is showing — the preview follows the video, the panel
  // follows the selection.
  const previewSettings = useMemo(() => {
    const placed = placedSlices(state.project);
    const at = placed.find(
      (slice) =>
        media.playback.position() >= slice.timelineStart &&
        media.playback.position() < slice.timelineStart + slice.duration,
    );
    const slice = slices.find((candidate) => candidate.id === at?.id) ?? slices[0];
    return resolveSettings(state.project.defaults, slice?.overrides);
  }, [state.project, slices, media.playback]);

  const exportState = useExport(session, state.project);
  // Against the recording's own length rather than the edit's: the peaks are
  // indexed by source time, so cutting the edit shorter must not move them.
  const peaks = useWaveforms(session?.media ?? NO_MEDIA, session?.manifest.duration ?? 0);

  // The span the camera actually covers, not just whether one was recorded.
  // It opens a few hundred ms after the screen, so a clip cut from the very
  // start of the take genuinely has no camera in it and should not claim to.
  const cameraSpan = useMemo(() => {
    const track = session?.media.find((candidate) => candidate.kind === "camera");
    return track ? { start: track.offset, end: track.offset + track.duration } : null;
  }, [session]);

  // From the manifest rather than the video element: the inspector needs it to
  // shape the `wide` bubble before the element has necessarily loaded.
  const cameraSource = useMemo(() => {
    const track = session?.media.find((candidate) => candidate.kind === "camera");
    return track?.width && track.height ? { width: track.width, height: track.height } : null;
  }, [session]);

  const screenSource = useMemo(() => {
    const track = session?.media.find((candidate) => candidate.kind === "screen");
    return track?.width && track.height ? { width: track.width, height: track.height } : null;
  }, [session]);

  useAutoFrame(state.project.frame, screenSource, dispatch);
  useFirstCut(session, state, dispatch);
  usePersistence(session, state.project, state.revision);
  useAudioMix(media, state, session);
  useEditorImages(session, state.project, setImages);
  useShortcuts(media, dispatch, state);

  if (!session) {
    return (
      <Shell>
        <div className="grid flex-1 place-items-center text-editor-muted">Opening recording…</div>
      </Shell>
    );
  }

  return (
    <Shell
      name={session.name}
      actions={
        <>
          <button
            type="button"
            aria-pressed={panelOpen}
            title={panelOpen ? "Hide the panel" : "Show the panel"}
            aria-label={panelOpen ? "Hide the panel" : "Show the panel"}
            className={cn(
              "no-drag grid size-7 place-items-center rounded-lg [&_svg]:size-4",
              panelOpen ? "text-editor-fg" : "text-editor-muted",
              "hover:bg-white/10 hover:text-editor-fg",
            )}
            onClick={() => setPanelOpen((open) => !open)}
          >
            <PanelIcon open={panelOpen} />
          </button>
          <button
            type="button"
            title="Move this recording to the Trash"
            aria-label="Move this recording to the Trash"
            className="no-drag grid size-7 place-items-center rounded-lg text-editor-muted hover:bg-cut/20 hover:text-editor-fg [&_svg]:size-4"
            onClick={() => void window.prequel.editor.deleteRecording(session.dir)}
          >
            <TrashIcon />
          </button>
          <ExportBar state={exportState} />
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
              cameraSource={cameraSource}
              settings={previewSettings}
              media={media}
              images={images}
              cursor={session.cursor}
              zooms={state.project.zooms}
              onMoveCamera={(x, y) => {
                dispatch({ type: "setSetting", section: "layout", key: "cameraX", value: x });
                dispatch({ type: "setSetting", section: "layout", key: "cameraY", value: y });
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
              frame={state.project.frame}
              cameraSource={cameraSource}
              wallpaperUrl={mediaUrl(recordingName(session.dir), WALLPAPER_FILE_NAME)}
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
          onSplit={() => dispatch({ type: "split", at: media.playback.position() })}
          onDelete={() => {
            if (state.selectedZoomId) {
              dispatch({ type: "deleteZoom", zoomId: state.selectedZoomId });
            } else if (state.selectedSliceId) {
              dispatch({ type: "deleteSlice", sliceId: state.selectedSliceId });
            }
          }}
          dispatch={dispatch}
        />
        <TimelineStrip
          state={state}
          dispatch={dispatch}
          media={media}
          peaks={peaks}
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
    </Shell>
  );
}

function Shell({
  name,
  actions,
  children,
}: {
  name?: string;
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
      <header className="drag flex h-[38px] flex-none items-center gap-3 border-b border-editor-line pr-3 pl-20">
        <span className="flex-1 truncate text-[13px] font-medium">{name ?? "Editor"}</span>
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

    const moments: Moment[] = [
      ...(session.manifest.clicks ?? []).map((click) => ({ ...click, kind: "click" as const })),
      // The middle of the field, which is what a zoom would frame anyway.
      ...(session.manifest.typing ?? []).map((span) => ({
        at: span.at,
        x: span.x + span.width / 2,
        y: span.y + span.height / 2,
        kind: "typing" as const,
      })),
    ];

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
 * closing the window cannot lose the last edit — `beforeunload` is synchronous,
 * which is exactly what is needed here.
 */
function usePersistence(session: EditorSession | null, project: unknown, revision: number) {
  const latest = useRef({ session, project });
  latest.current = { session, project };

  useEffect(() => {
    // Revision 0 is the project as loaded. Saving it would create a
    // `project.json` for a recording nobody has edited.
    if (!session || revision === 0) return;

    const timer = setTimeout(() => {
      void window.prequel.editor.saveProject(session.dir, project as never);
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [session, project, revision]);

  useEffect(() => {
    const flush = () => {
      const { session: current, project: pending } = latest.current;
      if (current && revision > 0) {
        void window.prequel.editor.saveProject(current.dir, pending as never);
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [revision]);
}

/** Pushes the resolved audio settings into the live graph. */
function useAudioMix(
  media: ReturnType<typeof useEditorPlayback>,
  state: ReturnType<typeof initialState>,
  session: EditorSession | null,
) {
  const settings = activeSettings(state);
  const slice = selectedSlice(state);

  useEffect(() => {
    if (!session) return;
    // The playhead's slice rather than the selected one would be more correct
    // mid-playback; the difference only shows while a clip is selected that is
    // not playing, and following the selection is what makes the fader respond
    // to the thing being adjusted.
    const resolved = resolveSettings(state.project.defaults, slice?.overrides);

    media.setGain("microphone", {
      volume: resolved.audio.micVolume,
      muted: resolved.audio.micMuted,
    });
    media.setGain("system_audio", {
      volume: resolved.audio.systemVolume,
      muted: resolved.audio.systemMuted,
    });
  }, [media, session, state.project.defaults, slice?.overrides, settings]);
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
  const paths = imagePaths(project, session?.cursor?.path).join("\u0000");

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
function imagePaths(project: ReturnType<typeof newProject>, cursor?: string): string[] {
  const paths = new Set<string>();
  if (cursor) paths.add(cursor);

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
