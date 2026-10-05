"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AddRecordingIcon,
  AddTextIcon,
  AddZoomIcon,
  AngleIcon,
  AudioIcon,
  BlurIcon,
  BugIcon,
  BorderIcon,
  CameraIcon,
  CaptionsIcon,
  ChevronUpIcon,
  ClockIcon,
  CloseIcon,
  CornerRadiusIcon,
  CursorIcon,
  DropletIcon,
  ExportIcon,
  FilterIcon,
  FolderIcon,
  ImageIcon,
  LayoutIcon,
  LinesIcon,
  MaskToolIcon,
  OffsetIcon,
  OpacityIcon,
  PaddingIcon,
  PauseIcon,
  PerspectiveIcon,
  PlayIcon,
  PresetsIcon,
  ResetIcon,
  ScissorsIcon,
  ScreenIcon,
  ShadowIcon,
  ShadowOffsetIcon,
  SizeIcon,
  SkipEndIcon,
  SkipStartIcon,
  SmoothingIcon,
  SpeakerIcon,
  SpeedIcon,
  TextIcon,
  TrashIcon,
  UndoIcon,
  WatermarkIcon,
  ZoomIcon,
  ZoomInIcon,
} from "@/components/landing/editor-icons";
import {
  ColorField,
  FLOATING,
  Panel,
  PanelHeader,
  Rail,
  Segmented,
  Slider,
  ToggleField,
} from "@/components/editor-controls";
import { ASSETS } from "@/lib/assets";
/**
 * The editor, drawn on the landing page.
 *
 * The markup and the classes are copied from `apps/desktop`, not imported —
 * `apps/web` shares no code with the product, and the point of that rule is that
 * nothing in `apps/desktop` gains a marketing consumer that would become a second
 * reason for it to change. What is copied is the presentation: the shell, the
 * frame bar, the transport and the timeline strip, class for class, from
 * `editor/Editor.tsx`, `editor/FrameBar.tsx`, `editor/PlaybackControls.tsx` and
 * `editor/TimelineStrip.tsx`. The palette is copied the same way, into
 * `editor-theme` in `globals.css`.
 *
 * What is deliberately *not* copied is the app's logic. The real strip computes
 * its ticks from `ruler.ts`, its clip geometry from `timeline.ts` and its clock
 * from `useEditorPlayback` — some nine thousand lines, including the geometry
 * module the no-import rule exists to protect. Here the same shapes are laid out
 * from the fixture below and the positions are percentages of a fixed duration.
 * So this is accurate about what the editor looks like and says nothing about
 * what it computes: if the app's maths changes, this picture is not wrong,
 * because it never claimed to be running it.
 *
 * It is dark on a white page for the reason the other landing mocks are: the
 * editor is dark, and a light one would be a picture of an app that does not
 * exist.
 *
 * What plays in the composition is a real export from the app rather than a
 * still or a re-creation, so the background, the rounded screen and the camera
 * bubble in it are the ones Prequel actually renders. The timeline is the length
 * of that file, which is what lets the strip be the scrubber: seeking is one
 * write to `currentTime`.
 */

/**
 * The take, and its length.
 *
 * The number is the file's own duration and has to stay in step with it: the
 * strip maps its full width onto this, so a wrong figure puts the playhead in
 * the wrong place rather than merely ending early. Encoded to the same shape as
 * the site's other footage — 1280 wide, 30fps, silent — which took 35MB of
 * ProRes-grade export down to 1.3MB.
 */
const TAKE = `${ASSETS}/editor-take.mp4`;
/** Its first frame, so the panel opens on the composition rather than on black. */
const POSTER = `${ASSETS}/editor-take-poster.jpg`;

/**
 * The camera, in the corner.
 *
 * A second file rather than something burnt into the take, which is the whole
 * point the composition is making: Prequel records the camera separately, so
 * where it sits and what shape it is are decided afterwards. The export above
 * has no camera in it, so this is the layout being applied rather than a bubble
 * drawn over one that is already there.
 *
 * Cropped square at the source rather than fitted with `object-cover` here: the
 * file is 146kB at 480², and shipping a 16:9 frame to show the middle third of
 * it is most of a megabyte spent on something no one sees.
 */
const CAMERA = `${ASSETS}/camera-take.mp4`;

/**
 * The wallpaper the window sits on.
 *
 * The same idea as the demos further down the page, which float a window over a
 * desktop picture: a window with nothing behind it is a diagram, and one on a
 * wallpaper is a screenshot.
 *
 * 183kB at 1920 wide, which is heavier than a gradient this smooth has any right
 * to be — the grain is what costs it. That grain is the point rather than an
 * artefact, though: a clean ramp across this many pixels bands into visible steps
 * on an 8-bit display, and noise is what breaks the step up. Same trade the
 * editor's own backgrounds make; see the `backgrounds` skill for the long
 * version. Quality 4 rather than lower for the same reason — JPEG spends its
 * bits smoothing exactly the thing that is doing the work here.
 */
const BACKDROP = `${ASSETS}/editor-backdrop.jpg`;

/**
 * The width the preview is shown at, and the width its media is fetched at.
 *
 * The home page hides this panel below `md`: an editor window with a title bar,
 * a dock, an inspector and a timeline in it is illegible on a phone, and what
 * survives the squeeze is not a picture of the product.
 *
 * Hiding it in CSS is only half of that. `display: none` stops the paint, not
 * the fetch, and it does not stop a `play()` that has already been asked for —
 * so a phone would pull 1.45 MB of video and decode it behind a panel nobody
 * ever sees. Both files are therefore `preload="none"` and neither is started
 * until this query matches.
 *
 * `page.tsx` writes the same breakpoint as `hidden md:block`. Tailwind's `md` is
 * 48rem, and the two have to move together.
 */
const ON_SCREEN = "(min-width: 48rem)";

/**
 * The camera's outline: a true superellipse.
 *
 * `corner-shape: squircle` — what the site's `squircle` utility sets, and what
 * the app itself uses — lands in Chrome 139 and nowhere else yet. Everywhere else
 * it is ignored and the shape falls back to whatever `border-radius` says, which
 * is a rounded rectangle: the corners leave the straight edge at a visible seam
 * instead of growing out of it, and no radius fixes that. On the 26px mark in the
 * nav that is a fair approximation; on a bubble this size the shape *is* the
 * thing being looked at.
 *
 * So this one is clipped rather than rounded. |x|^4 + |y|^4 = 1 is the curve
 * `apps/desktop/scripts/make-app-icon.mjs` masks the app icon with, at the same
 * exponent, and `src/app/icon.svg` carries the same one baked into a clip path.
 *
 * Through an SVG `clipPath` with `clipPathUnits="objectBoundingBox"` rather than
 * CSS `clip-path: path()`, which is the trap here: `path()` reads its numbers as
 * pixels in the element's own box, so a path written in fractions clips
 * everything down to a single pixel. `objectBoundingBox` is what makes one path
 * fit the bubble at every width.
 *
 * Sampled at 96 points rather than fitted with béziers. Each segment is well
 * under a pixel at the size this is drawn, and the arithmetic is a line of maths
 * instead of a quadrant-wise approximation nobody could check.
 */
