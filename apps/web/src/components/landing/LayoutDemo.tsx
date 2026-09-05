/**
 * The layouts, cycling, in place of a grid of thumbnails of them.
 *
 * The point being made is that the screen and the camera are two pictures
 * sharing a frame rather than one burned into the other, and a strip of static
 * thumbnails cannot make it: six stills of six boxes read as six unrelated
 * pictures. The same two boxes travelling between the six layouts read as
 * one recording being re-framed, which is what the product actually does to it.
 *
 * Entirely CSS, for the reason `ZoomDemo` is — see the note at the top of that
 * file. Three animations on one 24s period: the screen box, the camera box, and
 * the slice lit under them, plus the playhead sweep the zoom demo already had.
 * The track itself is `DemoTimeline`, the same component that sits under the
 * picture above.
 *
 * Unlike the zoom demo, which animates `transform`, this one animates `inset`,
 * and it pays a layout for every frame it moves rather than none. That is the
 * trade the picture is worth: a layout change is a change of *box*, and a
 * transform can only scale one — a 16:9 screen becoming a split's 8:9 half
 * would squash the window furniture inside it, where a narrower box reflows it,
 * which is what a real layout switch does to a real recording. What it costs is
 * bounded: two small subtrees, laid out again over the ~0.9s a step boundary
 * takes and held still for the three seconds between them.
 *
 * The geometry below is worked out in frame units (16 wide by 9 tall) and then
 * written as percentages of each axis, so the same absolute gap is 6% down the
 * frame and 3.4% across it. That is the product's own rule — geometry is a
 * fraction of the frame's shorter edge, never pixels, so a look survives
 * 16:9 -> 9:16 — reproduced here rather than imported: `apps/web` shares no code
 * with `apps/desktop`, and giving `shared/layout.ts` a marketing consumer would
 * be a second reason for it to change.
 */
import { CameraFootage } from "@/components/landing/CameraFootage";
import { DemoTimeline } from "@/components/landing/DemoTimeline";
import { LAYOUT_STAGE } from "@/components/landing/stage";
import { Container, SectionHeading } from "@/components/Section";

/**
 * The six the picture plays, in order.
 *
 * One word each, and the app's own picker names cut down to it — six slices
 * share the width the zoom demo gives four, so "Padded screen, camera over"
 * arrives as "Padded scr…" and says less than nothing. The glyph beside each
 * name is what carries the rest, which is the same division of labour the
 * picker in the app makes.
 *
 * Six of the ten, not all ten. The four left out — split across the middle,
 * screen only in its two forms, camera only padded — are each a near neighbour
 * of one that is here, and a cycle long enough to hold all ten is one nobody
 * watches to the end. The count in the heading is still ten, because that is
 * how many there are.
 */
const LAYOUTS = [
  { name: "Full", screen: [0, 0, 16, 9], camera: [12.4, 5.4, 3.06, 3.06], bubble: true },
  // The glyph pads the screen harder than the picture does, or seven pixels of
  // inset is invisible — so the bubble is placed inside the glyph's screen
  // rather than at the figure the keyframe uses, which would hang over its edge.
  { name: "Padded", screen: [1.6, 1, 12.8, 7], camera: [11.1, 4.8, 2.88, 2.88], bubble: true },
  { name: "Beside", screen: [0.5, 1.9, 9.2, 5.2], camera: [10.3, 1.9, 5.2, 5.2] },
  { name: "Stacked", screen: [3.66, 0.54, 8.68, 4.88], camera: [6.75, 5.96, 2.5, 2.5] },
  { name: "Split", screen: [0, 0, 8, 9], camera: [8, 0, 8, 9] },
  { name: "Camera", camera: [0, 0, 16, 9] },
] satisfies Layout[];

/**
 * One layout, as the two boxes it puts on the frame.
 *
 * `[x, y, w, h]` in the frame's own units — 16 across by 9 down — which is the
 * same coordinate space the keyframes are written in, so a glyph and the
 * picture it labels cannot disagree about which layout they are showing.
 * A screen-less layout simply has no `screen`.
 */
interface Layout {
  name: string;
  screen?: Box;
  camera: Box;
  /** The camera is a bubble over the screen rather than a card beside it. */
  bubble?: boolean;
}

