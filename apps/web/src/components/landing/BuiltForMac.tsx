import { AppleIcon } from "@/components/icons";
import { HoloDie } from "@/components/landing/HoloDie";
import { Container, Eyebrow } from "@/components/Section";
import { SITE } from "@/lib/site";

/**
 * The one dark panel on the page: a chip with the mark set into its die, and
 * under it the sentence that Prequel is a native Mac app.
 *
 * Dark where everything else is paper, on purpose. The section is about the
 * hardware, and silicon drawn on white reads as a diagram; on a deep field it
 * reads as the thing itself, lit from one side. It is the only place the site
 * goes dark, so it carries as a change of scene rather than as a theme.
 *
 * The chip is drawn in CSS and not shipped as a picture. A rendered image of a
 * chip would need a light-theme twin and a 2x export, and would still fuzz at
 * the die's edge on a retina display; four nested boxes with a gradient and a
 * hatch pattern are sharp at every size and about forty lines. The proportions
 * come from a real package — a die about two thirds of the substrate, the
 * substrate with one corner cut to say which way up it goes.
 *
 * Sized in pixels, not `em`. The chip is an object rather than type, and it has
 * no reason to grow with the heading beside it.
 */

/**
 * The panel's colours, in one place so the whole scene changes hue together:
 * the field behind everything, the substrate the die sits on, and the dark of
 * the screw heads. The notch is cut in the field's colour, so it needs none. The die itself is the shader and stays as it is.
 */
const PANEL = {
  from: "#1b1b1f",
  to: "#0c0c0f",
  substrate: "#202026",
  screw: "#141418",
  screwLit: "#34343c",
  screwDark: "#0a0a0d",
};

/** The substrate's side and the die's, in pixels at the wide setting. */
const SUBSTRATE = 320;
const DIE = 216;

export function BuiltForMac() {
  return (
    <section id="built-for-mac" className="py-24">
      <Container>
        <div
          className="relative grid items-center gap-12 overflow-hidden rounded-3xl px-6 py-16 text-white sm:px-12 lg:grid-cols-2 lg:gap-16 lg:px-16 lg:py-20"
          style={{ backgroundImage: `linear-gradient(180deg, ${PANEL.from} 0%, ${PANEL.to} 100%)` }}
        >
          {/* The words on the left, the chip on the right, the way every demo
              above puts its picture beside its heading. On a phone the words
              come first and the chip sits under them: the sentence is the
              point, and the chip is what proves it. */}
          <div className="max-w-xl text-center lg:text-left">
            {/* The platform mark beside the requirement, which is the one line
                of the section that is a fact rather than a sentence: the same
                words the footer carries, from the same string. */}
            <p className="mb-6 flex items-center justify-center gap-2 font-mono text-[11px] tracking-wider text-white/55 uppercase lg:justify-start">
              <AppleIcon className="size-3.5 translate-y-[-0.5px] text-white/70" />
              {SITE.platform}
            </p>
            <Eyebrow>Native</Eyebrow>
            <h2 className="text-3xl leading-tight font-normal tracking-tight text-balance sm:text-4xl">
              Built for your Mac
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-pretty text-white/70">
              Prequel is a native app for Apple Silicon. It records with the system&rsquo;s own
              capture, encodes on the video hardware and draws every frame in Metal. Your recordings
              stay on your disk.
            </p>
          </div>

          {/* The chip, with the board hairlines running off its edges. The
              column is `relative` so the vertical lines are placed from the
              chip's own centre and span the panel's full height through it. */}
          <div className="relative flex justify-center">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-[-100vh] left-1/2"
            >
              {([-1, 1] as const).map((sign) => (
                <span
                  key={sign}
                  className="absolute inset-y-0 w-px bg-white/[0.07]"
                  style={{ left: (sign * SUBSTRATE) / 2 }}
                />
              ))}
            </span>
            <Chip />
          </div>
        </div>
      </Container>
    </section>
  );
}

/**
 * The package: a hatched substrate with a cut corner and three pins, a die on
 * top with the light falling across it, and the mark on the die.
 *
 * The die's light is one radial gradient off-centre, which is what a single
 * lamp does to a polished black square, plus a faint grain so the dark field
 * does not band on a wide display. The glow under the die is the die's own
 * shadow, tinted the same blue as the light, so the two read as one source.
 */
