import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
} from "react";

import {
  CURSOR_FILES,
  mayExport,
  type EditorSession,
  type TrackMedia,
} from "../../../shared/contract";
import { seamsOf, type MediaTime, type TrackKind } from "../../../shared/manifest";
import { mediaUrl, recordingName } from "../../../shared/media-url";
import {
  clickSoundId,
  keySoundId,
  newProject,
  outputFrame,
  SOUND_OFF,
  type Project,
  type TextSlice,
  type ZoomSlice,
} from "../../../shared/project";
import {
  presetCarriesImage,
  presetNeedsBackground,
  type ScenePreset,
} from "../../../shared/scene-presets";
import { augmentZooms, autoZooms, whileTyping, type Moment } from "../../../shared/autoedit";
import { AUTO_PRESET_ID, evenSize } from "../../../shared/presets";
import { cn } from "../lib/cn";
import { FolderIcon, TrashIcon, WandIcon } from "./icons";
import type { Images } from "./webgl";
import type { CaptionEditing } from "./CaptionEditor";
import { mergeWords, realignWords, survivingWords, wordsWithin } from "./captionText";
import { ExportButton } from "./ExportButton";
import { ExportDialog } from "./ExportDialog";
import { UpgradeDialog } from "./UpgradeDialog";
import { FrameBar } from "./FrameBar";
import { Inspector, PANEL_WIDTH, type CategoryId } from "./Inspector";
import { PlaybackControls } from "./PlaybackControls";
import { Preview, type Grab, type Picked } from "./Preview";
import { asCard } from "./poster";
import { previewReady } from "./ready";
import { matteKey, mediaKey } from "./segments";
import { useScenePresets } from "./useScenePresets";
import { useBackgrounds } from "./useBackgrounds";
import { useCaptions } from "./useCaptions";
import { useCaptionImages } from "./useCaptionImages";
import { useFonts } from "./useFonts";
import { useTextBitmaps } from "./useTextBitmaps";
import { useCursorTags } from "./useCursorTags";
import { useTranscription } from "./useTranscription";
import { transcriptForShare } from "./shareTranscript";
import {
  settingsOf,
  canUndo,
  editorReducer,
  findText,
  initialState,
  slicesOf,
  textInProject,
  textSpanNear,
  zoomInProject,
  zoomSpanNear,
  type EditorAction,
  type EditorState,
} from "./state";
import { CLIP_FRAME_H, TimelineStrip } from "./TimelineStrip";
import { place, spanInProject, toProjectTime, toSourceTime } from "./timeline";
import { useEditorPlayback } from "./useEditorPlayback";
import type { MediaKey } from "./segments";
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

/** How much of the hold a text's replay shows either side of its motion. */
const TEXT_PREVIEW_HOLD_NS = 700_000_000;

