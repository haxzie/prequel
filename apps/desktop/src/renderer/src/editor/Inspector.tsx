import { useEffect, useState, type Dispatch } from "react";

import { cameraAspect, type Size } from "../../../shared/layout";
import type { TrackKind } from "../../../shared/manifest";
import {
  overriddenKeys,
  type Background,
  type SettingsSection,
  type SliceSettings,
  type ZoomSlice,
} from "../../../shared/project";
import { cn } from "../lib/cn";
import { CameraMap } from "./controls/CameraMap";
import { Field, Section } from "./controls/Field";
import { EasingPad } from "./controls/EasingPad";
import { PerspectivePad } from "./controls/PerspectivePad";
import { PerspectivePlate } from "./controls/PerspectivePlate";
import {
  AudioIcon,
  CameraIcon,
  CircleIcon,
  CursorIcon,
  CloseIcon,
  FillIcon,
  FitIcon,
  FocusIcon,
  GradientIcon,
  ImageIcon,
  LayoutIcon,
  PerspectiveIcon,
  RoundedIcon,
  ScreenIcon,
  SolidIcon,
  SquircleIcon,
  TrashIcon,
  WideIcon,
  ZoomIcon,
} from "./icons";
import { ColorField, percent, Segmented, Slider, Toggle } from "./controls/inputs";
import { GradientSwatches, ImageSwatches, SolidSwatches } from "./controls/Swatches";
import { activeSettings, selectedSlice, type EditorAction, type EditorState } from "./state";

export interface InspectorProps {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  /** Which tracks the recording actually has, so absent ones are not offered. */
  present: Set<TrackKind>;
  /** Whether the pointer is a layer here, or already part of the picture. */
  hasCursor: boolean;
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
  onPickPreset: (presetId: string) => void;
  /** URL for the desktop picture inside the recording, drawn on its cell. */
  wallpaperUrl: string | null;
  /**
   * Put the panel away and drop the selection with it.
   *
   * Both, because they are one thing to the person doing it: the panel is only
   * ever showing something because that thing is selected, and leaving a clip
   * selected behind a closed panel leaves the timeline lit up over an editor
   * with no visible way to change it.
   */
  onClose: () => void;
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

  const sectionReset = (section: SettingsSection) =>
    scoped && Object.keys(slice?.overrides[section] ?? {}).length > 0
      ? () => dispatch({ type: "resetSection", section })
      : undefined;

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