function Chip() {
  return (
    <div className="relative mx-auto" style={{ width: SUBSTRATE, height: SUBSTRATE }}>
      {/* The horizontal hairlines, from the chip's top and bottom edges out
          past the panel on both sides. */}
      <span aria-hidden="true" className="absolute inset-x-[-100vw] top-0 h-px bg-white/[0.07]" />
      <span
        aria-hidden="true"
        className="absolute inset-x-[-100vw] bottom-0 h-px bg-white/[0.07]"
      />

      {/* The substrate. A hatch rather than a flat fill, which is how a
          package is drawn in a datasheet and what stops a square this big
          reading as a button. The cut corner is a clip and not a border
          trick, so the hatch runs off the diagonal cleanly. */}
      <div
        className="absolute inset-0 border border-white/10"
        style={{
          backgroundColor: PANEL.substrate,
          clipPath: "polygon(0 0, 88% 0, 100% 12%, 100% 100%, 0 100%)",
          backgroundImage:
            "repeating-linear-gradient(135deg, rgba(255,255,255,0.07) 0 1.5px, transparent 1.5px 9px)",
        }}
      />
      {/* Three screws, one corner left for the cut, set in from the edges the
          way a fixing is: a screw hard against a corner would split the
          board. Each is a domed head
          with a Phillips slot: a bevel from one light edge and one dark
          edge, a cross of two bars sunk into it, and a different turn on
          each, because three screws driven by hand never line up. */}
      {(
        [
          ["top-5 left-5", 14],
          ["bottom-5 left-5", -31],
          ["right-5 bottom-5", 52],
        ] as const
      ).map(([at, turn]) => (
        <span
          key={at}
          aria-hidden="true"
          className={`absolute ${at} grid size-4 place-items-center rounded-full shadow-[inset_0_1px_1px_rgba(255,255,255,0.22),inset_0_-1px_1px_rgba(0,0,0,0.6),0_1px_2px_rgba(0,0,0,0.6)]`}
          style={{
            transform: `rotate(${String(turn)}deg)`,
            backgroundImage: `radial-gradient(circle at 35% 30%, ${PANEL.screwLit} 0%, ${PANEL.screw} 60%, ${PANEL.screwDark} 100%)`,
          }}
        >
          {/* The slot: two bars, dark with a hairline of light on their lower
              edge, so they read as cut into the head rather than drawn on. */}
          <span className="absolute h-[2px] w-[9px] rounded-full bg-[#060b14] shadow-[0_1px_0_rgba(255,255,255,0.18)]" />
          <span className="absolute h-[9px] w-[2px] rounded-full bg-[#060b14] shadow-[1px_0_0_rgba(255,255,255,0.14)]" />
        </span>
      ))}
      {/* The index notch on the right edge: a half-round bite out of the
          substrate, the mark a package carries to say which way up it goes.
          Painted in the field's own colour with the hatch stopping at its
          rim, and shaded inside like the screw heads, so it reads as cut
          through to the board behind rather than as a tab stuck on. */}
      <span
        aria-hidden="true"
        className="absolute top-1/2 right-[-1px] h-7 w-3.5 -translate-y-1/2 rounded-l-full border border-r-0 border-white/10 shadow-[inset_2px_1px_3px_rgba(0,0,0,0.7),inset_-1px_-1px_1px_rgba(255,255,255,0.06)]"
        style={{ backgroundColor: PANEL.to }}
      />

      {/* The die. The gradient is the fallback and the first paint; the
          shader canvas draws over it once WebGL is up — see `HoloDie`. */}
      <div
        className="absolute grid place-items-center overflow-hidden rounded-[6px] shadow-[0_24px_60px_-12px_rgba(56,132,220,0.45),0_8px_20px_rgba(0,0,0,0.45)]"
        style={{
          width: DIE,
          height: DIE,
          left: (SUBSTRATE - DIE) / 2,
          top: (SUBSTRATE - DIE) / 2,
          backgroundImage:
            "radial-gradient(120% 90% at 32% 30%, #3c84d8 0%, #1b3f6b 32%, #0b1220 68%)",
        }}
      >
        <HoloDie className="absolute inset-0 size-full" />
        {/* The markings a die carries: the name along the bottom edge, a lot
            number in the far corner, the architecture beside it. Etched, not
            printed: dark glyphs with a hairline of light under them, which is
            what a laser mark on foil looks like. Tiny, tracked wide and in the
            mono the site uses for every label. */}
        {(
          [
            ["PREQUEL", "bottom-2.5 left-3"],
            ["\u2116 0001", "top-2.5 right-3"],
            ["ARM64", "right-3 bottom-2.5"],
          ] as const
        ).map(([mark, at]) => (
          <span
            key={mark}
            aria-hidden="true"
            className={`absolute ${at} font-mono text-[9px] leading-none tracking-[0.22em] text-black/55 select-none`}
            style={{ textShadow: "0 1px 0 rgba(255,255,255,0.35)" }}
          >
            {mark}
          </span>
        ))}
        {/* The ring from the top of the mark, on its own: the whole icon on
            top of the foil was two pictures fighting, and the ring is the
            part of it that reads at a glance. Solid white with a wide stroke,
            the way it is drawn in the icon, and a short shadow so it sits on
            the foil rather than printed into it. */}
        <span aria-hidden="true" className="relative grid place-items-center">
          {/* A faint light behind the ring, breathing — see `ring-breathe` in
              `globals.css`. Low and wide, so it reads as the foil warming
              under the ring rather than as a lamp behind it. */}
          <span
            data-ring-halo
            className="animate-ring-breathe absolute rounded-full bg-white/35 blur-2xl"
            style={{ width: 130, height: 130 }}
          />
          {/* The ring, pressed into the foil. The band is mostly transparent so
              the foil shows through it, and the relief is four shadows: light
              from the upper left catches the outer edge and the far side of the
              hole, and the near side of the hole and the outer lower edge fall
              into shadow. Nothing is painted white; the shape is the light. */}
          <span
            className="relative block rounded-full border-[16px] border-white/[0.08]"
            style={{
              width: 96,
              height: 96,
              boxShadow:
                "-1px -1px 2px rgba(255,255,255,0.75), 2px 3px 6px rgba(0,0,0,0.75), " +
                "inset 2px 2px 4px rgba(0,0,0,0.75), inset -1px -1px 2px rgba(255,255,255,0.65)",
            }}
          />
        </span>
      </div>
    </div>
  );
}