const SQUIRCLE_ID = "prequel-camera-squircle";
const SQUIRCLE =
  "M1.0000 0.5000L0.9995 0.6279L0.9979 0.6806L0.9952 0.7208L0.9914 0.7544L0.9866 0.7835L0.9806 0.8093L0.9735 0.8325L0.9653 0.8536L0.9559 0.8727L0.9454 0.8901L0.9335 0.9060L0.9204 0.9204L0.9060 0.9335L0.8901 0.9454L0.8727 0.9559L0.8536 0.9653L0.8325 0.9735L0.8093 0.9806L0.7835 0.9866L0.7544 0.9914L0.7208 0.9952L0.6806 0.9979L0.6279 0.9995L0.5000 1.0000L0.3721 0.9995L0.3194 0.9979L0.2792 0.9952L0.2456 0.9914L0.2165 0.9866L0.1907 0.9806L0.1675 0.9735L0.1464 0.9653L0.1273 0.9559L0.1099 0.9454L0.0940 0.9335L0.0796 0.9204L0.0665 0.9060L0.0546 0.8901L0.0441 0.8727L0.0347 0.8536L0.0265 0.8325L0.0194 0.8093L0.0134 0.7835L0.0086 0.7544L0.0048 0.7208L0.0021 0.6806L0.0005 0.6279L0.0000 0.5000L0.0005 0.3721L0.0021 0.3194L0.0048 0.2792L0.0086 0.2456L0.0134 0.2165L0.0194 0.1907L0.0265 0.1675L0.0347 0.1464L0.0441 0.1273L0.0546 0.1099L0.0665 0.0940L0.0796 0.0796L0.0940 0.0665L0.1099 0.0546L0.1273 0.0441L0.1464 0.0347L0.1675 0.0265L0.1907 0.0194L0.2165 0.0134L0.2456 0.0086L0.2792 0.0048L0.3194 0.0021L0.3721 0.0005L0.5000 0.0000L0.6279 0.0005L0.6806 0.0021L0.7208 0.0048L0.7544 0.0086L0.7835 0.0134L0.8093 0.0194L0.8325 0.0265L0.8536 0.0347L0.8727 0.0441L0.8901 0.0546L0.9060 0.0665L0.9204 0.0796L0.9335 0.0940L0.9454 0.1099L0.9559 0.1273L0.9653 0.1464L0.9735 0.1675L0.9806 0.1907L0.9866 0.2165L0.9914 0.2456L0.9952 0.2792L0.9979 0.3194L0.9995 0.3721Z";
const DURATION = 30.87;

/**
 * The cuts, as fractions of the take. Widths, not positions — they abut.
 *
 * The last one is named rather than reached for with an index. `tsconfig` has
 * `noUncheckedIndexedAccess`, so `CLIPS[CLIPS.length - 1]` is typed as possibly
 * missing and every use of it needs a guard for a case that cannot happen. The
 * same applies to the two other fixtures below.
 */
const LAST_CLIP = { id: "d", duration: 8.57, camera: true };
const CLIPS = [
  { id: "a", duration: 9.5, camera: true },
  { id: "b", duration: 7.2, camera: true },
  { id: "c", duration: 5.6, camera: false },
  LAST_CLIP,
];

/** The zoom and pan, in seconds from the start of the take. */
const PANEL_ZOOM = { id: "z2", at: 11, length: 4.4, level: 1.8, target: "typing" as const };
const ZOOMS = [
  { id: "z1", at: 1.5, length: 5.2, level: 2.4, target: "cursor" as const },
  PANEL_ZOOM,
  { id: "z3", at: 19.5, length: 6.2, level: 3.1, target: "cursor" as const },
];

/**
 * The dock's eleven destinations and what each one puts in the panel.
 *
 * `CATEGORIES` in `Inspector.tsx`, in its order and with its labels — including
 * "Logo" for the `watermark` id, which is the one place the two differ. The app
 * hides Camera, Audio, Cursor and Captions when a recording has no camera, no
 * audio, no cursor track or no transcript; this is a take that has all four.
 * Focus and Angle are left out for the opposite reason: they belong to a
 * screenshot, and this is a recording.
 *
 * The rows are the controls those panels actually carry, in the order they carry
 * them, each slider with the glyph the app puts beside it — read off
 * `Inspector.tsx` rather than invented, because a panel of plausible-looking
 * settings is a picture of a different app. Four of them are not lists of
 * settings at all: Presets is a grid of saved looks, Layout a grid of
 * arrangements and Filters a grid of looks, so they are drawn as grids.
 *
 * What is a fixture here is the *values*. A real panel reads those off the
 * selected clip's settings, and this has no clip.
 */
type Row =
  | { kind: "slider"; label: string; value: number; read: string; Icon: () => React.ReactElement }
  | { kind: "toggle"; label: string; on: boolean; Icon: () => React.ReactElement }
  | { kind: "segmented"; options: string[]; at: number }
  | { kind: "colour"; label: string; hex: string; Icon: () => React.ReactElement }
  | { kind: "chips"; options: string[]; at: number }
  | { kind: "grid"; columns: number; items: string[]; at: number };

/**
 * A group of fields, divided from the next by a rule — the app's `Section`.
 *
 * The title is usually absent, and that is the app's rule rather than an
 * omission here: the panel header already names what is showing, so a heading
 * saying it again was that word twice, stacked, in two type sizes. It earns its
 * place on the panels with several groups, where it names something the header
 * does not.
 */
type Group = { title?: string; rows: Row[] };

type Category = { id: string; label: string; Icon: () => React.ReactElement; groups: Group[] };

const PRESETS_TAB: Category = {
  id: "presets",
  label: "Presets",
  Icon: PresetsIcon,
  groups: [
    {
      rows: [
        {
          kind: "grid",
          columns: 2,
          items: ["Studio", "Keynote", "Plain", "Save this look"],
          at: 0,
        },
      ],
    },
  ],
};

