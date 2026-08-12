import { cn } from "../lib/cn";
import { ExportIcon } from "./icons";
import type { ExportState } from "./useExport";

const STAGE_LABELS: Record<string, string> = {
  preparing: "Preparing…",
  rendering: "Rendering",
  finalising: "Finishing…",
  done: "Exported",
  failed: "Export failed",
  cancelled: "Export cancelled",
};

/**
 * Export, and how it is going.
 *
 * Lives in the title bar rather than behind a dialog: an export takes minutes,
 * and a modal would stop the user doing anything else with the edit while they
 * waited for it.
 */
export function ExportBar({ state }: { state: ExportState }) {
  const { progress, running } = state;

  const percent =
    progress && progress.framesTotal > 0
      ? Math.round((progress.framesDone / progress.framesTotal) * 100)
      : 0;

  return (
    <div className="no-drag flex items-center gap-2">
      {progress && (
        <div className="flex items-center gap-2 text-[11px]">
          <span
            className={cn(progress.stage === "failed" ? "text-dock-record" : "text-editor-muted")}
            title={progress.error?.message}
          >
            {STAGE_LABELS[progress.stage] ?? progress.stage}
            {progress.stage === "rendering" && ` ${percent}%`}
          </span>

          {running && (
            <div className="h-1 w-24 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-editor-accent transition-[width]"
                style={{ width: `${percent}%` }}
              />
            </div>
          )}

          {/* Dismissable rather than auto-hiding: a failure the user did not
              happen to be looking at would otherwise vanish unread. */}
          {!running && (
            <button
              type="button"
              className="text-editor-muted hover:text-editor-fg"
              onClick={state.dismiss}
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* Green, and the only colour in the title bar: this is the button the
          whole window exists to lead to, and it should be findable without
          being read. White on it rather than the panel's near-black, which on a
          mid-green is the pair that fails contrast. Cancel drops the colour —
          a green button that stops something reads as "go". */}
      <button
        type="button"
        className={cn(
          "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium [&_svg]:size-3.5",
          running ? "bg-white/10 text-editor-fg" : "bg-export text-white hover:brightness-110",
        )}
        onClick={() => (running ? state.cancel() : void state.start())}
      >
        {running ? (
          "Cancel"
        ) : (
          <>
            <ExportIcon />
            Export
          </>
        )}
      </button>
    </div>
  );
}
