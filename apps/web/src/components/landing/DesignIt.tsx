import { Container, Eyebrow } from "@/components/Section";
import { ButtonLink } from "@/components/Button";
import { CAPTIONS_SCREEN, DESIGN_STAGE } from "@/components/landing/stage";

/**
 * The editor, put the way a designer would recognise it.
 *
 * Everything above this on the page is about what Prequel does on its own —
 * the zooms it places, the sounds it adds, the pointer it swaps in. This is
 * the other half: that none of it is baked, and the thing you are moving is an
 * object on a canvas with handles on it rather than a setting in a list.
 *
 * Wider than the rest of the page. `Container` caps at `max-w-6xl` and that is
 * the measure the argument is set to; this is the one section whose subject is
 * a canvas, and a canvas cropped to a column of type is a thumbnail. Its own
 * wrapper rather than a wider `max-w` passed down, for the reason the hero's
 * editor picture has one: both would be plain utilities of equal specificity
 * and which won would come down to Tailwind's emit order.
 *
 * The camera is a still and not a video. Nothing in this picture moves — it is
 * a selected object sitting there, which is the state being described — and a
 * 4MB loop of somebody talking would be the heaviest thing on the page to say
 * that something is *not* happening.
 */

/**
 * What the panel reads out, in the order the app's own Camera group has it.
 *
 * Three values each, one per state of the loop on the canvas — the same three
 * `camera-shape` and `camera-corners` step through in `globals.css`. The two
 * have to agree by being written the same in both places: a keyframe cannot be
 * read back, so a figure changed here and not there is a panel describing a
 * camera that is not on screen.
 */
const CONTROLS = [
  { label: "Size", values: ["26%", "34%", "34%", "34%"] },
  { label: "Corners", values: ["22%", "22%", "50%", "50%"] },
  { label: "Angle", values: ["0°", "0°", "0°", "-6°"] },
];

/** The loop the canvas, the cursor and the panel all run on. */
const CYCLE_S = 16;

