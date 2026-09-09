"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AngleIcon,
  AudioIcon,
  BackdropIcon,
  BlurIcon,
  BorderIcon,
  CameraIcon,
  CaptionsIcon,
  ClockIcon,
  CornerRadiusIcon,
  CursorIcon,
  LayoutIcon,
  LinesIcon,
  OffsetIcon,
  OpacityIcon,
  PaddingIcon,
  PauseIcon,
  PlayIcon,
  PresetsIcon,
  ScissorsIcon,
  ScreenIcon,
  ShadowIcon,
  ShadowOffsetIcon,
  SizeIcon,
  SkipEndIcon,
  SkipStartIcon,
  SmoothingIcon,
  SpeakerIcon,
  TrashIcon,
  WatermarkIcon,
  ZoomIcon,
  ZoomInIcon,
} from "@/components/landing/editor-icons";
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
const TAKE = "/editor-take.mp4";
/** Its first frame, so the panel opens on the composition rather than on black. */
const POSTER = "/editor-take-poster.jpg";

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
const CAMERA = "/camera-take.mp4";

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
const BACKDROP = "/editor-backdrop.jpg";

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

/** The zoom pass, in seconds from the start of the take. */
const PANEL_ZOOM = { id: "z2", at: 11, length: 4.4, level: 1.8, target: "typing" as const };
const ZOOMS = [
  { id: "z1", at: 1.5, length: 5.2, level: 2.4, target: "cursor" as const },
  PANEL_ZOOM,
  { id: "z3", at: 19.5, length: 6.2, level: 3.1, target: "cursor" as const },
];

/**
 * The dock's nine destinations and what each one puts in the panel.
 *
 * `CATEGORIES` in `Inspector.tsx`, in its order and with its labels — including
 * "Logo" for the `watermark` id, which is the one place the two differ. The app
 * hides Camera, Audio, Cursor and Captions when a recording has no camera, no
 * audio, no cursor track or no transcript; this is a take that has all four.
 *
 * The rows are the controls those panels actually carry, in the order they carry
 * them, each slider with the glyph the app puts beside it — read off
 * `Inspector.tsx` rather than invented, because a panel of plausible-looking
 * settings is a picture of a different app. Two of them are not lists of settings
 * at all: Presets is a grid of saved looks and Layout is a grid of arrangements,
 * so they are drawn as grids.
 *
 * What is a fixture here is the *values*. A real panel reads those off the
 * selected clip's settings, and this has no clip.
 */
type Row =
  | { kind: "slider"; label: string; value: number; read: string; Icon: () => React.ReactElement }
  | { kind: "toggle"; label: string; on: boolean }
  | { kind: "segmented"; options: string[]; at: number }
  | { kind: "colour"; label: string; hex: string; Icon: () => React.ReactElement }
  | { kind: "grid"; columns: number; items: string[]; at: number };

const PRESETS_TAB = {
  id: "presets",
  label: "Presets",
  Icon: PresetsIcon,
  rows: [
    { kind: "grid", columns: 2, items: ["Studio", "Keynote", "Plain", "Save this look"], at: 0 },
  ] satisfies Row[],
};

