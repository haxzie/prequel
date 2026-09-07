import { useEffect, useState, type Dispatch } from "react";

import { captionStyle } from "../../../shared/captions";
import { cursorStyle } from "../../../shared/contract";
import { cameraFloats, shapeAspect, type Size } from "../../../shared/layout";
import type { TrackKind } from "../../../shared/manifest";
import {
  DEFAULT_LAYOUT,
  overriddenKeys,
  type Background,
  type BackgroundSettings,
  type CameraShape,
  type CaptionPlace,
  type CaptionSettings,
  type LayoutPreset,
  type LayoutSettings,
  type SettingsSection,
  type SliceSettings,
  type ZoomSlice,
  WALLPAPER_FILE_NAME,
} from "../../../shared/project";
import type { Backgrounds } from "./useBackgrounds";
import { CameraMap } from "./controls/CameraMap";
import { CaptionEditor, type CaptionEditing } from "./CaptionEditor";
import { CaptionStylePicker } from "./controls/CaptionStylePicker";
import { cn } from "../lib/cn";
import { CursorPicker } from "./controls/CursorPicker";
import { EasingPad } from "./controls/EasingPad";
import { FontPicker } from "./controls/FontPicker";
import { ScrollFade } from "./controls/ScrollFade";
import { Field, Section } from "./controls/Field";
import { LayoutPicker } from "./controls/LayoutPicker";
import { PerspectivePad } from "./controls/PerspectivePad";
import { PerspectivePlate } from "./controls/PerspectivePlate";
import {
  AngleIcon,
  AudioIcon,
  BackdropIcon,
  BackIcon,
  BlurIcon,
  BorderIcon,
  CameraIcon,
  CaptionsIcon,
  CircleIcon,
  ClockIcon,
  CloseIcon,
  CursorIcon,
  DepthIcon,
  DropletIcon,
  EyeIcon,
  EyeOffIcon,
  FillIcon,
  FocusIcon,
  FontIcon,
  FrameIcon,
  LayoutIcon,
  LevelIcon,
  LinesIcon,
  MicIcon,
  MirrorIcon,
  OffsetIcon,
  OpacityIcon,
  PaddingIcon,
  PencilIcon,
  PerspectiveIcon,
  PlaceIcon,
  PortraitIcon,
  ResetIcon,
  RoundedIcon,
  ScreenIcon,
  ShadowIcon,
  ShadowOffsetIcon,
  SizeIcon,
  SmoothingIcon,
  SpeakerIcon,
  SpeedIcon,
  SquircleIcon,
  StrengthIcon,
  TiltIcon,
  TypingIcon,
  TrashIcon,
  VignetteIcon,
  WideIcon,
  YawIcon,
  ZoomIcon,
  ZoomOutIcon,
  ZoomInIcon,
} from "./icons";
import {
  ColorField,
  percent,
  Segmented,
  Slider,
  SLIDE_MS,
  Tabs,
  Toggle,
  ToggleField,
  useTravelling,
} from "./controls/inputs";
import { GradientSwatches, ImageSwatches, SolidSwatches } from "./controls/Swatches";
import { activeSettings, selectedSlice, type EditorAction, type EditorState } from "./state";

export interface InspectorProps {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  /** Which tracks the recording actually has, so absent ones are not offered. */
  present: Set<TrackKind>;
  /** Whether the pointer is a layer here, or already part of the picture. */
  hasCursor: boolean;
  /** How the transcript is doing, so the captions panel can offer to make one. */
  captions: CaptionsState;
  /** The hosted background catalogue, or the shipped presets as a fallback. */
  backgrounds: Backgrounds;
  /** The background being downloaded, so its swatch can say so. */
  pendingBackground: string | null;
  /** Output size, so the camera map can take the frame's own proportions. */
  frame: Size;
  /** The camera track's own dimensions, or null when there is no camera. */
  cameraSource: Size | null;
  /**
   * Play the selected zoom's span once, to show what a control just changed.
   *
   * Called on every change and expected to settle on its own: the panel does not
   * know when a drag has finished, and a slider is a stream of changes rather
   * than one.
   */
  onPreviewZoom: () => void;
  onPickWallpaper: () => void;
  onPickImage: () => void;
  onPickPreset: (file: string) => void;
  /**
   * A file inside the recording, as something the renderer can load.
   *
   * One resolver rather than a URL for each picture. Three panels want one —
   * the desktop picture on its swatch, the pointer images on theirs, the
   * background behind every layout thumbnail — and which files those are is
   * decided by `CURSOR_STYLES`, by what the user dropped in, and by the
   * arrangement being drawn. None of that should reach this list of props.
   */
  fileUrl: (file: string) => string;
  /**
   * Put the panel away and drop the selection with it.
   *
   * Both, because they are one thing to the person doing it: the panel is only
   * ever showing something because that thing is selected, and leaving a clip
   * selected behind a closed panel leaves the timeline lit up over an editor
   * with no visible way to change it.
   */
  onClose: () => void;
  /**
   * The words, and what the captions editor may do to them.
   *
   * Bundled for the reason `captions` is: the words are derived from the
   * session's transcript and the project together, and every one of the
   * callbacks reaches the playback clock, which lives outside the reducer.
   */
  editing: CaptionEditing;
}

/**
 * What the captions panel needs to know about the transcript, and how to start
 * one.
 *
 * Passed in rather than read here for the reason `hasCursor` is: the transcript
 * belongs to the session, and the session is deliberately not in `EditorState`.
 */
export interface CaptionsState {
  /** True once there is a usable transcript on disk. */
  ready: boolean;
  /** Non-null while one is being made. 0-1, or null when the stage has no measure. */
  progress: number | null;
  /** What is happening. */
  stage: "idle" | "preparing" | "transcribing" | "failed";
  /** Why the attempt failed, if it did. */
  error: string | null;
}

/**
 * The controls for whatever is selected.
 *
 * With a clip selected, every change becomes an override on that clip. With
 * nothing selected it edits the project defaults, which every clip that has not
 * overridden the key follows. The dot beside a control says which of the two
 * a value is currently coming from.
 */