const CATEGORIES: Category[] = [
  PRESETS_TAB,
  {
    id: "layout",
    label: "Layout",
    Icon: LayoutIcon,
    // `LayoutPicker`, which is the whole panel: no label over it, because a
    // grid of arrangements is a control that shows what it is.
    groups: [
      {
        rows: [
          {
            kind: "grid",
            columns: 3,
            items: ["Full", "Corner", "Beside", "Under", "Split", "Screen only"],
            at: 1,
          },
        ],
      },
    ],
  },
  {
    id: "background",
    // A picture, not a palette: the palette glyph went to the text panel's
    // Style tab, where a look is chosen, and what this panel mostly holds is
    // wallpapers.
    label: "Background",
    Icon: ImageIcon,
    groups: [
      {
        rows: [
          { kind: "segmented", options: ["Image", "Colour", "None"], at: 0 },
          { kind: "slider", label: "Blur", value: 0.36, read: "24%", Icon: BlurIcon },
          { kind: "slider", label: "Angle", value: 0.5, read: "0°", Icon: AngleIcon },
        ],
      },
    ],
  },
  {
    id: "recording",
    label: "Recording",
    Icon: ScreenIcon,
    groups: [
      {
        title: "Speed",
        rows: [
          { kind: "slider", label: "Speed", value: 0.2, read: "1×", Icon: SpeedIcon },
          // `SPEED_PRESETS`: stops for the common cases, so reaching for 2×
          // is a click rather than a drag landing near enough.
          { kind: "chips", options: ["0.25×", "0.5×", "1×", "2×", "4×"], at: 2 },
        ],
      },
      {
        rows: [
          { kind: "slider", label: "Padding", value: 0.4, read: "9%", Icon: PaddingIcon },
          {
            kind: "slider",
            label: "Corner radius",
            value: 0.28,
            read: "3%",
            Icon: CornerRadiusIcon,
          },
        ],
      },
      {
        title: "Border",
        rows: [
          { kind: "slider", label: "Width", value: 0.3, read: "0.6%", Icon: BorderIcon },
          { kind: "colour", label: "Colour", hex: "#2A2D33", Icon: DropletIcon },
          { kind: "slider", label: "Opacity", value: 0.55, read: "55%", Icon: OpacityIcon },
        ],
      },
      {
        title: "Shadow",
        rows: [
          { kind: "slider", label: "Opacity", value: 0.45, read: "45%", Icon: ShadowIcon },
          { kind: "slider", label: "Blur", value: 0.42, read: "6%", Icon: BlurIcon },
          { kind: "slider", label: "Offset", value: 0.33, read: "3%", Icon: ShadowOffsetIcon },
        ],
      },
    ],
  },
  {
    id: "camera",
    label: "Camera",
    Icon: CameraIcon,
    groups: [
      {
        rows: [
          { kind: "toggle", label: "Camera", on: true, Icon: CameraIcon },
          // Five shapes, where there were three. The two at the end are the
          // camera at its own proportions rather than cropped square.
          {
            kind: "segmented",
            options: ["Circle", "Squircle", "Rounded", "Wide", "Portrait"],
            at: 0,
          },
          { kind: "slider", label: "Roundness", value: 0.9, read: "90%", Icon: CornerRadiusIcon },
          { kind: "slider", label: "Size", value: 0.34, read: "18%", Icon: SizeIcon },
          { kind: "slider", label: "Zoom", value: 0.2, read: "1.2×", Icon: ZoomIcon },
          { kind: "toggle", label: "Mirror", on: true, Icon: PerspectiveIcon },
          { kind: "toggle", label: "Shrink on zoom", on: false, Icon: ZoomIcon },
          { kind: "slider", label: "Size while zoomed", value: 0.5, read: "12%", Icon: ZoomInIcon },
        ],
      },
    ],
  },
  {
    id: "audio",
    label: "Audio",
    Icon: AudioIcon,
    groups: [
      {
        rows: [
          { kind: "toggle", label: "Include", on: true, Icon: SpeakerIcon },
          { kind: "slider", label: "Volume", value: 0.8, read: "80%", Icon: SpeakerIcon },
        ],
      },
    ],
  },
  {
    id: "cursor",
    label: "Cursor",
    Icon: CursorIcon,
    groups: [
      {
        rows: [
          { kind: "toggle", label: "Pointer", on: true, Icon: CursorIcon },
          { kind: "slider", label: "Size", value: 0.52, read: "1.3×", Icon: SizeIcon },
          { kind: "slider", label: "Smoothing", value: 0.66, read: "66%", Icon: SmoothingIcon },
          { kind: "slider", label: "Motion blur", value: 0.24, read: "24%", Icon: BlurIcon },
          { kind: "toggle", label: "Hide while typing", on: true, Icon: CursorIcon },
          { kind: "toggle", label: "Hide when still", on: false, Icon: ClockIcon },
          { kind: "slider", label: "After", value: 0.35, read: "1.2s", Icon: ClockIcon },
        ],
      },
    ],
  },
  {
    id: "captions",
    label: "Captions",
    Icon: CaptionsIcon,
    groups: [
      {
        rows: [
          { kind: "toggle", label: "Show captions", on: true, Icon: CaptionsIcon },
          { kind: "slider", label: "Size", value: 0.48, read: "42", Icon: SizeIcon },
          { kind: "slider", label: "Distance from edge", value: 0.2, read: "6%", Icon: OffsetIcon },
          { kind: "slider", label: "Lines", value: 0.5, read: "2", Icon: LinesIcon },
          { kind: "colour", label: "Spoken word", hex: "#FFD60A", Icon: DropletIcon },
        ],
      },
    ],
  },
  {
    // Past the conditional ones, and beside the logo rather than among the
    // panels above: everything above dresses a picture the recording already
    // has, and a look is laid over the finished composition.
    id: "filters",
    label: "Filters",
    Icon: FilterIcon,
    groups: [
      {
        rows: [
          {
            kind: "grid",
            columns: 3,
            items: ["None", "Warm", "Cool", "Mono", "Faded", "Velvia"],
            at: 0,
          },
        ],
      },
    ],
  },
  {
    // Unconditional, even when nothing was found: a panel that appeared only
    // when there was something to show is a panel nobody knows exists, and
    // "nothing was found" is the most reassuring thing it can say.
    id: "privacy",
    label: "Privacy",
    Icon: MaskToolIcon,
    groups: [
      {
        rows: [
          { kind: "segmented", options: ["Blur", "Pixelate"], at: 0 },
          { kind: "toggle", label: "Email and phone numbers", on: true, Icon: MaskToolIcon },
          { kind: "toggle", label: "Cards and ID numbers", on: true, Icon: MaskToolIcon },
          { kind: "toggle", label: "Keys and secrets", on: true, Icon: MaskToolIcon },
          { kind: "toggle", label: "Faces", on: false, Icon: MaskToolIcon },
        ],
      },
    ],
  },
  {
    id: "watermark",
    label: "Logo",
    Icon: WatermarkIcon,
    groups: [
      {
        rows: [
          { kind: "slider", label: "Size", value: 0.26, read: "8%", Icon: SizeIcon },
          { kind: "slider", label: "Opacity", value: 0.6, read: "60%", Icon: OpacityIcon },
        ],
      },
    ],
  },
];

const FIRST_TAB = PRESETS_TAB;

/**
 * How tall the title bar is, and the frame bar under it.
 *
 * `TITLE_BAR` and `FRAME_BAR` in `surfaces.ts`. Constants because several things
 * that are not the bars have to agree on them: neither takes a row of its own
 * any more — both float over the board, which is what lets the dots and the
 * recording's own light reach the top of the window — so everything underneath
 * holds its own space clear. The stage's headroom is the two plus a gutter, and
 * the dock and the panel start below the first.
 */
const TITLE_BAR = "2.625rem";
const FRAME_BAR = "2.375rem";

/**
 * What the dock and the panel occupy together.
 *
 * The dock is 2.25rem of button, 0.75rem of padding, 0.125rem of border and
 * 0.5rem of margin — 3.625rem — and the panel is 20rem plus the 0.5rem it is
 * inset from the window edge by. The frame bar and the stage are both held off
 * the right by it, so the picture and the controls over it stay centred on the
 * part of the board anybody can see.
 *
 * Handed down as a custom property rather than written into a class: the pair is
 * only on screen at `lg`, and a breakpoint cannot be expressed in an inline
 * style. One number, read by `lg:pr-[var(--panel)]` in the two places that
 * need it.
 */
const PANEL_WIDTH = "24.125rem";