const CATEGORIES: { id: string; label: string; Icon: () => React.ReactElement; rows: Row[] }[] = [
  PRESETS_TAB,
  {
    id: "layout",
    label: "Layout",
    Icon: LayoutIcon,
    // `LayoutPicker`, which is the whole panel: no label over it, because a grid
    // of arrangements is a control that shows what it is.
    rows: [
      {
        kind: "grid",
        columns: 3,
        items: ["Full", "Corner", "Beside", "Under", "Split", "Screen only"],
        at: 1,
      },
    ],
  },
  {
    id: "background",
    label: "Background",
    Icon: BackdropIcon,
    rows: [
      { kind: "segmented", options: ["Image", "Colour", "None"], at: 0 },
      { kind: "slider", label: "Blur", value: 0.36, read: "24", Icon: BlurIcon },
      { kind: "slider", label: "Angle", value: 0.5, read: "0°", Icon: AngleIcon },
    ],
  },
  {
    id: "recording",
    label: "Recording",
    Icon: ScreenIcon,
    rows: [
      { kind: "slider", label: "Padding", value: 0.4, read: "12%", Icon: PaddingIcon },
      { kind: "slider", label: "Corner radius", value: 0.28, read: "18", Icon: CornerRadiusIcon },
      { kind: "slider", label: "Width", value: 0.14, read: "1", Icon: BorderIcon },
      { kind: "colour", label: "Colour", hex: "#2A2D33", Icon: OpacityIcon },
      { kind: "slider", label: "Opacity", value: 0.55, read: "55%", Icon: ShadowIcon },
      { kind: "slider", label: "Blur", value: 0.42, read: "32", Icon: BlurIcon },
      { kind: "slider", label: "Offset", value: 0.33, read: "12", Icon: ShadowOffsetIcon },
    ],
  },
  {
    id: "camera",
    label: "Camera",
    Icon: CameraIcon,
    rows: [
      { kind: "toggle", label: "Camera", on: true },
      { kind: "segmented", options: ["Circle", "Squircle", "Rectangle"], at: 0 },
      { kind: "slider", label: "Roundness", value: 0.9, read: "90%", Icon: CornerRadiusIcon },
      { kind: "slider", label: "Size", value: 0.34, read: "18%", Icon: SizeIcon },
      { kind: "slider", label: "Zoom", value: 0.2, read: "1.2×", Icon: ZoomIcon },
      { kind: "toggle", label: "Mirror", on: true },
      { kind: "toggle", label: "Shrink on zoom", on: false },
      { kind: "slider", label: "Size while zoomed", value: 0.5, read: "12%", Icon: ZoomInIcon },
    ],
  },
  {
    id: "audio",
    label: "Audio",
    Icon: AudioIcon,
    rows: [
      { kind: "toggle", label: "Include", on: true },
      { kind: "slider", label: "Volume", value: 0.8, read: "80%", Icon: SpeakerIcon },
    ],
  },
  {
    id: "cursor",
    label: "Cursor",
    Icon: CursorIcon,
    rows: [
      { kind: "toggle", label: "Pointer", on: true },
      { kind: "slider", label: "Size", value: 0.52, read: "1.3×", Icon: SizeIcon },
      { kind: "slider", label: "Smoothing", value: 0.66, read: "66%", Icon: SmoothingIcon },
      { kind: "slider", label: "Motion blur", value: 0.24, read: "24%", Icon: BlurIcon },
      { kind: "toggle", label: "Hide while typing", on: true },
      { kind: "toggle", label: "Hide when still", on: false },
      { kind: "slider", label: "After", value: 0.35, read: "1.2s", Icon: ClockIcon },
    ],
  },
  {
    id: "captions",
    label: "Captions",
    Icon: CaptionsIcon,
    rows: [
      { kind: "toggle", label: "Show captions", on: true },
      { kind: "slider", label: "Size", value: 0.48, read: "42", Icon: SizeIcon },
      { kind: "slider", label: "Distance from edge", value: 0.2, read: "6%", Icon: OffsetIcon },
      { kind: "slider", label: "Lines", value: 0.5, read: "2", Icon: LinesIcon },
      { kind: "colour", label: "Spoken word", hex: "#FFD60A", Icon: OpacityIcon },
    ],
  },
  {
    id: "watermark",
    label: "Logo",
    Icon: WatermarkIcon,
    rows: [
      { kind: "slider", label: "Size", value: 0.26, read: "8%", Icon: SizeIcon },
      { kind: "slider", label: "Opacity", value: 0.6, read: "60%", Icon: OpacityIcon },
    ],
  },
];

