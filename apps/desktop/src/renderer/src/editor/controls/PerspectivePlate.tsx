import { cn } from "../../lib/cn";
import { plateTransform, shadingAngle, shadingStrength } from "./perspective";

/**
 * One tilted plate, shaded so it reads as a plate rather than a parallelogram.
 *
 * Extracted because three places now draw the same rotation — the pad you drag,
 * the preset buttons under it, and any future picture of an angle. Two copies
 * of `rotateX/rotateY` drift the moment one of them is adjusted, and a preset
 * thumbnail that disagrees with the pad is worse than no thumbnail: it teaches
 * the wrong thing about a control whose whole job is to be looked at.
 *
 * Callers own the `perspective` container. The amount of splay is a property of
 * the scene being drawn, not of the plate, and the pad varies it with the
 * zoom's perspective while a 20px preset thumbnail wants a fixed shallow one.
 */
export function PerspectivePlate({
  rotateX,
  rotateY,
  className,
}: {
  rotateX: number;
  rotateY: number;
  /** Size and skin. The plate has no opinion about either. */
  className?: string;
}) {
  return (
    <div
      className={cn("relative overflow-hidden", className)}
      style={{ transform: plateTransform(rotateX, rotateY) }}
    >
      <Shading rotateX={rotateX} rotateY={rotateY} />
    </div>
  );
}

/**
 * Which edge is nearer, said in light.
 *
 * A rotated rectangle in CSS is still a flat fill, and at the small angles this
 * editor allows the outline alone is very nearly symmetrical — an 8° lean back
 * and an 8° lean in draw almost the same trapezium, so the control could not
 * say which way the plate was facing. The shading is what disambiguates them.
 *
 * One gradient rather than one per axis. Light has a single direction, so the
 * two are resolved into one vector first; stacking a vertical gradient on a
 * horizontal one cross-fades them and leaves the corner nearest the viewer no
 * brighter than its neighbours, which is exactly the corner the eye uses.
 */
function Shading({ rotateX, rotateY }: { rotateX: number; rotateY: number }) {
  const strength = shadingStrength(rotateX, rotateY);
  if (strength === 0) return null;

  const away = Math.round(shadingAngle(rotateX, rotateY));

  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        background:
          `linear-gradient(${String(away)}deg, ` +
          `rgba(255,255,255,${(strength * 0.22).toFixed(3)}) 0%, ` +
          `rgba(255,255,255,0) 42%, ` +
          `rgba(0,0,0,${(strength * 0.45).toFixed(3)}) 100%)`,
      }}
    />
  );
}