export function Inspector(props: InspectorProps) {
  const { state, dispatch } = props;
  const [tab, setTab] = useState<CategoryId>("layout");
  const [zoomTab, setZoomTab] = useState<ZoomTabId>("motion");
  /**
   * Which of the captions category's two views is showing.
   *
   * Local, like the tab: it is navigation, not an edit, and it is put back to
   * the options whenever the panel changes what it is about — another tab, a
   * zoom taking the panel over, the panel being closed. Coming back to the
   * captions tab and finding the editor still open, with its selection band
   * on the timeline, reads as the panel having remembered the wrong thing.
   */
  const [captionView, setCaptionView] = useState<"options" | "edit">("options");
  useEffect(() => {
    if (state.selectedZoomId !== null) setCaptionView("options");
  }, [state.selectedZoomId]);

  const settings = activeSettings(state);
  const slice = selectedSlice(state);
  const scoped = slice !== undefined;

  const set = (section: SettingsSection, key: string, value: unknown) =>
    dispatch({ type: "setSetting", section, key, value });

  // Only a selected clip can override anything; with nothing selected the
  // inspector *is* the defaults, and marking a field would be claiming
  // otherwise. There is no per-field reset — the section header has one.
  const field = <S extends SettingsSection>(section: S, key: keyof SliceSettings[S]) => ({
    overridden: scoped && overriddenKeys(slice?.overrides, section).has(key),
  });

  // `keys` narrows both halves of the button to part of a section: whether it
  // is offered at all, and what it puts back. Background and Frame are two
  // panels over the one `background` section, and either header resetting the
  // whole of it would undo edits the person cannot see from where they are.
  const sectionReset = (section: SettingsSection, keys?: string[]) => {
    const overridden = Object.keys(slice?.overrides[section] ?? {});
    const touched = keys ? overridden.some((key) => keys.includes(key)) : overridden.length > 0;
    return scoped && touched ? () => dispatch({ type: "resetSection", section, keys }) : undefined;
  };

  // A selected zoom takes over the panel: it is not a clip, and none of the
  // clip's questions — what does it override, what does it inherit — apply.
  const zoom = state.project.zooms.find((candidate) => candidate.id === state.selectedZoomId);
  if (zoom) {
    // Every zoom control funnels through here, so this is the one place the
    // preview has to be triggered from.
    const change = (patch: Partial<ZoomSlice>) => {
      dispatch({ type: "setZoom", zoomId: zoom.id, patch });
      props.onPreviewZoom();
    };
    const panel = { zoom, frame: props.frame, hasCursor: props.hasCursor, onChange: change };
    // Non-null because `zoomTab` only ever holds an id from this list.
    const showingZoomTab = ZOOM_TABS.find((entry) => entry.id === zoomTab) ?? ZOOM_TABS[0]!;

    return (
      <div className={SHELL}>
        <Rail items={ZOOM_TABS} value={zoomTab} onChange={setZoomTab} />

        <aside className={PANEL}>
          <div className="flex min-w-0 flex-1 flex-col">
            <PanelHeader
              // The tab that is showing, not the word "Zoom": the header names
              // the section the panel is displaying, which is what the rail's
              // glyphs cannot say for themselves.
              title={showingZoomTab.label}
              icon={<showingZoomTab.Icon />}
              onDelete={() => dispatch({ type: "deleteZoom", zoomId: zoom.id })}
              deleteLabel="Remove zoom"
              onClose={props.onClose}
            />
            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
              <ScrollFade className="sticky top-0 z-10" />
              {/* Keyed on the tab, so React replaces the view rather than
                  reconciling one panel's controls into another's and the
                  animation has something to run on. */}
              <div key={zoomTab} className="flex min-w-0 flex-1 flex-col animate-view-in">
                {zoomTab === "motion" && <ZoomMotionPanel {...panel} />}
                {zoomTab === "perspective" && <ZoomPerspectivePanel {...panel} />}
                {zoomTab === "focus" && <ZoomFocusPanel {...panel} />}
              </div>
            </div>
          </div>
        </aside>
      </div>
    );
  }

  const categories: Category[] = [
    { id: "layout", label: "Layout", Icon: LayoutIcon },
    { id: "background", label: "Background", Icon: BackdropIcon },
    { id: "frame", label: "Frame", Icon: FrameIcon },
    ...(props.present.has("camera")
      ? [{ id: "camera" as const, label: "Camera", Icon: CameraIcon }]
      : []),
    ...(props.present.has("microphone") || props.present.has("system_audio")
      ? [{ id: "audio" as const, label: "Audio", Icon: AudioIcon }]
      : []),
    ...(props.hasCursor ? [{ id: "cursor" as const, label: "Cursor", Icon: CursorIcon }] : []),
    // Only where there is a voice to caption. A recording with no microphone
    // has nothing to transcribe, and offering the panel anyway would be a
    // section whose every control is dead.
    ...(props.present.has("microphone")
      ? [{ id: "captions" as const, label: "Captions", Icon: CaptionsIcon }]
      : []),
  ];

  // What each category's Reset puts back.
  //
  // Here rather than inside the panels because the button is in the header now,
  // and the header does not know which panel is under it beyond its id. The
  // pairs that are not one-to-one are the reason this is a table: Background
  // and Frame are two panels over the one `background` section and must reset
  // only their own half of it, and three of them are views onto `layout`.
  const RESETS: Record<CategoryId, (of: typeof sectionReset) => (() => void) | undefined> = {
    layout: (of) => of("layout"),
    background: (of) => of("background", PAINT_KEYS),
    frame: (of) => of("background", FRAME_KEYS),
    camera: (of) => of("layout"),
    audio: (of) => of("audio"),
    cursor: (of) => of("layout"),
    captions: (of) => of("captions"),
  };

  // A category can disappear — open a recording with no camera while Camera is
  // showing — so the fallback is the one that is always there rather than a
  // blank panel.
  const active = categories.some((category) => category.id === tab) ? tab : "layout";
  // `active` is resolved against this same list above, so the fallback is
  // unreachable — it exists to keep this total rather than to be taken.
  const showing = categories.find((category) => category.id === active) ?? categories[0]!;
  const editingCaptions = active === "captions" && captionView === "edit";

  const close = () => {
    setCaptionView("options");
    props.onClose();
  };

  return (
    <div className={SHELL}>
      <Rail
        items={categories}
        value={active}
        onChange={(id) => {
          setTab(id);
          setCaptionView("options");
        }}
      />

      <aside className={PANEL}>
        {/* The header sits outside the scroller rather than sticking to the top
            of it. Sticky would hold it in place too, but the tab row inside
            wants to pin *under* the header — and a second `sticky top-0` lands
            on top of the first unless the header's height is written in as a
            number. Out here the header is simply not scrollable, and the tabs
            pin at `top-0` of whatever is left. */}
        <div className="flex min-w-0 flex-1 flex-col">
          {editingCaptions ? (
            // The editor is about the words, not about the selected clip, so
            // the header says so rather than "Clip" — and offers no delete,
            // because Backspace in here already means something.
            <PanelHeader
              title="Edit captions"
              icon={<CaptionsIcon />}
              onBack={() => setCaptionView("options")}
              // The same button in the same place as every other panel's, and
              // absent for the same reason: nothing edited is nothing to put
              // back. It was a word here while the panels had words of their
              // own, and a lone word among icons once they stopped.
              onReset={props.editing.edited ? props.editing.onReset : undefined}
              deleteLabel="Remove clip"
              onClose={close}
            />
          ) : (
            <PanelHeader
              // The category that is showing. The rail is a column of glyphs
              // with no labels — a tooltip is the only way to find out what one
              // means — so the panel it opens says the word.
              title={showing.label}
              icon={<showing.Icon />}
              onReset={RESETS[showing.id](sectionReset)}
              // Only a selected clip can be removed. With nothing selected this
              // panel is the project defaults, which are not a thing to delete.
              onDelete={
                scoped && slice
                  ? () => dispatch({ type: "deleteSlice", sliceId: slice.id })
                  : undefined
              }
              deleteLabel="Remove clip"
              onClose={close}
            />
          )}

          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
            <ScrollFade className="sticky top-0 z-10" />

            {/* The panel's content, faded in on the way to a new one.
                `animate-view-in` is the dock's own swap, reused: opacity and
                nothing else, which matters more here than it does there. A
                keyframe that moved the content would make this wrapper a
                containing block for the length of it, and the background
                panel's tab row is `sticky` — it would come unpinned for
                200ms every time you opened it.

                Fading in and not out. An outgoing panel would have to stay
                mounted and float over the incoming one, and these are a
                scrolling column of very different heights: the two would have
                to agree on a size neither has. */}
            <div
              key={editingCaptions ? "captions-editor" : active}
              className="flex min-w-0 flex-1 flex-col animate-view-in"
            >
              {editingCaptions && <CaptionEditor {...props.editing} />}

              {active === "layout" && (
                <LayoutPanel
                  settings={settings}
                  frame={props.frame}
                  cameraSource={props.cameraSource}
                  cameraPresent={props.present.has("camera")}
                  fileUrl={props.fileUrl}
                  field={field}
                  set={set}
                />
              )}

              {active === "background" && (
                <BackgroundPanel
                  settings={settings}
                  field={field}
                  set={set}
                  onPickWallpaper={props.onPickWallpaper}
                  onPickImage={props.onPickImage}
                  onPickPreset={props.onPickPreset}
                  backgrounds={props.backgrounds}
                  pendingBackground={props.pendingBackground}
                  wallpaperUrl={props.fileUrl(WALLPAPER_FILE_NAME)}
                />
              )}

              {active === "frame" && <FramePanel settings={settings} field={field} set={set} />}

              {active === "camera" && (
                <CameraPanel
                  settings={settings}
                  frame={props.frame}
                  cameraSource={props.cameraSource}
                  field={field}
                  set={set}
                />
              )}

              {active === "audio" && (
                <AudioPanel settings={settings} present={props.present} field={field} set={set} />
              )}

              {active === "cursor" && (
                <CursorPanel
                  settings={settings}
                  field={field}
                  set={set}
                  cursorUrl={props.fileUrl}
                />
              )}

              {active === "captions" && !editingCaptions && (
                <CaptionsPanel
                  settings={settings}
                  captions={props.captions}
                  field={field}
                  set={set}
                  onEdit={() => setCaptionView("edit")}
                />
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

/**
 * The pair, run to the window's edges.
 *
 * No margin, so the panel is a full-height column meeting the timeline below it
 * rather than a card floating on the board. The spacing that used to be here
 * moved onto the rail, which still needs room around its icons — putting it on
 * the shell would push the panel off the edge again, which is the thing being
 * removed.
 *
 * `justify-end` anchors the controls to the window edge, so the panel does not
 * slide sideways when the rail is absent — which it is for a selected zoom.
 */
const SHELL = "flex flex-1 justify-end";

/**
 * The rail: icons over the editor's own background, with nothing behind them.
 *
 * It used to be a panel in its own right, which made two surfaces where the
 * eye only has one thing to find — and the smaller of the two was introducing
 * the larger. `self-start` is what keeps it the height of its own buttons: as
 * an ordinary flex item it would stretch to match the panel beside it and hold
 * a column of hover targets over nothing.
 */
/**
 * The rail: icons over the editor's own background, with nothing behind them.
 *
 * It is a surface again. It was one, then was not — two surfaces made the eye
 * hunt, and the smaller of them was only introducing the larger — but that was
 * while the inspector was a floating card too. The panel is a full-height column
 * against the window edge now, so there is one thing here that floats rather
 * than two, and the dock is it.
 *
 * `self-start` is what keeps it the height of its own buttons: as an ordinary
 * flex item it would stretch to match the panel beside it and hold a column of
 * hover targets over nothing.
 *
 * Marked the same way the background's tabs are, and for the same reason: two
 * pills behind the icons, one following the choice and one following the
 * pointer, moved by a transform so the mark reads as travelling to the icon
 * that was pressed rather than as one square going dark while another lights
 * up. Blue here where the tabs are grey — the rail chooses which of the clip's
 * settings you are editing, which is the app's own "this is the one".
 */
function Rail<T extends string>({
  items,
  value,
  onChange,
}: {
  items: readonly { id: T; label: string; Icon: () => React.ReactElement }[];
  value: T;
  onChange: (id: T) => void;
}) {
  const at = Math.max(
    0,
    items.findIndex((item) => item.id === value),
  );
  const [hovered, setHovered] = useState<number | null>(null);
  // Keeps the pointer's pill up until the blue one reaches it — see the hook.
  const travelling = useTravelling(at);

  // One step down the rail: a button (`size-9`) and the gap under it (`gap-1`).
  // The pills are positioned from the rail's own padding, so a whole number of
  // steps lands one exactly on a button.
  const step = (index: number) => ({ transform: `translateY(calc(${String(index)} * 2.5rem))` });
  const pill =
    "pointer-events-none absolute top-1.5 left-1.5 size-9 rounded " +
    "transition-[transform,opacity] ease-out motion-reduce:transition-none";
  const slide = { transitionDuration: `${String(SLIDE_MS)}ms` };

  return (
    <nav
      className={cn(
        "relative flex flex-none flex-col gap-1 self-start",
        // A dock: a raised surface floating over the board rather than icons
        // lying directly on it. `self-start` keeps it the height of its own
        // buttons, which is what makes it read as an object placed on the
        // composition rather than as a column the window happens to have.
        //
        // The panel's own colour, so the two read as one piece of chrome with a
        // gap in it rather than as a dark object in front of a lighter one.
        //
        // The *solid* veil, not the translucent one the panel wears. They are
        // the same colour — `rgba(22, 23, 26, …)` is `#16171a` — but the panel
        // has the window behind it where this has the dot grid, and at 93% the
        // pattern comes through the dock as a faint texture on a surface that
        // is meant to be sitting on top of it.
        // 10px around 4px buttons with 6px of padding between them: concentric,
        // 10 − 6 = 4. A shadow just deep enough to lift it off the board — the
        // dock is a surface the composition sits under, not a dialog over it,
        // and a heavy one made the board look like a hole.
        "rounded-[10px] border border-editor-line bg-editor-veil-solid shadow-[0_1px_6px_rgba(0,0,0,0.3)]",
        // Margin outside, padding in. Without the margin the dock's own corners
        // meet the panel's edge and the top of the row, which is the one thing
        // a floating object must not do.
        "my-2 mr-2 p-1.5",
      )}
      onPointerLeave={() => setHovered(null)}
    >
      {/* Parked under the choice while nothing is hovered, so it fades in where
          the pointer is rather than travelling the length of the rail to it. */}
      <span
        aria-hidden
        className={cn(pill, "bg-white/10")}
        style={{
          ...step(hovered ?? at),
          ...slide,
          opacity: hovered === null || (hovered === at && !travelling) ? 0 : 1,
        }}
      />
      <span aria-hidden className={cn(pill, "bg-selected")} style={{ ...step(at), ...slide }} />

      {items.map(({ id, label, Icon }, index) => (
        <button
          key={id}
          type="button"
          aria-current={id === value}
          // The label the icon replaced, kept where it is still needed: as the
          // accessible name, and as the tooltip that is now the only way to
          // find out what a glyph means.
          aria-label={label}
          title={label}
          // Above the pills, which are painted behind the whole column. White
          // whether or not it is the one showing: with no surface behind the
          // rail there is nothing for a muted colour to read against, and a
          // dimmed icon on the editor's own background looks disabled rather
          // than merely unselected — so the fill behind the chosen one carries
          // that on its own. Tried at 45% with a lift on hover, and it still
          // read as a column of unavailable things.
          className="relative z-10 grid size-9 place-items-center rounded text-white [&_svg]:size-[18px]"
          onPointerEnter={() => setHovered(index)}
          onClick={() => onChange(id)}
        >
          <Icon />
        </button>
      ))}
    </nav>
  );
}

/**
 * The panel itself: a full-height column against the window edge.
 *
 * `bg-editor-veil`, the timeline's surface rather than `--editor-panel`, so the
 * two meet as one continuous chrome down the right and along the bottom instead
 * of as two panels of slightly different greys.
 *
 * A left border and no shadow: square and flush, the only edge that exists is
 * the one facing the composition, and a drop shadow with nothing to float over
 * reads as a seam rather than as depth. `overflow-hidden` still earns its place
 * — it keeps the scrolling content off the border.
 */
const PANEL = "flex w-80 flex-none overflow-hidden border-l border-editor-line bg-editor-veil";

/**
 * What the pair occupies when open.
 *
 * The dock is 2.25rem of button, 0.75rem of padding, 0.125rem of border and
 * 0.5rem of margin beside the panel — 3.625rem — and the panel is 20rem. The
 * rest falls to the left of the dock, the shell being `justify-end`, so slack
 * here never moves the panel off the window edge.
 */
export const PANEL_WIDTH = "24rem";

/** The inspector's destinations. */
type CategoryId = "layout" | "background" | "frame" | "camera" | "audio" | "cursor" | "captions";

/**
 * A selected zoom's destinations.
 *
 * Its own rail rather than more rows in one column. A zoom carries as many
 * controls as a clip does, and they divide the same way: what the shot does,
 * and two looks that are set once. Kept separate from `CategoryId` because the
 * two rails never coexist — a zoom takes over the panel — and a single union
 * would let a clip's tab be selected on a zoom and back again.
 */
type ZoomTabId = "motion" | "perspective" | "focus";

const ZOOM_TABS: { id: ZoomTabId; label: string; Icon: () => React.ReactElement }[] = [
  { id: "motion", label: "Zoom", Icon: ZoomIcon },
  { id: "perspective", label: "Angle", Icon: PerspectiveIcon },
  { id: "focus", label: "Focus", Icon: FocusIcon },
];

interface Category {
  id: CategoryId;
  label: string;
  Icon: () => React.JSX.Element;
}

type FieldProps = <S extends SettingsSection>(
  section: S,
  key: keyof SliceSettings[S],
) => { overridden: boolean };

type Setter = (section: SettingsSection, key: string, value: unknown) => void;

/**
 * Arrangements the two pictures can be in.
 *
 * No zoom of its own: how far into the recording to push is what a zoom moment
 * answers, and a second, static control for the same question was one the
 * timeline knew nothing about.
 */
function LayoutPanel({
  settings,
  frame,
  cameraSource,
  cameraPresent,
  fileUrl,
  field,
  set,
}: {
  settings: SliceSettings;
  frame: Size;
  cameraSource: Size | null;
  cameraPresent: boolean;
  fileUrl: (file: string) => string;
  field: FieldProps;
  set: Setter;
}) {
  const { layout } = settings;

  return (
    <Section>
      {/* No label over it, for the reason the background's tabs have none: the
          panel header already says Layout, and a grid of arrangements is a
          control that shows what it is. The override this field marked is still
          reachable — the header carries Reset whenever anything here is set for
          the clip. */}
      <Field {...field("layout", "preset")}>
        <LayoutPicker
          frame={frame}
          // The composition's own background and padding, so a padded
          // arrangement is told apart from a full-bleed one by the thing that
          // actually differs between them.
          background={settings.background}
          fileUrl={fileUrl}
          value={layout.preset}
          cameraPresent={cameraPresent}
          onChange={(preset) => {
            set("layout", "preset", preset);
            // The arrangement answers the shape, the same way it answers the
            // camera toggle below. It stays a control afterwards.
            const shape = cameraShapeFor(preset) ?? layout.cameraShape;
            if (shape !== layout.cameraShape) set("layout", "cameraShape", shape);
            // The toggle and the arrangement are two ways of asking the same
            // question, so picking a screen-only arrangement has to answer it
            // the same way — otherwise the Camera panel says the camera is on
            // while the frame plainly has no camera in it.
            set("layout", "cameraVisible", !SCREEN_ONLY.has(preset));

            // Picking an arrangement starts it clean.
            //
            // Every crop, box and position is an answer to "how should this sit
            // in *that* arrangement", and none of them survive the question
            // changing: a zoom that framed a split's left half lands somewhere
            // arbitrary once the same picture is full-bleed, a bubble dragged
            // out of the way of one arrangement is in the way of the next, and
            // a box dragged in `custom` would otherwise sit in the settings
            // unread until the next resize snapped the picture back to it.
            //
            // So the cell delivers the picture on it, every time, and undo is
            // what puts a hand-made arrangement back.
            for (const [key, value] of Object.entries(
              freshFraming({ ...layout, cameraShape: shape }, cameraSource),
            )) {
              set("layout", key, value);
            }
          }}
        />
      </Field>
    </Section>
  );
}

/**
 * The arrangement to move to when the camera is switched on or off, if any.
 *
 * Null where the current one already agrees — the `over-*` arrangements own
 * only the screen, so the bubble simply appears and disappears within them.
 */
function cameraAgreement(preset: LayoutPreset, visible: boolean): LayoutPreset | null {
  if (visible) {
    if (preset === "screen-full") return "over-full";
    // `screen-inset` lands here too. There is no `over-*` standing that far
    // back, and the nearest arrangement that has a camera in it is the one that
    // pads the screen — a toggle that quietly did nothing would be worse than
    // one that gives up the extra margin.
    if (preset === "screen-padded" || preset === "screen-inset") return "over-padded";
    return null;
  }

  // Each camera-only arrangement hands over to the screen-only one that frames
  // the picture the same way, so switching the camera off changes what is in
  // the frame and nothing else about how it sits in it.
  if (preset === "camera-inset") return "screen-inset";
  if (preset === "camera-full" || SLOTTED.has(preset)) return "screen-padded";
  if (preset === "camera-padded") return "screen-padded";
  return null;
}

/**
 * Every framing key back at its default, for a change of arrangement.
 *
 * Picking a cell in the grid means "give me that picture", so it gives that
 * picture — nothing dragged, resized or nudged in the arrangement before it
 * survives the switch. Position included, which it was not: a bubble parked
 * bottom-left came back bottom-left in the next arrangement that left it free,
 * so the cell that promised a corner bubble delivered someone else's, and the
 * only way back to the picture on the thumbnail was to drag it there by hand.
 *
 * A clean slate is also what makes the grid honest. Every plate is drawn from
 * `DEFAULT_LAYOUT`, so any key kept across a switch is a key the thumbnail did
 * not draw.
 *
 * The camera's shape and whether it is mirrored are not framing and are not
 * here: they say what the picture *is*, not where it sits, and the arrangement
 * that wants a particular one says so where it is picked.
 */
function freshFraming(layout: LayoutSettings, cameraSource: Size | null): Partial<LayoutSettings> {
  return {
    screenOffsetX: DEFAULT_LAYOUT.screenOffsetX,
    screenOffsetY: DEFAULT_LAYOUT.screenOffsetY,
    screenX: DEFAULT_LAYOUT.screenX,
    screenY: DEFAULT_LAYOUT.screenY,
    screenWidth: DEFAULT_LAYOUT.screenWidth,
    screenHeight: DEFAULT_LAYOUT.screenHeight,
    cameraZoom: DEFAULT_LAYOUT.cameraZoom,
    cameraOffsetX: DEFAULT_LAYOUT.cameraOffsetX,
    cameraOffsetY: DEFAULT_LAYOUT.cameraOffsetY,
    cameraX: DEFAULT_LAYOUT.cameraX,
    cameraY: DEFAULT_LAYOUT.cameraY,
    cameraHeight: DEFAULT_LAYOUT.cameraHeight,
    // Off the shape rather than off the default, or a `wide` bubble would come
    // back square while the shape control still said wide.
    cameraWidth: DEFAULT_LAYOUT.cameraHeight * shapeAspect(layout.cameraShape, cameraSource),
    // Which dressing the camera takes under `custom`, which is the one
    // arrangement that reads it. Left behind, a column dragged loose from this
    // switch would be dressed as whatever the arrangement two switches ago was.
    cameraCard: DEFAULT_LAYOUT.cameraCard,
  };
}

/**
 * The camera's shape for an arrangement, at the moment it is picked.
 *
 * Only the corner is being decided here — `radiusFor` reads the shape, and
 * these two differ in nothing else: both are square, and `squircle` rounds by
 * half the edge where `rounded` takes a fraction of it.
 *
 * A bubble floating over the screen is round, because it is a picture of a
 * person and nothing else in the frame is that shape. A camera that stands *in*
 * the frame is a card, and a card is cut the way the screen beside it is cut —
 * a squircle at three quarters of the frame's height is a blob rather than a
 * shape, and a circle there is a porthole.
 *
 * The camera-only arrangements take the rectangle corner. There the camera is
 * not a picture of a person sitting in a frame — it *is* the frame's picture,
 * filling it the way a screen recording does, and a squircle's radius of half
 * the shorter edge turns a 1920×1080 picture into a lozenge. `wide` is the
 * rectangle whose aspect is the camera's own, so what it says about the shot is
 * "all of it", which is what these arrangements show.
 *
 * Null only where there is nothing to say: the screen-only cells have no camera
 * to shape, and `custom` is wherever a drag left things.
 */
function cameraShapeFor(preset: LayoutPreset): CameraShape | null {
  switch (preset) {
    case "over-full":
    case "over-padded":
      return "squircle";
    case "camera-full":
    case "camera-padded":
    case "camera-inset":
      return "wide";
    case "over-column":
    case "over-column-left":
    case "beside":
    case "beside-left":
    case "stacked":
    case "split":
      return "rounded";
    default:
      return null;
  }
}

/** Arrangements with no camera in them. */
const SCREEN_ONLY = new Set<LayoutPreset>(["screen-full", "screen-padded", "screen-inset"]);

/** Arrangements where the camera is a card beside the screen, not a bubble over it. */
/**
 * Arrangements that decide the camera's size for themselves.
 *
 * `stacked` is deliberately not one of them any more. In the others the camera
 * is the other half of a split and its size falls out of the space left over,
 * so a Size control would be a slider that visibly does nothing; there the
 * bubble is a separate object under the picture, and its own controls set it.
 */
const SLOTTED = new Set<LayoutPreset>([
  "beside",
  "beside-left",
  "split",
  // The column's height is the frame's and its width follows from that, so
  // both the Size slider and the Position map would be controls visibly doing
  // nothing. Dragging it in the preview is how it is let loose.
  "over-column",
  "over-column-left",
]);

/** The webcam bubble. Only reachable when the recording has one. */
function CameraPanel({
  settings,
  frame,
  cameraSource,
  field,
  set,
}: {
  settings: SliceSettings;
  frame: Size;
  /** The camera's own dimensions, for the `wide` shape's proportions. */
  cameraSource: Size | null;
  field: FieldProps;
  set: Setter;
}) {
  const { layout } = settings;
  // Disabled rather than hidden. Controls that vanish take the panel's shape
  // with them, so turning the camera off and on again moves everything below —
  // and hides what turning it back on is going to do.
  const off = !layout.cameraVisible;
  // Where the camera is a card beside the screen, the arrangement decides how
  // big it is and where it sits — so those controls are unavailable rather than
  // visibly doing nothing. Shape is not among them: the camera is round because
  // it is a camera, in every arrangement, and nothing in the Frame panel
  // reaches it.
  //
  // `custom` is either a card or a bubble, depending on what it was dragged out
  // of, which is exactly what `cameraCard` records.
  const slotted = SLOTTED.has(layout.preset) || (layout.preset === "custom" && layout.cameraCard);
  // Not `!slotted`, which is a different question: `camera-*` is neither a card
  // beside the screen nor a bubble over it — it *is* the picture, and a picture
  // that shrank away from a zoom would leave the frame empty.
  const floats = cameraFloats(layout);
  const aspect = layout.cameraWidth / Math.max(layout.cameraHeight, 0.0001);

  return (
    <>
      <Section>
        <ToggleField
          icon={<CameraIcon />}
          label="Camera"
          {...field("layout", "cameraVisible")}
          value={layout.cameraVisible}
          onChange={(value) => {
            set("layout", "cameraVisible", value);
            // The arrangement has to agree. Switching the camera off inside one
            // built around it would leave the screen alone in half a frame, and
            // switching it back on inside a screen-only one would do nothing at
            // all — a toggle that visibly does nothing is worse than no toggle.
            const answer = cameraAgreement(layout.preset, value);
            if (answer) set("layout", "preset", answer);
          }}
        />

        <Field icon={<SquircleIcon />} {...field("layout", "cameraShape")}>
          <Segmented
            value={layout.cameraShape}
            disabled={off}
            iconsOnly
            options={[
              { value: "circle", label: "Circle", icon: <CircleIcon /> },
              { value: "squircle", label: "Squircle", icon: <SquircleIcon /> },
              { value: "rounded", label: "Rounded", icon: <RoundedIcon /> },
              {
                value: "wide",
                label: "Wide",
                title: "The camera at its own size, corners rounded",
                icon: <WideIcon />,
              },
              {
                value: "portrait",
                label: "Portrait",
                title: "Taller than it is wide, cropped to the middle of the picture",
                icon: <PortraitIcon />,
              },
            ]}
            onChange={(value) => {
              set("layout", "cameraShape", value);
              // The shape decides the proportions once, here, rather than on
              // every frame. Derived during layout instead, a bubble someone had
              // dragged to a shape of their own would snap back to a square the
              // next time this control was touched.
              set("layout", "cameraWidth", layout.cameraHeight * shapeAspect(value, cameraSource));
            }}
          />
        </Field>

        <Slider
          icon={<SizeIcon />}
          label="Size"
          {...field("layout", "cameraHeight")}
          value={layout.cameraHeight}
          min={0.05}
          max={0.6}
          format={percent}
          disabled={off || slotted}
          onChange={(value) => {
            set("layout", "cameraHeight", value);
            // Both edges together, so resizing keeps whatever proportions the
            // bubble has rather than squaring it off.
            set("layout", "cameraWidth", value * aspect);
          }}
        />

        <Slider
          icon={<ZoomIcon />}
          label="Zoom"
          {...field("layout", "cameraZoom")}
          value={layout.cameraZoom}
          min={1}
          max={3}
          step={0.01}
          format={(value) => `${value.toFixed(2)}×`}
          disabled={off}
          onChange={(value) => set("layout", "cameraZoom", value)}
        />
      </Section>

      <Section title="Position">
        <Field icon={<PlaceIcon />} {...field("layout", "cameraX")}>
          <CameraMap
            frame={frame}
            shape={layout.cameraShape}
            size={layout.cameraHeight}
            aspect={aspect}
            x={layout.cameraX}
            y={layout.cameraY}
            disabled={off || slotted}
            onChange={(x, y) => {
              set("layout", "cameraX", x);
              set("layout", "cameraY", y);
            }}
          />
        </Field>

        <ToggleField
          icon={<MirrorIcon />}
          label="Mirror"
          {...field("layout", "cameraMirror")}
          value={layout.cameraMirror}
          disabled={off}
          // On by default because the bubble the user watched while recording
          // was mirrored; off reads as flipped against it.
          onChange={(value) => set("layout", "cameraMirror", value)}
        />
      </Section>

      <Section title="When zoomed">
        <ToggleField
          icon={<ZoomOutIcon />}
          label="Shrink on zoom"
          {...field("layout", "cameraShrinkOnZoom")}
          value={layout.cameraShrinkOnZoom}
          disabled={off || !floats}
          title={floats ? undefined : "Only a camera floating over the screen can shrink"}
          onChange={(value) => set("layout", "cameraShrinkOnZoom", value)}
        />

        <Slider
          icon={<ZoomInIcon />}
          label="Size while zoomed"
          {...field("layout", "cameraShrinkTo")}
          value={layout.cameraShrinkTo}
          min={0.2}
          max={1}
          format={percent}
          disabled={off || !floats || !layout.cameraShrinkOnZoom}
          onChange={(value) => set("layout", "cameraShrinkTo", value)}
        />
      </Section>
    </>
  );
}

/**
 * The pointer, composited from the positions sampled during capture.
 *
 * Only reachable when the recording was made with the system cursor switched
 * off — otherwise the pointer is part of the picture and none of this applies.
 */
function CursorPanel({
  settings,
  field,
  set,
  cursorUrl,
}: {
  settings: SliceSettings;
  field: FieldProps;
  set: Setter;
  cursorUrl: (file: string) => string;
}) {
  const { layout } = settings;
  const off = !layout.cursorVisible;

  return (
    <>
      <Section>
        <ToggleField
          icon={<EyeIcon />}
          label="Pointer"
          {...field("layout", "cursorVisible")}
          value={layout.cursorVisible}
          onChange={(value) => set("layout", "cursorVisible", value)}
        />

        <Field icon={<CursorIcon />} label="Style" {...field("layout", "cursorStyle")}>
          <CursorPicker
            // Resolved rather than passed straight through, so a project naming a
            // style this build no longer ships shows the one actually being drawn
            // instead of no selection at all.
            value={cursorStyle(layout.cursorStyle).id}
            imageUrl={cursorUrl}
            disabled={off}
            onChange={(value) => set("layout", "cursorStyle", value)}
          />
        </Field>

        <Slider
          icon={<SizeIcon />}
          label="Size"
          {...field("layout", "cursorSize")}
          value={layout.cursorSize}
          min={0.015}
          max={0.12}
          step={0.001}
          disabled={off}
          // Shown against the default rather than as a fraction: 0.035 of the
          // shorter edge means nothing to anyone.
          format={(value) => `${(value / 0.035).toFixed(1)}×`}
          onChange={(value) => set("layout", "cursorSize", value)}
        />
      </Section>

      <Section title="Motion">
        <Slider
          icon={<SmoothingIcon />}
          label="Smoothing"
          {...field("layout", "cursorSmoothing")}
          value={layout.cursorSmoothing}
          min={0}
          max={1}
          step={0.05}
          disabled={off}
          // A share of the smoothing rather than the lag in milliseconds it
          // buys: what anyone is judging is the path on screen, and nobody
          // picks a pointer by how far behind their hand it runs.
          format={(value) => (value === 0 ? "Off" : `${Math.round(value * 100)}%`)}
          onChange={(value) => set("layout", "cursorSmoothing", value)}
        />

        <Slider
          icon={<BlurIcon />}
          label="Motion blur"
          {...field("layout", "cursorMotionBlur")}
          value={layout.cursorMotionBlur}
          min={0}
          max={1}
          step={0.05}
          disabled={off}
          // A share of a full shutter, shown the way Smoothing above is: the
          // streak's length comes from how fast the pointer is actually going,
          // and a figure in pixels would be a number nobody can picture.
          format={(value) => (value === 0 ? "Off" : `${Math.round(value * 100)}%`)}
          onChange={(value) => set("layout", "cursorMotionBlur", value)}
        />
      </Section>

      <Section title="Hiding">
        <ToggleField
          icon={<TypingIcon />}
          label="Hide while typing"
          {...field("layout", "cursorHideWhileTyping")}
          value={layout.cursorHideWhileTyping}
          disabled={off}
          onChange={(value) => set("layout", "cursorHideWhileTyping", value)}
        />

        <ToggleField
          icon={<EyeOffIcon />}
          label="Hide when still"
          {...field("layout", "cursorAutoHide")}
          value={layout.cursorAutoHide}
          disabled={off}
          onChange={(value) => set("layout", "cursorAutoHide", value)}
        />

        <Slider
          icon={<ClockIcon />}
          label="After"
          {...field("layout", "cursorHideAfter")}
          value={layout.cursorHideAfter}
          min={0.5}
          max={10}
          step={0.5}
          disabled={off || !layout.cursorAutoHide}
          format={(value) => `${value}s`}
          onChange={(value) => set("layout", "cursorHideAfter", value)}
        />
      </Section>
    </>
  );
}

/**
 * Captions, drawn from what was said.
 *
 * The one panel whose controls need something made before they do anything, so
 * the transcript's own state sits above them rather than in a dialog: with no
 * transcript there is nothing to style, and the button that makes one is the
 * first thing the eye should land on.
 */
function CaptionsPanel({
  settings,
  captions,
  field,
  set,
  onEdit,
}: {
  settings: SliceSettings;
  captions: CaptionsState;
  field: FieldProps;
  set: Setter;
  /** Open the words for correction. */
  onEdit: () => void;
}) {
  const values: CaptionSettings = settings.captions;
  // Off when captions are switched off *or* when there is nothing to draw. Both
  // are the same thing to the controls, and a live style picker over a
  // recording with no words is a promise the preview will not keep.
  const off = !values.captionsOn || !captions.ready;

  return (
    <>
      <Section>
        <Transcription captions={captions} />

        {/* Above the styling, because a misheard word is the first thing anyone
          notices about captions and the styling is what they look at second.
          Dead until there are words, for the reason the toggle is. */}
        <button
          type="button"
          className={cn(
            "flex w-full items-center justify-center gap-1.5 rounded-lg border border-editor-line bg-white/5 px-2 py-1.5 text-[11px]",
            "transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5",
          )}
          disabled={!captions.ready}
          title={captions.ready ? undefined : "Generate captions first"}
          onClick={onEdit}
        >
          <PencilIcon />
          Edit captions
        </button>

        <ToggleField
          icon={<EyeIcon />}
          label="Show captions"
          {...field("captions", "captionsOn")}
          value={values.captionsOn}
          disabled={!captions.ready}
          title={captions.ready ? undefined : "Generate captions first"}
          onChange={(value) => set("captions", "captionsOn", value)}
        />

        <Field icon={<CaptionsIcon />} {...field("captions", "captionStyle")}>
          <CaptionStylePicker
            // Resolved rather than passed through, so a project naming a look this
            // build no longer ships shows the one actually being drawn instead of
            // no selection at all.
            value={captionStyle(values.captionStyle).id}
            accent={values.captionAccent}
            disabled={off}
            onChange={(value) => set("captions", "captionStyle", value)}
          />
        </Field>
      </Section>

      <Section title="Text">
        <Field icon={<FontIcon />} {...field("captions", "captionFont")}>
          <FontPicker
            value={values.captionFont}
            disabled={!values.captionsOn}
            onChange={(id) => set("captions", "captionFont", id)}
          />
        </Field>

        <Slider
          icon={<SizeIcon />}
          label="Size"
          {...field("captions", "captionSize")}
          value={values.captionSize}
          min={0.025}
          max={0.11}
          step={0.001}
          disabled={off}
          // Against the default rather than as a fraction, the way the pointer's
          // size is: 0.05 of the shorter edge means nothing to anyone.
          format={(value) => `${(value / 0.05).toFixed(1)}×`}
          onChange={(value) => set("captions", "captionSize", value)}
        />
      </Section>

      <Section title="Placement">
        <Field icon={<PlaceIcon />} {...field("captions", "captionPlace")}>
          <Segmented<CaptionPlace>
            value={values.captionPlace}
            options={[
              { value: "top", label: "Top" },
              { value: "middle", label: "Middle" },
              { value: "bottom", label: "Bottom" },
            ]}
            disabled={off}
            onChange={(value) => set("captions", "captionPlace", value)}
          />
        </Field>

        <Slider
          icon={<OffsetIcon />}
          label="Distance from edge"
          {...field("captions", "captionOffset")}
          value={values.captionOffset}
          min={0}
          max={0.25}
          step={0.005}
          // Middle has no edge to be measured from, so the control says so by
          // going dead rather than by moving nothing.
          disabled={off || values.captionPlace === "middle"}
          format={percent}
          onChange={(value) => set("captions", "captionOffset", value)}
        />

        <Slider
          icon={<LinesIcon />}
          label="Lines"
          {...field("captions", "captionLines")}
          value={values.captionLines}
          min={1}
          max={3}
          step={1}
          // A look that shows one word at a time has no line to fill, so this
          // would move a number nothing reads. Dead rather than missing: the
          // control belongs to captions, not to one look.
          disabled={off || captionStyle(values.captionStyle).perWord}
          format={(value) => (value === 1 ? "1 line" : `${value} lines`)}
          onChange={(value) => set("captions", "captionLines", value)}
        />

        <ColorField
          icon={<DropletIcon />}
          label="Spoken word"
          {...field("captions", "captionAccent")}
          value={values.captionAccent}
          onChange={(value) => set("captions", "captionAccent", value)}
        />
      </Section>
    </>
  );
}

/**
 * How the transcript is coming along.
 *
 * Reports, rather than offers. A recording with a microphone transcribes itself
 * when it is opened — there is nothing to decide, so there is no button — and
 * this exists to say why the controls below are dead for the few seconds that
 * takes, and to say so plainly if it could not be done at all.
 *
 * A bar rather than a spinner because a long take is minutes of work, and a
 * spinner over minutes is indistinguishable from a hang.
 */
function Transcription({ captions }: { captions: CaptionsState }) {
  const running = captions.stage === "preparing" || captions.stage === "transcribing";

  if (captions.ready && !running && captions.stage !== "failed") return null;

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-lg border border-editor-line bg-white/5 p-2">
      <span className="text-[11px] text-editor-muted">
        {captions.stage === "failed"
          ? "No captions"
          : captions.stage === "preparing"
            ? "Getting ready to transcribe…"
            : running
              ? "Transcribing…"
              : "No speech to caption"}
      </span>

      {running && (
        <div className="h-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-editor-accent transition-[width] duration-200"
            // An indeterminate stage gets a third of the bar rather than none:
            // the model is being fetched or the file opened, and an empty bar
            // over that reads as nothing happening.
            style={{ width: `${Math.round((captions.progress ?? 0.33) * 100)}%` }}
          />
        </div>
      )}

      {captions.stage === "failed" && captions.error && (
        <p className="text-[11px] text-red-300">{captions.error}</p>
      )}
    </div>
  );
}

function BackgroundPanel({
  settings,
  field,
  set,
  onPickWallpaper,
  onPickImage,
  onPickPreset,
  backgrounds,
  pendingBackground,
  wallpaperUrl,
}: {
  settings: SliceSettings;
  field: FieldProps;
  set: Setter;
  onPickWallpaper: () => void;
  onPickImage: () => void;
  onPickPreset: (file: string) => void;
  backgrounds: Backgrounds;
  pendingBackground: string | null;
  wallpaperUrl: string;
}) {
  const { background } = settings;
  const paint = background.background;

  const setPaint = (value: Background) => set("background", "background", value);

  /**
   * Which style's swatches are on show, which is not the same as which is
   * applied.
   *
   * Switching to Solid used to *set* a solid background, so looking at what the
   * colours were would replace the image you had — and the only way back was
   * undo. The tabs now only change what the grid holds; pressing a swatch is
   * the single thing that changes the frame.
   */
  const [style, setStyle] = useState<Background["kind"]>(paint.kind);

  // Follows the project when the background changes from somewhere else — a
  // different clip selected, a section reset, an undo — so the panel is never
  // showing one style while the frame draws another.
  useEffect(() => setStyle(paint.kind), [paint.kind]);

  return (
    <Section>
      {/* No label over it. "Style" restated what three tabs reading Image,
          Solid and Gradient already say, and a tab row is the one control in
          this panel that names itself. The override this field would have
          marked is still reachable: the panel header carries Reset whenever
          anything in this section is set for the clip.

          No icons either. Three words that short are read as words, and a glyph
          beside each one was a second thing to look at saying nothing the word
          did not. */}
      <Tabs
        value={style}
        options={[
          { value: "image", label: "Image" },
          { value: "solid", label: "Solid" },
          { value: "gradient", label: "Gradient" },
        ]}
        onChange={setStyle}
      />

      {/* Each grid is passed the applied value only when it is that grid's own
          style. Otherwise nothing is marked as chosen — a colour highlighted
          while the frame is showing an image would be claiming something
          untrue. */}
      {style === "solid" && (
        <SolidSwatches
          value={paint.kind === "solid" ? paint.color : null}
          // A whole background rather than a patch of the old one: what is
          // applied may not be a solid, so there is nothing to spread.
          onChange={(color) => setPaint({ kind: "solid", color })}
        />
      )}

      {style === "gradient" && (
        <>
          <GradientSwatches
            value={paint.kind === "gradient" ? paint : null}
            onChange={(preset) => setPaint({ kind: "gradient", ...preset })}
          />
          {/* Only once one is applied. An angle slider for a gradient that is
              not on screen has nothing to turn. */}
          {paint.kind === "gradient" && (
            <Slider
              icon={<AngleIcon />}
              label="Angle"
              value={paint.angle}
              min={0}
              max={360}
              step={1}
              format={(value) => `${Math.round(value)}°`}
              onChange={(angle) => setPaint({ ...paint, angle })}
            />
          )}
        </>
      )}

      {style === "image" && (
        // No label: the tab above already says Image, and what follows is
        // pictures.
        <Field>
          <div className="flex flex-col gap-1.5">
            <ImageSwatches
              path={paint.kind === "image" ? paint.path : null}
              wallpaper={wallpaperUrl}
              onPickWallpaper={onPickWallpaper}
              onPickPreset={onPickPreset}
              backgrounds={backgrounds}
              pending={pendingBackground}
              onPickImage={onPickImage}
            />

            <p
              className="truncate text-[11px] text-editor-muted"
              title={paint.kind === "image" ? paint.path : undefined}
            >
              {paint.kind === "image" && paint.path
                ? // Copied into the recording, so the export is the same
                  // tomorrow even after the desktop picture changes.
                  paint.path
                : "No image chosen yet"}
            </p>
          </div>
        </Field>
      )}
    </Section>
  );
}

/**
 * The edge around the screen recording: how far it is inset, and what is drawn
 * on it.
 *
 * The screen's, and only the screen's. The camera keeps its own shape in every
 * arrangement — see the note in `buildRenderPlan` — so nothing here rounds a
 * face or draws a ring round one.
 *
 * Its own panel rather than more fields under Background, though the two write
 * to the same settings section. What paints behind the picture and what the
 * picture's own edge looks like are separate decisions — someone rounding the
 * corners is not choosing a wallpaper — and one column holding both was long
 * enough that the frame controls were reached by scrolling past colours.
 *
 * Every value here is a fraction of the frame's shorter edge, so a look
 * survives 16:9 becoming 9:16.
 */
function FramePanel({
  settings,
  field,
  set,
}: {
  settings: SliceSettings;
  field: FieldProps;
  set: Setter;
}) {
  const { background } = settings;

  return (
    // Three groups rather than one column of eight. The panel is the frame
    // around the picture, and half of what is in here belongs to the border or
    // the shadow rather than to the frame itself — read as a flat list, "Blur"
    // sitting under "Border opacity" is anyone's guess as to what it blurs.
    //
    // Headings earn their place here for the reason they do not on the panels
    // with one group: these name something the panel header does not.
    <>
      <Section>
        <Slider
          icon={<PaddingIcon />}
          label="Padding"
          {...field("background", "padding")}
          value={background.padding}
          min={0}
          max={0.25}
          format={percent}
          onChange={(value) => set("background", "padding", value)}
        />

        <Slider
          icon={<RoundedIcon />}
          label="Corner radius"
          {...field("background", "cornerRadius")}
          value={background.cornerRadius}
          min={0}
          max={0.1}
          format={percent}
          onChange={(value) => set("background", "cornerRadius", value)}
        />
      </Section>

      <Section title="Border">
        <Slider
          icon={<BorderIcon />}
          label="Width"
          {...field("background", "borderWidth")}
          value={background.borderWidth}
          min={0}
          max={0.02}
          format={percent}
          onChange={(value) => set("background", "borderWidth", value)}
        />

        {/* Only once there is a border to dress. A swatch and an opacity slider
          attached to a zero-width edge change nothing on screen, which reads as
          broken. */}
        {background.borderWidth > 0 && (
          <>
            <ColorField
              icon={<DropletIcon />}
              label="Colour"
              {...field("background", "borderColor")}
              value={background.borderColor}
              onChange={(value) => set("background", "borderColor", value)}
            />

            {/* Opacity rather than transparency, because that is the number the
              slider holds: 100% is the solid edge, and a control that read
              "0%" for an opaque border would be the wrong way round. */}
            <Slider
              icon={<OpacityIcon />}
              label="Opacity"
              {...field("background", "borderOpacity")}
              value={background.borderOpacity}
              min={0}
              max={1}
              format={percent}
              onChange={(value) => set("background", "borderOpacity", value)}
            />
          </>
        )}
      </Section>

      <Section title="Shadow">
        <Slider
          icon={<ShadowIcon />}
          label="Opacity"
          {...field("background", "shadowOpacity")}
          value={background.shadowOpacity}
          min={0}
          max={1}
          format={percent}
          onChange={(value) => set("background", "shadowOpacity", value)}
        />

        {/* The two that shape the shadow, kept behind it having one to shape:
          a blur and an offset on an invisible shadow are two sliders that do
          nothing. `shadowBlur` and `shadowY` had no controls at all while these
          fields lived under Background, for want of column. */}
        {background.shadowOpacity > 0 && (
          <>
            <Slider
              icon={<BlurIcon />}
              label="Blur"
              {...field("background", "shadowBlur")}
              value={background.shadowBlur}
              min={0}
              max={0.15}
              format={percent}
              onChange={(value) => set("background", "shadowBlur", value)}
            />

            <Slider
              icon={<ShadowOffsetIcon />}
              label="Offset"
              {...field("background", "shadowY")}
              value={background.shadowY}
              min={0}
              max={0.08}
              format={percent}
              onChange={(value) => set("background", "shadowY", value)}
            />
          </>
        )}
      </Section>
    </>
  );
}

/**
 * The `background` section, split the way the two panels above split it.
 *
 * Named here rather than inline so the two lists are visibly exhaustive: a key
 * added to `BackgroundSettings` and left out of both would sit in a clip's
 * overrides with no Reset that clears it.
 */
const PAINT_KEYS: (keyof BackgroundSettings)[] = ["background"];

const FRAME_KEYS: (keyof BackgroundSettings)[] = [
  "padding",
  "cornerRadius",
  "borderWidth",
  "borderColor",
  "borderOpacity",
  "shadowOpacity",
  "shadowBlur",
  "shadowY",
];

function AudioPanel({
  settings,
  present,
  field,
  set,
}: {
  settings: SliceSettings;
  present: Set<TrackKind>;
  field: FieldProps;
  set: Setter;
}) {
  const { audio } = settings;

  // A silent track writes no file and no manifest entry, so its absence is the
  // honest answer to "was the mic on?" — and a fader for it would be a lie.
  if (!present.has("microphone") && !present.has("system_audio")) {
    return (
      <Section>
        <p className="text-[11px] text-editor-muted">This recording has no audio tracks.</p>
      </Section>
    );
  }

  // A group per source. The two used to be one list of four, where each row had
  // to name its own track — "Microphone volume" under a switch called
  // "Microphone" — and the mic glyph appeared twice in four rows saying two
  // different things. The heading carries the track now, so the rows say only
  // what they are and the icons can go back to meaning one thing each.
  return (
    <>
      {present.has("microphone") && (
        <Section title="Microphone">
          <ToggleField
            icon={<MicIcon />}
            label="Include"
            {...field("audio", "micMuted")}
            value={!audio.micMuted}
            onChange={(value) => set("audio", "micMuted", !value)}
          />
          <Slider
            icon={<SpeakerIcon />}
            label="Volume"
            {...field("audio", "micVolume")}
            value={audio.micVolume}
            min={0}
            max={2}
            format={percent}
            disabled={audio.micMuted}
            onChange={(value) => set("audio", "micVolume", value)}
          />
        </Section>
      )}

      {present.has("system_audio") && (
        <Section title="System audio">
          <ToggleField
            icon={<ScreenIcon />}
            label="Include"
            {...field("audio", "systemMuted")}
            value={!audio.systemMuted}
            onChange={(value) => set("audio", "systemMuted", !value)}
          />
          <Slider
            icon={<SpeakerIcon />}
            label="Volume"
            {...field("audio", "systemVolume")}
            disabled={audio.systemMuted}
            value={audio.systemVolume}
            min={0}
            max={2}
            format={percent}
            onChange={(value) => set("audio", "systemVolume", value)}
          />
        </Section>
      )}
    </>
  );
}

/**
 * Perspective presets.
 *
 * Small angles on purpose. Past about fifteen degrees a screen recording stops
 * being readable and starts being a picture of a screen — which is a fine
 * effect for a title card and a poor one for the thing being demonstrated.
 */
/**
 * The bar at the top of the panel: what is selected, and how to get rid of it.
 *
 * One line, no explanation. The description that used to sit under the title
 * said the same thing on every recording, which is the definition of something
 * nobody reads after the first time — and it cost a third of the panel's height
 * before any control appeared.
 *
 * The colour is carried by the chip behind the icon, in whatever the thing is
 * drawn in on the timeline, so the panel and the chip it belongs to agree at a
 * glance. The glyph itself stays white: at 14px a tinted stroke on a tinted
 * ground is two washes of the same hue and reads as neither.
 */
function PanelHeader({
  title,
  icon,
  onBack,
  action,
  onReset,
  onDelete,
  deleteLabel,
  onClose,
}: {
  title: string;
  icon: React.ReactNode;
  /**
   * Present when this is a view pushed over the panel, which puts a way back
   * at the near end. Leading rather than trailing because that is where every
   * pushed view on the platform keeps it, and close stays in its corner.
   */
  onBack?: () => void;
  /** A view's own control, between the title and the corner. */
  action?: React.ReactNode;
  /**
   * Puts this panel's section back to the project defaults.
   *
   * Absent when nothing in it is overridden, which hides the button — so its
   * presence is also the answer to "has this clip been changed here?".
   */
  onReset?: () => void;
  /** Absent when there is nothing deletable, which hides the button. */
  onDelete?: () => void;
  deleteLabel: string;
  onClose: () => void;
}) {
  return (
    // No rule under it. The header is already told apart from the panel by
    // being the row with the controls in it, and on a tabbed panel the tabs
    // bring their own — two rules a few pixels apart read as a boxed-in strip
    // rather than as a heading over its content.
    <header className="flex flex-none items-center gap-2.5 px-3 py-2.5">
      {onBack && (
        <button
          type="button"
          title="Back"
          aria-label="Back to caption options"
          className={cn(
            "-ml-1 grid size-6 flex-none place-items-center rounded-md text-editor-muted",
            "transition-colors hover:bg-white/10 hover:text-editor-fg [&_svg]:size-3.5",
          )}
          onClick={onBack}
        >
          <BackIcon />
        </button>
      )}

      {/* Bare, at the text's own colour. It used to be a chip tinted from the
          timeline's palette — purple for a clip, blue for a zoom — which made
          the header a second place the selection was colour-coded, competing
          with the timeline itself. Naming the section beside it says more than
          the tint did, and an icon that is simply part of the label needs no
          surface to sit on. */}
      <span className="flex-none [&_svg]:size-4" aria-hidden>
        {icon}
      </span>

      <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</p>

      {action}

      {/* Before delete, which is before close: the three run from the least
          destructive to the most reversible-by-habit. Reset used to be a word
          inside the panel, on a row of its own beneath a heading that repeated
          the title — moving it up here took that row out and put every control
          that acts on the panel in one place. */}
      {onReset && (
        <button
          type="button"
          title="Reset to the project defaults"
          aria-label="Reset to the project defaults"
          className={cn(
            "grid size-6 flex-none place-items-center rounded-md text-editor-muted",
            "transition-colors hover:bg-white/10 hover:text-editor-fg [&_svg]:size-3.5",
          )}
          onClick={onReset}
        >
          <ResetIcon />
        </button>
      )}

      {/* Delete first, close last. Close is the one that has to be in the same
          place every time — it is on every panel, where delete comes and goes
          with what is selected — and the corner is the place a pointer arrives
          at to dismiss something. Putting the destructive button there instead,
          and only sometimes, is how a clip gets removed by someone reaching to
          put the panel away.

          Red on hover where close stays neutral — the pair have to be
          distinguishable at a glance, and at this size the colour is quicker to
          read than the glyph. */}
      {onDelete && (
        <button
          type="button"
          title={deleteLabel}
          aria-label={deleteLabel}
          className={cn(
            "grid size-6 flex-none place-items-center rounded-md text-editor-muted",
            "transition-colors hover:bg-cut/20 hover:text-cut [&_svg]:size-3.5",
          )}
          onClick={onDelete}
        >
          <TrashIcon />
        </button>
      )}

      <button
        type="button"
        title="Close the panel"
        aria-label="Close the panel"
        className={cn(
          "grid size-6 flex-none place-items-center rounded-md text-editor-muted",
          "transition-colors hover:bg-white/10 hover:text-editor-fg [&_svg]:size-3.5",
        )}
        onClick={onClose}
      >
        <CloseIcon />
      </button>
    </header>
  );
}

/** What `sanitiseZooms` clamps an angle to, so the pad cannot set one it drops. */
const TILT_LIMIT = 30;

/**
 * How much the preset thumbnails splay.
 *
 * Fixed, and shallow: a 28px plate at the pad's near perspective turns into a
 * wedge with one edge a couple of pixels tall, which reads as a rendering
 * mistake rather than as an angle.
 */
const THUMB_PERSPECTIVE = 220;

const TILTS = [
  { label: "Flat", rotateX: 0, rotateY: 0 },
  { label: "Lean back", rotateX: 8, rotateY: 0 },
  { label: "Lean in", rotateX: -8, rotateY: 0 },
  { label: "Left", rotateX: 4, rotateY: -10 },
  { label: "Right", rotateX: 4, rotateY: 10 },
  { label: "Hero", rotateX: 12, rotateY: -14 },
] as const;

/**
 * The named eases, and the control points behind each.
 *
 * Presets because "ease out" is what anyone actually wants, and a pair of
 * control points is what the renderer needs — asking for the second to express
 * the first is the gap the pad alone would leave. Nudging a preset lands on
 * control points no preset matches, which is what `easingName` reports.
 */
const EASINGS = [
  {
    name: "smooth" as const,
    label: "Smooth",
    // The `smoothstep` this control replaced, exactly. Also the default, so the
    // segmented control reads as "Smooth" on every zoom made before it existed.
    curve: { easeInX: 1 / 3, easeInY: 0, easeOutX: 2 / 3, easeOutY: 1 },
  },
  {
    name: "linear" as const,
    label: "Linear",
    curve: { easeInX: 0, easeInY: 0, easeOutX: 1, easeOutY: 1 },
  },
  {
    // Slow to leave, arriving at speed. Reads as the camera being pulled.
    name: "in" as const,
    label: "Slow in",
    curve: { easeInX: 0.42, easeInY: 0, easeOutX: 1, easeOutY: 1 },
  },
  {
    // Off the mark immediately and settling. The most useful of the four for a
    // zoom that has to keep up with a click.
    name: "out" as const,
    label: "Slow out",
    curve: { easeInX: 0, easeInY: 0, easeOutX: 0.58, easeOutY: 1 },
  },
];

type EasingName = (typeof EASINGS)[number]["name"] | "custom";

/** Which preset a zoom's curve is, or `custom` once it has been dragged. */
function easingName(curve: {
  easeInX: number;
  easeInY: number;
  easeOutX: number;
  easeOutY: number;
}): EasingName {
  const match = EASINGS.find(
    (preset) =>
      // A pad drag lands on floats, so exact equality would never match and the
      // row would forget which preset it started from. A thousandth is finer
      // than the pad can resolve at this size.
      Math.abs(preset.curve.easeInX - curve.easeInX) < 1e-3 &&
      Math.abs(preset.curve.easeInY - curve.easeInY) < 1e-3 &&
      Math.abs(preset.curve.easeOutX - curve.easeOutX) < 1e-3 &&
      Math.abs(preset.curve.easeOutY - curve.easeOutY) < 1e-3,
  );

  return match?.name ?? "custom";
}

/**
 * One zoom span's settings.
 *
 * `cursor` is the default because it is what a screen recording usually wants:
 * the thing worth looking at is wherever the pointer just went. A region is the
 * answer when the interesting part of the frame is not where the pointer is —
 * a chart being talked about, a line of output.
 */
/**
 * Where the shot goes and how fast it gets there.
 *
 * The tab that opens, because a zoom that points at nothing is not a zoom
 * yet — the look of it only matters once there is something to look at.
 */
function ZoomMotionPanel({
  zoom,
  frame,
  hasCursor,
  onChange,
}: {
  zoom: ZoomSlice;
  frame: Size;
  /** Whether this recording has a pointer track to follow. */
  hasCursor: boolean;
  onChange: (patch: Partial<ZoomSlice>) => void;
}) {
  return (
    <Section>
      {/* No `typing` option. It needs the Accessibility grant to have anything
          to aim at and is absent without it, so most of the time it was a third
          choice that silently behaved as the first. The automatic pass still
          produces `typing` zooms where the track exists, and they keep working
          — this only stops it being offered as something to pick by hand. */}
      <Field icon={<CursorIcon />} label="Follow">
        <Segmented
          value={zoom.target}
          options={[
            {
              value: "cursor",
              label: "Cursor",
              title: hasCursor
                ? "Keep the pointer in the middle of the shot"
                : "This recording has no pointer track",
              icon: <CursorIcon />,
            },
            { value: "region", label: "Region", icon: <FillIcon /> },
          ]}
          onChange={(target) => onChange({ target })}
        />
      </Field>

      {/* Only under Region. Following the cursor means the pointer decides
          where the shot sits, so a map of somewhere to put it is answering a
          question that is not being asked — it used to sit there greyed out,
          which reads as something broken rather than something irrelevant. */}
      {zoom.target === "region" && (
        <Field icon={<PlaceIcon />} label="Area">
          <CameraMap
            frame={frame}
            shape="rounded"
            // A point, not a box. The box could not be dragged into a corner —
            // its own edges were clamped to the map — so the one thing this
            // control existed to do was the one thing it refused.
            point
            // Still passed: the outline behind the dot draws the share of the
            // frame the shot will show.
            size={1 / Math.max(1, zoom.level)}
            aspect={frame.width / frame.height}
            radius="5px"
            x={zoom.x}
            y={zoom.y}
            onChange={(x, y) => onChange({ x, y })}
          />
        </Field>
      )}

      <Slider
        icon={<LevelIcon />}
        label="Level"
        value={zoom.level}
        min={1.2}
        max={4}
        step={0.1}
        format={(value) => `${value.toFixed(1)}×`}
        onChange={(level) => onChange({ level })}
      />

      <Slider
        icon={<SpeedIcon />}
        label="Speed"
        value={zoom.speed}
        min={0}
        max={2}
        step={0.05}
        // Seconds, not a rate: "how long does it take" is the question
        // anyone actually has about a camera move.
        format={(value) => (value === 0 ? "Cut" : `${value.toFixed(2)}s`)}
        onChange={(speed) => onChange({ speed })}
      />

      {/* Directly under Speed, because the two answer halves of one question:
          that one is how long the move takes, this one is what it feels like
          over that time. Presets first — most people want "ease out" rather
          than a particular pair of control points, and the curve then shows
          what they picked and can be nudged from there. */}
      <Field icon={<SmoothingIcon />} label="Ease">
        <div className="flex flex-col gap-2">
          <Segmented
            value={easingName(zoom)}
            options={EASINGS.map((preset) => ({ value: preset.name, label: preset.label }))}
            onChange={(name) => {
              const preset = EASINGS.find((candidate) => candidate.name === name);
              if (preset) onChange(preset.curve);
            }}
          />
          <EasingPad curve={zoom} onChange={onChange} />
        </div>
      </Field>
    </Section>
  );
}

/**
 * Which way the picture is turned, and how hard the turn is sold.
 *
 * Its own tab rather than five more rows under the motion controls. Every
 * one of these is a look, set once and rarely returned to, while `Level`
 * and `Speed` are what a zoom is adjusted by — and a column that mixes the
 * two makes the frequent controls something to scroll past.
 */
function ZoomPerspectivePanel({
  zoom,
  frame,
  hasCursor,
  onChange,
}: {
  zoom: ZoomSlice;
  frame: Size;
  /** Whether this recording has a pointer track to follow. */
  hasCursor: boolean;
  onChange: (patch: Partial<ZoomSlice>) => void;
}) {
  return (
    <Section>
      {/* Drag the picture, not the numbers. The sliders below stay for
          precision and for saying what the angle currently is — the pad is how
          anyone arrives at one. */}
      <Field icon={<PerspectiveIcon />} label="Perspective">
        <PerspectivePad
          rotateX={zoom.rotateX}
          rotateY={zoom.rotateY}
          perspective={zoom.perspective}
          limit={TILT_LIMIT}
          onChange={onChange}
        />
      </Field>

      {/* Each preset shows the angle it sets rather than only naming it. "Hero"
          and "Lean back" are labels you have to have learned; the plate above
          them is the same picture the pad draws, so the row can be read instead
          of memorised. The name stays underneath — it is what the two of you
          call the setting once it is chosen. */}
      <Field icon={<AngleIcon />} label="Angles">
        <div className="grid grid-cols-3 gap-1">
          {TILTS.map((preset) => {
            const here =
              Math.abs(zoom.rotateX - preset.rotateX) < 0.5 &&
              Math.abs(zoom.rotateY - preset.rotateY) < 0.5;

            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={here}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md px-1 py-1.5",
                  "text-[10px] transition-colors",
                  here
                    ? "bg-selected text-white"
                    : "bg-white/5 text-editor-muted hover:bg-white/10",
                )}
                onClick={() => onChange({ rotateX: preset.rotateX, rotateY: preset.rotateY })}
              >
                {/* Fixed and shallower than the pad's. The pad splays with the
                    zoom's perspective because it is showing this shot; a thumbnail is
                    showing the angle alone, and letting it move with an
                    unrelated slider would make six buttons twitch whenever
                    perspective was dragged. */}
                <span
                  className="grid h-6 w-full place-items-center"
                  style={{ perspective: THUMB_PERSPECTIVE }}
                  aria-hidden="true"
                >
                  <PerspectivePlate
                    rotateX={preset.rotateX}
                    rotateY={preset.rotateY}
                    className={cn(
                      "h-4 w-7 rounded-[2px] border",
                      here ? "border-white/70 bg-white/25" : "border-white/25 bg-white/10",
                    )}
                  />
                </span>
                {preset.label}
              </button>
            );
          })}
        </div>
      </Field>

      {/* The control the panel was missing. The angle says which way the
          picture is turned; this says how much being turned costs it, and the
          same 12° is a product shot at one end and a caricature at the other.
          Every 3D tool separates the two — it is Rotato's "Perspective" and a
          camera's field of view. */}
      <Slider
        icon={<DepthIcon />}
        label="Depth"
        value={zoom.perspective}
        min={0}
        max={1}
        step={0.01}
        format={(value) => (value < 0.02 ? "Flat" : percent(value))}
        onChange={(perspective) => onChange({ perspective })}
      />

      <Slider
        icon={<TiltIcon />}
        label="Tilt"
        value={zoom.rotateX}
        min={-TILT_LIMIT}
        max={TILT_LIMIT}
        step={1}
        // Degrees, and signed: the sign is the whole difference between
        // leaning towards the viewer and away from them.
        format={(value) => `${value > 0 ? "+" : ""}${value.toFixed(0)}°`}
        onChange={(rotateX) => onChange({ rotateX })}
      />

      <Slider
        icon={<YawIcon />}
        label="Yaw"
        value={zoom.rotateY}
        min={-TILT_LIMIT}
        max={TILT_LIMIT}
        step={1}
        format={(value) => `${value > 0 ? "+" : ""}${value.toFixed(0)}°`}
        onChange={(rotateY) => onChange({ rotateY })}
      />
    </Section>
  );
}