const FIRST_TAB = PRESETS_TAB;

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
  const strip = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
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
   * Starts the take on its own.
   *
   * Muted, which is what browsers require of a video that plays without being
   * asked — and correct anyway: a page that makes noise on open is a page people
   * close. `play()` returns a promise that rejects when the browser refuses
   * regardless, iOS in Low Power Mode being the common one, so the rejection is
   * swallowed and the poster stays up with the transport waiting to be pressed.
   *
   * Not under `prefers-reduced-motion`. The site stops the wash, the demos and
   * the hero's entrance outright under that setting rather than slowing them
   * down, and thirty seconds of moving picture is a stronger claim on the eye
   * than any of them. The first frame is still there, and so is the play button.
   */
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    void element.play().catch(() => {
      // Refused. The poster and the transport are the fallback.
    });
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
      className="squircle relative isolate overflow-hidden rounded-3xl bg-cover bg-center p-4 sm:p-9 lg:p-16"
      style={{ backgroundImage: `url(${BACKDROP})` }}
    >
      {/* `select-none` because every pointer gesture in here is a drag, and a
          scrub that highlights the timecode as it goes reads as a broken text
          field. The shadow is what lifts the window off the wallpaper — without
          it the two are one flat picture and the inset reads as a mistake. */}
      <div
        className="editor-theme squircle relative flex select-none flex-col overflow-hidden rounded-2xl bg-editor-bg text-editor-fg shadow-[0_24px_60px_-20px_rgb(0_0_0_/_0.55)] ring-1 ring-black/20"
        role="img"
        aria-label="The Prequel editor: a recording on the timeline with three zooms over it"
      >
        {/* The window's title bar. `pl-20` in the app is the room the traffic
          lights need; the dots are drawn here because without them the bar reads
          as a web toolbar rather than as a macOS window. */}
        <header className="flex h-[38px] flex-none items-center gap-1.5 border-b border-editor-line bg-editor-veil pr-3 pl-4">
          <span aria-hidden className="mr-2 flex flex-none items-center gap-2">
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
          </span>
          <span className="flex flex-none items-center gap-1.5 rounded-lg px-1.5 py-1 text-[13px] text-editor-muted">
            Projects
          </span>
          <span aria-hidden className="flex-none text-[13px] text-editor-muted/50">
            /
          </span>
          <span className="flex-1 truncate pr-1.5 text-[13px] font-medium">
            Onboarding walkthrough
          </span>
          <span className="flex-none rounded-lg bg-white/10 px-2.5 py-1 text-[12px] font-medium">
            Export
          </span>
        </header>

        {/* The board: the dots and the fill are on the row, so the surface runs
          under the inspector as well as under the composition — one board with
          panels on it rather than a patterned area and a plain one meeting at a
          seam. */}
        {/* `min-h` because the dock is nine buttons tall — 2.25rem each plus the
          gaps, its padding, its border and its margin — and the board's own
          height comes from the composition, which is shorter than that at
          narrow widths. Without it the last categories fall past the panel and
          the shell's `overflow-hidden` cuts them off. */}
        <div className="dot-grid flex min-h-[25rem] flex-1 bg-editor-scrim">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* The frame bar, which shares its surface with the composition so it
              reads as part of the canvas rather than as chrome above it. */}
            <div className="relative flex flex-none items-center justify-center gap-3 px-4 py-2">
              <span className="text-[11px] tracking-wide text-editor-muted uppercase">Frame</span>
              <span className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs">
                Landscape
                <span className="tabular-nums text-editor-muted">16:9</span>
              </span>
              <span className="flex items-center gap-1.5 text-xs tabular-nums">
                1920
                <span className="text-editor-muted">×</span>
                1080
              </span>
            </div>

            {/* The composition, which is a finished export playing. Nothing is
              drawn over it: the background, the rounded screen, the camera and
              the zoom pass are all in the file, because the file came out of the
              app. `loop` because it is a picture of the editor rather than
              something to watch to the end — it should be moving whenever anyone
              looks at it, and a still panel halfway down a page reads as broken.
              `playsInline` so iOS does not take it fullscreen. */}
            <div className="flex min-h-0 flex-1 items-center justify-center px-6 pb-4">
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
                  preload="auto"
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

                Its own `loop` and `autoPlay`: it is a face, not a take, and it
                has nothing to stay in step with — the transport drives the
                composition, and a camera that stopped when the take was paused
                would read as a frozen video call rather than as a layer. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute right-[4%] bottom-[4%] w-[20%] [filter:drop-shadow(0_5px_10px_rgb(0_0_0_/_0.55))]"
                >
                  <video
                    src={CAMERA}
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="auto"
                    className="block w-full"
                    style={{ clipPath: `url(#${SQUIRCLE_ID})` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* The dock and the panel, which the app counts as one thing — see
            `PANEL_WIDTH`. The dock is what chooses the section, and it floats on
            the board rather than sitting inside the panel. */}
          {/* Both are fixed, and deliberately. The timeline is the one thing here
            worth handing a visitor, because scrubbing is what shows that the
            picture and the strip are the same edit. A rail that swapped nine
            panels of settings is a toy: it invites somebody to hunt for the
            control that does something and find that none of them do. So this
            shows one panel as a picture of the app, and the whole column is inert
            — `pointer-events-none` rather than disabled controls, so nothing
            offers a cursor or a hover it cannot honour. */}
          <div className="pointer-events-none hidden flex-none select-none lg:flex">
            <Rail value={tab} />
            {/* The panel: `bg-editor-veil`, the timeline's surface rather than
              `--editor-panel`, so the two meet as one continuous chrome down the
              right and along the bottom instead of as two greys. A left border
              and no shadow — the only edge that exists is the one facing the
              composition. */}
            <div className="flex w-64 flex-none overflow-hidden border-l border-editor-line bg-editor-veil">
              {/* `Section` in the app: one group of fields, `gap-3`, with the
                panel's own padding. No heading — the dock already says which one
                is showing, and repeating it here was the word twice in two type
                sizes. */}
              <div className="flex flex-1 flex-col gap-3 overflow-y-auto border-b border-editor-line px-4 py-4">
                {(CATEGORIES.find((t) => t.id === tab) ?? FIRST_TAB).rows.map((row, i) => (
                  <PanelRow key={`${row.kind}-${i}`} row={row} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* The transport. Three columns rather than a flex row with a spacer, so
          it is centred on the row and not on what is left after the clock and
          the verbs have taken their share. */}
        <div className="grid flex-none grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-editor-line bg-editor-veil px-4 py-2">
          <div className="flex items-center gap-1 text-xs tabular-nums">
            {/* Rendered once. The frame loop rewrites its text, so React must not
              — the app's clock is a ref for the same reason. */}
            <span
              ref={clock}
              className="flex-none text-right text-editor-fg"
              style={{ width: "7ch" }}
            >
              0:00.00
            </span>
            <span className="text-editor-muted">/ {timecode(DURATION)}</span>
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
          <div className="flex items-center justify-self-end gap-0.5 rounded-lg bg-white/5 p-0.5">
            <span className="grid size-7 place-items-center rounded-md text-editor-muted [&_svg]:size-[15px]">
              <ScissorsIcon />
            </span>
            <span
              className={`grid size-7 place-items-center rounded-md [&_svg]:size-[15px] ${
                selected ? "text-editor-muted" : "text-editor-muted/40"
              }`}
            >
              <TrashIcon />
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
 * A slider, copied from `editor/controls/inputs.tsx`.
 *
 * The label and the reading sit *inside* the bar rather than above and beside
 * it, which is the thing the panel is a list of: a stack of bars, not a repeated
 * label / track / number. The icon stands outside the track — inside it would
 * slide under the fill and change contrast as the value moved.
 *
 * `value` is the fill as a fraction here, where the app takes a real number with
 * a min and a max and computes it. This is a picture, so the fraction is the
 * only part of that which shows.
 */
function Slider({
  label,
  value,
  read,
  icon,
}: {
  label: string;
  value: number;
  read: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex-none text-editor-muted [&_svg]:size-4" aria-hidden>
        {icon}
      </span>

      <div className="group relative h-7 flex-1 overflow-hidden rounded-md bg-white/5">
        {/* A floor on the width, so the fill keeps its rounded end at zero
            instead of collapsing into a sliver against the left edge. */}
        <div
          className="absolute inset-y-0 left-0 rounded-md bg-white/12 transition-[width] duration-75"
          style={{ width: `max(0.75rem, ${value * 100}%)` }}
        >
          {/* Inside the fill, at its leading edge: on a bar this plain it is the
              only part that says it can be dragged. Green on hover — the grip is
              the thing being reached for, so it is the thing that answers. */}
          <span className="absolute top-1/2 right-1.5 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-white transition-colors group-hover:bg-toggle" />
        </div>

        {/* Over the fill and under the input, so the words never eat a drag. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-between gap-2 px-2.5 text-[11px]">
          <span className="truncate text-white">{label}</span>
          <span className="flex-none tabular-nums text-white/70">{read}</span>
        </div>
      </div>
    </div>
  );
}

/** One row of a panel, drawn as whatever control the app puts there. */
function PanelRow({ row }: { row: Row }) {
  if (row.kind === "slider") {
    return <Slider label={row.label} value={row.value} read={row.read} icon={<row.Icon />} />;
  }

  if (row.kind === "toggle") {
    // `ToggleField`: the label and the switch on one line, the switch pinned
    // right. The track is `--toggle` green when on and `bg-white/15` when off,
    // with the knob moved by `left` rather than a transform — the app's own.
    return (
      <div className="flex items-center gap-1.5">
        <span className="flex-1 text-[11px] text-editor-muted">{row.label}</span>
        <span
          className={`relative block h-[18px] w-8 flex-none rounded-md transition-colors ${
            row.on ? "bg-toggle" : "bg-white/15"
          }`}
          aria-hidden
        >
          <span
            className={`absolute top-0.5 size-3.5 rounded bg-white transition-[left] ${
              row.on ? "left-4" : "left-0.5"
            }`}
          />
        </span>
      </div>
    );
  }

  if (row.kind === "segmented") {
    // The marked option carries a pill rather than a background of its own, the
    // same two-pill construction the dock uses. A slot is one option plus the
    // 2px beside it, so a whole number of slots lands the pill on an option
    // rather than drifting a gap further along at every step.
    const slot = `calc((100% - 0.25rem - ${row.options.length - 1} * 0.125rem) / ${row.options.length})`;
    return (
      <div className="relative flex gap-0.5 rounded-lg bg-white/5 p-0.5" role="radiogroup">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-md bg-white/12"
          style={{ width: slot, transform: `translateX(calc(${row.at} * (100% + 0.125rem)))` }}
        />
        {row.options.map((option, index) => (
          <span
            key={option}
            className={`relative z-10 flex h-7 flex-1 items-center justify-center gap-1 rounded-md px-2 text-[11px] whitespace-nowrap ${
              index === row.at ? "font-medium text-editor-fg" : "text-editor-muted"
            }`}
          >
            {option}
          </span>
        ))}
      </div>
    );
  }

  if (row.kind === "colour") {
    // `ColorField`: a swatch, a divider and the hex, with the glyph outside the
    // well as it is on a slider. No word in the well — the icon and the group
    // above carry what it is for.
    return (
      <div className="flex items-center gap-2">
        <span className="flex-none text-editor-muted [&_svg]:size-4" aria-hidden>
          <row.Icon />
        </span>
        <div className="flex h-7 flex-1 items-center gap-2 rounded-md bg-white/5 px-1.5">
          <span
            className="size-4 flex-none rounded"
            style={{ backgroundColor: row.hex }}
            aria-label={row.label}
          />
          <span className="h-4 w-px flex-none bg-white/10" />
          <span className="text-[11px] tabular-nums text-white/70">{row.hex}</span>
        </div>
      </div>
    );
  }

  // A picker: `ScenePresetCard` on Presets, `LayoutPicker` on Layout. Both are
  // grids of pictures rather than lists of settings, which is why neither panel
  // carries a label over it — the grid is a control that shows what it is.
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
 * The dock beside the panel, copied from `Inspector.tsx`'s `Rail`.
 *
 * A raised surface floating over the board rather than icons lying on it:
 * `self-start` keeps it the height of its own buttons, which is what makes it
 * read as an object placed on the composition. `editor-panel` is the app's own
 * floating-surface colour, a shade lighter than the panel beside it — that is
 * the difference between the two: the panel is part of the window, the dock sits
 * on top of it.
 *
 * The blue pill marks the category showing. In the app there is a second, white
 * one that follows the pointer, and a press slides the blue one over to meet it;
 * here neither moves, because nothing on this side is pressable — see the note
 * where it renders. What is left is the mark parked on the choice, which is what
 * the dock looks like when nobody is touching it.
 */
function Rail({ value }: { value: string }) {
  const at = Math.max(
    0,
    CATEGORIES.findIndex((item) => item.id === value),
  );

  // One step down the rail: a button (`size-9`) and the gap under it (`gap-1`).
  const step = (index: number) => ({ transform: `translateY(calc(${index} * 2.5rem))` });
  const pill = "pointer-events-none absolute top-1.5 left-1.5 size-9 rounded";

  return (
    // Margin outside, padding in. Without the margin the dock's own corners meet
    // the panel's edge and the top of the row, which is the one thing a floating
    // object must not do.
    <div
      aria-hidden
      className="relative my-2 mr-2 flex flex-none flex-col gap-1 self-start rounded-[10px] border border-editor-line bg-editor-panel p-1.5 shadow-[0_1px_6px_rgba(0,0,0,0.3)]"
    >
      <span className={`${pill} bg-selected`} style={step(at)} />

      {CATEGORIES.map(({ id, label, Icon }) => (
        <span
          key={id}
          title={label}
          // White whether or not it is the one showing: with no surface behind
          // the rail there is nothing for a muted colour to read against, and a
          // dimmed icon on the editor's own background looks disabled rather
          // than merely unselected.
          className="relative z-10 grid size-9 place-items-center rounded text-white [&_svg]:size-[18px]"
        >
          <Icon />
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