    return (
      <div className={SHELL}>
        <nav className={RAIL}>
          {ZOOM_TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={id === zoomTab}
              // The label the icon replaced, kept where it is still needed: as
              // the accessible name, and as the tooltip that is now the only
              // way to find out what a glyph means.
              aria-label={label}
              title={label}
              className={railButton(id === zoomTab)}
              onClick={() => setZoomTab(id)}
            >
              <Icon />
            </button>
          ))}
        </nav>

        <aside className={PANEL}>
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
            <PanelHeader
              title="Zoom"
              icon={<ZoomIcon />}
              // The blue a zoom is drawn in on the timeline. The panel and the
              // chip it belongs to say the same thing about what is selected.
              tone="border-selected/60 bg-selected/35 text-white"
              onDelete={() => dispatch({ type: "deleteZoom", zoomId: zoom.id })}
              deleteLabel="Remove zoom"
              onClose={props.onClose}
            />
            {zoomTab === "motion" && <ZoomMotionPanel {...panel} />}
            {zoomTab === "perspective" && <ZoomPerspectivePanel {...panel} />}
            {zoomTab === "focus" && <ZoomFocusPanel {...panel} />}
          </div>
        </aside>
      </div>
    );
  }

  const categories: Category[] = [
    { id: "layout", label: "Layout", Icon: LayoutIcon },
    ...(props.present.has("camera")
      ? [{ id: "camera" as const, label: "Camera", Icon: CameraIcon }]
      : []),
    ...(props.present.has("microphone") || props.present.has("system_audio")
      ? [{ id: "audio" as const, label: "Audio", Icon: AudioIcon }]
      : []),
    ...(props.hasCursor ? [{ id: "cursor" as const, label: "Cursor", Icon: CursorIcon }] : []),
  ];

  // A category can disappear — open a recording with no camera while Camera is
  // showing — so the fallback is the one that is always there rather than a
  // blank panel.
  const active = categories.some((category) => category.id === tab) ? tab : "layout";

  return (
    <div className={SHELL}>
      <nav className={RAIL}>
        {categories.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={id === active}
            aria-label={label}
            title={label}
            className={railButton(id === active)}
            onClick={() => setTab(id)}
          >
            <Icon />
          </button>
        ))}
      </nav>

      <aside className={PANEL}>
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <PanelHeader
            title={scoped ? "Clip" : "All clips"}
            icon={<ScreenIcon />}
            // The purple a clip is drawn in on the timeline, and a neutral one
            // for the defaults, which are not a thing on the timeline at all.
            tone={
              scoped
                ? "border-slice-edge/70 bg-slice-edge/40 text-white"
                : "border-editor-line bg-white/10 text-white"
            }
            // Only a selected clip can be removed. With nothing selected this
            // panel is the project defaults, which are not a thing to delete.
            onDelete={
              scoped && slice
                ? () => dispatch({ type: "deleteSlice", sliceId: slice.id })
                : undefined
            }
            deleteLabel="Remove clip"
            onClose={props.onClose}
          />

          {active === "layout" && (
            <>
              <LayoutPanel
                settings={settings}
                field={field}
                reset={sectionReset("layout")}
                set={set}
              />
              <BackgroundPanel
                settings={settings}
                field={field}
                reset={sectionReset("background")}
                set={set}
                onPickWallpaper={props.onPickWallpaper}
                onPickImage={props.onPickImage}
                onPickPreset={props.onPickPreset}
                wallpaperUrl={props.wallpaperUrl}
              />
            </>
          )}

          {active === "camera" && (
            <CameraPanel
              settings={settings}
              frame={props.frame}
              cameraSource={props.cameraSource}
              field={field}
              reset={sectionReset("layout")}
              set={set}
            />
          )}

          {active === "audio" && (
            <AudioPanel
              settings={settings}
              present={props.present}
              field={field}
              reset={sectionReset("audio")}
              set={set}
            />
          )}

          {active === "cursor" && (
            <CursorPanel
              settings={settings}
              field={field}
              reset={sectionReset("layout")}
              set={set}
            />
          )}
        </div>
      </aside>
    </div>
  );
}

/**
 * The pair, floated off the window's edge.
 *
 * A margin and rounded corners rather than full-height columns with rules down
 * their sides: the dotted surface runs behind and under both, which says they
 * are *over* the composition rather than further regions of the window
 * competing with it.
 *
 * `justify-end` anchors the controls to the window edge, so the panel does not
 * slide sideways when the rail is absent — which it is for a selected zoom.
 */
const SHELL = "m-2 ml-0 flex flex-1 justify-end gap-2";

/**
 * The rail: icons over the editor's own background, with nothing behind them.
 *
 * It used to be a panel in its own right, which made two surfaces where the
 * eye only has one thing to find — and the smaller of the two was introducing
 * the larger. `self-start` is what keeps it the height of its own buttons: as
 * an ordinary flex item it would stretch to match the panel beside it and hold
 * a column of hover targets over nothing.
 */
const RAIL = "flex flex-none flex-col gap-1 self-start";

/**
 * One destination on the rail.
 *
 * White whether or not it is the one showing. With no surface behind the rail
 * there is nothing for a muted colour to read against, and a dimmed icon on the
 * editor's own background looks disabled rather than merely unselected — so the
 * fill behind the chosen one carries that on its own. The same blue the dock
 * marks a chosen screen with and the timeline its held tool: one colour across
 * the app for "this is the one".
 */
const railButton = (active: boolean) =>
  cn(
    "grid size-10 place-items-center rounded-lg text-white [&_svg]:size-5",
    active ? "bg-selected" : "hover:bg-white/10",
  );