/**
 * A tuple and not `number[]`, so `noUncheckedIndexedAccess` can see that all
 * four are there. Destructuring an array of unknown length hands back four
 * `number | undefined`, and every one of them then has to be defended against
 * for a figure written six lines above.
 */
type Box = [x: number, y: number, width: number, height: number];

export function LayoutDemo() {
  return (
    <section className="py-24">
      <Container>
        {/* The picture leads on this one and the heading follows it, the
            mirror of the zoom demo above. Two sections running heading-left,
            picture-right in sequence read as one long column of type with
            decoration beside it; alternating them makes the second section
            announce itself as a different thing to look at. */}
        <div
          data-layout-demo
          className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.18fr)_minmax(0,0.82fr)] lg:gap-16"
        >
          {/*
            `role="img"` with a label, everything inside hidden. The parts are
            boxes standing in for two pictures; read out one at a time they are
            noise, and the sentence below is the whole of what is worth reaching.
          */}
          <div
            role="img"
            aria-label="One recording, re-framed. The screen and the camera move between six layouts in turn: the camera as a bubble over a full-frame screen, then over a padded one, then side by side with it, then below it, then each taking half of a split frame, and finally the camera alone filling the frame."
          >
            {/* A wrapper and no more — see the note on the same element in
                `ZoomDemo`. The two demos sit a screen apart and a card around
                one but not the other would read as two different kinds of
                thing. */}
            <div>
              {/*
                The stage: the wallpaper the composition sits on, and the frame
                that crops it. `@container` so the radii in the keyframes can be
                written in `cqw` and stay proportional at every width — a fixed
                pixel radius is a different-looking corner on a 300px card and a
                700px one.
              */}
              <div className="grain @container relative aspect-[16/9] overflow-hidden rounded-lg">
                <div
                  className="absolute inset-0 bg-cover bg-center"
                  style={{ backgroundImage: `url(${LAYOUT_STAGE})` }}
                />

                {/* Both boxes are absolute and both are always mounted. A
                    camera that unmounted for the screen-only layouts would
                    have nowhere to travel from when it came back, and the
                    journey between the boxes is the whole argument. */}
                <ScreenBox />
                <CameraBox />
              </div>

              <LayoutTrack />
            </div>
          </div>

          <div>
            <SectionHeading
              eyebrow="Layouts"
              title="Layouts to communicate your big ideas"
              lede="The screen and the camera stay two pictures, never one burned into the other, so how a take is framed is decided after it is recorded. Ten layouts, and any of them can change mid-take."
            />
          </div>
        </div>
      </Container>
    </section>
  );
}

/**
 * The six layouts on the shared track.
 *
 * The same component the zoom demo puts under its picture — see
 * `DemoTimeline`. The two demos sit a screen apart and are making the same
 * claim about the same timeline, so a second, near-identical track drawn here
 * would read as a different kind of control rather than as the one the app has.
 */
function LayoutTrack() {
  return (
    <DemoTimeline
      step={4}
      sliceClass="animate-layouts-slice"
      playheadClass="animate-layouts-playhead"
      slices={LAYOUTS.map((layout) => ({
        key: layout.name,
        content: (
          <>
            <LayoutGlyph layout={layout} />
            {/* Hidden below `sm`, where six slices share the width of a phone
                and every name would be two truncated characters. The glyph
                survives that width and still says which layout it is,
                which the truncation would not. */}
            <span className="hidden truncate text-[0.6875rem] sm:inline sm:text-xs">
              {layout.name}
            </span>
          </>
        ),
      }))}
    />
  );
}

/**
 * An layout as the shape it makes: the frame faint, the screen tinted
 * inside it, the camera solid.
 *
 * Drawn from the same `[x, y, w, h]` figures the slice carries, in the frame's
 * own 16-by-9 units, so there is one description of a layout rather than
 * a picture and a second drawing of it that have to be kept in agreement. It is
 * the app's own layout picker in miniature, and for its reason: two rectangles
 * are understood before "padded screen with the camera beside it, matched to
 * its height" is finished being read.
 */