/** A text no longer than this replays whole when its template changes. */
const TEXT_PREVIEW_WHOLE_NS = 6_000_000_000;

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
  // Seeded from the recording rather than from a placeholder. Effects in the
  // first commit all read the state of the render that committed them, so
  // anything the reducer is seeded with is what every one of them decides from
  // — and seeding it with an empty project meant they were deciding about a
  // recording that does not exist. That is how the first cut came to replace a
  // saved project's zooms on every reopen.
  const [state, dispatch] = useReducer(editorReducer, session, (opened) =>
    initialState(opened.project, opened.manifest.duration, seamsOf(opened.manifest)),
  );
  const [images, setImages] = useState<Images>(new Map());
  /**
   * Video tracks whose first frame has decoded.
   *
   * Reported by the elements themselves, because nothing else here knows. A
   * track can be current, sized and seeking with no picture in it yet, and the
   * compositor draws what it is given — so on a cold open the first frames it
   * drew were a background with a hole where the recording goes.
   *
   * Reset with the recording, not accumulated: a second recording's elements
   * are new and have decoded nothing.
   */
  const [decoded, setDecoded] = useState<Set<MediaKey>>(new Set());
  /**
   * Image paths that have finished trying — loaded, or failed for good.
   *
   * Apart from `images` because the two answer different questions. The canvas
   * draws from `images` and a picture that would not decode must never reach
   * it; `ready` asks only whether there is still something worth waiting for,
   * and a file that is never going to arrive is not. Gating the reveal on
   * `images` instead meant one missing background held the preview behind the
   * loading screen for the life of the editor.
   */
  const [settledImages, setSettledImages] = useState<Set<string>>(new Set());

  useEffect(() => {
    setDecoded(new Set());
    setSettledImages(new Set());
  }, [session.dir]);

  const markDecoded = useCallback((key: MediaKey) => {
    setDecoded((current) => (current.has(key) ? current : new Set(current).add(key)));
  }, []);

  const markImageSettled = useCallback((path: string) => {
    setSettledImages((current) => (current.has(path) ? current : new Set(current).add(path)));
  }, []);

  /**
   * The pointer images to load, which is none at all without a pointer layer.
   *
   * The same condition `cursorLayer` uses in main, and it has to be: that is
   * what decides whether the files are ever copied into the recording. A take
   * with the pointer baked into its frames, or one where the pointer never
   * moved, gets none of them — and asking for all 28 anyway meant 28 requests
   * that could only 404, 28 warnings in the log, and a preview that waited for
   * every one of them.
   */
  const cursorFiles = useMemo(
    () => (session.cursor === null ? [] : CURSOR_FILES),
    [session.cursor],
  );

  /**
   * Every camera segment that came with a person matte.
   *
   * One `<video>` per matte rather than one for the recording: a matte is
   * written beside its own take's camera, at that camera's dimensions and
   * timestamps, and a mask from the wrong take is a silhouette hanging off the
   * person entirely.
   */
  const mattes = useMemo(
    () =>
      session.media.filter(
        (track): track is TrackMedia & { matteUrl: string } =>
          track.kind === "camera" && track.matteUrl !== null,
      ),
    [session],
  );
  /** The matte of the recording's first take, which is what the reveal waits on. */
  const matteUrl = useMemo(
    () => mattes.find((track) => track.segment === 0)?.matteUrl ?? null,
    [mattes],
  );
  /** Whether the camera came with a person matte — the cutout needs one. */
  const cameraMatte = matteUrl !== null;
  // Shown by default: the panel is where the editing happens, and an editor
  // that opens with its controls put away is a puzzle.
  const [panelOpen, setPanelOpen] = useState(true);
  /**
   * Which inspector panel is showing.
   *
   * Here rather than inside `Inspector` so that clicking a picture in the
   * preview can open the panel that dresses it — see `showPanelFor`.
   */
  const [panelTab, setPanelTab] = useState<CategoryId>("layout");

  /**
   * Opens the panel for a picture that has just been clicked.
   *
   * The ring says *what* is selected and the corner handles say it can be
   * resized, but everything else about the thing — a bubble's shape, a
   * recording's padding and border — was still a hunt through the rail. Clicking
   * it now answers both questions at once.
   *
   * The camera and the captions each have a panel named after them. The
   * screen's is `recording`, which is the one holding the padding, the corner,
   * the border and the shadow — the frame *around* the recording. Not `layout`:
   * that is where the two pictures are arranged relative to each other, which is
   * a statement about the pair rather than about the one that was clicked.
   *
   * Opens the panel as well as switching it, and drops any selected zoom. Both
   * for the same reason: a selected zoom takes the inspector over entirely, and
   * a closed panel shows nothing — so without either, clicking something would
   * set a tab nobody could see and look like it had done nothing at all.
   */
  const showPanelFor = useCallback(
    (target: Picked) => {
      setPanelTab(PANEL_FOR[target]);
      setPanelOpen(true);
      // Both, for the reason the zoom is dropped: a selected text takes the
      // panel over the same way, and the tab just set would be behind it.
      dispatch({ type: "selectZoom", zoomId: null });
      dispatch({ type: "selectText", textId: null });
    },
    [dispatch],
  );

  /**
   * A text was clicked in the preview, or picked on the timeline.
   *
   * Selecting it is what shows its panel — the inspector reads the selection
   * — so this only has to open the panel, and seek to the text where the
   * playhead is not already on it: a text you cannot see is one you cannot
   * place.
   */
  const pickText = useCallback(
    (textId: string) => {
      dispatch({ type: "selectText", textId });
      setPanelOpen(true);
    },
    [dispatch],
  );
  /**
   * What the panel is showing, and so what brings it back.
   *
   * The panel's own close button is the only way to put it away, and closing it
   * clears the selection — so selecting anything again is both the natural way
   * to want it back and proof that it is wanted. Without this, a click on a clip
   * put that clip's settings somewhere the user could no longer reach, and the
   * click read as doing nothing at all.
   */
  const selected = state.selectedSliceId ?? state.selectedZoomId ?? state.selectedTextId;
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
    dispatch({
      type: "load",
      project: session.project,
      duration: session.manifest.duration,
      seams: seamsOf(session.manifest),
    });
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

  // Off the manifest rather than off `session.sound`: the panel is offered on
  // the strength of what the recording noted, and a plan that failed to be
  // made — the addon still loading — is a warning in the log, not a missing
  // section. The gallery, which has no addon, gets the section the same way.
  const hasSounds =
    (session.manifest.key_presses?.length ?? 0) > 0 || (session.manifest.clicks?.length ?? 0) > 0;

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
   * Whether the preview has everything it draws with.
   *
   * Both halves arrive late and independently: a video decodes its first frame
   * some way after the element is handed a source, and the background, the
   * pointer images and the caption bitmaps are fetched over `prequel-media:`
   * with a retry ladder behind them. The compositor draws whatever it has, so
   * until both are in, what it paints is a background with the recording
   * missing from it.
   *
   * Every video track, not just the screen. Revealing on the first one to
   * decode would swap one flash for another on any recording with a camera in
   * it.
   *
   * The images are checked against what this project actually asks for, so a
   * composition on a solid colour is ready the moment its video is: there is no
   * background file to wait for. Settled rather than loaded — see
   * `settledImages`, and note that every clause here has to be able to finish
   * badly, or the reveal never happens at all.
   */
  const ready = useMemo(
    () =>
      previewReady({
        // The first take's video only. Every take's elements are in the DOM at
        // once, and waiting for all of them would hold a three-take recording
        // behind "Loading the recording…" until every one had buffered — while
        // the playhead starts at zero, which is always the first take.
        videoKinds: session.media
          .filter(
            (track) => track.segment === 0 && (track.kind === "screen" || track.kind === "camera"),
          )
          .map((track) => mediaKey(track.kind, track.segment)),
        matte: matteUrl !== null,
        decoded,
        wanted: imagePaths(state.project, cursorFiles),
        settled: settledImages,
      }),
    [session.media, matteUrl, decoded, state.project, settledImages, cursorFiles],
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

  /**
   * Plays the selected text's motion once, a moment after its controls settle.
   *
   * The zoom's replay for a text, debounced for the same reason. Not the whole
   * span, though: a title can sit on screen for a minute, and what changed is
   * how it arrives or how it leaves — so the entrance plays with a beat of the
   * hold after it, or the exit with a beat before, whichever the control was
   * about. A template changes both, and plays the whole text where it is
   * short enough to sit through.
   */
  const textToPreview = useRef<TextSlice | null>(null);
  textToPreview.current = findText(state.project, state.selectedTextId) ?? null;

  const previewText = useCallback(
    (part: "enter" | "exit" | "all") => {
      if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);

      previewTimer.current = window.setTimeout(() => {
        previewTimer.current = null;

        const text = textToPreview.current;
        if (!text) return;
        // Null where the text straddles a cut, and there is no one span to play.
        const span = textInProject(state.project, text);
        if (!span) return;

        // The same halving `textKeys` applies, so a short text's entrance and
        // exit are played as they are drawn.
        const length = span.end - span.start;
        const enter = Math.min(text.enterMs * 1_000_000, length / 2);
        const exit = Math.min(text.exitMs * 1_000_000, length / 2);
        const short = length <= TEXT_PREVIEW_WHOLE_NS;

        const from =
          part === "exit"
            ? Math.max(span.start, span.end - exit - TEXT_PREVIEW_HOLD_NS)
            : span.start;
        const to =
          part === "enter" || (part === "all" && !short)
            ? Math.min(span.end, span.start + enter + TEXT_PREVIEW_HOLD_NS)
            : span.end;
        media.playback.playRange(from, to);
      }, ZOOM_PREVIEW_SETTLE_MS);
    },
    [state.project, media.playback],
  );

  // Or a preview fires against an editor that has already been left.
  useEffect(
    () => () => {
      if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    },
    [],
  );

  /**
   * Set by both ways of adding a text, and cleared by the seek below.
   *
   * A flag and an effect rather than doing the work at the call site: the text
   * does not exist until the reducer has run, so the seek has to happen on the
   * render that follows the dispatch. A timeout would also get there, by
   * guessing at how long a render takes.
   */
  const added = useRef(false);

  /**
   * Puts the playhead where a new text is first fully itself.
   *
   * A text begins at the playhead and its entrance begins at nothing, so the
   * frame you are parked on when you add one is the single frame of its life
   * where it is invisible — add a title and the picture does not change, which
   * reads as the feature being broken.
   *
   * So the playhead moves to the end of the entrance: the first moment the text
   * is at rest and wholly on screen. Not played through, which was the earlier
   * answer to this — starting playback because somebody added a title is a
   * second thing happening that nobody asked for, and it leaves the playhead
   * wherever the beat after the entrance ended rather than at a moment that
   * means anything.
   */
  useEffect(() => {
    if (!added.current) return;
    added.current = false;

    const text = findText(state.project, state.selectedTextId);
    if (!text) return;
    const span = textInProject(state.project, text);
    if (!span) return;

    // The same halving `textKeys` applies, so a text too short to hold its
    // whole entrance is met where its entrance actually ends.
    const enter = Math.min(text.enterMs * 1_000_000, (span.end - span.start) / 2);
    media.playback.seek(Math.min(span.end, span.start + enter));
  }, [state.selectedTextId, state.project, media.playback]);

  // Drawn against the export frame rather than the editor's, so one set of
  // bitmaps serves the preview and the export and the preview only samples
  // them down. `useExport` lays its plan out in this frame too.
  const captionFrame = useMemo(
    () => outputFrame(state.project.frame, state.project.output.shortEdge),
    [state.project.frame, state.project.output.shortEdge],
  );

  const transcription = useTranscription(session);
  /**
   * The words in force: the panel's corrections laid over what was recognised.
   *
   * The live transcript, not the session's: a run that finishes while the
   * editor is open delivers it here, and the session snapshot never changes.
   * The corrections are the project's, so they are saved with the cuts and
   * come back with them; the generated words stay on disk untouched for Reset
   * to go back to.
   */
  const transcript = useMemo(() => {
    const generated = transcription.transcript;
    const edited = state.project.transcript;
    return generated && edited ? { ...generated, words: edited.words } : generated;
  }, [transcription.transcript, state.project.transcript]);

  const backgrounds = useBackgrounds();
  /** The background being downloaded, so its swatch can say so. */
  const [pendingBackground, setPendingBackground] = useState<string | null>(null);

  const scenePresets = useScenePresets();
  const { setMine: setSavedPresets } = scenePresets;

  /**
   * Applies a look, having first made sure its picture is on disk.
   *
   * All or nothing. `onPickPreset` below carries the same rule for the same
   * reason: applied before the download finishes, the composition goes dark for
   * as long as it takes. What is different here is that a look is a *bundle* —
   * applying everything except the background would leave the user unable to
   * tell which half had landed, which is worse than nothing happening.
   */
  const applyPreset = useCallback(
    async (preset: ScenePreset) => {
      const token = (applyToken.current += 1);
      const stale = () => token !== applyToken.current;
      let ready = preset;

      const wallpaper = presetNeedsBackground(preset);
      if (wallpaper) {
        setApplyingPreset(preset.id);
        const result = await window.prequel.editor.backgrounds.ensure(session.dir, wallpaper);
        if (stale()) return;
        setApplyingPreset(null);

        if (!result.ok || !result.value) {
          // A picture that has been withdrawn from the catalogue, or no network.
          // Nothing is applied; the look that is working is left alone.
          console.warn(`[editor] could not fetch ${wallpaper} for ${preset.id}`);
          return;
        }
      } else if (presetCarriesImage(preset)) {
        setApplyingPreset(preset.id);
        const result = await window.prequel.editor.scenePresets.applyImage(preset.id, session.dir);
        if (stale()) return;
        setApplyingPreset(null);

        if (!result.ok || !result.value) {
          console.warn(`[editor] could not copy ${preset.id}'s own picture in`);
          return;
        }

        // Named for the preset once it is inside the recording, so two looks
        // applied to one recording cannot land on the same file.
        ready = {
          ...preset,
          background: {
            ...preset.background,
            background: { kind: "image", source: "file", path: result.value },
          },
        };
      }

      // The logo, copied in under the name it already carries. Done after the
      // background rather than instead of it: a look can carry both, and they
      // are two files.
      const logo = ready.watermark.watermark;
      if (logo) {
        const copied = await window.prequel.editor.scenePresets.applyWatermark(
          preset.id,
          session.dir,
          logo,
        );
        if (stale()) return;

        if (!copied.ok || !copied.value) {
          // Applied without it rather than not at all: everything else about
          // the look is still what was asked for, and a mark that will not copy
          // is one missing picture rather than a broken preset.
          console.warn(`[editor] could not copy ${preset.id}'s logo in`);
          ready = {
            ...ready,
            watermark: { ...ready.watermark, watermark: null },
          };
        }
      }

      // A look saved from a take with a matte, applied to one without, would
      // ask for a cutout this recording cannot supply and draw the camera as a
      // bare rectangle. Everything else about the look still applies.
      if (ready.layout.cameraCutout && !cameraMatte) {
        ready = { ...ready, layout: { ...ready.layout, cameraCutout: false } };
      }

      if (stale()) return;
      dispatch({ type: "applyPreset", preset: ready });
    },
    [session.dir, cameraMatte],
  );

  /**
   * Renames a saved look, and forgets one.
   *
   * Both answer with the whole list rather than patching the one that changed,
   * which is what main hands back — the disk is what decides, and a renderer
   * that edited its own copy could come to disagree with it.
   */
  const renamePreset = useCallback(
    async (id: string, name: string) => {
      const result = await window.prequel.editor.scenePresets.rename(id, name);
      if (result.ok) setSavedPresets(result.value);
    },
    [setSavedPresets],
  );

  const deletePreset = useCallback(
    async (id: string) => {
      const result = await window.prequel.editor.scenePresets.remove(id);
      if (result.ok) setSavedPresets(result.value);
    },
    [setSavedPresets],
  );

  /**
   * Saves what is on screen as a look.
   *
   * The card is the preview's own frame, grabbed through `Grab` — which resolves
   * from inside the draw loop, because the WebGL context has no
   * `preserveDrawingBuffer` and a read from here would come back transparent.
   * It answers null rather than throwing when the loop is not running, and a
   * look with no card is a cell that never draws, so that is declined.
   */
  const savePreset = useCallback(
    async (name: string) => {
      const still = await grab.current?.();
      const card = still && (await asCard(still));
      if (!card) {
        console.warn("[editor] the preview had no frame to save as a card");
        return;
      }

      const { captionsOn: _on, ...captions } = previewSettings.captions;
      const { background } = previewSettings.background;
      // A picture chosen in this recording travels as bytes, not as a name:
      // `background-custom.png` means a different photograph in every folder.
      const carried =
        background.kind === "image" && background.source === "file" ? background.path : null;

      const result = await window.prequel.editor.scenePresets.save(
        {
          id: `look-${Date.now().toString(36)}`,
          name,
          savedAt: Date.now(),
          frame: {
            width: state.project.frame.width,
            height: state.project.frame.height,
            // Resolved to the size it actually is. `auto` is not a size, and a
            // preset carrying it has its frame written straight back over.
            presetId:
              state.project.frame.presetId === AUTO_PRESET_ID ? null : state.project.frame.presetId,
          },
          layout: previewSettings.layout,
          background: previewSettings.background,
          effects: previewSettings.effects,
          captions,
          watermark: previewSettings.watermark,
          zoom: state.project.zoomDefaults,
        },
        card,
        // The session is needed whenever *either* picture has to be carried.
        carried || previewSettings.watermark.watermark ? session.dir : null,
        carried,
        previewSettings.watermark.watermark,
      );

      if (result.ok) setSavedPresets(result.value);
    },
    [
      previewSettings,
      session.dir,
      setSavedPresets,
      state.project.frame,
      state.project.zoomDefaults,
    ],
  );
  /** The look whose wallpaper is being fetched, so its card can say so. */
  const [applyingPreset, setApplyingPreset] = useState<string | null>(null);
  /**
   * Which apply is the current one.
   *
   * Two looks clicked in quick succession are two downloads in flight, and
   * without this both land — the slower one last, so the winner is whichever
   * finished rather than whichever was asked for. Bumped on every apply and
   * checked before anything is dispatched.
   */
  const applyToken = useRef(0);
  // The project defaults rather than the playhead's settings: captions are
  // project-wide, and reading them off whichever clip the playhead is under
  // would re-rasterise every cue on every cut.
  const captions = useCaptions(
    session,
    transcript,
    // The whole project, not one clip's settings: caption looks are per clip,
    // so this has to see every override to know which sets to draw.
    state.project,
    captionFrame,
  );
  const fonts = useFonts();
  const textBitmaps = useTextBitmaps(session, state.project, captionFrame, fonts);
  const cursorTags = useCursorTags(session, state.project, setImages);
  /**
   * Every text's bitmaps by when it is on screen, for the image cache.
   *
   * Rebuilt only when the rows or the bitmaps change; a drag along the
   * timeline changes the rows and is cheap, a slider in the panel changes
   * neither until the settle redraws.
   */
  const textImages = useMemo(
    () =>
      state.project.texts.flatMap((track) =>
        track.slices.flatMap((text) => {
          const drawn = textBitmaps.rendered.get(text.id);
          return drawn
            ? [
                {
                  at: text.source.start,
                  end: text.source.end,
                  paths: drawn.fields.map((field) => field.path),
                },
              ]
            : [];
        }),
      ),
    [state.project.texts, textBitmaps.rendered],
  );
  useCaptionImages(session, captions.byLook, textImages, media, setImages);

  // Keyed on the slices rather than the project, so typing a correction —
  // which changes the project — does not lay the clips out again and hand the
  // editor a fresh word list to rebuild from on every keystroke.
  const placed = useMemo(() => place(slices), [slices]);

  /**
   * The clip under the playhead is the clip being edited.
   *
   * `media.sliceId` already tracks which one that is, and it follows a seek and
   * playback alike — so both "click the timeline" and "let it play into the
   * next clip" fall out of watching it, rather than each seek site having to
   * remember to select as well.
   *
   * Not while a zoom is selected. `select` clears the zoom — the inspector
   * shows one thing at a time — so without this guard, previewing a zoom would
   * close the panel you were previewing it from the moment the head crossed a
   * cut. The head moving is not a request to stop editing the zoom.
   */
  useEffect(() => {
    if (!media.sliceId || media.sliceId === state.selectedSliceId) return;
    // Nor a text, for the same reason: scrubbing across a cut while a title
    // is being typed must not swap the panel out from under the keyboard.
    if (state.selectedZoomId || state.selectedTextId) return;

    dispatch({ type: "select", sliceId: media.sliceId });
  }, [media.sliceId, state.selectedSliceId, state.selectedZoomId, state.selectedTextId]);

  /**
   * Seeks to a text the moment it is selected, when the playhead is not on it.
   *
   * On the selection changing rather than in `pickText`: the timeline selects
   * a text by dispatching, and having every path that selects one also seek
   * would be the same rule in three places. Just past the entrance, so what
   * comes up is the text at rest rather than the first frame of its arrival.
   */
  useEffect(() => {
    const text = findText(state.project, state.selectedTextId);
    if (!text) return;
    // The playhead, not `media.sourceAt()`, which answers the *hovered* moment
    // while the pointer is on the strip: a text drawn out rightwards is
    // released with the pointer on its end — outside a half-open span — so
    // the hover said "not on it" and the head, already on the text's start,
    // was moved anyway. And the whole span, not only the hold: a text added
    // at the press starts exactly there, and moving the head off the moment
    // just pressed read as the head jumping on its own. Press play and it
    // arrives; scrub and it is there.
    const at = toSourceTime(placed, media.playback.position());
    if (at !== null && at >= text.source.start && at < text.source.end) return;
    const length = text.source.end - text.source.start;
    const enter = Math.min(text.enterMs * 1_000_000, length / 2);
    const span = textInProject(state.project, text);
    if (span) media.playback.seek(Math.min(span.start + enter, span.end));
    // Only on the selection: the text's span moving under the playhead is a
    // drag, and seeking during one would fight the hand doing it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedTextId]);
  /**
   * The words the captions editor shows, and the ones it does not.
   *
   * Scoped to the selection, like every other panel: a clip in hand means that
   * clip's words. `rest` is everything left out — the words in cut-out
   * footage and the words of the other clips — and it goes back in on every
   * edit, or correcting one sentence would delete the rest of the recording.
   */
  const spoken = useMemo(() => {
    if (!transcript) return null;

    const { visible, hidden } = survivingWords(transcript.words, placed);
    const clip = slices.find((slice) => slice.id === state.selectedSliceId);
    const { shown, rest } = wordsWithin(visible, clip?.source ?? null);

    return { shown, rest: [...hidden, ...rest] };
  }, [transcript, placed, slices, state.selectedSliceId]);
  /** The footage under the words selected in the captions editor. */
  const [captionRange, setCaptionRange] = useState<{ start: MediaTime; end: MediaTime } | null>(
    null,
  );

  const editing: CaptionEditing = {
    words: spoken?.shown ?? [],
    edited: state.project.transcript !== null,
    onEdit: (text) => {
      if (!spoken) return;
      const next = realignWords(spoken.shown, text);
      // The same words back means nothing but whitespace changed.
      if (next === spoken.shown) return;
      // The editor only ever showed some of the words; the rest go back in, or
      // an edit here would take the other clips' captions with it.
      dispatch({ type: "setTranscript", words: mergeWords(spoken.rest, next) });
    },
    onBeginEdit: () => dispatch({ type: "beginEdit" }),
    onReset: () => {
      // Its own undo step, not the tail of whatever was being typed.
      dispatch({ type: "beginEdit" });
      dispatch({ type: "setTranscript", words: null });
    },
    onUndo: () => dispatch({ type: "undo" }),
    onSelect: setCaptionRange,
    onCut: (range) => {
      // Worked out before the cut: where the range began is exactly where the
      // footage after it lands once it is gone, so the playhead goes there.
      const at = spanInProject(placed, range)?.start;
      dispatch({ type: "deleteRange", source: range });
      setCaptionRange(null);
      if (at === undefined) return;
      media.onInteract();
      media.playback.seek(at);
    },
    onSeek: (source) => {
      const at = toProjectTime(placed, source);
      if (at === null) return;
      media.onInteract();
      media.playback.seek(at);
    },
    sourceAt: media.sourceAt,
  };

  const exportState = useExport(
    session,
    state.project,
    state.project.output,
    captions,
    textBitmaps,
    cursorTags,
  );

  /**
   * Lands on the clip a just-finished Add Recording appended.
   *
   * Selected and seeked to, so the editor comes back showing the footage that
   * was just added rather than the head of the recording. Once per session,
   * because `focusSliceId` describes that addition and not the recording — main
   * clears it as the editor reads it, and the editor remounts across an extend so
   * there is one open per merge.
   */
  useEffect(() => {
    const id = session.focusSliceId;
    if (!id) return;

    const found = placed.find((slice) => slice.id === id);
    if (!found) return;

    dispatch({ type: "select", sliceId: id });
    media.playback.seek(found.timelineStart);
    // Deliberately not depending on `placed`, which is rebuilt on every edit:
    // this is the arrival, and running it again after the user has moved the
    // playhead would drag them back to the new clip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  /**
   * Puts the panel back so more footage can be recorded into this project.
   *
   * The edit is flushed *first* and awaited. Saving is debounced, so pressing
   * this straight after a drag leaves a write in flight — and the merge is about
   * to append a clip to the same file, which that write would then land on top
   * of. Main flushes its own side too; both are cheap and the failure is a lost
   * clip.
   */
  /**
   * Whether the project in this component is about to be replaced wholesale.
   *
   * Set once a take has been merged. Main appends a clip for the new footage
   * and writes `project.json` itself, and this component is then remounted
   * around the grown session — so everything it is still holding predates that
   * append, and writing any of it back would take the new clip off the
   * timeline. Which is exactly what happened: the footage recorded, the
   * manifest grew, and the clip never appeared.
   *
   * Nothing is lost by going quiet. The edits made before the button was
   * pressed were saved and awaited at the top of `addRecording`, and are what
   * main appended *to*; anything after that is replaced by the reload whether
   * it is written or not.
   */
  const superseded = useRef(false);

  const addRecording = useCallback(async () => {
    // Paused first. The panel is about to cover the screen and the recording is
    // about to start; a preview still playing behind it is four media elements
    // and a canvas competing with the capture for the same frame budget.
    media.playback.pause();

    const saved = await window.prequel.editor.saveProject(session.dir, state.project);
    if (!saved.ok) {
      // Said out loud and not gone ahead with. Adding footage to a project whose
      // last edits were not written would look like the edits were the thing
      // that was lost.
      console.error("[editor] could not save before adding a recording:", saved.message);
      return;
    }

    const result = await window.prequel.editor.addRecording();
    if (!result.ok) {
      console.error("[editor] could not add a recording:", result.message);
      return;
    }

    // Before the reload, and only on the way out of a merge that worked: from
    // here the file on disk is ahead of anything this component holds.
    superseded.current = true;
  }, [media, session.dir, state.project]);

  /**
   * The words as the finished file will have them, for the share page's
   * chapters. Computed live, like `durationMs`: the dialog is what stops the
   * edit changing between the export and the share.
   */
  const shareTranscript = useMemo(
    () => transcriptForShare(transcript, placed),
    [transcript, placed],
  );

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
      // Reported here rather than from a mount effect inside `UpgradeDialog`,
      // which would keep the dialog the pure presentational thing it is and
      // then have to re-derive the status from a prop that lags this answer by
      // a render. This is the only path that opens it, and the moment the
      // verdict arrives is the moment it is true.
      window.prequel.licence.prompted();
      return;
    }

    await showExport();
  };
  // Against the recording's own length rather than the edit's: the peaks are
  // indexed by source time, so cutting the edit shorter must not move them.
  const peaks = useWaveforms(session.media, session.manifest.duration);
  // Indexed by source time for the same reason, so a cut neither moves the
  // thumbnails nor asks for them to be extracted again.
  const filmstrip = useFilmstrip(session.media, session.manifest.duration, CLIP_FRAME_H);

  // The span the camera actually covers, not just whether one was recorded.
  // It opens a few hundred ms after the screen, so a clip cut from the very
  // start of the take genuinely has no camera in it and should not claim to.
  // One span per take that recorded a camera: the row has to show a gap where a
  // take was recorded without one, not a bar spanning the whole recording.
  const cameraSpans = useMemo(
    () =>
      session.media
        .filter((candidate) => candidate.kind === "camera")
        .map((track) => ({ start: track.offset, end: track.offset + track.duration })),
    [session],
  );

  // From the manifest rather than the video element: the inspector needs it to
  // shape the `wide` bubble before the element has necessarily loaded.
  // The first take's, for both. These shape the inspector's controls and the
  // automatic output frame — decisions about the recording rather than about the
  // moment — and the picture itself is laid out per slice from the segment that
  // slice plays, in `Preview` and in `useExport`.
  const cameraSource = useMemo(() => sizeOf(session.media, "camera"), [session]);

  const screenSource = useMemo(() => sizeOf(session.media, "screen"), [session]);

  useAutoFrame(state.project.frame, screenSource, dispatch);
  useFirstCut(session, state, dispatch);
  usePersistence(session, state.project, state.revision, superseded);
  useAudioMix(media, state, session);
  useSoundBanks(media, state.project);
  const playSample = useCallback(
    (profile: string, volume: number) => {
      // Fetched on demand rather than preloaded like the banks `useSoundBanks`
      // keeps: a demo is only ever wanted the moment someone presses play, and
      // main caches it the same way, so pressing the same row twice is free.
      void window.prequel.editor.soundSample(profile).then((result) => {
        if (result.ok) {
          media.playSample(result.value, volume);
        } else {
          console.warn(`[editor] could not load the sound sample ${profile}:`, result.message);
        }
      });
    },
    [media],
  );
  useEditorImages(session, state.project, cursorFiles, setImages, markImageSettled);
  useShortcuts(
    media,
    dispatch,
    state,
    () => void addRecording(),
    () => {
      added.current = true;
    },
  );

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
        {/* The dots and the fill are on the row rather than on the column
            below, so the surface runs under the inspector as well as under the
            composition — one board with the panels sitting on it, rather than a
            patterned area and a plain one meeting at a seam. A child painting
            its own background would cover the pattern, which is why neither
            column has one.

            Frosted only slightly: the wallpaper reads as depth behind the
            board, and any more of it competes with the composition, which is
            the one thing in this window being looked at. */}
        <div className="dot-grid flex min-h-0 flex-1 bg-editor-scrim">
          {/* `min-h-0` as well as `min-w-0`: a flex item defaults to
            `min-height: auto`, so this column refuses to shrink below its
            content — and the canvas reports an intrinsic 1920×1080. Without it
            the column grows past the row and the timeline is clipped away by
            the shell's `overflow-hidden`. */}
          {/* The frame bar and the composition share one surface, so the bar
              reads as part of the canvas rather than as chrome above it. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <FrameBar
              frame={state.project.frame}
              recorded={screenSource}
              onChange={(frame) => dispatch({ type: "setFrame", frame })}
            />
            <Preview
              ready={ready}
              frame={state.project.frame}
              settings={previewSettings}
              enter={previewEnter}
              media={media}
              images={images}
              cursor={session.cursor}
              zooms={state.project.zooms}
              cues={captions.byLook}
              texts={state.project.texts}
              rendered={textBitmaps.rendered}
              tags={cursorTags}
              selectedTextId={state.selectedTextId}
              grab={grab}
              onPick={showPanelFor}
              onPickText={pickText}
              onDragText={(textId, drag) => {
                if (drag.kind === "move") {
                  dispatch({ type: "setText", textId, patch: { x: drag.x, y: drag.y } });
                } else {
                  dispatch({ type: "sizeText", textId, sizes: drag.sizes });
                }
              }}
              onDrag={(section, patch) => {
                // One dispatch per key, because that is what the override
                // bookkeeping counts in: a gesture that writes five keys has to
                // mark five keys as set for this clip, or resetting one of them
                // would take its neighbours with it.
                for (const [key, value] of Object.entries(patch)) {
                  dispatch({ type: "setSetting", section, key, value });
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
            // Named by attribute for the documentation screenshots, which clip
            // to this box: `gallery/shots.tsx` finds it this way rather than by
            // class, so the utilities above can be rearranged without moving
            // the crop. Same convention as `data-panel='setup'` on the dock.
            data-panel="inspector"
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
              hasSounds={hasSounds}
              onAudition={media.audition}
              onPlaySample={playSample}
              captions={transcription}
              editing={editing}
              backgrounds={backgrounds}
              pendingBackground={pendingBackground}
              frame={state.project.frame}
              cameraSource={cameraSource}
              cameraMatte={cameraMatte}
              tab={panelTab}
              onTab={setPanelTab}
              presets={{
                mine: scenePresets.mine,
                applying: applyingPreset,
                // Nothing under the playhead is nothing drawn, and a look is
                // saved from what is on screen.
                canSave: media.sliceId !== null,
                onApply: applyPreset,
                onSave: savePreset,
                onRename: renamePreset,
                onDelete: deletePreset,
              }}
              fonts={fonts}
              onPreviewZoom={previewZoom}
              onPreviewText={previewText}
              // Deselects both kinds, rather than working out which one the
              // panel is showing: only one can be set at a time, and clearing
              // the other is free where asking which is live is a branch that
              // has to be kept right.
              onClose={() => {
                dispatch({ type: "select", sliceId: null });
                dispatch({ type: "selectZoom", zoomId: null });
                dispatch({ type: "selectText", textId: null });
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
              onPickPreset={async (file) => {
                // Fetched first, applied second. Applying straight away named a
                // file that was not there yet, so the composition went dark for
                // as long as the download took — the picture that is already on
                // screen is a better thing to look at than nothing. The spinner
                // on the swatch is what says the choice was registered.
                setPendingBackground(file);
                const result = await window.prequel.editor.backgrounds.ensure(session.dir, file);
                setPendingBackground((current) => (current === file ? null : current));

                if (!result.ok || !result.value) {
                  // Nothing is applied. A background that cannot be fetched
                  // leaves the one that is working alone.
                  console.warn(`[editor] could not fetch ${file}`);
                  return;
                }

                dispatch({
                  type: "setSetting",
                  section: "background",
                  key: "background",
                  value: { kind: "image", source: "preset", path: file },
                });
              }}
              onPickWatermark={async () => {
                const result = await window.prequel.editor.pickWatermark(session.dir);
                if (result.ok && result.value) {
                  dispatch({
                    type: "setSetting",
                    section: "watermark",
                    key: "watermark",
                    value: result.value.path,
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
          canDelete={
            state.selectedSliceId !== null ||
            state.selectedZoomId !== null ||
            state.selectedTextId !== null
          }
          // Asked from the start rather than from the playhead, which is not
          // React state and could not re-enable the button as it moved. The
          // search covers every gap whatever it is given, so any one answer
          // is the answer for all of them.
          canAddZoom={zoomSpanNear(state.project, 0) !== null}
          canAddText={textSpanNear(state.project, 0) !== null}
          // Off while an export is running: the recorder and the exporter fight
          // over the same GPU and the same encoder, and the dock appearing over
          // a render nobody asked to interrupt is the wrong outcome either way.
          canAddRecording={!exportState.running}
          canUndo={canUndo(state)}
          onAddZoom={() => dispatch({ type: "addZoomNear", at: media.playback.position() })}
          onAddText={() => {
            dispatch({ type: "addTextNear", at: media.playback.position() });
            // And the playhead follows it — see the effect beside `previewText`.
            added.current = true;
          }}
          onAddRecording={() => void addRecording()}
          onSplit={() => dispatch({ type: "split", at: media.playback.position() })}
          onDelete={() => {
            if (state.selectedTextId) {
              dispatch({ type: "deleteText", textId: state.selectedTextId });
            } else if (state.selectedZoomId) {
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
          cameraSpans={cameraSpans}
          captionRange={captionRange}
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
              key={mediaKey(track.kind, track.segment)}
              ref={media.register(mediaKey(track.kind, track.segment))}
              src={track.url}
              crossOrigin="anonymous"
              muted
              playsInline
              preload="auto"
              // The first frame having decoded, which is not the same as the
              // track being on screen: `media.visible` says a track *covers*
              // this moment, and it says so before there are any pixels to
              // draw. Compositing then paints a background with nothing on it,
              // which is the flash this reports away.
              onLoadedData={() => markDecoded(mediaKey(track.kind, track.segment))}
              // Counted as decoded on failure too, for the reason the matte
              // below is: `ready` waits for every video track, and a track
              // that will not open never sends `loadeddata`. Without this the
              // editor sits on "Loading the recording…" for ever — the
              // timeline, the panel and the export all work, and the one thing
              // the user came for never appears, with nothing anywhere to say
              // why. Revealing a composition with a track missing from it is
              // the lesser fault, and the warning names which one.
              onError={(event) => {
                const failure = event.currentTarget.error;
                console.error(
                  `[editor] ${track.file} would not open:`,
                  failure ? `${failure.code}: ${failure.message}` : "no reason given",
                );
                markDecoded(mediaKey(track.kind, track.segment));
              }}
            />
          ) : (
            <audio
              key={mediaKey(track.kind, track.segment)}
              ref={media.register(mediaKey(track.kind, track.segment))}
              src={track.url}
              crossOrigin="anonymous"
              preload="auto"
            />
          ),
        )}
        {mattes.map((track) => (
          <video
            key={matteKey(track.segment)}
            ref={media.register(matteKey(track.segment))}
            src={track.matteUrl}
            crossOrigin="anonymous"
            muted
            playsInline
            preload="auto"
            onLoadedData={() => markDecoded(matteKey(track.segment))}
            // Counted as decoded on failure as well: a sidecar that will not
            // open must not hold the whole editor behind the loading screen.
            // The camera then draws whole, which is what the preview does for
            // any matte that is not there.
            onError={() => markDecoded(matteKey(track.segment))}
          />
        ))}
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
          transcript={shareTranscript}
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
    <div className="editor-theme relative flex min-h-0 flex-1 flex-col overflow-hidden bg-editor-glass text-editor-fg">
      {/* Dragging the bar moves the window, and the inset traffic lights need
          the room on the left. */}
      {/* Nearly solid, like the transport and the timeline at the other end:
          the window's two bands of controls read as the frame around the work,
          and the frosted board between them is the work. It is also what lets
          this bar keep `--editor-muted` for the breadcrumb — that tone was
          chosen against an opaque surface, and at the shell's own frost it had
          the wallpaper coming up through it. */}
      <header className="drag flex h-[38px] flex-none items-center gap-1.5 border-b border-editor-line bg-editor-veil pr-3 pl-20">
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
    // The middle of the field, which is what a zoom would frame anyway. Only
    // the samples taken while keys were going down: the rest are a field that
    // was focused, which is not something that happened.
    ...whileTyping(session.manifest.typing ?? [], session.manifest.keys).map((span) => ({
      at: span.at,
      x: span.x + span.width / 2,
      y: span.y + span.height / 2,
      kind: "typing" as const,
    })),
  ];
}

