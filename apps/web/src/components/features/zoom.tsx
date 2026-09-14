import {
  CLIP_H,
  Clip,
  ClipLabel,
  Field,
  Filmstrip,
  Group,
  PanelHeader,
  Playhead,
  Segmented,
  Slider,
  Strip,
  TRACK_GAP,
  Wave,
  ZoomBar,
} from "@/components/editor-controls";
import { Bubble, Chip, Frame, Pointer, Screen, Slab } from "@/components/features/frame";
import { Lane, VOICE } from "@/components/features/tracks";
import {
  BlurIcon,
  CameraIcon,
  PerspectiveIcon,
  ScreenIcon,
  SizeIcon,
  SmoothingIcon,
  ZoomIcon,
} from "@/components/landing/editor-icons";
import { LAYOUT_SCREEN } from "@/components/landing/stage";

/**
 * The pictures on the Zoom and pan cards: where the zooms come from, and what
 * one of them can be told to do.
 */

/**
 * Clicks and typing, becoming zoom slices.
 *
 * The marks and the bars come off one array, so a bar cannot drift out of
 * alignment with the cluster it is supposed to have come from — which is the
 * whole claim of the section and the one thing a reader would notice.
 *
 * Both rows are the app's: the clip row above, the zoom row below at the same
 * height, `TRACK_GAP` between them. A zoom row half the size reads as less
 * important than the thing it is changing, which is backwards.
 */
const SHOTS = [
  { marks: [0.05, 0.08, 0.12], from: 0.02, to: 0.16 },
  { marks: [0.27, 0.3], from: 0.25, to: 0.35 },
  { marks: [0.48, 0.51, 0.54, 0.57], from: 0.46, to: 0.61 },
  { marks: [0.75, 0.8], from: 0.73, to: 0.87 },
];

export function ZoomPass() {
  return (
    <Frame stage="sequoia">
      <Slab className="inset-x-4 top-5 -bottom-6">
        <Strip>
          <div className="pt-4">
            <Lane label="You did">
              <div className="relative flex" style={{ height: CLIP_H }}>
                <Clip width={1}>
                  <Filmstrip src={LAYOUT_SCREEN} />
                  <Wave peaks={VOICE} />
                  <ClipLabel
                    icons={
                      <>
                        <ScreenIcon />
                        <CameraIcon />
                      </>
                    }
                    read="0:30"
                  />
                  {/* Where the pointer went down, and where a burst of typing
                      landed. `--slice-ring` is the clip's own light, so these
                      read as marks on the recording rather than a fifth colour.
                      On the clip's middle band: the label owns the top and
                      the wave the bottom three fifths. */}
                  {SHOTS.flatMap((shot) =>
                    shot.marks.map((at) => (
                      <span
                        key={at}
                        className="absolute top-[38%] size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slice-ring"
                        style={{ left: `${at * 100}%` }}
                      />
                    )),
                  )}
                </Clip>
              </div>
            </Lane>
            <div style={{ height: TRACK_GAP }} />
            <Lane label="Prequel made">
              <div className="relative" style={{ height: CLIP_H }}>
                {SHOTS.map((shot, i) => (
                  <ZoomBar
                    key={shot.from}
                    left={shot.from}
                    width={shot.to - shot.from}
                    // One of them held, because a row where nothing is selected
                    // never shows the ring or the grips, and those are half of
                    // what a zoom bar looks like.
                    selected={i === 2}
                  />
                ))}
                <Playhead at={0.52} read="0:15" />
              </div>
            </Lane>
          </div>
        </Strip>
      </Slab>
    </Frame>
  );
}

/**
 * A zoom held by its end, mid-retime.
 *
 * The hand is on the trailing grip, which is the one thing about a generated
 * zoom that a picture of it sitting still cannot say: it can be taken hold of.
 */
export function EditableZoom() {
  return (
    <Frame stage="facet">
      <Slab className="inset-x-4 top-8 -bottom-6">
        <Strip>
          <div className="relative pt-4">
            <div className="flex" style={{ height: CLIP_H }}>
              <Clip width={1}>
                <Filmstrip src={LAYOUT_SCREEN} cells={10} />
              </Clip>
            </div>
            <div className="relative" style={{ height: CLIP_H, marginTop: TRACK_GAP }}>
              <ZoomBar left={0.06} width={0.22} />
              <ZoomBar left={0.38} width={0.34} selected />
              <ZoomBar left={0.82} width={0.14} />
            </div>
            <Playhead at={0.55} read="0:12" />
          </div>
        </Strip>
      </Slab>
      <Pointer art="hand" className="right-[22%] bottom-1 w-8" />
    </Frame>
  );
}

/**
 * A zoom row topped up: the two that were there, and the two that filled the
 * gaps.
 *
 * The new ones are drawn dashed. The app draws them solid the moment they
 * land, but a row of four identical bars says nothing about which two were
 * just added, and that is the whole of what the card claims.
 */
export function TopUp() {
  return (
    <Frame stage="peony">
      <Slab className="inset-x-4 top-8 -bottom-6">
        <Strip>
          <div className="relative pt-4">
            <div className="flex" style={{ height: CLIP_H }}>
              <Clip width={1}>
                <Filmstrip src={LAYOUT_SCREEN} cells={10} />
              </Clip>
            </div>
            <div className="relative" style={{ height: CLIP_H, marginTop: TRACK_GAP }}>
              <ZoomBar left={0.03} width={0.2} />
              <ZoomBar left={0.6} width={0.16} />
              <div className="absolute inset-0 [&>div]:border-dashed">
                <ZoomBar left={0.27} width={0.29} />
                <ZoomBar left={0.8} width={0.17} />
              </div>
            </div>
          </div>
        </Strip>
      </Slab>
      <Chip className="top-3 right-4">
        <ZoomIcon />
        Add zooms
      </Chip>
    </Frame>
  );
}

