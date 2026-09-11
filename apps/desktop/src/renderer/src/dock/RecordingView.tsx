import type { ReactNode } from "react";

import type { DockState } from "../../../shared/contract";
import { useTooltip } from "../components/Tooltip";
import { cn } from "../lib/cn";
import { formatElapsed } from "../lib/format";
import { PauseIcon, PlayIcon, StopIcon, TrashIcon } from "./icons";

/** Smaller than the setup panel's 18px: this view is a pill, not a toolbar. */
const BUTTON = "grid size-[30px] place-items-center rounded-lg text-dock-fg [&_svg]:size-[14px]";

/** What the panel collapses into once recording starts. */
export function RecordingView({ state }: { state: DockState }) {
  const paused = state.session.status === "paused";

  return (
    <div className="drag flex h-full animate-view-in items-center gap-1.5 pr-1.5 pl-3">
      {/* Dragging the pill moves its window; the buttons opt back out. */}
      <div className="drag flex h-full flex-1 items-center gap-2">
        <span
          className={cn(
            "size-[9px] rounded-full",
            paused ? "bg-dock-muted" : "animate-pulse-dot bg-dock-record",
          )}
        />
        <span className="text-[15px] font-semibold tabular-nums">
          {formatElapsed(state.session.elapsedMs)}
        </span>
      </div>

      <div className="no-drag flex gap-1">
        {/* Before Pause, and away from Stop: the two destructive-looking
            buttons are the ones that end the take, and putting Discard next to
            Stop is how a hurried click loses a recording. */}
        <Control
          label="Discard recording"
          className="hover:bg-dock-record hover:text-white"
          onClick={() => void window.prequel.dock.discard()}
        >
          <TrashIcon />
        </Control>
        <Control
          label={paused ? "Resume" : "Pause"}
          className="hover:bg-dock-hover"
          onClick={() => void window.prequel.dock.togglePause()}
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
        </Control>
        <Control
          label="Stop recording"
          className="bg-dock-record text-white hover:brightness-[1.12]"
          onClick={() => void window.prequel.dock.stop()}
        >
          <StopIcon />
        </Control>
      </div>
    </div>
  );
}

/**
 * One of the pill's buttons, labelled by the shared tooltip.
 *
 * Not `IconButton`: that one is the setup row's 18px control with its own
 * hover and selected fills, and this pill's glyphs are smaller and coloured
 * per button. Layering a second set of hover classes over the first would
 * leave the outcome to stylesheet order — the reason `cn` never overrides.
 */
function Control({
  label,
  className,
  onClick,
  children,
}: {
  label: string;
  className: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const tooltip = useTooltip(label, "top");
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(BUTTON, className)}
      onClick={onClick}
      {...tooltip}
    >
      {children}
    </button>
  );
}