/**
 * Makes the first cut, once — and runs it again, scoped, when a take lands.
 *
 * On a project nobody has touched: revision 0, and no zooms of its own. Both
 * conditions matter — the first stops it running again on every reopen, and
 * the second means a recording whose zooms were all deleted stays that way
 * rather than growing them back, which would be the app arguing.
 *
 * A take Add Recording just merged in is different: `session.focusSliceId`
 * names it, and it is by construction footage with no zoom of its own yet —
 * nothing could have covered a span that did not exist a moment ago. Without
 * this, only the very first take of a project ever got the automatic pass, and
 * every one added afterwards sat there unzoomed until somebody noticed and
 * pressed the wand button by hand. Run through `augmentZooms` rather than
 * `autoZooms`, and scoped to the new slice's span rather than the whole
 * recording — the whole-recording pass is the wand button, and re-running it
 * here on every merge would grow back a zoom somebody deliberately deleted
 * from the *older* footage.
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
    // Marked up front rather than beside each dispatch below: both branches
    // this effect can take are "once per mount", and the mount is what a merge
    // remounts — see `EditorRoute`'s `key` bump on `editorReload`.
    made.current = true;

    if (session.focusSliceId) {
      const added = session.project.tracks[0]?.slices.find(
        (slice) => slice.id === session.focusSliceId,
      );
      if (!added) return;

      // Source time, the same clock `moment.at` is on — a slice's `source` and
      // a manifest sample were shifted onto it by the same merge.
      const moments = momentsOf(session).filter(
        (moment) => moment.at >= added.source.start && moment.at < added.source.end,
      );
      if (moments.length === 0) return;

      const zooms = augmentZooms(session.project.zooms, moments, {
        duration: added.source.end,
        hasCursor: session.cursor !== null,
      });
      if (zooms.length > session.project.zooms.length) dispatch({ type: "setZooms", zooms });
      return;
    }

    // Asked of the project as it was loaded, never of the reducer's copy. The
    // two are the same now that the reducer is seeded from the session, and
    // this is deliberately not relying on that: a guard on `state` was what
    // made this run against a placeholder, and the project on disk is the thing
    // the question is actually about.
    if (state.revision !== 0 || session.project.zooms.length > 0) return;

    const moments = momentsOf(session);
    if (moments.length === 0) return;

    const zooms = autoZooms(moments, {
      duration: session.manifest.duration,
      hasCursor: session.cursor !== null,
    });
    if (zooms.length > 0) dispatch({ type: "setZooms", zooms });
  }, [session, state.revision, dispatch]);
}

/**
 * Writes the project after editing pauses.
 *
 * Debounced because dragging a slider is a 60 Hz stream of changes, and a write
 * per frame would be hard on the disk for no benefit. Flushed on the way out so
 * leaving cannot lose the last edit — `beforeunload` is synchronous, which is
 * exactly what is needed when the window is closing.
 */
