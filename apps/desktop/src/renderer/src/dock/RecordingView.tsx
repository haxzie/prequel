import type { ReactNode } from "react";

import type { DockState } from "../../../shared/contract";
import { useTooltip } from "../components/Tooltip";
import { cn } from "../lib/cn";
import { formatElapsed } from "../lib/format";
import { PauseIcon, PlayIcon, PrompterIcon, PrompterOffIcon, StopIcon, TrashIcon } from "./icons";

/** Smaller than the setup panel's 18px: this view is a pill, not a toolbar. */
const BUTTON = "grid size-[30px] place-items-center rounded-full text-dock-fg [&_svg]:size-[14px]";

/** What the panel collapses into once recording starts. */
export function RecordingView({ state }: { state: DockState }) {
  const paused = state.session.status === "paused";
  const { teleprompter, micId } = state.preferences;

  return (
    // Each end inset by what the control there already has above and below it,
    // so both sit in an even band of panel rather than closer to the pill's
    // arc than to its edge. The two differ because the controls do: the 22px
    // recording light leaves ten, the 30px Stop leaves six. Both are off the
    // panel's inner 42 and not its 44 — the rim is drawn inside the box — and
    // the setup row lands on four for the same reason and a taller tray.
    <div className="drag flex h-full animate-view-in items-center gap-1.5 pr-[6px] pl-[10px]">
      {/* Dragging the pill moves its window; the buttons opt back out. */}
      <div className="drag flex h-full flex-1 items-center gap-2">
        {/* The recording light. A dot matrix the size of the buttons beside
            it, with a wave of red crossing it, where this was a 9px dot that
            faded in and out.
            Bigger because of what it is for: it is the one thing on screen
            saying a take is running, read across a room and out of the corner
            of an eye, and at nine pixels it was the smallest mark on a panel
            whose every other control is thirty.
            The dots come from a mask — see `dot-matrix` — so these two plain
            layers are all that move: a resting fill that keeps the light lit
            between sweeps, and a band of the same red that crosses it. Left
            at `currentColor` so the pair follow the one colour set here.
            Paused, the sweep is simply not rendered and the colour goes
            muted. A light that kept moving while nothing was being recorded
            would be the panel saying the opposite of what it means. */}
        <span
          aria-hidden
          className={cn(
            // Round, like everything else on the bar — by the mask rather
            // than by a radius here, which is what keeps the four corner dots
            // from being cut through and leaving slivers; see `dot-matrix`.
            //
            // Eight short of the buttons it sits beside, where it started
            // level with them. At thirty it was the largest thing on the pill
            // and read as a control somebody could press; the job is to be
            // seen, not to be aimed at, and the disc only has to be
            // unmistakably bigger than the 9px dot it replaced. Twenty-two
            // holds five dots across, which is the figure the grid wants.
            "dot-matrix relative size-[22px] flex-none overflow-hidden",
            paused ? "text-dock-muted" : "text-dock-record",
          )}
        >
          {/* A third of strength: the dots have to be there between sweeps,
              and the further down they rest the further the wave has to climb
              — which is the whole of what the light is doing. Low enough that
              an unlit dot reads as off and not as dim, and no lower, or the
              matrix disappears into the panel between passes and the light
              looks like it is blinking rather than turning over.
              Full where motion is off, which is the one case with no wave. */}
          <span className="absolute inset-0 bg-current opacity-35 motion-reduce:opacity-100" />
          {!paused && (
            <span
              className={
                "absolute inset-y-0 -left-full w-[300%] animate-matrix-sweep bg-gradient-to-r " +
                // Its own colour rather than `currentColor`, which is the
                // resting dots': a band of exactly what is underneath it is a
                // band nobody can see. Only ever drawn while recording, so it
                // has no paused state to follow — see `--dock-record-lit`.
                "from-transparent via-dock-record-lit to-transparent motion-reduce:hidden"
              }
            />
          )}
        </span>
        <span className="text-[15px] font-semibold tabular-nums">
          {formatElapsed(state.session.elapsedMs)}
        </span>
      </div>

      <div className="no-drag flex gap-1">
        {/* The prompter's switch, as on the setup row and for the same
            microphone rule. Hiding keeps the reader's place: the island comes
            back where it was, with the microphone reopened. Main sizes the
            pill for this button only when it is drawn. */}
        {micId !== null && (
          <Control
            label={teleprompter ? "Hide the teleprompter" : "Show the teleprompter"}
            className={cn("hover:bg-dock-hover", !teleprompter && "text-dock-muted")}
            onClick={() =>
              void window.prequel.dock.updatePreferences({ teleprompter: !teleprompter })
            }
          >
            {teleprompter ? <PrompterIcon /> : <PrompterOffIcon />}
          </Control>
        )}
        {/* Before Pause, and away from Stop: the two destructive-looking
            buttons are the ones that end the take, and putting Discard next to
            Stop is how a hurried click loses a recording. */}
        <Control
          // Named for what it actually throws away. While a take is being added
          // to a project, "Discard recording" reads as though the whole
          // recording goes — where in fact only this addition does, and the
          // project is untouched.
          label={state.extending ? "Discard this addition" : "Discard recording"}
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
          label={state.extending ? "Add to the project" : "Stop recording"}
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