/**
 * The wash of background colour behind the composition.
 *
 * `ambientGradient` in `ambience.ts`: three lamps of the background's own
 * colours thrown on the board, so what reaches the eye is light rather than a
 * shape. The app samples them off the wallpaper the recording is dressed in;
 * these three are read off this take's, which is the lilac and pale green its
 * first frame opens on.
 *
 * It is the reason the panels float rather than sit flush. A surface that
 * stopped the light dead was a hole punched in it, which is what the old opaque
 * sidebar and the old solid title bar both were.
 *
 * Each lamp fades to its own colour at zero alpha rather than to `transparent`,
 * which is `rgb(0 0 0 / 0)` — a ramp to it travels towards black as well as
 * towards nothing. Premultiplied interpolation hides that most of the time and
 * not all of it, and fading to the same hue at zero changes only the alpha,
 * which is the one channel a wash is allowed to move. Free, and right.
 */
const WASH = [
  "radial-gradient(60% 60% at 22% 18%, rgb(186 169 249 / 0.50), rgb(186 169 249 / 0) 72%)",
  "radial-gradient(60% 60% at 80% 26%, rgb(229 248 216 / 0.43), rgb(229 248 216 / 0) 72%)",
  "radial-gradient(60% 60% at 50% 88%, rgb(207 186 245 / 0.35), rgb(207 186 245 / 0) 72%)",
].join(", ");

/** The ruler's marks: a major every five seconds, a minor every second. */
const MARKS = Array.from({ length: Math.floor(DURATION) + 1 }, (_, at) => ({
  at,
  major: at % 5 === 0,
  label: at % 5 === 0 ? `0:${String(at).padStart(2, "0")}` : null,
}));