/** `overflow-hidden` so the scrolling content stays inside the corners. */
const PANEL =
  "flex w-80 flex-none overflow-hidden rounded-xl border border-editor-line " +
  "bg-editor-panel shadow-[0_8px_30px_rgba(0,0,0,0.35)]";

/** What the pair occupies when open: rail, gap, panel, and the margin beside. */
export const PANEL_WIDTH = "24rem";

/** The inspector's four destinations. */
type CategoryId = "layout" | "camera" | "audio" | "cursor";

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

/** The screen itself: how much of the frame it takes and how it is cropped. */
function LayoutPanel({
  settings,
  field,
  reset,
  set,
}: {
  settings: SliceSettings;
  field: FieldProps;
  reset?: () => void;
  set: Setter;
}) {
  const { layout } = settings;

  return (
    <Section title="Screen" onReset={reset}>
      <Field label="Screen fit" {...field("layout", "screenFit")}>
        <Segmented
          value={layout.screenFit}
          options={[
            {
              value: "contain",
              label: "Fit",
              title: "Show all of the recording",
              icon: <FitIcon />,
            },
            {
              value: "cover",
              label: "Fill",
              title: "Fill the frame, cropping the rest",
              icon: <FillIcon />,
            },
          ]}
          onChange={(value) => set("layout", "screenFit", value)}
        />
      </Field>

      <Field label="Zoom" {...field("layout", "screenZoom")}>
        <Slider
          value={layout.screenZoom}
          min={0.5}
          max={3}
          step={0.01}
          format={(value) => `${value.toFixed(2)}×`}
          onChange={(value) => set("layout", "screenZoom", value)}
        />
      </Field>
    </Section>
  );
}

/** The webcam bubble. Only reachable when the recording has one. */
function CameraPanel({
  settings,
  frame,
  cameraSource,
  field,
  reset,
  set,
}: {
  settings: SliceSettings;
  frame: Size;
  /** The camera's own dimensions, for the `wide` shape's proportions. */
  cameraSource: Size | null;
  field: FieldProps;
  reset?: () => void;
  set: Setter;
}) {
  const { layout } = settings;
  // Disabled rather than hidden. Controls that vanish take the panel's shape
  // with them, so turning the camera off and on again moves everything below —
  // and hides what turning it back on is going to do.
  const off = !layout.cameraVisible;

  return (
    <Section title="Camera" onReset={reset}>
      <Field label="Camera" inline {...field("layout", "cameraVisible")}>
        <Toggle
          value={layout.cameraVisible}
          onChange={(value) => set("layout", "cameraVisible", value)}
        />
      </Field>

      <Field label="Shape" {...field("layout", "cameraShape")}>
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
          ]}
          onChange={(value) => set("layout", "cameraShape", value)}
        />
      </Field>

      <Field label="Size" {...field("layout", "cameraSize")}>
        <Slider
          value={layout.cameraSize}
          min={0.05}
          max={0.6}
          format={percent}
          disabled={off}
          onChange={(value) => set("layout", "cameraSize", value)}
        />
      </Field>

      <Field label="Zoom" {...field("layout", "cameraZoom")}>
        <Slider
          value={layout.cameraZoom}
          min={1}
          max={3}
          step={0.01}
          format={(value) => `${value.toFixed(2)}×`}
          disabled={off}
          onChange={(value) => set("layout", "cameraZoom", value)}
        />
      </Field>

      <Field label="Position" {...field("layout", "cameraX")}>
        <CameraMap
          frame={frame}
          shape={layout.cameraShape}
          size={layout.cameraSize}
          aspect={cameraAspect(layout, cameraSource)}
          x={layout.cameraX}
          y={layout.cameraY}
          disabled={off}
          onChange={(x, y) => {
            set("layout", "cameraX", x);
            set("layout", "cameraY", y);
          }}
        />
      </Field>

      <Field label="Mirror" inline {...field("layout", "cameraMirror")}>
        <Toggle
          value={layout.cameraMirror}
          disabled={off}
          // On by default because the bubble the user watched while recording
          // was mirrored; off reads as flipped against it.
          onChange={(value) => set("layout", "cameraMirror", value)}
        />
      </Field>
    </Section>
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
  reset,
  set,
}: {
  settings: SliceSettings;
  field: FieldProps;
  reset?: () => void;
  set: Setter;
}) {
  const { layout } = settings;
  const off = !layout.cursorVisible;

  return (
    <Section title="Cursor" onReset={reset}>
      <Field label="Pointer" inline {...field("layout", "cursorVisible")}>
        <Toggle
          value={layout.cursorVisible}
          onChange={(value) => set("layout", "cursorVisible", value)}
        />
      </Field>

      <Field label="Size" {...field("layout", "cursorSize")}>
        <Slider
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
      </Field>

      <Field label="Hide when still" inline {...field("layout", "cursorAutoHide")}>
        <Toggle
          value={layout.cursorAutoHide}
          disabled={off}
          onChange={(value) => set("layout", "cursorAutoHide", value)}
        />
      </Field>

      <Field label="After" {...field("layout", "cursorHideAfter")}>
        <Slider
          value={layout.cursorHideAfter}
          min={0.5}
          max={10}
          step={0.5}
          disabled={off || !layout.cursorAutoHide}
          format={(value) => `${value}s`}
          onChange={(value) => set("layout", "cursorHideAfter", value)}
        />
      </Field>
    </Section>
  );
}