/**
 * What a zoom can follow, and the region one of them holds.
 *
 * The rectangle on the screen is drawn in the zoom row's own edge colour, so
 * the box on the picture and the bar on the timeline read as one object.
 */
export function ZoomTargets() {
  return (
    <Frame stage="sequoia">
      <Screen className="-right-8 -bottom-8 top-9 left-8" />
      <div className="absolute top-[44%] right-[18%] bottom-[10%] left-[40%] rounded border-2 border-[#f0d06f] bg-[#f0d06f]/10">
        {["-top-1 -left-1", "-top-1 -right-1", "-bottom-1 -left-1", "-bottom-1 -right-1"].map(
          (corner) => (
            <span key={corner} className={`absolute size-2 rounded-[2px] bg-[#f0d06f] ${corner}`} />
          ),
        )}
      </div>
      <Slab className="top-3 left-3 w-52" inner="p-1">
        <Segmented options={["Cursor", "Region", "Typing"]} at={1} />
      </Slab>
    </Frame>
  );
}

/**
 * The zoom's motion panel: level, speed, and the ease as a curve.
 *
 * The pad is the app's `EasingPad`: the curve is a cubic bézier from the
 * bottom left to the top right and the two handles are its control points,
 * drawn at the `DEFAULT_ZOOM` figures so the curve on the page is the motion
 * that ships.
 */
export function ZoomCurve() {
  // A third and two thirds, which is the `smoothstep` every zoom moved on
  // before the pad existed and is still what a fresh one gets.
  const p1 = { x: 1 / 3, y: 0 };
  const p2 = { x: 2 / 3, y: 1 };
  const px = (v: number) => (v * 100).toFixed(1);
  const py = (v: number) => ((1 - v) * 100).toFixed(1);

  return (
    <Frame stage="facet" fill>
      <Slab className="inset-x-5 top-6 -bottom-4">
        <PanelHeader icon={<ZoomIcon />} title="Zoom" />
        <Group>
          <Slider icon={<ZoomIcon />} label="Level" read="2.0×" value={0.4} />
          <Slider icon={<SmoothingIcon />} label="Speed" read="60%" value={0.6} />
        </Group>
        <Group>
          <Field label="Ease" icon={<SmoothingIcon />}>
            <div className="relative aspect-square w-full overflow-hidden rounded-md bg-white/5">
              <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" aria-hidden>
                <path
                  d="M0 100 L100 0"
                  stroke="rgb(255 255 255 / 0.12)"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <path
                  d={`M0 100 L${px(p1.x)} ${py(p1.y)}`}
                  stroke="rgb(255 255 255 / 0.35)"
                  strokeWidth="1"
                />
                <path
                  d={`M100 0 L${px(p2.x)} ${py(p2.y)}`}
                  stroke="rgb(255 255 255 / 0.35)"
                  strokeWidth="1"
                />
                <path
                  d={`M0 100 C${px(p1.x)} ${py(p1.y)} ${px(p2.x)} ${py(p2.y)} 100 0`}
                  fill="none"
                  stroke="#4296fc"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <circle cx={px(p1.x)} cy={py(p1.y)} r="4" fill="#fff" />
                <circle cx={px(p2.x)} cy={py(p2.y)} r="4" fill="#fff" />
              </svg>
            </div>
          </Field>
        </Group>
      </Slab>
    </Frame>
  );
}

/**
 * The push in, tilted, with the focus falling away from the pointer.
 *
 * Two copies of the recording: a blurred one underneath and a sharp one over
 * it under a radial mask, so the sharp disc sits where the pointer was and
 * everything else softens. A `blur()` on one element would soften its edges
 * into the wallpaper as well, and the recording has to keep a hard edge.
 *
 * The tilt is a real `perspective()` transform at the panel's readings, and
 * the bubble tilts with it, because in the app it is the composition that
 * turns and the camera is part of it.
 */
export function TiltAndFocus() {
  const pushed = {
    backgroundImage: `url(${LAYOUT_SCREEN})`,
    backgroundSize: "180%",
    backgroundPosition: "62% 38%",
  };

  return (
    <Frame stage="peony">
      <div
        className="absolute top-6 -bottom-6 left-6 w-[54%] lg:left-10"
        style={{ transform: "perspective(900px) rotateX(8deg) rotateY(-10deg)" }}
      >
        <div className="absolute inset-0 overflow-hidden rounded-lg shadow-[0_18px_40px_-14px_rgb(0_0_0_/_0.6)] ring-1 ring-black/20">
          <div className="absolute inset-0 scale-110 bg-no-repeat blur-[4px]" style={pushed} />
          <div
            className="absolute inset-0 bg-no-repeat"
            style={{
              ...pushed,
              maskImage:
                "radial-gradient(circle at 62% 38%, #000 16%, rgb(0 0 0 / 0.3) 36%, transparent 52%)",
            }}
          />
        </div>
        <Bubble className="right-3 bottom-3 size-12" />
      </div>
      {/* No header, and three rows: the frame is 160px and a header with four
          sliders under it runs off the bottom before the focus rows, which are
          half of what the card is about. */}
      <Slab className="top-4 right-4 -bottom-6 w-52 lg:w-60">
        <Group>
          <Slider icon={<PerspectiveIcon />} label="Tilt" read="8°" value={0.3} />
          <Slider icon={<PerspectiveIcon />} label="Yaw" read="-10°" value={0.3} />
          <Slider icon={<BlurIcon />} label="Blur around" read="60%" value={0.6} />
          <Slider icon={<SizeIcon />} label="Sharp area" read="35%" value={0.35} levels={4} />
        </Group>
      </Slab>
    </Frame>
  );
}
