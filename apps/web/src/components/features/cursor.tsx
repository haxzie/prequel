import { Group, PanelHeader, Slider, ToggleField } from "@/components/editor-controls";
import { Frame, Pointer, Screen, Slab } from "@/components/features/frame";
import { ClockIcon, CursorIcon, SmoothingIcon } from "@/components/landing/editor-icons";
import { CAPTIONS_SCREEN } from "@/components/landing/stage";

/**
 * The pictures on the Cursor cards.
 */

/**
 * The fifteen, in the order `CURSOR_STYLES` lists them.
 *
 * The first is the default and is the one drawn selected. Two rows of the
 * picker's own cells rather than one long row, because fifteen in a line is
 * too small to tell a corn from a frog at, and the card claims there are
 * fifteen different ones.
 */
const STYLES = [
  "modern-black",
  "modern-white",
  "black",
  "white",
  "circle",
  "point",
  "hammer",
  "wrench",
  "cooking",
  "bottle",
  "corn",
  "fish",
  "frog",
  "hamster",
  "football",
];

export function PointerStyles() {
  return (
    <Frame stage="sequoia">
      <Slab className="inset-x-4 top-5 -bottom-6" inner="px-4 pt-3">
        <span className="text-[10px] text-editor-muted">Pointer</span>
        {/* Cells of a fixed height rather than squares: eight squares across
            a wide card are 85px each, and two rows of that are taller than the
            frame. The artwork is square and sits centred in each. */}
        <div className="mt-1.5 grid grid-cols-8 gap-1">
          {STYLES.map((style, i) => (
            <span
              key={style}
              className={`relative h-10 rounded-md ${
                i === 0 ? "bg-selected/25 ring-1 ring-selected" : "bg-white/5"
              }`}
            >
              <Pointer art={style} className="top-1 left-1/2 h-8 w-8 -translate-x-1/2" />
            </span>
          ))}
        </div>
      </Slab>
    </Frame>
  );
}

/**
 * The recorded path and the drawn one.
 *
 * The recording is a polyline: a sample every frame, a corner at every sample,
 * and nothing at all while the pointer held still. The drawn path is the same
 * points through a curve, and the pointer sits at its end. Both are on the
 * screen rather than on the wallpaper, because the pointer is part of the
 * recording and not of the frame.
 */
export function Smoothing() {
  return (
    <Frame stage="facet">
      <Screen className="-right-8 -bottom-8 top-6 left-6" src={CAPTIONS_SCREEN}>
        <svg
          className="absolute inset-0 size-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          <polyline
            points="8,78 16,74 22,62 27,64 33,50 38,52 45,40 49,44 56,33 60,36 66,30 72,33 78,30"
            fill="none"
            stroke="rgb(0 0 0 / 0.5)"
            strokeWidth="1.25"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d="M8 78 C 30 70, 40 48, 56 36 S 72 30, 78 30"
            fill="none"
            stroke="#4296fc"
            strokeWidth="2"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <Pointer className="top-[30%] left-[76%] w-7" />
      </Screen>
    </Frame>
  );
}

/**
 * A pointer smeared along its travel.
 *
 * Five copies behind the sharp one, each a step further back along the line
 * and a step fainter and softer, which is what a frame of a fast pointer with
 * motion blur looks like once it is stopped.
 */
export function MotionBlur() {
  return (
    <Frame stage="peony">
      <Screen className="-right-8 -bottom-8 top-6 left-6">
        {[5, 4, 3, 2, 1].map((step) => (
          <Pointer
            key={step}
            className="w-8"
            style={{
              left: `${58 - step * 6}%`,
              top: `${62 - step * 5}%`,
              opacity: 0.7 - step * 0.11,
              filter: `blur(${step * 0.5}px)`,
            }}
          />
        ))}
        <Pointer className="top-[62%] left-[58%] w-8" />
      </Screen>
    </Frame>
  );
}

/**
 * The pointer fading out, and the panel that decides when.
 *
 * Three states of one pointer across the screen: there, going, gone. The
 * panel's rows are the app's cursor panel: the hide-when-still switch, how
 * long still means, and the typing switch beside them.
 */
export function HideWhenStill() {
  return (
    <Frame stage="sequoia">
      <Screen className="-bottom-8 top-6 left-6 w-[52%]" src={CAPTIONS_SCREEN}>
        <Pointer className="top-[34%] left-[18%] w-8" />
        <Pointer className="top-[34%] left-[46%] w-8 opacity-45" />
        <Pointer className="top-[34%] left-[74%] w-8 opacity-10" />
      </Screen>
      <Slab className="top-4 right-4 -bottom-6 w-52 lg:w-60">
        <PanelHeader icon={<CursorIcon />} title="Cursor" />
        <Group>
          <ToggleField icon={<CursorIcon />} label="Hide when still" on />
          <Slider icon={<ClockIcon />} label="After" read="2.0 s" value={0.4} />
          <ToggleField icon={<SmoothingIcon />} label="Hide while typing" on />
        </Group>
      </Slab>
    </Frame>
  );
}
