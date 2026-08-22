import type { ReactNode } from "react";

import { formatAccelerator } from "../../../shared/accelerator";
import { cn } from "../lib/cn";
import { CommandIcon, ControlIcon, OptionIcon, ShiftIcon } from "../editor/icons";

/**
 * A chord, drawn as separate caps.
 *
 * The modifiers are drawn from icon components rather than as `⌘` and `⇧` text,
 * for the reason the welcome flow already gives: a glyph character renders at
 * whatever weight the text font happens to give it, which is rarely the weight
 * the caps are drawn at, and a reader who does not know the symbol gets no help
 * from it either. `formatAccelerator` hands back an `id` per key so the mapping
 * lives here and the shared module stays free of React.
 */
const ICONS: Record<string, ReactNode> = {
  Command: <CommandIcon />,
  Shift: <ShiftIcon />,
  Alt: <OptionIcon />,
  Control: <ControlIcon />,
};

export function Keycaps({ accelerator, muted }: { accelerator: string; muted?: boolean }) {
  const keys = formatAccelerator(accelerator);

  if (keys.length === 0) {
    return <span className="text-[11px] text-editor-muted">Not set</span>;
  }

  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {keys.map((key, i) => (
        <kbd
          // The same modifier cannot appear twice in a chord, and there is only
          // ever one non-modifier, so id plus index is stable across renders.
          key={`${key.id}-${i}`}
          aria-label={key.label}
          title={key.label}
          className={cn(
            "grid h-6 min-w-6 place-items-center rounded-[6px] px-1.5",
            "bg-gradient-to-b from-white/[0.14] to-white/[0.04]",
            "ring-1 ring-white/15 ring-inset",
            "[&_svg]:size-3",
            muted ? "text-editor-muted" : "text-editor-fg",
          )}
        >
          {ICONS[key.id] ?? <span className="text-[11px] font-medium">{key.glyph}</span>}
        </kbd>
      ))}
    </span>
  );
}
