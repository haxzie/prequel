import { useEffect, useState } from "react";

import type { ExportFormat } from "../../../shared/contract";
import { GIF_MAX_SHORT_EDGE, type OutputSettings } from "../../../shared/project";
import { cn } from "../lib/cn";
import { Segmented } from "./controls/inputs";
import { Field } from "./controls/Field";
import { CheckIcon, CloseIcon, CopyIcon, ExportIcon, FolderIcon } from "./icons";
import type { ExportState } from "./useExport";

/** How the resolution choice reads. Values are the frame's shorter edge. */
type Quality = "full" | "1080" | "720" | "480";

const QUALITIES: { value: Quality; label: string; title: string }[] = [
  { value: "full", label: "Full", title: "The frame's own size" },
  { value: "1080", label: "1080p", title: "Scaled so the shorter edge is 1080px" },
  { value: "720", label: "720p", title: "Scaled so the shorter edge is 720px" },
  { value: "480", label: "480p", title: "Scaled so the shorter edge is 480px" },
];

const FORMATS: { value: ExportFormat; label: string; title: string }[] = [
  { value: "h264", label: "MP4", title: "H.264 — plays everywhere" },
  { value: "hevc", label: "HEVC", title: "Smaller at the same quality, less widely playable" },
  { value: "gif", label: "GIF", title: "Silent, looping, and much larger per second" },
];

/**
 * The rates each format offers.
 *
 * GIF's are the ones that divide 100: its only unit of time is the
 * centisecond, so a 30 fps GIF is written as a 3cs delay and plays at 33 —
 * close enough to look right and wrong enough that a screen recording of
 * something timed drifts visibly by the end.
 */
const RATES: Record<ExportFormat, number[]> = {
  h264: [60, 30],
  hevc: [60, 30],
  gif: [20, 10],
};

/**
 * Choosing what an export is, watching it happen, and taking the file away.
 *
 * A dialog rather than a title-bar strip, which is what this used to be. The
 * strip could not hold three settings and it had nowhere to put the finished
 * file, so an export ended by opening Finder over the editor and hoping the
 * user was still there.
 *
 * The old reason for avoiding a modal — an export takes minutes, and a modal
 * would hold the window hostage for all of them — is answered by dismissing it.
 * Closing at any point, mid-render included, leaves the export running; the
 * Export button brings this back with the progress where it left off.
 */