function usePersistence(
  session: EditorSession | null,
  project: unknown,
  revision: number,
  /** See `superseded` in `Editor`: true once main's copy is ahead of this one. */
  superseded: RefObject<boolean>,
) {
  const latest = useRef({ session, project, revision });
  latest.current = { session, project, revision };

  useEffect(() => {
    // Revision 0 is the project as loaded. Saving it would create a
    // `project.json` for a recording nobody has edited.
    if (!session || revision === 0 || superseded.current) return;

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
      if (current && at > 0 && !superseded.current) {
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
    // The sounds' volume is a bus gain like the tracks', and for the same
    // reason: a fader dragged while a press is already armed has to be heard,
    // and the bus is the one thing a slider can still reach by then. Which
    // keyboard plays is decided per cue instead — see `useSoundBanks`.
    media.setGain("keys", {
      volume: audio.keySoundVolume,
      muted: keySoundId(audio.keySound) === SOUND_OFF,
    });
    media.setGain("clicks", {
      volume: audio.clickSoundVolume,
      muted: clickSoundId(audio.clickSound) === SOUND_OFF,
    });
  }, [
    media,
    session,
    audio.micVolume,
    audio.micMuted,
    audio.systemVolume,
    audio.systemMuted,
    audio.keySound,
    audio.keySoundVolume,
    audio.clickSound,
    audio.clickSoundVolume,
  ]);
}

/**
 * Keeps the mixer holding a bank for every keyboard and mouse the edit names.
 *
 * The project's defaults and every clip's overrides can each name a profile,
 * so the set is collected across all of them rather than read off the clip
 * under the playhead — a cue is armed up to 400 ms ahead, in a clip that may
 * use a different keyboard. Banks are asked of main once each and kept for
 * the editor's life; switching back to a keyboard already heard is free.
 *
 * The resolver handed to the loop reads `settingsOf` for the cue's clip, so
 * changing a clip's keyboard takes effect on the next press without anything
 * being re-planned.
 */
function useSoundBanks(media: ReturnType<typeof useEditorPlayback>, project: Project) {
  const loaded = useRef(new Set<string>());

  const wanted = useMemo(() => {
    const ids = new Set<string>();
    const add = (audio: { keySound?: string; clickSound?: string } | undefined) => {
      if (!audio) return;
      if (audio.keySound !== undefined) ids.add(keySoundId(audio.keySound));
      if (audio.clickSound !== undefined) ids.add(clickSoundId(audio.clickSound));
    };
    add(project.defaults.audio);
    for (const slice of slicesOf(project)) add(slice.overrides.audio);
    ids.delete(SOUND_OFF);
    // A stable key, so the effect below runs when the set changes and not
    // when the project object does.
    return [...ids].sort().join(",");
  }, [project]);

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;

    for (const profile of wanted.split(",")) {
      if (loaded.current.has(profile)) continue;
      loaded.current.add(profile);

      void window.prequel.editor.soundBank(profile).then((result) => {
        if (cancelled) return;
        if (result.ok) {
          media.setSoundBank(profile, result.value);
        } else {
          // Forgotten so a later render asks again; a bank that failed once
          // — the addon still loading — is not a bank that always will.
          loaded.current.delete(profile);
          console.warn(`[editor] could not load the sound bank ${profile}:`, result.message);
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [media, wanted]);

  useEffect(() => {
    media.setSoundChoice((sliceId) => {
      const { audio } = settingsOf(project, sliceId);
      const keys = keySoundId(audio.keySound);
      const clicks = clickSoundId(audio.clickSound);
      return {
        keys: keys === SOUND_OFF ? null : keys,
        clicks: clicks === SOUND_OFF ? null : clicks,
      };
    });
  }, [media, project]);
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
 *
 * A failed load is retried, because this effect is keyed on the *set* of paths
 * and choosing the same background again does not change it. Without the retry
 * one failure was permanent for the life of the editor: main would fetch the
 * bytes correctly on the next attempt and the picture would still never appear,
 * which is how a single bad download turned into a dozen backgrounds that
 * "do not get set".
 */
function useEditorImages(
  session: EditorSession | null,
  project: ReturnType<typeof newProject>,
  /** The same list `ready` waits on, or the two would disagree about the wait. */
  cursors: readonly string[],
  setImages: (update: (images: Images) => Images) => void,
  /** Called once a path has finished trying, whether or not it arrived. */
  onSettled: (path: string) => void,
) {
  // Joined so the effect re-runs when the set changes rather than on every
  // edit — a project object is new on each keystroke.
  const paths = imagePaths(project, cursors).join("\u0000");

  useEffect(() => {
    if (!session || !paths) return;

    let cancelled = false;
    const loaded: Images = new Map();
    const timers: ReturnType<typeof setTimeout>[] = [];
    const wanted = paths.split("\u0000");

    const load = (path: string, attempt: number) => {
      const image = new Image();
      // Before `src`, or the request is already in flight without it. The same
      // reason the media elements carry it: `prequel-media:` is a different
      // origin, and an image fetched without CORS is tainted. Canvas 2D merely
      // taints the canvas back; WebGL *throws* on `texImage2D`, and the throw
      // takes the whole frame down with it — a blank preview, from a missing
      // attribute on a background nobody was looking at.
      image.crossOrigin = "anonymous";
      // The query is a cache-buster and nothing more: `resolveMediaPath` reads
      // only the pathname, so it never reaches the file lookup. Without it a
      // retry can be answered from Chromium's cache with the same failure.
      const url = mediaUrl(recordingName(session.dir), path);
      image.src = attempt === 0 ? url : `${url}?retry=${attempt}`;

      image.onload = () => {
        if (cancelled) return;
        loaded.set(path, image);
        // A fresh Map each time, because the canvas reads it by identity — but
        // merged into what is already there rather than replacing it. The
        // caption bitmaps live in the same map and are put there by
        // `useCaptionImages`, so replacing it wholesale drops every caption the
        // moment a background or a pointer image finishes loading.
        setImages((images) => {
          const next = new Map(images);
          for (const [file, picture] of loaded) next.set(file, picture);
          return next;
        });
        onSettled(path);
      };

      image.onerror = () => {
        if (cancelled) return;
        if (attempt >= RETRY_DELAYS.length) {
          console.warn(`[editor] could not load ${path}`);
          // Settled, not loaded: the picture is missing from the composition
          // either way, and the preview has to reveal without it rather than
          // wait for a file the ladder has just proved is not coming.
          onSettled(path);
          return;
        }
        timers.push(setTimeout(() => load(path, attempt + 1), RETRY_DELAYS[attempt]!));
      };
    };

    for (const path of wanted) load(path, 0);

    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [session, paths, setImages, onSettled]);
}

/**
 * How long to wait before each retry of a failed image load.
 *
 * Long enough at the end to cover a background still being downloaded on a slow
 * connection, and bounded so a genuinely missing file settles rather than
 * retrying for ever.
 */
const RETRY_DELAYS = [300, 900, 2500, 6000] as const;

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

  // The watermark, from the defaults and from every clip that sets its own. A
  // path collected here is a path `useEditorImages` loads — one left out is a
  // logo the preview simply never draws, with nothing to say why.
  const mark = (file: string | null | undefined) => {
    if (file) paths.add(file);
  };
  mark(project.defaults.watermark.watermark);
  for (const track of project.tracks) {
    for (const slice of track.slices) mark(slice.overrides.watermark?.watermark);
  }

  return [...paths];
}

/**
 * The panel behind each thing the preview can be clicked on.
 *
 * A table rather than a conditional, so adding something to the composition
 * that can be clicked is a line here and a compile error until it is.
 */
const PANEL_FOR: Record<Picked, CategoryId> = {
  camera: "camera",
  screen: "recording",
  watermark: "watermark",
  captions: "captions",
};

/** The shortcuts worth having before there is a menu bar. */
function useShortcuts(
  media: ReturnType<typeof useEditorPlayback>,
  dispatch: Dispatch<EditorAction>,
  state: EditorState,
  onAddRecording: () => void,
  /** A text has just been added, so the playhead can go and meet it. */
  onAddedText: () => void,
) {
  // Read through a ref so the listener is bound once rather than rebound on
  // every edit — the selection and tool change constantly.
  const latest = useRef(state);
  latest.current = state;
  // Through a ref for the same reason, and it matters more here: this closure
  // holds the project it saves, so a stale one would write an edit from several
  // keystrokes ago over the current one.
  const addRecording = useRef(onAddRecording);
  addRecording.current = onAddRecording;
  const addedText = useRef(onAddedText);
  addedText.current = onAddedText;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Never while typing in a field, or a space would toggle playback instead
      // of being a space, and D would change tool mid-word.
      // `TEXTAREA` too: the text panel types into one, and without it a
      // space toggled playback mid-sentence and T added a second title.
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "SELECT" ||
        target?.tagName === "TEXTAREA" ||
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

        // Adds a zoom where the playhead is, for the same reason S cuts there.
        case "KeyZ":
          event.preventDefault();
          dispatch({ type: "addZoomNear", at: media.playback.position() });
          return;

        // Adds a text where the playhead is, for the same reason Z adds a zoom.
        // The playhead then moves to the end of its entrance — see the effect
        // beside `previewText`.
        case "KeyT":
          event.preventDefault();
          dispatch({ type: "addTextNear", at: media.playback.position() });
          addedText.current();
          return;

        // Records more into this project. Beside Z and T because it is the third
        // thing the transport's pill adds, even though this one leaves the editor
        // to do it.
        case "KeyR":
          event.preventDefault();
          addRecording.current();
          return;

        case "Backspace":
        case "Delete": {
          // Whichever of the three is selected — they are mutually exclusive,
          // so there is never a question of which one Backspace means.
          const { selectedSliceId, selectedZoomId, selectedTextId } = latest.current;
          if (selectedTextId) {
            event.preventDefault();
            dispatch({ type: "deleteText", textId: selectedTextId });
            return;
          }
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

/**
 * The first take's dimensions for one kind, or null.
 *
 * The first take's because these shape the inspector's stock controls and the
 * automatic output frame — decisions about the recording, made once. The picture
 * is laid out per slice from the segment that slice plays, which is what lets a
 * second take at a different resolution compose correctly.
 */
function sizeOf(
  media: readonly TrackMedia[],
  kind: TrackKind,
): { width: number; height: number } | null {
  const track = media.find((candidate) => candidate.kind === kind && candidate.segment === 0);
  return track?.width && track.height ? { width: track.width, height: track.height } : null;
}
