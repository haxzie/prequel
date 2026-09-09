import Image from "next/image";

import mark from "../../public/prequel.svg";

/**
 * The one place the mark is rendered.
 *
 * The artwork bleeds to all four edges, so the box has to clip it — dropping
 * the mark in bare puts a hard-edged square next to type that has none. The
 * shape is the macOS icon's superellipse: radius 0.2237 of the side, exponent
 * 4, matching `apps/desktop/scripts/make-app-icon.mjs`. Engines without
 * `corner-shape` fall back to the plain rounded square.
 *
 * The favicon at `src/app/icon.svg` carries the same curve baked into a clip
 * path, since nothing wraps a browser tab icon.
 */

/** The macOS icon's corner radius, as a fraction of the side. */
const ICON_RADIUS = 0.2237;

export function Logo({
  size = 28,
  // Most engines still ignore `corner-shape`, and at the system ratio the
  // fallback is a rounded square that does not read as a squircle at display
  // size. Callers showing the mark large pass a larger fraction to compensate.
  radius = ICON_RADIUS,
  className = "",
}: {
  size?: number;
  radius?: number;
  className?: string;
}) {
  return (
    <span
      // `ring-fg/10` and not a literal white: the mark renders on paper in the
      // nav and on near-black in the sidebar, and the rim has to lift it off
      // whichever one it lands on.
      className={`squircle relative inline-block shrink-0 overflow-hidden ring-1 ring-fg/10 ${className}`}
      style={{ width: size, height: size, borderRadius: size * radius }}
    >
      <Image src={mark} alt="" width={size} height={size} className="h-full w-full" />
    </span>
  );
}

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <Logo size={size} />
      <span className="text-[0.9375rem] font-medium tracking-tight text-fg">Prequel</span>
    </span>
  );
}