/**
 * What the shot does to everything that is not the subject.
 *
 * Blur and vignette together under one heading, which is the grouping the
 * code already argued for where the two sat adjacent. Called Focus rather
 * than Blur: a vignette darkens, it does not blur, and a tab that names
 * one of its two controls is a tab you look in the wrong place for.
 */
function ZoomFocusPanel({
  zoom,
  frame,
  hasCursor,
  onChange,
}: {
  zoom: ZoomSlice;
  frame: Size;
  /** Whether this recording has a pointer track to follow. */
  hasCursor: boolean;
  onChange: (patch: Partial<ZoomSlice>) => void;
}) {
  return (
    <Section>
      <ToggleField
        icon={<BlurIcon />}
        label="Blur around"
        value={zoom.blur}
        onChange={(blur) => onChange({ blur })}
      />

      <Slider
        icon={<FocusIcon />}
        label="Sharp area"
        value={zoom.blurSafe}
        min={0.05}
        max={0.9}
        step={0.01}
        disabled={!zoom.blur}
        format={percent}
        onChange={(blurSafe) => onChange({ blurSafe })}
      />

      <Slider
        icon={<StrengthIcon />}
        label="Strength"
        value={zoom.blurStrength}
        min={0}
        max={0.04}
        step={0.001}
        disabled={!zoom.blur}
        // Against the default rather than as a fraction of the shorter edge,
        // which is not a number anyone has an opinion about.
        format={(value) => `${(value / 0.012).toFixed(1)}×`}
        onChange={(blurStrength) => onChange({ blurStrength })}
      />

      {/* Beside the blur because the two are the same kind of thing — what the
          shot does to everything that is not the subject — but on its own
          switch-free row: a vignette of zero is already off, so a toggle in
          front of it would be a second way to say the same thing. */}
      <Slider
        icon={<VignetteIcon />}
        label="Vignette"
        value={zoom.vignette}
        min={0}
        max={1}
        step={0.01}
        format={(value) => (value === 0 ? "Off" : percent(value))}
        onChange={(vignette) => onChange({ vignette })}
      />
    </Section>
  );
}