export function ExportDialog({
  state,
  output,
  poster,
  onChange,
  onClose,
}: {
  state: ExportState;
  output: OutputSettings;
  /** A still of the composition, from the preview canvas. Null if none loaded. */
  poster: string | null;
  onChange: (output: OutputSettings) => void;
  onClose: () => void;
}) {
  const { progress, running, frame } = state;
  const failed = progress?.stage === "failed";

  // Escape closes whatever the export is doing, because closing is not
  // cancelling — the render carries on and the title bar keeps reporting it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const rates = RATES[output.format];

  const setFormat = (format: ExportFormat) => {
    onChange({
      format,
      // Both of the others are constrained by the format, and a choice the new
      // format cannot honour has to become one it can — silently keeping 60 fps
      // on a GIF would write a file that claims 60 and plays at 50.
      fps: RATES[format].includes(output.fps) ? output.fps : RATES[format][0]!,
      shortEdge:
        format === "gif"
          ? Math.min(output.shortEdge ?? GIF_MAX_SHORT_EDGE, GIF_MAX_SHORT_EDGE)
          : output.shortEdge,
    });
  };

  return (
    // `no-drag` throughout: the dialog floats over the title bar's drag region,
    // and without it every press inside the header would move the window.
    <div
      className="no-drag absolute inset-0 z-50 grid place-items-center bg-black/50 p-6"
      onPointerDown={(event) => {
        // Click-away, but only on the backdrop itself — a drag that starts on
        // the preview and ends out here must not close what it came from.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Export"
        className="flex w-[380px] flex-col overflow-hidden rounded-2xl border border-editor-line bg-editor-panel shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
      >
        <Header state={state} poster={poster} />

        <div className="flex flex-col gap-3 px-4 py-4">
          <Field label="Type" inline>
            <Segmented
              value={output.format}
              disabled={running}
              options={FORMATS}
              onChange={setFormat}
            />
          </Field>

          <Field label="Quality" inline>
            <Segmented
              value={qualityOf(output.shortEdge)}
              disabled={running}
              options={
                // A GIF's options stop where the format stops being sensible,
                // rather than being offered and then quietly overridden.
                output.format === "gif"
                  ? QUALITIES.filter((quality) => allowedForGif(quality.value))
                  : QUALITIES
              }
              onChange={(quality) => onChange({ ...output, shortEdge: shortEdgeOf(quality) })}
            />
          </Field>

          <Field label="Frame rate" inline>
            <Segmented
              value={String(output.fps)}
              disabled={running}
              options={rates.map((rate) => ({ value: String(rate), label: `${rate}` }))}
              onChange={(rate) => onChange({ ...output, fps: Number(rate) })}
            />
          </Field>

          {/* What the choices above add up to, spelled out: three controls that
              each change one number are much easier to trust when the result is
              on screen next to them. */}
          <p className="text-[11px] tabular-nums text-editor-muted">
            {frame.width} × {frame.height} · {output.fps} fps
            {output.format === "gif" && " · silent"}
          </p>

          {failed && (
            <p className="text-[11px] text-dock-record" title={progress?.error?.message}>
              {progress?.error?.message ?? "The export failed."}
            </p>
          )}
        </div>

        <Actions state={state} onClose={onClose} />
      </div>
    </div>
  );
}

/**
 * The preview, and what is happening to it.
 *
 * Shows the composition before the export and the exported file after it —
 * the same rectangle either way, so the thing that appears at the end is
 * visibly the thing that was going to be made.
 *
 * Full width and a *fixed* height, with everything inside cropped to fill it.
 * Sizing the band to the frame's own aspect instead would make the dialog jump
 * between a squat letterbox and a tall column as the export frame changes — and
 * the header is not what the frame controls are for. A stable band that the
 * picture fills is read as one dialog; a resizing one is read as a bug.
 */
function Header({ state, poster }: { state: ExportState; poster: string | null }) {
  const { running, result, progress } = state;

  return (
    // Edge to edge, and the header is exactly this band: the dialog's own
    // `overflow-hidden` and rounded corners clip it, so it needs no radius of
    // its own, and the controls below start straight after the rule.
    <div
      className="relative h-[176px] w-full overflow-hidden border-b border-editor-line bg-black"
      draggable={result !== null}
      onDragStart={(event) => {
        if (!result) return;

        // The browser's own drag has to be called off before Electron's can
        // take over: left to run, it offers the page's HTML to the drop
        // target and the file never leaves the app.
        event.preventDefault();
        window.prequel.editor.export.drag(result.path, poster ?? BLANK_ICON);
      }}
    >
      {/* `block` on every one of these. An image is inline by default, so its
          line box adds a few pixels of descender under it — which is enough to
          push the bottom of the picture out of a band this exact. */}
      {result ? (
        result.isGif ? (
          <img src={result.url} alt="" className="block size-full object-cover" />
        ) : (
          // Muted and looping: this is a thumbnail, and a preview that starts
          // talking over the editor is not what pressing Export asked for.
          <video
            src={result.url}
            className="block size-full object-cover"
            autoPlay
            loop
            muted
            playsInline
          />
        )
      ) : poster ? (
        <img
          src={poster}
          alt=""
          className={cn("block size-full object-cover", running && "opacity-40")}
        />
      ) : (
        <div className="size-full bg-editor-line" />
      )}

      {running && <Ring progress={progress} />}

      {/* Over the picture rather than under it. A line of its own below the
          band would be blank until an export finished — which reads as a gap
          between the header and the controls — and reserving its height only
          makes that gap permanent. `pointer-events-none` so it is not what the
          drag picks up. */}
      {result && (
        <p className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pt-6 pb-2 text-center text-[11px] text-white/85">
          Drag and drop anywhere
        </p>
      )}
    </div>
  );
}

/**
 * Export progress, over the preview.
 *
 * Determinate as soon as there is a frame count, and a plain sweep before that:
 * preparing has no total to divide by, and a ring pinned at zero for the first
 * few seconds reads as an export that has stalled.
 */
function Ring({ progress }: { progress: ExportState["progress"] }) {
  const total = progress?.framesTotal ?? 0;
  const fraction = total > 0 ? Math.min((progress?.framesDone ?? 0) / total, 1) : null;

  // A radius in the SVG's own units; the circumference is what the dash array
  // is expressed in, so it has to be computed rather than guessed.
  const radius = 20;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="absolute inset-0 grid place-items-center bg-black/40">
      <div className="relative grid size-14 place-items-center">
        <svg
          viewBox="0 0 48 48"
          className={cn("size-14 -rotate-90", fraction === null && "animate-spin")}
        >
          <circle
            cx="24"
            cy="24"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            className="text-white/15"
          />
          <circle
            cx="24"
            cy="24"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            className="text-export transition-[stroke-dashoffset] duration-150"
            strokeDasharray={circumference}
            // A quarter turn while indeterminate, which the spin above carries
            // round — there is nothing to report yet, only that work is going on.
            strokeDashoffset={circumference * (1 - (fraction ?? 0.25))}
          />
        </svg>

        {fraction !== null && (
          <span className="absolute text-[11px] font-medium tabular-nums text-white">
            {Math.round(fraction * 100)}%
          </span>
        )}
      </div>
    </div>
  );
}

/** The buttons, which are a different set at each stage of an export. */
function Actions({ state, onClose }: { state: ExportState; onClose: () => void }) {
  const { running, result } = state;
  const [copied, setCopied] = useState(false);

  // Reset when the file changes, so a second export does not open with the
  // previous one's tick still showing.
  useEffect(() => setCopied(false), [result?.path]);

  return (
    <div className="flex items-center gap-2 border-t border-editor-line px-4 py-3">
      {result ? (
        <>
          <Secondary
            icon={<FolderIcon />}
            label="Show in Finder"
            onClick={() => void window.prequel.library.reveal(result.path)}
          />
          <Secondary
            icon={copied ? <CheckIcon /> : <CopyIcon />}
            label={copied ? "Copied" : "Copy"}
            onClick={async () => {
              const done = await window.prequel.editor.export.copy(result.path);
              setCopied(done.ok);
            }}
          />
          <div className="flex-1" />
          <Primary label="Done" onClick={onClose} />
        </>
      ) : (
        <>
          <div className="flex-1" />
          <Secondary icon={<CloseIcon />} label="Close" onClick={onClose} />
          {running ? (
            <Primary label="Cancel" quiet onClick={state.cancel} />
          ) : (
            <Primary icon={<ExportIcon />} label="Export" onClick={() => void state.start()} />
          )}
        </>
      )}
    </div>
  );
}

function Primary({
  icon,
  label,
  quiet,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  /** Drops the colour. A green button that stops something reads as "go". */
  quiet?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium [&_svg]:size-3.5",
        quiet
          ? "bg-white/10 text-editor-fg hover:bg-white/15"
          : "bg-export text-white hover:brightness-110",
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function Secondary({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-editor-muted hover:bg-white/10 hover:text-editor-fg [&_svg]:size-3.5"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * A last-resort drag image: one opaque pixel.
 *
 * Electron throws on an empty icon, and a throw in main takes the drag with it.
 * This only ever appears if the preview has not drawn a frame yet, which means
 * the composition is not on screen either.
 */
const BLANK_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/**
 * The listed option a stored size corresponds to.
 *
 * Matched against the list rather than formatted from the number: a project
 * written by a build that offered a different set of sizes would otherwise
 * select nothing at all, and a segmented control with no selection looks
 * broken rather than out of date.
 */
function qualityOf(shortEdge: number | null): Quality {
  if (shortEdge === null) return "full";
  return QUALITIES.find((quality) => shortEdgeOf(quality.value) === shortEdge)?.value ?? "full";
}

function shortEdgeOf(quality: Quality): number | null {
  return quality === "full" ? null : Number(quality);
}

function allowedForGif(quality: Quality): boolean {
  const edge = shortEdgeOf(quality);
  return edge !== null && edge <= GIF_MAX_SHORT_EDGE;
}
