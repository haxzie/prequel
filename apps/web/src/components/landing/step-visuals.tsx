import {
  CLIP_H,
  Clip,
  EditorSurface,
  Filmstrip,
  Playhead,
  Strip,
  TRACK_GAP,
  ZoomBar,
} from "@/components/editor-controls";

import {
  CAMERA_STILL,
  CAPTIONS_SCREEN,
  CAPTIONS_STAGE,
  LAYOUT_SCREEN,
  LAYOUT_STAGE,
  ZOOM_STAGE,
} from "@/components/landing/stage";

/**
 * The picture over each of the three steps.
 *
 * Each one is a corner of the app rather than a whole window. At 160px tall a
 * complete editor is a grey rectangle with detail nobody can resolve, where a
 * crop of the part the step is about reads at a glance: the camera bubble, the
 * zoom slices, the transport. The app does the same thing to a recording, which
 * is the argument the page is making anyway.
 *
 * All three stand on a wallpaper, and on a different one each, for the reason
 * `stage.ts` gives about the demos below: three pictures on the same ground read
 * as one recording shown three times, and the background is a choice from a
 * catalogue that says so without a word of copy.
 *
 * `aria-hidden` throughout. The step's own title and sentence carry the meaning,
 * and a screen reader that is read three descriptions of a drawn corner of an
 * interface has been given noise in place of the two lines beside it.
 */

/** The frame each picture is cropped to. Tall enough for the timeline's two rows. */
// `bg-center`, not `bg-centre`. The comments and copy in this repo are British
// and the hand carries it into class names, where Tailwind has no such utility
// and the wallpaper silently anchors top left instead.
const FRAME = "relative h-40 overflow-hidden bg-cover bg-center";

/**
 * Step one: the bottom left of a recording, with the camera in focus.
 *
 * The screen bleeds out of the top and right edges rather than sitting inside
 * them, which is what makes this read as a corner of something bigger instead of
 * a small picture of a whole one. The blur on it is a hair over a pixel: enough
 * that the eye lands on the face first, not enough to look like a mistake, and
 * it is the same falloff the zoom applies in the product.
 */
export function CaptureStep() {
  return (
    <div className={FRAME} style={{ backgroundImage: `url(${ZOOM_STAGE})` }} aria-hidden>
      <div
        className="absolute -top-10 -right-14 bottom-8 left-7 rounded-xl bg-cover bg-center blur-[1.5px] ring-1 ring-black/10"
        style={{
          backgroundImage: `url(${LAYOUT_SCREEN})`,
          boxShadow: "0 18px 40px -18px rgb(0 0 0 / 0.55)",
        }}
      />
      {/* Bottom left, inset by the padding the screen sits on, so the bubble
          reads as standing in the recording's own corner rather than in the
          picture's.

          `squircle` *and* `rounded-full`, because `corner-shape` reshapes a
          radius rather than supplying one: on its own it is a square, which is
          what this was. The pair is the app's own squircle, whose `SHAPE_RADIUS`
          is 0.5 of the shorter edge.

          A border and not a ring. `corner-shape` is a property of the box, so a
          border follows the superellipse, where a ring is drawn outside it and
          comes back round. */}
      <div
        className="squircle absolute bottom-14 left-12 size-16 rounded-full border-2 border-white bg-cover bg-center"
        style={{
          backgroundImage: `url(${CAMERA_STILL})`,
          boxShadow: "0 10px 22px -8px rgb(0 0 0 / 0.6)",
        }}
      />
    </div>
  );
}

/**
 * Step two: the timeline, with one zoom selected.
 *
 * Built from `editor-controls`, so the clip's radius, the zoom bar's wash and
 * the playhead's bubble are the app's own and not a drawing of them. One bar
 * carries `selected`, because a row of three identical spans says "there are
 * zooms" where a selected one says "and you can take hold of this".
 *
 * The panel bleeds off the bottom of the frame for the reason the screen bleeds
 * off the top of step one: a timeline with air under it is a diagram of a
 * timeline, and one running out of the frame is a window that carries on.
 */
export function TimelineStep() {
  return (
    <div className={FRAME} style={{ backgroundImage: `url(${LAYOUT_STAGE})` }} aria-hidden>
      <EditorSurface className="absolute inset-x-4 top-7 -bottom-4">
        <Strip>
          <div className="relative pt-7">
            {/* The clip row, in two cuts, each with its own footage under it. */}
            <div className="flex gap-1.5" style={{ height: CLIP_H }}>
              <Clip width={0.6} selected>
                <Filmstrip src={LAYOUT_SCREEN} cells={7} />
              </Clip>
              <Clip width={0.38}>
                <Filmstrip src={CAPTIONS_SCREEN} cells={5} />
              </Clip>
            </div>

            {/* The zoom row under it, which is the thing this step is about. */}
            <div className="relative h-7" style={{ marginTop: TRACK_GAP }}>
              <ZoomBar left={0.04} width={0.2} />
              <ZoomBar left={0.34} width={0.26} selected />
              <ZoomBar left={0.72} width={0.18} />
            </div>

            <Playhead at={0.44} read="0:12" />
          </div>
        </Strip>
      </EditorSurface>
    </div>
  );
}

/**
 * Step three: the bottom left of a player, mid-play.
 *
 * The export is a file and a link, and neither photographs. What a person
 * pictures when they are told a video is finished is a transport bar over a
 * frame of it, so that is what this draws: the played part of the scrub filled,
 * the head sitting on it, and a time that is not zero.
 */
export function PlayerStep() {
  return (
    <div className={FRAME} style={{ backgroundImage: `url(${CAPTIONS_STAGE})` }} aria-hidden>
      <div
        className="absolute -top-8 -right-12 bottom-6 left-6 overflow-hidden rounded-xl bg-cover bg-center"
        style={{
          backgroundImage: `url(${CAPTIONS_SCREEN})`,
          boxShadow: "0 18px 40px -18px rgb(0 0 0 / 0.55)",
        }}
      >
        {/* The controls sit on the picture, on the gradient a player lays over
            it rather than on a bar below it. The gradient is the whole reason
            they are readable: white on a light frame is where a transport goes
            to disappear, and this one is a checkout page. */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-4 pt-8 pb-3.5">
          <div className="flex items-center gap-3">
            <span className="grid size-7 flex-none place-items-center rounded-full bg-white/95">
              <svg viewBox="0 0 24 24" className="size-3 translate-x-px fill-black">
                <path d="M7 4.5v15l13-7.5z" />
              </svg>
            </span>
            <span className="font-mono text-[11px] tabular-nums text-white/85">0:41</span>
            <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/25">
              <span className="absolute inset-y-0 left-0 w-[38%] rounded-full bg-white" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
