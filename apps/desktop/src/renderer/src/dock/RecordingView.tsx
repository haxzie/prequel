import type { DockState } from "../../../shared/contract";
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
        <button
          type="button"
          className={cn(BUTTON, "hover:bg-dock-record hover:text-white")}
          title="Discard recording"
          onClick={() => void window.prequel.dock.discard()}
        >
          <TrashIcon />
        </button>
        <button
          type="button"
          className={cn(BUTTON, "hover:bg-dock-hover")}
          title={paused ? "Resume" : "Pause"}
          onClick={() => void window.prequel.dock.togglePause()}
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
        </button>
        <button
          type="button"
          className={cn(BUTTON, "bg-dock-record text-white hover:brightness-[1.12]")}
          title="Stop recording"
          onClick={() => void window.prequel.dock.stop()}
        >
          <StopIcon />
        </button>
      </div>
    </div>
  );
}