/** `formatTimecode` from the app, at the one precision this picture needs. */
function timecode(seconds: number) {
  const whole = Math.floor(seconds);
  const hundredths = Math.round((seconds - whole) * 100);
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, "0")}.${String(
    hundredths,
  ).padStart(2, "0")}`;
}

export function AppPreview() {
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | null>("z2");
  // Fixed: the rail is a picture. Named rather than inlined so the panel showing
  // and the dock's mark cannot drift apart.
  const tab = "recording";
  const showing = CATEGORIES.find((category) => category.id === tab) ?? FIRST_TAB;
  const strip = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const camera = useRef<HTMLVideoElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);

  // The pointer's position on the strip, as a time. The strip is the full width
  // of the take here — the app's version scrolls and zooms, which is the one
  // thing a picture of it has no use for.
  const timeAt = useCallback((clientX: number) => {
    const box = strip.current?.getBoundingClientRect();
    if (!box) return 0;
    const fraction = (clientX - box.left) / box.width;
    return Math.min(Math.max(fraction, 0), 1) * DURATION;
  }, []);

  /**
   * The playhead and the clock, written straight to the DOM.
   *
   * Not through React state: while the take is playing this runs once a frame,
   * and a render per frame to move one element and retype six characters is the
   * thing the app's own editor is careful not to do. `transform` and
   * `textContent`, both of which the compositor can take without a layout.
   */
  const paint = useCallback((time: number) => {
    if (rail.current) rail.current.style.transform = `translateX(${(time / DURATION) * 100}%)`;
    if (clock.current) clock.current.textContent = timecode(time);
  }, []);

  const seek = useCallback(
    (time: number) => {
      setAt(time);
      paint(time);
      if (video.current) video.current.currentTime = time;
    },
    [paint],
  );

  // Follows the file while it plays. `requestAnimationFrame` rather than
  // `timeupdate`, which fires about four times a second — the playhead would
  // advance in visible steps while the picture beside it ran smoothly.
  useEffect(() => {
    if (!playing) return;

    let frame = 0;
    const follow = () => {
      const element = video.current;
      if (element) {
        paint(element.currentTime);
        // Kept for the parts that do need a render: which clip is under the
        // playhead, and the transport's own icon.
        setAt(element.currentTime);
      }
      frame = requestAnimationFrame(follow);
    };

    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [playing, paint]);

  /**
   * Starts the take and the camera on their own, once the panel is on screen.
   *
   * Muted, which is what browsers require of a video that plays without being
   * asked — and correct anyway: a page that makes noise on open is a page people
   * close. `play()` returns a promise that rejects when the browser refuses
   * regardless, iOS in Low Power Mode being the common one, so the rejection is
   * swallowed and the poster stays up with the transport waiting to be pressed.
   *
   * There are two gates. `ON_SCREEN` is the width one, and it is what replaced
   * the camera's `autoPlay` and both files' `preload="auto"`: below it the panel
   * is `display: none`, which would have stopped neither, because the bytes are
   * the point and not the paint. The observer below is the other — see the note
   * on it — and the two are `&&`, so neither can start the files on its own.
   *
   * Not under `prefers-reduced-motion`. The site stops the wash, the demos and
   * the hero's entrance outright under that setting rather than slowing them
   * down, and thirty seconds of moving picture is a stronger claim on the eye
   * than any of them. The first frame is still there, and so is the play button.
   * The camera is exempt for the reason it always was: it is a layer of the
   * picture rather than something to watch, and a frozen one reads as a dropped
   * video call.
   */
  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wide = window.matchMedia(ON_SCREEN);

    // Whether the panel is in the viewport at all. Held outside the observer so
    // a width change can ask the same question without waiting for the next
    // intersection to be reported.
    let showing = true;

    const start = () => {
      if (!wide.matches || !showing) return;

      void camera.current?.play().catch(() => {
        // Refused, and there is no fallback frame to show. An empty corner is
        // the same thing the clip path would have been drawn around.
      });

      // Left on its poster, which is what this setting asked for. Nothing is
      // fetched until somebody presses the transport.
      if (still) return;

      void video.current?.play().catch(() => {
        // Refused. The poster and the transport are the fallback.
      });
    };

    const stop = () => {
      video.current?.pause();
      camera.current?.pause();
    };

    /**
     * Both files run only while the panel is on screen.
     *
     * Two videos decoding is work the compositor does whether or not anybody
     * can see them, and this sits near the top of a long page: left running,
     * they went on decoding through every section below, which is the frame
     * budget of the rest of the landing page spent on a picture nobody is
     * looking at. It is also what the `rAF` loop above is gated on — pausing
     * clears `playing`, and the loop stops with it.
     *
     * A margin, so the two are already running by the time the panel is
     * reached rather than starting as it arrives: a video that begins playing
     * the moment it comes into view reads as having been broken until then.
     */
    const watcher = new IntersectionObserver(
      ([entry]) => {
        showing = entry?.isIntersecting ?? true;
        if (showing) start();
        else stop();
      },
      { rootMargin: "200px" },
    );

    if (box.current) watcher.observe(box.current);
    start();

    // A window that opens narrow and is widened, or a phone turned on its side,
    // would otherwise keep the poster and an empty camera corner for as long as
    // the page is open.
    wide.addEventListener("change", start);
    return () => {
      watcher.disconnect();
      wide.removeEventListener("change", start);
    };
  }, []);

  const toggle = () => {
    const element = video.current;
    if (!element) return;
    if (element.paused) void element.play();
    else element.pause();
  };

  const scrub = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    seek(timeAt(event.clientX));
  };

  const clipAt = (() => {
    let elapsed = 0;
    for (const clip of CLIPS) {
      elapsed += clip.duration;
      if (at < elapsed) return clip.id;
    }
    return LAST_CLIP.id;
  })();

  return (
    // The wallpaper, and the page's own corner on it so the whole thing is the
    // same object as the cards around it.
    //
    // The padding is what the window is inset by, and it grows with the screen:
    // a fixed inset is a generous margin on a phone and a hairline on a monitor,
    // and the point of the wallpaper is that it reads as the desktop the window
    // is standing on rather than as a coloured border around it. Wide enough at
    // the top end that the window reads as sitting *on* the picture — at half
    // this it was a window with a coloured edge.
    <div
      ref={box}
      className="squircle relative isolate overflow-hidden rounded-3xl bg-cover bg-center p-4 sm:p-9 lg:p-16"
      style={{ backgroundImage: `url(${BACKDROP})` }}
    >
      {/* `select-none` because every pointer gesture in here is a drag, and a
          scrub that highlights the timecode as it goes reads as a broken text
          field. The shadow is what lifts the window off the wallpaper — without
          it the two are one flat picture and the inset reads as a mistake. */}
      {/* `select-none` because every pointer gesture in here is a drag, and a
          scrub that highlights the timecode as it goes reads as a broken text
          field. The shadow is what lifts the window off the wallpaper — without
          it the two are one flat picture and the inset reads as a mistake.

          `bg-editor-glass`, not the opaque `--editor-bg` this was. Electron
          gives a window one vibrancy material and the app paints three depths
          of the same colour over it; the wallpaper reading faintly through the
          chrome is that material, and it is what the floating panels inside are
          floating on.

          The tint and no `backdrop-filter`, which it carried for about a day.
          What is behind this element is one smooth gradient, so blurring it
          produced the same pixels at the cost of a backdrop root around two
          playing videos — and a backdrop root is re-rastered in tiles as the
          page scrolls, which is where the black band came from. See `FLOATING`
          for the three inside it, dropped for the same reason. */}
      <div
        className="editor-theme squircle relative flex select-none flex-col overflow-hidden rounded-2xl bg-editor-glass text-editor-fg shadow-[0_24px_60px_-20px_rgb(0_0_0_/_0.55)] ring-1 ring-black/20"
        role="img"
        aria-label="The Prequel editor: a recording on the timeline with three zooms over it"
      >
        {/* The window's title bar, which has no surface of its own. It was a
          nearly-solid band matching the transport at the other end, so the two
          read as the frame around the work — and that stopped being the
          arrangement when the panels inside lifted off the board. A solid bar
          above a window of floating things is the one thing left that is still
          a wall.

          So it floats over the board, which is what lets the dots and the
          recording's own light run to the top of the window. Everything
          underneath holds its own space clear; see `TITLE_BAR`.

          `pl-20` in the app is the room macOS's own traffic lights need. The
          dots are drawn here because without them the bar reads as a web
          toolbar rather than as a macOS window. */}
        <header
          className="absolute inset-x-0 top-0 z-40 flex items-center gap-2 pr-2 pl-4"
          style={{ height: TITLE_BAR }}
        >
          <span aria-hidden className="mr-2 flex flex-none items-center gap-2">
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
          </span>

          {/* Where this recording is and what can be done to it, as one group.
            No plate under it: these are the window saying where you are, not
            controls waiting to be used, and a plate made the bar read as three
            objects competing with the picture below. Each part lights up on
            hover, which is the only moment it is a control. */}
          <span className="flex min-w-0 items-center gap-1">
            <span className="flex flex-none items-center gap-1.5 rounded-full px-2 py-1 text-[13px] text-editor-fg/75 [&_svg]:size-3.5">
              <FolderIcon />
              Recordings
            </span>
            <span aria-hidden className="flex-none text-[13px] text-editor-fg/40">
              /
            </span>
            <span className="min-w-0 truncate px-1 text-[13px] font-medium">
              Onboarding walkthrough
            </span>
            <span className="grid size-6 flex-none place-items-center rounded-full text-editor-muted [&_svg]:size-3.5">
              <TrashIcon />
            </span>
          </span>

          <span className="flex-1" />

          {/* Text as well as the glyph, unlike anything else on this bar. The
            rest are things somebody came here to do and will find by looking;
            this one has to be noticed by somebody who was not looking for it. */}
          <span className="hidden flex-none items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] text-editor-fg/75 sm:flex [&_svg]:size-3.5">
            <BugIcon />
            Found a bug?
          </span>
          {/* The only thing on the bar that is already a surface — a filled
            button in the app's own green — because it is the only thing on it
            that is a decision rather than a label. */}
          <span className="flex h-7 flex-none items-center gap-1.5 rounded-full bg-export px-3 text-[11px] font-medium text-white [&_svg]:size-3.5">
            <ExportIcon />
            Export
          </span>
        </header>

        {/* The board: the dots and the fill are on the row, so the surface runs
          under the inspector and under the title bar as well as under the
          composition — one board with things sitting on it rather than a
          patterned area and a plain one meeting at a seam.

          `min-h` because the dock is eleven buttons tall — 2.25rem each plus
          the gaps, its padding, its border and its margin, under a title bar —
          and the board's own height comes from the composition, which is
          shorter than that at narrow widths. Without it the last categories
          fall past the panel and the shell's `overflow-hidden` cuts them off.

          `relative`, because everything on it is positioned against it: the
          bars, the dock and the panel all float rather than taking a column or
          a row. */}
        <div
          className="dot-grid relative flex min-h-[34rem] flex-1 bg-editor-scrim"
          style={{ "--panel": PANEL_WIDTH } as React.CSSProperties}
        >
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            {/* The frame bar, floating over the board rather than taking a row
              above the picture. As a row it was a strip of board the
              composition could not reach and the light behind it could not
              cross, so the wash ended in a straight horizontal line a third of
              the way up the window — which reads as a rendering fault rather
              than as light.

              Inset by the panel for the reason the stage is: this column runs
              the full width of the board, and a bar centred in it would sit
              off-centre over the part of the board anybody can see. */}
            <div
              className="pointer-events-none absolute inset-x-0 z-20 flex justify-center lg:pr-[var(--panel)]"
              style={{ top: TITLE_BAR }}
            >
              {/* Pill-shaped like the dock rather than rounded like the panel:
                both of those are a line of controls, and the panel is a page of
                them. White, not `--editor-muted` — that tone was chosen against
                the opaque strip this used to be a row in, and over a surface lit
                by the recording's own colours a muted grey is the one thing on
                the bar you have to look twice at. */}
              <span
                className={`flex items-center gap-3 rounded-full px-4 py-1.5 ${FLOATING}`}
                style={{ height: FRAME_BAR }}
              >
                <span className="text-[11px] tracking-wide text-editor-fg uppercase">Frame</span>
                <span className="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs">
                  {/* A rectangle of the frame's proportions, at a glance. */}
                  <span className="grid size-4 flex-none place-items-center" aria-hidden>
                    <span className="h-[7.875px] w-3.5 rounded-[2px] border border-current" />
                  </span>
                  Landscape
                  <span className="tabular-nums text-editor-fg">16:9</span>
                </span>
                <span className="flex items-center gap-1.5 text-xs tabular-nums">
                  <span className="rounded-full px-2 py-1">1920</span>
                  <span className="text-editor-fg">×</span>
                  <span className="rounded-full px-2 py-1">1080</span>
                </span>
              </span>
            </div>

            {/* The stage. The composition is a finished export playing: nothing
              is drawn over it, because the background, the rounded screen, the
              camera and the zoom and pan are all in the file, which came out of
              the app. `loop` because it is a picture of the editor rather than
              something to watch to the end — it should be moving whenever
              anyone looks at it, and a still panel halfway down a page reads as
              broken. `playsInline` so iOS does not take it fullscreen.

              The headroom is the two bars plus the same gutter the picture has
              from the transport below it, written as one sum so the space over
              the picture and the space under it are the same number rather than
              two that happen to agree.

              `relative isolate` for the wash: a `-z-10` child is only behind its
              own stacking context, and without one it goes behind the board's
              own fill and is never seen. `overflow-hidden` keeps it on the
              board, and it clips at the padding box — so the wash reaches under
              the floating panel, which is the whole point of it being on the
              stage rather than around the picture. */}
            <div
              className="relative isolate grid min-h-0 flex-1 place-items-center overflow-hidden px-6 lg:pr-[calc(1.5rem+var(--panel))]"
              style={{
                paddingTop: `calc(${TITLE_BAR} + ${FRAME_BAR} + 1.5rem)`,
                paddingBottom: "1.5rem",
              }}
            >
              {/* No `blur()`, where the app carries 72px of it.
                
                The app samples its lamps off a photograph, so the filter is
                what turns a picture into light. These three are radial
                gradients, which are already a smooth ramp from the centre to
                nothing — blurring one changes no pixel you can find in a
                screenshot, and it was the largest filter left on the page
                after the backdrops went. The softness lives in the stops. */}
              <div
                aria-hidden
                className="pointer-events-none absolute -inset-[10%] -z-10"
                style={{ background: WASH }}
              />

              {/* `relative` and sized to the take, so the camera below is placed
                against the composition's own edges rather than the column's —
                the two differ at every width, and a bubble inset from the column
                floats off the corner it belongs to. `w-fit` so the box is the
                video and not the space around it. */}
              <div className="relative h-fit w-fit max-w-[38rem]">
                <video
                  ref={video}
                  src={TAKE}
                  muted
                  loop
                  playsInline
                  poster={POSTER}
                  preload="none"
                  className="max-h-full w-full max-w-[38rem] cursor-pointer rounded-lg shadow-[0_10px_30px_-12px_rgb(0_0_0_/_0.7)]"
                  onClick={toggle}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onLoadedMetadata={() => paint(0)}
                />

                {/* The clip path itself, defined once. Zero-sized and `absolute`, so
                it takes no room and cannot be reached. */}
                <svg aria-hidden className="pointer-events-none absolute size-0">
                  <defs>
                    <clipPath id={SQUIRCLE_ID} clipPathUnits="objectBoundingBox">
                      <path d={SQUIRCLE} />
                    </clipPath>
                  </defs>
                </svg>

                {/* Bottom right, inset by the same fraction on both edges so it stays
                in the corner as the composition resizes.

                The shadow is a `drop-shadow` filter on the wrapper rather than a
                `box-shadow` on the video. `clip-path` clips everything the
                element paints — its own shadow and ring included — so a box
                shadow here would be cut off at the very curve it is meant to be
                falling away from. `drop-shadow` follows the clipped silhouette,
                which is the shape a shadow of this thing should have. The ring
                goes with it: there is no border left to draw on.

                Its own `loop`, and started on its own: it is a face, not a
                take, and it has nothing to stay in step with — the transport
                drives the composition, and a camera that stopped when the take
                was paused would read as a frozen video call rather than as a
                layer. It played from `autoPlay` until that turned out to fire
                behind `display: none` as happily as in front of it. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute right-[4%] bottom-[4%] w-[20%] [filter:drop-shadow(0_5px_10px_rgb(0_0_0_/_0.55))]"
                >
                  <video
                    ref={camera}
                    src={CAMERA}
                    muted
                    loop
                    playsInline
                    preload="none"
                    className="block w-full"
                    style={{ clipPath: `url(#${SQUIRCLE_ID})` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* The dock and the panel, which the app counts as one thing — see
            `PANEL_WIDTH`. The dock is what chooses the section.

            Floating over the board rather than sitting beside it, and the
            reason is the rail: those icons are drawn on the editor's own
            background with nothing behind them, so as a column of its own the
            rail was a vertical strip the light could not cross and the wash
            stopped dead at it. Over the board, the light runs underneath and the
            icons sit in it. `top` rather than `inset-y-0`: the board reaches the
            top of the window and this must not, or it would slide up behind the
            title bar's own controls.

            Both are fixed, and deliberately. The timeline is the one thing here
            worth handing a visitor, because scrubbing is what shows that the
            picture and the strip are the same edit. A rail that swapped eleven
            panels of settings is a toy: it invites somebody to hunt for the
            control that does something and find that none of them do. So this
            shows one panel as a picture of the app, and the whole column is
            inert — `pointer-events-none` rather than disabled controls, so
            nothing offers a cursor or a hover it cannot honour. */}
          <div
            className="pointer-events-none absolute right-0 bottom-0 z-30 hidden select-none lg:flex"
            style={{ top: TITLE_BAR }}
          >
            <Rail
              items={CATEGORIES}
              at={Math.max(
                0,
                CATEGORIES.findIndex((c) => c.id === tab),
              )}
            />
            <Panel>
              <PanelHeader
                icon={<showing.Icon />}
                title={showing.label}
                controls={
                  <>
                    {/* Reset, then Close. The rail is a column of glyphs with no
                      labels, so the panel it opens says the word — and every
                      control acting on the panel is up here with it, where
                      Reset used to be a word on a row of its own inside. */}
                    <span className="grid size-6 flex-none place-items-center rounded-full text-editor-muted [&_svg]:size-3.5">
                      <ResetIcon />
                    </span>
                    <span className="grid size-6 flex-none place-items-center rounded-full text-editor-muted [&_svg]:size-3.5">
                      <CloseIcon />
                    </span>
                  </>
                }
              />
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                {showing.groups.map((group, index) => (
                  <section
                    key={group.title ?? index}
                    className="flex flex-none flex-col gap-3 border-b border-editor-line px-4 py-4 last:border-b-0"
                  >
                    {group.title && (
                      <h2 className="text-[11px] font-semibold tracking-wide uppercase">
                        {group.title}
                      </h2>
                    )}
                    {group.rows.map((row, i) => (
                      <PanelRow key={`${row.kind}-${i}`} row={row} />
                    ))}
                  </section>
                ))}
              </div>
            </Panel>
          </div>
        </div>

        {/* The transport. Three columns rather than a flex row with a spacer, so
          it is centred on the row and not on what is left after the clock and
          the verbs have taken their share. */}
        <div className="grid flex-none grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-editor-line bg-editor-veil px-4 py-2">
          {/* The verbs for the selection, then the clock. Both act on what you
            have already picked, so they share a box; the two things that can be
            added sit at the far end of the row, because those act on the
            playhead instead. */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
              <span
                className={`grid h-7 w-7 place-items-center rounded-md [&_svg]:size-[15px] ${
                  selected ? "text-editor-muted" : "text-editor-muted/40"
                }`}
              >
                <ScissorsIcon />
              </span>
              <span
                className={`grid h-7 w-7 place-items-center rounded-md [&_svg]:size-[15px] ${
                  selected ? "text-editor-muted" : "text-editor-muted/40"
                }`}
              >
                <TrashIcon />
              </span>
              {/* Hidden until there is a step back, not disabled like the two
                beside it: those are always the verbs for the current selection,
                whereas undo is a claim that something happened. Last in the
                group, so appearing extends it away from the edge rather than
                moving the other two out from under the pointer. */}
              <span className="grid h-7 w-7 place-items-center rounded-md text-editor-muted [&_svg]:size-[15px]">
                <UndoIcon />
              </span>
            </div>

            {/* The clock and what it is counting towards, as one thing: a time
              and its total read as a single value, and spacing them like two
              controls is what made this look wrong. */}
            <div className="flex items-center gap-1 text-xs tabular-nums">
              {/* Rendered once. The frame loop rewrites its text, so React must
                not — the app's clock is a ref for the same reason. */}
              <span
                ref={clock}
                className="flex-none text-right text-editor-fg"
                style={{ width: "7ch" }}
              >
                0:00.00
              </span>
              <span className="text-editor-muted">/ {timecode(DURATION)}</span>
            </div>
          </div>
          <div className="flex items-center justify-center gap-1">
            <button
              type="button"
              title="Go to start"
              onClick={() => seek(0)}
              className="grid size-8 cursor-pointer place-items-center rounded-lg text-editor-fg hover:bg-white/10 [&_svg]:size-[15px]"
            >
              <SkipStartIcon />
            </button>
            {/* Round rather than the rounded square its neighbours are: it is
              pressed more than everything else in the row put together, and a
              shape of its own is what lets the pointer find it without reading
              it. Green to start and white to stop, so the button says what
              pressing it does rather than what is happening. */}
            {/* Green to start and white to stop, so the button says what pressing
              it does rather than what is currently happening — the icon inside it
              already says that, and a green button showing a pause bar would be
              two answers to one question. */}
            <button
              type="button"
              title={playing ? "Pause" : "Play"}
              onClick={toggle}
              className={`grid size-8 cursor-pointer place-items-center rounded-full transition-colors [&_svg]:size-[15px] ${
                playing ? "bg-white text-editor-bg" : "bg-play text-white"
              }`}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
              type="button"
              title="Go to end"
              onClick={() => seek(DURATION)}
              className="grid size-8 cursor-pointer place-items-center rounded-lg text-editor-fg hover:bg-white/10 [&_svg]:size-[15px]"
            >
              <SkipEndIcon />
            </button>
          </div>
          {/* The three things that can be added, in their own pill at the far
            end. They are also the ones with a word on them: a bare magnifier
            next to a pair of scissors reads as a search box. Add Clip carries a
            chevron because footage can come from the screen or from a file, and
            both arrive the same way — as another clip at the end. */}
          <div className="flex items-center justify-self-end gap-0.5 rounded-lg bg-white/5 p-0.5">
            <span className="hidden h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-editor-muted sm:flex [&_svg]:size-[15px]">
              <AddZoomIcon />
              Add Zoom
            </span>
            <span className="hidden h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-editor-muted sm:flex [&_svg]:size-[15px]">
              <AddTextIcon />
              Add Text
            </span>
            <span className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-editor-muted [&_svg]:size-[15px]">
              <AddRecordingIcon />
              Add Clip
              {/* Smaller and dimmer than the glyph on the other side: it says
                the button has more behind it, and it is not one of the two
                things being chosen between. */}
              <span className="text-editor-muted/60 [&_svg]:size-3">
                <ChevronUpIcon />
              </span>
            </span>
          </div>
        </div>

        {/* The strip. Padded to match the transport above it. */}
        <div className="flex flex-none flex-col bg-editor-veil px-4 pb-4">
          <div
            ref={strip}
            className="relative cursor-default"
            onPointerDown={scrub}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                seek(timeAt(event.clientX));
            }}
          >
            {/* The ruler. The marks sit in the lower part of the box; the space
              above them is the same control, just empty. */}
            <div className="relative h-9">
              <div className="absolute inset-x-0 bottom-0 h-6">
                {MARKS.map((mark) => (
                  <div
                    key={mark.at}
                    className="absolute inset-y-0"
                    style={{ left: `${(mark.at / DURATION) * 100}%` }}
                  >
                    {/* Hung from the top edge, so every tick starts on the same
                      line and the row reads as a scale rather than a row of
                      stubs. */}
                    <div
                      className={`absolute top-0 w-px ${
                        mark.major ? "h-2.5 bg-white/25" : "h-1.5 bg-white/12"
                      }`}
                    />
                    {mark.label && (
                      <span className="absolute bottom-0 left-1 text-[9px] leading-none tabular-nums text-editor-muted">
                        {mark.label}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="h-2.5" />

            {/* The text row, above the clips and empty, saying what it is for.
              A take with no titles on it still shows one: the row is where a
              title is drawn, and an invitation is the only way anybody finds
              out that the strip has a layer for words at all. Thinner than the
              clips and the zooms on purpose — a title is a line laid over the
              picture, where a zoom changes the picture itself. */}
            <div className="relative h-6">
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="flex items-center gap-1.5 rounded-md border border-dashed border-white/15 px-2.5 py-0.5 text-[10px] text-editor-muted [&_svg]:size-3">
                  <TextIcon />
                  Click or drag to add text
                </span>
              </span>
            </div>

            <div className="h-2.5" />

            {/* The cuts. `gap-px` is the app's, and the widths are shares of the
              take, so the row fills the strip exactly however it is resized. */}
            <div className="flex h-[42px] gap-px">
              {CLIPS.map((clip) => {
                const isSelected = selected === clip.id;
                return (
                  <div
                    key={clip.id}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      setSelected(clip.id);
                    }}
                    className={`group relative min-w-1 cursor-pointer overflow-hidden rounded-lg border outline-2 -outline-offset-2 transition-[background-color,border-color,outline-color] ${
                      isSelected
                        ? "border-slice-edge-active bg-slice-fill-active outline-slice-ring"
                        : "border-slice-edge bg-slice-fill outline-transparent hover:outline-slice-ring"
                    }`}
                    style={{ width: `${(clip.duration / DURATION) * 100}%` }}
                  >
                    {/* The waveform, at the app's height and opacity. */}
                    <svg
                      aria-hidden
                      viewBox="0 0 100 20"
                      preserveAspectRatio="none"
                      className="pointer-events-none absolute bottom-0 left-0 h-3/5 w-full text-wave opacity-40"
                    >
                      <path d={wave(clip.id)} fill="currentColor" />
                    </svg>
                    {/* Tinted off the clip rather than off the panel: the app's
                      `--editor-muted` is picked to sit on a near-black surface
                      and all but disappears on purple. */}
                    <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1.5 px-3.5 py-1 text-white/70">
                      <span className="flex flex-none items-center gap-1 [&_svg]:size-3">
                        <ScreenIcon />
                        {clip.camera && <CameraIcon />}
                      </span>
                      <span className="truncate text-[10px] leading-none tabular-nums">
                        {timecode(clip.duration)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="h-2.5" />

            {/* Zooms, on their own row and the same height as the clips: a row
              half the size reads as less important than the thing it is
              changing, which is backwards. */}
            <div className="relative h-[42px]">
              {ZOOMS.map((zoom) => {
                const isSelected = selected === zoom.id;
                return (
                  <div
                    key={zoom.id}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      setSelected(zoom.id);
                    }}
                    className={`group absolute inset-y-0 flex cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-zoom-edge px-3.5 outline-2 -outline-offset-2 transition-[background-color,outline-color] ${
                      isSelected
                        ? "bg-zoom-fill/45 outline-zoom-ring"
                        : "bg-zoom-fill/25 outline-transparent hover:outline-zoom-ring/40"
                    }`}
                    style={{
                      left: `${(zoom.at / DURATION) * 100}%`,
                      width: `${(zoom.length / DURATION) * 100}%`,
                    }}
                  >
                    {/* Truncated rather than wrapped: a short zoom is a few pixels
                      wide and its label has to degrade to nothing without
                      changing the row's height. */}
                    <span className="pointer-events-none flex min-w-0 items-center gap-1.5 text-[10px] text-white/85 [&_svg]:size-3 [&_svg]:flex-none">
                      <ZoomIcon />
                      <CursorIcon />
                      <span className="truncate tabular-nums">{zoom.level.toFixed(1)}×</span>
                    </span>
                  </div>
                );
              })}
            </div>

            {/* The playhead, with the time on it. In the app the playback loop
              rewrites this element's transform once per frame; here the pointer
              does, which is the same property for the same reason — `left` would
              lay the strip out again on every move. */}
            {/* The rail is the full width of the strip with the head on its left
              edge, so one `translateX(100%)` is exactly one strip width. On the
              2px line itself a percentage would resolve against those two
              pixels, and the playhead would travel the width of itself.

              `will-change` so the compositor gives it a layer up front rather
              than promoting it on the first move, which shows as a stutter right
              as playback starts — the app's note says the same. */}
            <div
              ref={rail}
              className="pointer-events-none absolute inset-y-0 left-0 z-10 w-full will-change-transform"
            >
              <div className="absolute inset-y-0 -ml-px w-0.5 bg-indicator-deep">
                <span className="absolute top-0 left-1/2 h-5 -translate-x-1/2 rounded-full bg-indicator-deep px-1.5 text-center text-[11px] leading-5 font-medium tabular-nums text-white">
                  {timecode(at)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* The clip under the playhead, named for a screen reader that has been
            handed a `role="img"` and cannot reach any of the above. */}
        <span className="sr-only">
          Playhead at {timecode(at)}, on clip {clipAt}
        </span>
      </div>
    </div>
  );
}

/**
 * One row of a panel, drawn as whatever control the app puts there.
 *
 * The four ordinary kinds come from `components/editor-controls.tsx`, which is
 * the one place the app's controls are redrawn. They used to be written out
 * here, and two of them had already drifted: the toggle had lost its well and
 * was a muted label beside a switch, and the colour field had lost its chevron
 * and set the hex in the body face. Neither was wrong on its own terms, which
 * is exactly the problem with a second copy.
 */
function PanelRow({ row }: { row: Row }) {
  if (row.kind === "slider") {
    return <Slider label={row.label} value={row.value} read={row.read} icon={<row.Icon />} />;
  }

  if (row.kind === "toggle") {
    return <ToggleField icon={<row.Icon />} label={row.label} on={row.on} />;
  }

  if (row.kind === "segmented") {
    return <Segmented options={row.options} at={row.at} />;
  }

  if (row.kind === "colour") {
    return <ColorField icon={<row.Icon />} hex={row.hex} />;
  }

  // Stops under a slider, so reaching for a common value is a click rather than
  // a drag landing near enough. Lit only on an exact match — a speed carried to
  // 0.73× is not "close to 0.5×", and a preset marked for it would say so.
  if (row.kind === "chips") {
    return (
      <div className="grid grid-cols-5 gap-1">
        {row.options.map((option, index) => (
          <span
            key={option}
            className={`rounded-full px-1 py-1.5 text-center text-[11px] tabular-nums ${
              index === row.at ? "bg-white/15 text-white" : "text-editor-muted"
            }`}
          >
            {option}
          </span>
        ))}
      </div>
    );
  }

  // A picker: `ScenePresetCard` on Presets, `LayoutPicker` on Layout. Both are
  // grids of pictures rather than lists of settings, which is why neither panel
  // carries a label over it — the grid is a control that shows what it is. It
  // stays here rather than moving to the shared file: nothing else draws one,
  // and a component used once is indirection.
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${row.columns}, 1fr)` }}>
      {row.items.map((item, index) => (
        <span
          key={item}
          className={`flex aspect-[4/3] flex-col justify-end rounded-md border p-1.5 text-[10px] leading-none ${
            index === row.at
              ? "border-selected bg-white/10 text-editor-fg"
              : "border-editor-line bg-white/5 text-editor-muted"
          }`}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

/**
 * A waveform for one clip.
 *
 * Drawn from the clip's id rather than from audio, and deterministic so the
 * server and the client agree — a random path here is a hydration mismatch on
 * every load. The app's `waveform.ts` builds the same shape out of decoded peaks.
 *
 * Curved rather than joined point to point. A polyline through forty-eight peaks
 * puts a hard vertex on every one of them, and at this height they read as a comb
 * of spikes instead of a level that rises and falls. Each segment is a quadratic
 * through the midpoint between two peaks, with the peaks themselves as the
 * control points — the standard way to round a series without moving it, and it
 * keeps the curve inside the envelope rather than overshooting past it the way a
 * cubic fitted to the points would.
 */
function wave(seed: string) {
  let n = seed.charCodeAt(0) * 7919;
  const next = () => {
    n = (n * 1103515245 + 12345) % 2147483648;
    return n / 2147483648;
  };

  const points = Array.from({ length: 48 }, (_, i) => {
    // Two frequencies plus a little noise, so it reads as speech rather than as
    // a sine — a level that never returns to near-zero looks like tone.
    const envelope = 0.35 + 0.4 * Math.abs(Math.sin(i * 0.41)) + 0.25 * next();
    return { x: (i / 47) * 100, y: 20 - Math.min(envelope, 1) * 20 };
  });

  const first = points[0] ?? { x: 0, y: 20 };
  let d = `M0,20 L${first.x},${first.y}`;

  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const point = points[i];
    if (!previous || !point) continue;
    // The curve passes through each midpoint and only bends towards the peak, so
    // the ends of the run stay where the data put them.
    const midX = (previous.x + point.x) / 2;
    const midY = (previous.y + point.y) / 2;
    d += ` Q${previous.x},${previous.y} ${midX},${midY}`;
  }

  const last = points[points.length - 1] ?? first;
  return `${d} L${last.x},${last.y} L100,20 Z`;
}
