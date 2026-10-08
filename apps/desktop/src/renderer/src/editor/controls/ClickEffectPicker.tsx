import type { ReactNode } from "react";

import {
  CLICK_EFFECTS,
  CLICK_EFFECT_IDS,
  NO_CLICK_EFFECT,
  type ClickEffectId,
} from "../../../../shared/click-effects";
import { cn } from "../../lib/cn";

/**
 * The click marks, as a grid of tiles with a glyph each.
 *
 * A name alone asks the reader to know what "Sonar" looks like before picking
 * it. The real mark is a shader arm and plays for half a second, which is the
 * wrong thing to put on a tile — twelve of them looping in a side panel is a
 * panel nobody can read — so each tile carries a still drawn by hand at the
 * mark's most recognisable moment. The glyphs are approximations and are
 * meant to be: the picture under the tile shows the real thing the moment a
 * press is scrubbed over.
 *
 * Four across. The pointer picker is five because a pointer is small; a
 * glyph with a label under it needs the width.
 */
export function ClickEffectPicker({
  value,
  disabled,
  onChange,
}: {
  value: ClickEffectId | typeof NO_CLICK_EFFECT;
  disabled?: boolean;
  onChange: (id: ClickEffectId | typeof NO_CLICK_EFFECT) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-1">
      <Tile
        label="None"
        title="No mark"
        chosen={value === NO_CLICK_EFFECT}
        disabled={disabled}
        onClick={() => onChange(NO_CLICK_EFFECT)}
      >
        <svg viewBox="0 0 32 32" className="h-full w-full">
          <circle cx="16" cy="16" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 22 22 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </Tile>

      {CLICK_EFFECT_IDS.map((id) => (
        <Tile
          key={id}
          label={CLICK_EFFECTS[id].label}
          title={CLICK_EFFECTS[id].hint}
          chosen={value === id}
          disabled={disabled}
          onClick={() => onChange(id)}
        >
          {GLYPHS[id]}
        </Tile>
      ))}
    </div>
  );
}

function Tile({
  label,
  title,
  chosen,
  disabled,
  onClick,
  children,
}: {
  label: string;
  title: string;
  chosen: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={`${label} — ${title}`}
      aria-pressed={chosen}
      disabled={disabled}
      className={cn(
        // The filter grid's surface: a hairline-free plate with a barely-there
        // fill, so the two grids read as one family of thing.
        "flex flex-col items-center gap-1 rounded-lg bg-white/5 p-1.5",
        "disabled:pointer-events-none disabled:opacity-30",
        chosen ? "ring-2 ring-selected ring-inset" : "hover:bg-white/10",
      )}
      onClick={onClick}
    >
      <span className="block h-8 w-8 text-editor-text" aria-hidden>
        {children}
      </span>
      <span className="text-[9px] leading-tight text-editor-muted">{label}</span>
    </button>
  );
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.5 } as const;

/** One still per mark, at the moment it is most itself. */
const GLYPHS: Record<ClickEffectId, ReactNode> = {
  ripple: (
    <svg viewBox="0 0 32 32" className="h-full w-full">
      <circle cx="16" cy="16" r="10" {...stroke} />
      <circle cx="16" cy="16" r="2" fill="currentColor" opacity="0.5" />
    </svg>
  ),
  sonar: (
    <svg viewBox="0 0 32 32" className="h-full w-full">
      <circle cx="16" cy="16" r="4" {...stroke} />
      <circle cx="16" cy="16" r="8" {...stroke} opacity="0.6" />
      <circle cx="16" cy="16" r="12" {...stroke} opacity="0.3" />
    </svg>
  ),
  orb: (
    <svg viewBox="0 0 32 32" className="h-full w-full">
      <circle cx="16" cy="16" r="10" fill="currentColor" opacity="0.25" />
      <circle cx="16" cy="16" r="6" fill="currentColor" />
    </svg>
  ),
  pressure: (
    <svg viewBox="0 0 32 32" className="h-full w-full">
      <circle cx="16" cy="16" r="6" {...stroke} strokeWidth="3" />
      <circle cx="16" cy="16" r="12" {...stroke} opacity="0.3" strokeDasharray="2 3" />
    </svg>
  ),
  burst: (
    <svg viewBox="0 0 32 32" className="h-full w-full">
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <line
          key={angle}
          x1="16"
          y1="6"
          x2="16"
          y2="11"
          {...stroke}
          strokeLinecap="round"
          transform={`rotate(${angle} 16 16)`}
        />
      ))}
    </svg>
  ),
  confetti: (
    <svg viewBox="0 0 32 32" className="h-full w-full">
      <rect x="7" y="8" width="4" height="4" fill="currentColor" transform="rotate(20 9 10)" />
      <rect x="20" y="6" width="4" height="4" fill="currentColor" transform="rotate(-30 22 8)" />
      <rect x="13" y="14" width="4" height="4" fill="currentColor" transform="rotate(45 15 16)" />
      <rect x="23" y="17" width="4" height="4" fill="currentColor" transform="rotate(10 25 19)" />
      <rect x="6" y="20" width="4" height="4" fill="currentColor" transform="rotate(-15 8 22)" />
      <rect x="16" y="23" width="4" height="4" fill="currentColor" transform="rotate(30 18 25)" />
    </svg>
  ),
  target: (
    <svg viewBox="0 0 32 32" className="h-full w-full">
      <circle cx="16" cy="16" r="8" {...stroke} />
      <path d="M16 3v6M16 23v6M3 16h6M23 16h6" {...stroke} strokeLinecap="round" />
      <circle cx="16" cy="16" r="1.5" fill="currentColor" />
    </svg>
  ),
  heart: (
    <svg viewBox="0 0 32 32" className="h-full w-full">
      <path
        d="M16 27s-10-6.5-10-14a5.5 5.5 0 0 1 10-3 5.5 5.5 0 0 1 10 3c0 7.5-10 14-10 14z"
        fill="currentColor"
      />
    </svg>
  ),
  "pixel-ring": (
    <svg viewBox="0 0 32 32" className="h-full w-full" shapeRendering="crispEdges">
      <path
        d="M12 6h8v4h4v4h4v4h-4v4h-4v4h-8v-4h-4v-4h-4v-4h4v-4h4z M14 10h4v2h-4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  ),
  ink: (
    <svg viewBox="0 0 32 32" className="h-full w-full">
      <path
        d="M16 6c3 0 4 3 7 4s4 4 2 7-1 6-4 7-6-1-8 0-5-2-5-5 1-5 0-8 4-5 8-5z"
        fill="currentColor"
      />
      <circle cx="26" cy="8" r="1.5" fill="currentColor" />
      <circle cx="6" cy="25" r="1" fill="currentColor" />
    </svg>
  ),
  halo: (
    <svg viewBox="0 0 32 32" className="h-full w-full">
      <circle cx="16" cy="16" r="9" {...stroke} strokeWidth="5" opacity="0.25" />
      <circle cx="16" cy="16" r="9" {...stroke} strokeWidth="2" opacity="0.7" />
    </svg>
  ),
  tap: (
    <svg viewBox="0 0 32 32" className="h-full w-full">
      <circle cx="16" cy="16" r="9" fill="currentColor" opacity="0.2" />
      <circle cx="16" cy="16" r="9" {...stroke} />
    </svg>
  ),
};