export function DesignIt() {
  return (
    <section className="py-20 lg:py-24">
      <Container>
        <Eyebrow>The editor</Eyebrow>
        <h2 className="max-w-2xl text-3xl leading-tight font-normal tracking-tight text-balance text-fg sm:text-4xl">
          Edit it the way you would design it
        </h2>
      </Container>

      {/* The wide part. `max-w-7xl` against the page's `6xl`, which is one step
          and not a jump to full bleed: the canvas has to read as wider than
          the sentence above it rather than as a different page. */}
      <div className="mx-auto mt-12 w-full max-w-7xl px-5 sm:px-8">
        <div className="grid items-center gap-10 lg:grid-cols-[1.35fr_1fr] lg:gap-16">
          {/* The canvas. A recording with the camera selected on it, drawn at
              the size the editor draws it rather than as a diagram: the frame,
              the background behind it, the camera over it, and the eight
              handles that say it can be moved. */}
          <div className="squircle lit relative overflow-hidden rounded-3xl border border-line">
            <div
              className="aspect-[16/10] w-full bg-cover bg-center"
              style={{ backgroundImage: `url(${DESIGN_STAGE})` }}
            >
              {/* The recording inside the frame: padding, a radius and a
                  shadow, which is what the app puts there by default. A real
                  capture and not an empty rectangle — the camera has to be
                  over something, and a dark panel behind it says the editor
                  is a canvas with nothing on it. */}
              <div className="absolute inset-[7%] overflow-hidden rounded-xl bg-[#101218] shadow-[0_24px_60px_-18px_rgb(0_0_0_/_0.75)] ring-1 ring-white/10 sm:rounded-2xl">
                <img
                  src={CAPTIONS_SCREEN}
                  alt=""
                  draggable={false}
                  className="size-full object-cover object-left-top select-none"
                />
              </div>

              {/* The camera, selected. Rotated a little, because the angle is
                  one of the four things the panel beside it reads out and a
                  square-on camera would make that control look inert. */}
              <div className="animate-camera-shape absolute top-[18%] left-[9%] w-[26%]">
                <div className="relative aspect-square">
                  <img
                    src="/camera-portrait.jpg"
                    alt=""
                    width={900}
                    height={900}
                    draggable={false}
                    className="animate-camera-face size-full object-cover select-none"
                  />
                  {/* The selection: a hairline round the object and eight
                      handles on it, each centred on the edge it sits on so
                      half is inside and half out. The same marquee the
                      headline's chip quotes — see `HeroCard` — because it is
                      the same thing in the app. */}
                  <span
                    aria-hidden
                    className="animate-camera-corners pointer-events-none absolute -inset-[1.5%] border-2 border-accent"
                  />
                  {HANDLES.map((at) => (
                    <span
                      key={at}
                      aria-hidden
                      className={`pointer-events-none absolute size-2.5 rounded-[2px] border-2 border-accent bg-white sm:size-3 ${at}`}
                    />
                  ))}

                  {/* The radius grips, inside the corners. An invisible square
                      whose inset follows the radius, with a grip at each of
                      its corners — so they travel inwards as the corner opens
                      up, which is the thing they are for. */}
                  <span aria-hidden className="animate-radius-frame pointer-events-none absolute">
                    {RADIUS_GRIPS.map((at) => (
                      <span
                        key={at}
                        className={`absolute size-2 rounded-full border-2 border-accent bg-white ${at}`}
                      />
                    ))}
                  </span>
                  {/* The rotate grip, off the top edge: the one handle that is
                      not on the box, because it does not resize it. */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -top-[18%] left-1/2 h-[12%] w-px -translate-x-1/2 bg-accent"
                  />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -top-[24%] left-1/2 size-3 -translate-x-1/2 rounded-full border-2 border-accent bg-white sm:size-3.5"
                  />
                </div>
              </div>

              {/* The hand on the handles. Outside the camera's own box, so it
                  does not take the box's rotation with it — a cursor that
                  leans when the thing under it leans is not a cursor. Its
                  hotspot is the app's own: 7% in and 7.5% down, which is where
                  the arrow's point is in that PNG. */}
              <span aria-hidden className="animate-editor-cursor absolute size-0">
                <img
                  src="/cursors/modern-white.png"
                  alt=""
                  width={128}
                  height={128}
                  draggable={false}
                  className="absolute max-w-none select-none drop-shadow-[0_2px_5px_rgb(0_0_0_/_0.55)]"
                  style={{
                    width: CURSOR_PX,
                    marginLeft: -CURSOR_PX * 0.0696,
                    marginTop: -CURSOR_PX * 0.0752,
                  }}
                />
              </span>

              {/* The readout, as the editor's own panel. Sat on the canvas
                  rather than beside it: in the app it is a floating group and
                  this is a picture of the app. */}
              <div className="absolute right-[6%] bottom-[8%] w-[30%] min-w-[150px] rounded-xl border border-white/10 bg-black/55 p-3 backdrop-blur-md">
                <p className="mb-2 font-mono text-[10px] tracking-wider text-white/50 uppercase">
                  Camera
                </p>
                <dl className="flex flex-col gap-1.5">
                  {CONTROLS.map((control) => (
                    <div key={control.label} className="flex items-center justify-between">
                      <dt className="text-[11px] text-white/60">{control.label}</dt>
                      {/* The three stacked in one slot, each up for its third
                          of the loop. `relative` on the cell and the values
                          absolute inside it, so the row keeps the width of
                          the widest rather than reflowing as the figures
                          change — a panel whose columns twitch reads as a
                          layout bug, not as a value updating. */}
                      <dd className="relative h-[13px] min-w-[34px] font-mono text-[11px] text-white">
                        {control.values.map((value, i) => (
                          <span
                            // Keyed by position and not by the value: the
                            // four states repeat figures — Size is 34% for
                            // three of them — and a repeated key is React
                            // being told two slots are the same element.
                            key={`${control.label}-${i}`}
                            className="animate-readout-value absolute inset-y-0 right-0 opacity-0"
                            style={{ animationDelay: `${(i * CYCLE_S) / 4}s` }}
                          >
                            {value}
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>

          <div className="max-w-xl">
            <p className="text-lg leading-relaxed text-pretty text-muted">
              Click the camera and it is an object on a canvas. Drag a corner to size it, pull the
              grip above it to turn it, round the corners as far as a circle. Everything else on the
              frame works the same way.
            </p>
            <ul className="mt-8 flex flex-col gap-4">
              {POINTS.map((point) => (
                <li key={point.title}>
                  <p className="text-[0.9375rem] font-medium text-fg">{point.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{point.body}</p>
                </li>
              ))}
            </ul>
            <ButtonLink href="/download" variant="cta" size="sm" className="mt-9">
              Download for Mac
            </ButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The three things worth saying about a canvas, and not a list of controls.
 *
 * "Corner radius" is a slider's name; "as far as a circle" is what it does.
 * The last one is the point of the whole section and goes last for that
 * reason: a design file is not a design file if the decisions are baked in.
 */
const POINTS = [
  {
    title: "Handles, not a form",
    body: "Eight on the box and one above it. Drag from a corner to keep the shape, from an edge to change it.",
  },
  {
    title: "The same for everything in the frame",
    body: "The screen, the camera, a title, the background behind both. Each is an object with its own corners, shadow and angle.",
  },
  {
    title: "Nothing is baked until you export",
    body: "None of it was decided while you recorded, and none of it is written into the file until you ask for one.",
  },
];

/** How big the hand is drawn. The art is 128px and this is a canvas, not a
    recording, so it is sized to read at the width the card is drawn at. */
const CURSOR_PX = 30;

/** The four radius grips, on the corners of the frame that follows the
    radius. Centred on each corner, so half is inside the frame and half out —
    the same rule the eight resize handles follow. */
const RADIUS_GRIPS = [
  "-top-1 -left-1",
  "-top-1 -right-1",
  "-bottom-1 -right-1",
  "-bottom-1 -left-1",
];

/** Where the eight handles sit, each centred on its own edge or corner. */
const HANDLES = [
  "-top-1.5 -left-1.5",
  "-top-1.5 left-1/2 -translate-x-1/2",
  "-top-1.5 -right-1.5",
  "top-1/2 -right-1.5 -translate-y-1/2",
  "-bottom-1.5 -right-1.5",
  "-bottom-1.5 left-1/2 -translate-x-1/2",
  "-bottom-1.5 -left-1.5",
  "top-1/2 -left-1.5 -translate-y-1/2",
];