function BackgroundPanel({
  settings,
  field,
  reset,
  set,
  onPickWallpaper,
  onPickImage,
  onPickPreset,
  wallpaperUrl,
}: {
  settings: SliceSettings;
  field: FieldProps;
  reset?: () => void;
  set: Setter;
  onPickWallpaper: () => void;
  onPickImage: () => void;
  onPickPreset: (presetId: string) => void;
  wallpaperUrl: string | null;
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
    <Section title="Background" onReset={reset}>
      <Field label="Style" {...field("background", "background")}>
        <Segmented
          value={style}
          options={[
            { value: "image", label: "Image", icon: <ImageIcon /> },
            { value: "solid", label: "Solid", icon: <SolidIcon /> },
            { value: "gradient", label: "Gradient", icon: <GradientIcon /> },
          ]}
          onChange={setStyle}
        />
      </Field>

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
            <Field label="Angle">
              <Slider
                value={paint.angle}
                min={0}
                max={360}
                step={1}
                format={(value) => `${Math.round(value)}°`}
                onChange={(angle) => setPaint({ ...paint, angle })}
              />
            </Field>
          )}
        </>
      )}

      {style === "image" && (
        <Field label="Image">
          <div className="flex flex-col gap-1.5">
            <ImageSwatches
              path={paint.kind === "image" ? paint.path : null}
              wallpaper={wallpaperUrl}
              onPickWallpaper={onPickWallpaper}
              onPickPreset={onPickPreset}
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

      <Field label="Padding" {...field("background", "padding")}>
        <Slider
          value={background.padding}
          min={0}
          max={0.25}
          format={percent}
          onChange={(value) => set("background", "padding", value)}
        />
      </Field>

      <Field label="Corner radius" {...field("background", "cornerRadius")}>
        <Slider
          value={background.cornerRadius}
          min={0}
          max={0.1}
          format={percent}
          onChange={(value) => set("background", "cornerRadius", value)}
        />
      </Field>

      <Field label="Border" {...field("background", "borderWidth")}>
        <Slider
          value={background.borderWidth}
          min={0}
          max={0.02}
          format={percent}
          onChange={(value) => set("background", "borderWidth", value)}
        />
      </Field>

      {background.borderWidth > 0 && (
        <Field label="Border colour" {...field("background", "borderColor")}>
          <ColorField
            value={background.borderColor}
            onChange={(value) => set("background", "borderColor", value)}
          />
        </Field>
      )}

      <Field label="Shadow" {...field("background", "shadowOpacity")}>
        <Slider
          value={background.shadowOpacity}
          min={0}
          max={1}
          format={percent}
          onChange={(value) => set("background", "shadowOpacity", value)}
        />
      </Field>
    </Section>
  );
}

