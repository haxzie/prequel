import { useState, type Dispatch } from "react";

import { BACKGROUND_PRESETS } from "../../../shared/backgrounds";
import { cameraAspect, type Size } from "../../../shared/layout";
import type { TrackKind } from "../../../shared/manifest";
import { assetUrl } from "../../../shared/media-url";
import { GRADIENT_PRESETS, SOLID_PRESETS } from "../../../shared/presets";
import {
  hasOverrides,
  overriddenKeys,
  WALLPAPER_FILE_NAME,
  type Background,
  type SettingsSection,
  type SliceSettings,
  type ZoomSlice,
} from "../../../shared/project";
import { formatTimecode } from "../lib/format";
import { cn } from "../lib/cn";
import { CameraMap } from "./controls/CameraMap";
import { Field, Section } from "./controls/Field";
import {
  AudioIcon,
  CameraIcon,
  CircleIcon,
  CursorIcon,
  FillIcon,
  FitIcon,
  GradientIcon,
  ImageIcon,
  LayoutIcon,
  RoundedIcon,
  SolidIcon,
  SquircleIcon,
  TypingIcon,
  WideIcon,
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
  onPickWallpaper: () => void;
  onPickImage: () => void;
  onPickPreset: (presetId: string) => void;
  /** URL for the desktop picture inside the recording, drawn on its cell. */
  wallpaperUrl: string | null;
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
    return (
      <aside className="flex w-80 flex-none border-l border-editor-line bg-editor-panel">
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <header className="flex-none border-b border-editor-line px-4 py-3">
            <p className="text-[13px] font-medium">Zoom</p>
            <p className="mt-0.5 text-[11px] text-editor-muted">
              {formatTimecode(zoom.source.end - zoom.source.start)} of the recording
            </p>
          </header>
          <ZoomPanel
            zoom={zoom}
            frame={props.frame}
            hasCursor={props.hasCursor}
            onChange={(patch) => dispatch({ type: "setZoom", zoomId: zoom.id, patch })}
            onDelete={() => dispatch({ type: "deleteZoom", zoomId: zoom.id })}
          />
        </div>
      </aside>
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
    <aside className="flex w-80 flex-none border-l border-editor-line bg-editor-panel">
      {/* The rail. Icon over label rather than beside it: four items in a
          column of this width read as a list of destinations, which is what
          they are, and the labels stay legible at 10px because nothing has to
          share the line with them. */}
      <nav className="flex w-16 flex-none flex-col gap-1 border-r border-editor-line p-1.5">
        {categories.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={id === active}
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] [&_svg]:size-4",
              // The same blue the dock marks a chosen screen with, and the
              // timeline its held tool: one colour across the app for "this is
              // the one selected". White on it rather than the panel's text
              // colour, which is tuned for a near-black surface.
              id === active
                ? "bg-selected text-white"
                : "text-editor-muted hover:bg-white/5 hover:text-editor-fg",
            )}
            onClick={() => setTab(id)}
          >
            <Icon />
            {label}
          </button>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="flex-none border-b border-editor-line px-4 py-3">
          <p className="text-[13px] font-medium">{scoped ? "Clip" : "All clips"}</p>
          <p className="mt-0.5 text-[11px] text-editor-muted">
            {scoped
              ? hasOverrides(slice?.overrides)
                ? "Changes apply to this clip only"
                : "Following the project defaults"
              : "Changes apply everywhere they are not overridden"}
          </p>
        </header>

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
          <CursorPanel settings={settings} field={field} reset={sectionReset("layout")} set={set} />
        )}
      </div>
    </aside>
  );
}

/** The inspector's four destinations. */
type CategoryId = "layout" | "camera" | "audio" | "cursor";

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

  return (
    <Section title="Background" onReset={reset}>
      <Field label="Style" {...field("background", "background")}>
        <Segmented
          value={paint.kind}
          options={[
            { value: "image", label: "Image", icon: <ImageIcon /> },
            { value: "solid", label: "Solid", icon: <SolidIcon /> },
            { value: "gradient", label: "Gradient", icon: <GradientIcon /> },
          ]}
          onChange={(kind) => {
            if (kind === paint.kind) return;
            // Each style opens on a sensible default rather than on nothing, so
            // switching to one always shows a background rather than a blank
            // frame waiting to be configured.
            if (kind === "solid") setPaint({ kind: "solid", color: SOLID_PRESETS[1]! });
            if (kind === "gradient") setPaint({ kind: "gradient", ...GRADIENT_PRESETS[1]! });
            if (kind === "image") {
              setPaint({ kind: "image", source: "wallpaper", path: WALLPAPER_FILE_NAME });
            }
          }}
        />
      </Field>

      {paint.kind === "solid" && (
        <SolidSwatches value={paint.color} onChange={(color) => setPaint({ ...paint, color })} />
      )}

      {paint.kind === "gradient" && (
        <>
          <GradientSwatches
            value={paint}
            onChange={(preset) => setPaint({ kind: "gradient", ...preset })}
          />
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
        </>
      )}

      {paint.kind === "image" && (
        <Field label="Image">
          <div className="flex flex-col gap-1.5">
            <ImageSwatches
              path={paint.path}
              wallpaper={wallpaperUrl}
              onPickWallpaper={onPickWallpaper}
              onPickPreset={onPickPreset}
            />

            <div className="flex gap-1.5">
              <button
                type="button"
                className="flex-1 rounded-lg bg-white/5 px-2 py-1.5 text-[11px] hover:bg-white/10"
                onClick={onPickImage}
              >
                Choose…
              </button>
            </div>
            <p className="truncate text-[11px] text-editor-muted" title={paint.path}>
              {paint.path
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
 * One zoom span's settings.
 *
 * `cursor` is the default because it is what a screen recording usually wants:
 * the thing worth looking at is wherever the pointer just went. A region is the
 * answer when the interesting part of the frame is not where the pointer is —
 * a chart being talked about, a line of output.
 */
function ZoomPanel({
  zoom,
  frame,
  hasCursor,
  onChange,
  onDelete,
}: {
  zoom: ZoomSlice;
  frame: Size;
  /** Whether this recording has a pointer track to follow. */
  hasCursor: boolean;
  onChange: (patch: Partial<ZoomSlice>) => void;
  onDelete: () => void;
}) {
  return (
    <Section title="Zoom">
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
            {
              value: "typing",
              label: "Typing",
              title: "Frame whatever field has keyboard focus, falling back to the pointer",
              icon: <TypingIcon />,
            },
            { value: "region", label: "Region", icon: <FillIcon /> },
          ]}
          onChange={(target) => onChange({ target })}
        />
      </Field>

      {/* Offered whichever mode is on, so switching to Region does not move
          everything below it — and so the area can be picked before it is
          switched to. Disabled under Cursor, where the pointer decides. */}
      <Field label="Area">
        <CameraMap
          frame={frame}
          shape="rounded"
          // The share of the frame the zoom will show, which is exactly what
          // the box on the map should be.
          size={1 / Math.max(1, zoom.level)}
          aspect={frame.width / frame.height}
          x={zoom.x}
          y={zoom.y}
          disabled={zoom.target === "cursor"}
          onChange={(x, y) => onChange({ x, y })}
        />
      </Field>

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

      <button
        type="button"
        className="rounded-lg bg-white/5 px-2 py-1.5 text-[11px] text-editor-muted hover:bg-cut/20 hover:text-editor-fg"
        onClick={onDelete}
      >
        Remove zoom
      </button>
    </Section>
  );
}