function LayoutGlyph({ layout }: { layout: Layout }) {
  const [cx, cy, cw, ch] = layout.camera;

  return (
    <svg viewBox="-0.5 -0.5 17 10" className="h-3.5 w-[1.55rem] shrink-0" aria-hidden>
      {/* The output frame, faint, behind both boxes — the edge a padded screen
          is padded *from*. Every layout that does not fill the frame needs
          something to be inset within, or it reads as a smaller frame rather
          than as a smaller picture in the same one. */}
      <rect
        x="0"
        y="0"
        width="16"
        height="9"
        rx="0.8"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="0.9"
      />

      {layout.screen ? (
        <rect
          x={layout.screen[0]}
          y={layout.screen[1]}
          width={layout.screen[2]}
          height={layout.screen[3]}
          rx="0.8"
          // Tinted, where the camera below is solid. Outlining both left a
          // full-frame screen and a padded one as the same rectangle drawn a
          // hair smaller; filling the screen turns the difference into an area,
          // which survives being fourteen pixels tall.
          fill="currentColor"
          fillOpacity="0.3"
          stroke="currentColor"
          strokeWidth="0.9"
        />
      ) : null}

      {/* A bubble is a squircle and a card is a slightly-rounded rectangle, the
          same two shapes the picture uses — so the corner radius is the whole
          difference, and at this size it is enough of one. */}
      <rect
        x={cx}
        y={cy}
        width={cw}
        height={ch}
        rx={layout.bubble ? cw * 0.32 : 0.8}
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * The screen picture: an application window, drawn generically.
 *
 * Everything inside is sized in per cent so it reflows as the box changes shape
 * rather than being stretched with it. That is the difference between this
 * reading as one recording being re-framed and reading as a picture of one
 * being squashed.
 */
function ScreenBox() {
  return (
    <div className="animate-layouts-screen absolute inset-0 overflow-hidden rounded-none bg-[#1b1d22] shadow-[0_2cqw_5cqw_-2cqw_rgb(0_0_0_/_0.75)] ring-1 ring-white/10">
      <div className="flex h-[9%] items-center gap-[0.5%] border-b border-black/40 bg-[#2b2d33] px-[2%]">
        <span className="size-[0.55cqw] rounded-full bg-white/20" />
        <span className="size-[0.55cqw] rounded-full bg-white/20" />
        <span className="size-[0.55cqw] rounded-full bg-white/20" />
      </div>

      <div className="flex h-[91%]">
        <div className="flex w-[26%] shrink-0 flex-col gap-[4%] border-r border-black/40 bg-[#232529] p-[4%]">
          <span className="h-[4%] w-[70%] rounded-full bg-white/20" />
          <span className="h-[4%] w-[52%] rounded-full bg-white/10" />
          <span className="h-[4%] w-[60%] rounded-full bg-white/10" />
          <span className="h-[4%] w-[44%] rounded-full bg-white/10" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-[3%] p-[4%]">
          <span className="h-[8%] w-[54%] rounded-full bg-white/25" />
          <span className="h-[5%] w-[86%] rounded-full bg-white/10" />
          <span className="h-[5%] w-[72%] rounded-full bg-white/10" />
          <div className="mt-[2%] flex-1 rounded-[0.6cqw] bg-gradient-to-br from-[#4e84f9]/35 to-[#4e84f9]/5 ring-1 ring-white/10" />
        </div>
      </div>
    </div>
  );
}

/**
 * The camera picture: real footage, cropped to whatever box the layout
 * gives it.
 *
 * `object-cover` and nothing else, which is exactly what the app does to a
 * webcam track — the picture is cropped into its box, never squashed to fit
 * it, so a circle in a corner and a half of a split frame are two crops of one
 * shot rather than two differently-stretched copies of it. The colour under it
 * is what shows for the moment before the first frame decodes.
 */
function CameraBox() {
  return (
    // `squircle` — `corner-shape` — rather than a plain 50% radius, because a
    // square box at 50% is a circle and the app's default camera shape is the
    // macOS superellipse, not a circle. It is set here once and left on for
    // every layout: the card and split radii are small enough that the
    // corner shape makes no visible difference, so there is nothing to animate.
    // Safari and Firefox have no `corner-shape` yet and fall back to the
    // circle, which is a shape the app offers too.
    <div className="squircle animate-layouts-camera absolute top-[60%] right-[3.4%] bottom-[6%] left-[77.5%] overflow-hidden rounded-full bg-[#2a1a2e] ring-1 ring-white/15">
      <CameraFootage />
    </div>
  );
}