function AudioPanel({
  settings,
  present,
  field,
  reset,
  set,
}: {
  settings: SliceSettings;
  present: Set<TrackKind>;
  field: FieldProps;
  reset?: () => void;
  set: Setter;
}) {
  const { audio } = settings;

  // A silent track writes no file and no manifest entry, so its absence is the
  // honest answer to "was the mic on?" — and a fader for it would be a lie.
  if (!present.has("microphone") && !present.has("system_audio")) {
    return (
      <Section title="Audio">
        <p className="text-[11px] text-editor-muted">This recording has no audio tracks.</p>
      </Section>
    );
  }

  return (
    <Section title="Audio" onReset={reset}>
      {present.has("microphone") && (
        <>
          <Field label="Microphone" inline {...field("audio", "micMuted")}>
            <Toggle
              value={!audio.micMuted}
              onChange={(value) => set("audio", "micMuted", !value)}
            />
          </Field>
          <Field label="Microphone volume" {...field("audio", "micVolume")}>
            <Slider
              value={audio.micVolume}
              min={0}
              max={2}
              format={percent}
              disabled={audio.micMuted}
              onChange={(value) => set("audio", "micVolume", value)}
            />
          </Field>
        </>
      )}

      {present.has("system_audio") && (
        <>
          <Field label="System audio" inline {...field("audio", "systemMuted")}>
            <Toggle
              value={!audio.systemMuted}
              onChange={(value) => set("audio", "systemMuted", !value)}
            />
          </Field>
          <Field label="System volume" {...field("audio", "systemVolume")}>
            <Slider
              disabled={audio.systemMuted}
              value={audio.systemVolume}
              min={0}
              max={2}
              format={percent}
              onChange={(value) => set("audio", "systemVolume", value)}
            />
          </Field>
        </>
      )}
    </Section>
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
  tone,
  onDelete,
  deleteLabel,
  onClose,
}: {
  title: string;
  icon: React.ReactNode;
  /** Border, background and text classes, from the timeline's own palette. */
  tone: string;
  /** Absent when there is nothing deletable, which hides the button. */
  onDelete?: () => void;
  deleteLabel: string;
  onClose: () => void;
}) {
  return (
    <header className="flex flex-none items-center gap-2.5 border-b border-editor-line px-3 py-2.5">
      <span
        className={cn(
          "grid size-6 flex-none place-items-center rounded-md border [&_svg]:size-3.5",
          tone,
        )}
        aria-hidden
      >
        {icon}
      </span>

      <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</p>

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
  { label: "Flat", tilt: 0, yaw: 0 },
  { label: "Lean back", tilt: 8, yaw: 0 },
  { label: "Lean in", tilt: -8, yaw: 0 },
  { label: "Left", tilt: 4, yaw: -10 },
  { label: "Right", tilt: 4, yaw: 10 },
  { label: "Hero", tilt: 12, yaw: -14 },
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
    <Section title="Zoom">
      {/* No `typing` option. It needs the Accessibility grant to have anything
          to aim at and is absent without it, so most of the time it was a third
          choice that silently behaved as the first. The automatic pass still
          produces `typing` zooms where the track exists, and they keep working
          — this only stops it being offered as something to pick by hand. */}
      <Field label="Follow">
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
        <Field label="Area">
          <CameraMap
            frame={frame}
            shape="rounded"
            // The share of the frame the zoom will show, which is exactly what
            // the box on the map should be.
            size={1 / Math.max(1, zoom.level)}
            aspect={frame.width / frame.height}
            radius="5px"
            x={zoom.x}
            y={zoom.y}
            onChange={(x, y) => onChange({ x, y })}
          />
        </Field>
      )}

      <Field label="Level">
        <Slider
          value={zoom.level}
          min={1.2}
          max={4}
          step={0.1}
          format={(value) => `${value.toFixed(1)}×`}
          onChange={(level) => onChange({ level })}
        />
      </Field>

      <Field label="Speed">
        <Slider
          value={zoom.speed}
          min={0}
          max={2}
          step={0.05}
          // Seconds, not a rate: "how long does it take" is the question
          // anyone actually has about a camera move.
          format={(value) => (value === 0 ? "Cut" : `${value.toFixed(2)}s`)}
          onChange={(speed) => onChange({ speed })}
        />
      </Field>

      {/* Directly under Speed, because the two answer halves of one question:
          that one is how long the move takes, this one is what it feels like
          over that time. Presets first — most people want "ease out" rather
          than a particular pair of control points, and the curve then shows
          what they picked and can be nudged from there. */}
      <Field label="Ease">
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
    <Section title="Perspective">
      {/* Drag the picture, not the numbers. The sliders below stay for
          precision and for saying what the angle currently is — the pad is how
          anyone arrives at one. */}
      <Field label="Perspective">
        <PerspectivePad
          tilt={zoom.tilt}
          yaw={zoom.yaw}
          depth={zoom.depth}
          limit={TILT_LIMIT}
          onChange={onChange}
        />
      </Field>

      {/* Each preset shows the angle it sets rather than only naming it. "Hero"
          and "Lean back" are labels you have to have learned; the plate above
          them is the same picture the pad draws, so the row can be read instead
          of memorised. The name stays underneath — it is what the two of you
          call the setting once it is chosen. */}
      <Field label="Angles">
        <div className="grid grid-cols-3 gap-1">
          {TILTS.map((preset) => {
            const here =
              Math.abs(zoom.tilt - preset.tilt) < 0.5 && Math.abs(zoom.yaw - preset.yaw) < 0.5;

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
                onClick={() => onChange({ tilt: preset.tilt, yaw: preset.yaw })}
              >
                {/* Fixed and shallower than the pad's. The pad splays with the
                    zoom's depth because it is showing this shot; a thumbnail is
                    showing the angle alone, and letting it move with an
                    unrelated slider would make six buttons twitch whenever
                    depth was dragged. */}
                <span
                  className="grid h-6 w-full place-items-center"
                  style={{ perspective: THUMB_PERSPECTIVE }}
                  aria-hidden="true"
                >
                  <PerspectivePlate
                    tilt={preset.tilt}
                    yaw={preset.yaw}
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
      <Field label="Depth">
        <Slider
          value={zoom.depth}
          min={0}
          max={1}
          step={0.01}
          format={(value) => (value < 0.02 ? "Flat" : percent(value))}
          onChange={(depth) => onChange({ depth })}
        />
      </Field>

      <Field label="Tilt">
        <Slider
          value={zoom.tilt}
          min={-TILT_LIMIT}
          max={TILT_LIMIT}
          step={1}
          // Degrees, and signed: the sign is the whole difference between
          // leaning towards the viewer and away from them.
          format={(value) => `${value > 0 ? "+" : ""}${value.toFixed(0)}°`}
          onChange={(tilt) => onChange({ tilt })}
        />
      </Field>

      <Field label="Yaw">
        <Slider
          value={zoom.yaw}
          min={-TILT_LIMIT}
          max={TILT_LIMIT}
          step={1}
          format={(value) => `${value > 0 ? "+" : ""}${value.toFixed(0)}°`}
          onChange={(yaw) => onChange({ yaw })}
        />
      </Field>
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
    <Section title="Focus">
      <Field label="Blur around" inline>
        <Toggle value={zoom.blur} onChange={(blur) => onChange({ blur })} />
      </Field>

      <Field label="Sharp area">
        <Slider
          value={zoom.blurSafe}
          min={0.05}
          max={0.9}
          step={0.01}
          disabled={!zoom.blur}
          format={percent}
          onChange={(blurSafe) => onChange({ blurSafe })}
        />
      </Field>

      <Field label="Strength">
        <Slider
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
      </Field>

      {/* Beside the blur because the two are the same kind of thing — what the
          shot does to everything that is not the subject — but on its own
          switch-free row: a vignette of zero is already off, so a toggle in
          front of it would be a second way to say the same thing. */}
      <Field label="Vignette">
        <Slider
          value={zoom.vignette}
          min={0}
          max={1}
          step={0.01}
          format={(value) => (value === 0 ? "Off" : percent(value))}
          onChange={(vignette) => onChange({ vignette })}
        />
      </Field>
    </Section>
  );
}
