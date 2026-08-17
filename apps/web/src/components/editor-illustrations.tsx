import type { CSSProperties, ReactNode } from "react";

/**
 * The six animated headers on the editor cards.
 *
 * Each is a small white diagram over its own noisy gradient. The gradients are
 * generated in CSS rather than shipped as images: six background photographs
 * would be six requests and a megabyte, and these are a few hundred bytes that
 * resample at any size. Grain comes from the `grain` utility.
 *
 * The six colour pairs walk the icon's own palette in order — amber, coral,
 * magenta, iris, blue, teal — so the section reads as a spectrum rather than
 * six unrelated cards.
 *
 * Every animated element carries `motion-reduce:animate-none`. Six loops
 * running forever is exactly the case a reduced-motion preference is asking
 * about, and Tailwind has no way to apply that to a subtree.
 */

/** `[highlight, shadow, base-from, base-to]`, all from the icon's palette. */
type Scheme = [string, string, string, string];

const AMBER: Scheme = ["#ffd88a", "#e1601a", "#f7a13d", "#e14b15"];
const CORAL: Scheme = ["#ff9a6b", "#8f1450", "#e14b15", "#ac1860"];
const MAGENTA: Scheme = ["#ff8fd0", "#7d1a86", "#ac1860", "#c000f0"];
const IRIS: Scheme = ["#eeacff", "#3552c8", "#c000f0", "#4e84f9"];
const BLUE: Scheme = ["#9fc4ff", "#1f7f96", "#4e84f9", "#3fa9c9"];
const TEAL: Scheme = ["#a5e8f0", "#d98a1f", "#3fa9c9", "#f7b955"];

function background([highlight, shadow, from, to]: Scheme): string {
  return [
    `radial-gradient(85% 85% at 18% 22%, ${highlight} 0%, transparent 58%)`,
    `radial-gradient(80% 80% at 86% 82%, ${shadow} 0%, transparent 60%)`,
    `linear-gradient(135deg, ${from}, ${to})`,
  ].join(", ");
}

/**
 * The backdrop, plus the frame each diagram is drawn inside. The frame is a
 * fixed size because the keyframes move elements by rem offsets measured
 * against it.
 */
function Stage({
  scheme,
  children,
  frame = "",
}: {
  scheme: Scheme;
  children: ReactNode;
  frame?: string;
}) {
  return (
    <>
      <div className="grain absolute inset-0" style={{ background: background(scheme) }} />
      <div className="absolute inset-0 grid place-items-center">
        <div className={`relative h-16 w-28 ${frame}`}>{children}</div>
      </div>
    </>
  );
}

const OUTLINE = "rounded-lg border border-white/70 bg-white/10";

export function ZoomIllustration() {
  return (
    <Stage scheme={AMBER} frame={OUTLINE}>
      <span className="absolute top-1/2 left-1/2 size-6 animate-zoom-push rounded border-2 border-white motion-reduce:animate-none" />
    </Stage>
  );
}

export function CameraIllustration() {
  return (
    <Stage scheme={CORAL} frame={OUTLINE}>
      <span className="absolute bottom-1.5 left-1.5 size-5 animate-bubble-hop bg-white/90 motion-reduce:animate-none" />
    </Stage>
  );
}

export function BackgroundIllustration() {
  return (
    <Stage scheme={MAGENTA} frame="overflow-hidden rounded-lg border border-white/70">
      {["#ffd88a", "#eeacff", "#a5e8f0"].map((colour, i) => (
        <span
          key={colour}
          className="absolute inset-0 animate-swatch motion-reduce:animate-none"
          // Negative delays a third of the cycle apart, so the layers hand over
          // rather than all starting together on the first frame.
          style={{ background: colour, animationDelay: `${-2 * i}s` }}
        />
      ))}
      <span className="absolute inset-2.5 rounded bg-[#12141a]" />
    </Stage>
  );
}

export function TimelineIllustration() {
  return (
    <Stage scheme={IRIS} frame="flex items-center gap-1.5">
      <span className="h-6 w-11 rounded bg-white/85" />
      <span className="h-6 w-9 origin-left animate-clip-cut rounded bg-white motion-reduce:animate-none" />
      <span className="h-6 w-11 animate-clip-close rounded bg-white/85 motion-reduce:animate-none" />
    </Stage>
  );
}

export function CursorIllustration() {
  return (
    <Stage scheme={BLUE} frame={OUTLINE}>
      <svg
        className="absolute top-3 left-4 animate-cursor-drift text-white motion-reduce:animate-none"
        width="16"
        height="18"
        viewBox="0 0 16 18"
        fill="currentColor"
        aria-hidden
      >
        <path d="M1 1 14.5 8.2 8.6 9.6 6.4 16Z" stroke="#12141a" strokeWidth="1.2" />
      </svg>
    </Stage>
  );
}

export function ExportIllustration() {
  return (
    <Stage scheme={TEAL}>
      {[
        { dx: "-0.6rem", dy: "-0.5rem", tone: "border-white/60" },
        { dx: "0.6rem", dy: "0.5rem", tone: "border-white" },
      ].map((frame) => (
        <span
          key={frame.dx}
          className={`absolute inset-0 animate-converge rounded-lg border bg-white/10 motion-reduce:animate-none ${frame.tone}`}
          style={{ "--dx": frame.dx, "--dy": frame.dy } as CSSProperties}
        />
      ))}
    </Stage>
  );
}
