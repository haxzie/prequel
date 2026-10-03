import { useCallback, useEffect, useState } from "react";

import type { AuthState, ExportFormat, ShareTranscript } from "../../../shared/contract";
import { GIF_MAX_SHORT_EDGE, type OutputSettings } from "../../../shared/project";
import { cn } from "../lib/cn";
import { formatFileSize } from "../lib/format";
import { useAuth } from "../hooks/useAuth";
import { CheckIcon, CloseIcon, CopyIcon, FolderIcon, LinkIcon } from "./icons";
import { capturePoster } from "./poster";
import type { ExportState } from "./useExport";
import { useShare, type ShareState } from "./useShare";

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
 *
 * One dialog through three states, and the same rectangle in each: the picture
 * at the top, the settings under it, and one full-width button that is always
 * the next thing to do — Export, then the export running in it, then Share. The
 * only control that survives all three is the close cross on the picture, so
 * there is never a second button competing to be pressed.
 */

export function ExportDialog({
  state,
  output,
  still: isStill = false,
  poster,
  transcript,
  onChange,
  onClose,
}: {
  state: ExportState;
  output: OutputSettings;
  /**
   * Whether this is a screenshot rather than a recording.
   *
   * Two of the three controls come off the sheet when it is. A frame rate and a
   * video format are choices about something that plays, and a PNG is neither
   * of those things — offering them would be two controls that change nothing
   * about the file, and one of them would name a codec.
   */
  still?: boolean;
  /** A still of the composition, from the preview canvas. Null if none loaded. */
  poster: string | null;
  /** What was said in the finished file, for the link's chapters. Null if never transcribed. */
  transcript: ShareTranscript | null;
  onChange: (output: OutputSettings) => void;
  onClose: () => void;
}) {
  const { progress, running, frame, result } = state;
  const failed = progress?.stage === "failed";

  const share = useShare(result, frame, output);

  /**
   * A still taken from the finished file, once there is one.
   *
   * Captured as soon as the export lands rather than when Share is pressed, so
   * the decode and seek have already happened by the time anybody clicks —
   * pressing Share should start an upload, not wait on a video element.
   *
   * `poster` — the preview's own grab — remains the fallback. It is the picture
   * shown *during* the export, when there is no file to take one from yet.
   */
  const [still, setStill] = useState<string | null>(null);

  useEffect(() => {
    if (!result) return setStill(null);

    let live = true;
    void capturePoster(result.url, result.isImage).then((shot) => {
      if (live) setStill(shot);
    });

    return () => {
      live = false;
    };
  }, [result]);

  // Escape closes whatever the export is doing, because closing is not
  // cancelling — the render carries on and the title bar keeps reporting it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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
        className="flex w-[400px] flex-col overflow-hidden rounded-2xl border border-editor-line bg-editor-panel shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
      >
        <Preview state={state} poster={poster} shot={still} onClose={onClose} />

        {/* The settings are gone once there is a file.
            They change nothing about an export that has already been written —
            a control that silently applies to the *next* one is worse than no
            control at all — and what the dialog is for at that point is
            getting the file somewhere, which is what the space becomes. */}
        {result ? (
          <Finished
            result={result}
            state={state}
            share={share}
            poster={still ?? poster}
            transcript={transcript}
          />
        ) : (
          <div className="flex flex-col gap-4 p-4">
            {!isStill && (
              <div className="grid grid-cols-[3fr_2fr] gap-3">
                <Choices
                  label="Video format"
                  value={output.format}
                  disabled={running}
                  options={FORMATS}
                  onChange={setFormat}
                />

                <Choices
                  label="Frame rate"
                  value={String(output.fps)}
                  disabled={running}
                  options={RATES[output.format].map((rate) => ({
                    value: String(rate),
                    label: `${rate} fps`,
                  }))}
                  onChange={(rate) => onChange({ ...output, fps: Number(rate) })}
                />
              </div>
            )}

            <Choices
              label={isStill ? "Image size" : "Video quality"}
              value={qualityOf(output.shortEdge)}
              disabled={running}
              options={
                // A GIF's options stop where the format stops being sensible,
                // rather than being offered and then quietly overridden. A PNG
                // has no such ceiling — it is written at whatever the frame is.
                output.format === "gif" && !isStill
                  ? QUALITIES.filter((quality) => allowedForGif(quality.value))
                  : QUALITIES
              }
              // What the choices add up to, on the row that names the last of
              // them: controls that each change one number are much easier to
              // trust when the result is on screen beside them.
              note={`${frame.width} × ${frame.height}${
                isStill ? " · PNG" : output.format === "gif" ? " · silent" : ""
              }`}
              onChange={(quality) => onChange({ ...output, shortEdge: shortEdgeOf(quality) })}
            />

            {failed && (
              <p className="text-[11px] text-dock-record" title={progress?.error?.message}>
                {progress?.error?.message ?? "The export failed."}
              </p>
            )}

            <Action
              tone={running ? "running" : "go"}
              label={buttonLabel(state)}
              // Pressing the button an export is running in is the only way to
              // stop one, now that there is no second button beside it. The
              // offer is added under the pointer rather than swapping the label
              // for it: a bar that silently cancels what it is reporting would
              // be pressed by somebody reading it, and a bar that stops saying
              // how far along it is the moment the pointer rests there — which
              // is exactly where the pointer is left by the press that started
              // it — has hidden the one number it exists to show.
              hoverSuffix={running ? "Cancel" : null}
              fraction={running ? fractionOf(state) : undefined}
              onClick={() => (running ? state.cancel() : void state.start())}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The picture, and what is happening to it.
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
function Preview({
  state,
  poster,
  shot,
  onClose,
}: {
  state: ExportState;
  poster: string | null;
  /** A still of the finished file, for the drag image. */
  shot: string | null;
  onClose: () => void;
}) {
  const { running, result } = state;

  /**
   * Starts the thumbnail playing, silently.
   *
   * `muted` is set on the element here rather than left to the `muted` prop:
   * React writes it as a property during commit, and Chromium decides whether
   * an element may autoplay from what it sees at that moment. Lose the race and
   * the play is refused as unmuted audio — no error anywhere, just a video
   * frozen on its first frame under a caption inviting a drag.
   */
  const play = useCallback((element: HTMLVideoElement | null) => {
    if (!element) return;
    element.muted = true;
    // Rejected when the element is torn down mid-attempt, which is not
    // something to report — the dialog it belonged to has gone.
    void element.play().catch(() => undefined);
  }, []);

  return (
    // Inset on all sides rather than edge to edge: the cross sits over the
    // picture's own corner, and a picture running under the dialog's rounded
    // corners would put it against the window behind instead.
    <div className="p-2 pb-0">
      <div
        className="relative h-[176px] w-full overflow-hidden rounded-xl bg-black"
        draggable={result !== null}
        onDragStart={(event) => {
          if (!result) return;

          // The browser's own drag has to be called off before Electron's can
          // take over: left to run, it offers the page's HTML to the drop
          // target and the file never leaves the app.
          event.preventDefault();
          window.prequel.editor.export.drag(result.path, shot ?? poster ?? BLANK_ICON);
        }}
      >
        {/* `block` on every one of these. An image is inline by default, so its
            line box adds a few pixels of descender under it — which is enough to
            push the bottom of the picture out of a band this exact. */}
        {result ? (
          result.isImage ? (
            <img src={result.url} alt="" className="block size-full object-cover" />
          ) : (
            // Muted and looping: this is a thumbnail, and a preview that starts
            // talking over the editor is not what pressing Export asked for.
            <video
              ref={play}
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

        {/* A still that is being rendered into a file, said twice: a band of
            light crossing the picture, and a spinner over it. The sheen alone
            is easy to miss on a dark frame and the spinner alone leaves the
            picture looking like a paused video — together they read as work
            going on. How far along it is stays on the button, where there is
            room for a number. */}
        {running && (
          <>
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute inset-y-0 left-0 w-1/3 animate-sheen bg-gradient-to-r from-transparent via-white/15 to-transparent motion-reduce:hidden" />
            </div>

            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <Spinner />
            </div>
          </>
        )}

        {/* The tick, and nothing else, says the file exists. Progress is in the
            button — a ring here as well would be the same number twice, and the
            one on the picture is the one that has nowhere to go afterwards. */}
        {result && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="grid size-14 place-items-center rounded-full bg-export text-white shadow-[0_8px_24px_rgba(0,0,0,0.45)] [&_svg]:size-7">
              <CheckIcon />
            </span>
          </div>
        )}

        <button
          type="button"
          aria-label="Close"
          title="Close"
          // Over the picture, which is the one thing on screen at every stage —
          // so closing is in the same place whether an export has been set up,
          // is running, or has landed. Closing is never cancelling.
          className="absolute top-2 right-2 grid size-7 place-items-center rounded-full bg-black/45 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/65 hover:text-white [&_svg]:size-3.5"
          onClick={onClose}
        >
          <CloseIcon />
        </button>

        {/* Over the picture rather than under it. A line of its own below the
            band would be blank until an export finished — which reads as a gap
            between the picture and the controls — and reserving its height only
            makes that gap permanent. `pointer-events-none` so it is not what the
            drag picks up. */}
        {result && (
          <p className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pt-6 pb-2 text-center text-[11px] text-white/85">
            Drag and drop anywhere
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The indeterminate half of an export's progress, over the still.
 *
 * Deliberately says nothing about how far along the render is: the button
 * below carries the percentage, and a second, differently-shaped answer to the
 * same question — a ring that rounds to 64% beside a bar at 65 — is read as
 * one of the two being wrong.
 */
function Spinner() {
  // A radius in the SVG's own units; the circumference is what the dash array
  // is expressed in, so it has to be computed rather than guessed.
  const radius = 20;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg viewBox="0 0 48 48" className="size-9 animate-spin text-white" aria-hidden>
      <circle
        cx="24"
        cy="24"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        className="opacity-20"
      />
      {/* A quarter turn of the ring, which is what makes the spin legible —
          a full circle rotating is a circle standing still. */}
      <circle
        cx="24"
        cy="24"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * 0.75}
      />
    </svg>
  );
}

/**
 * A row of choices, each its own tile.
 *
 * Tiles rather than the inspector's `Segmented`, which is a sliding pill in a
 * trough. That control is built for a panel of them a row apart, where one mark
 * travelling between rows is what keeps the column legible; there are three of
 * them here, all at once, and they are the only thing in the dialog. Separate
 * tiles with the selected one outlined say "these are the settings this file is
 * being written with" at a glance, which is what somebody about to press Export
 * is checking.
 */
function Choices<T extends string>({
  label,
  note,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  /** A read-out beside the label — what the choice below works out to. */
  note?: string;
  value: T;
  options: { value: T; label: string; title?: string }[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", disabled && "opacity-40")}>
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] text-editor-muted">{label}</span>
        {note && (
          <span className="ml-auto truncate text-[11px] tabular-nums text-editor-muted">
            {note}
          </span>
        )}
      </div>

      <div className="flex gap-1.5" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            title={option.title}
            disabled={disabled}
            className={cn(
              "h-9 flex-1 rounded-lg px-1 text-[11px] whitespace-nowrap transition-colors",
              // The ring is inset so a selected tile is exactly as big as an
              // unselected one; a border would add a pixel and nudge the row.
              option.value === value
                ? "bg-white/8 font-medium text-editor-fg ring-1 ring-selected ring-inset"
                : "bg-white/5 text-editor-muted hover:bg-white/10 hover:text-editor-fg",
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * What is under a finished export: where it went, and where it can go next.
 *
 * The file's name and size first, because the one question after a render is
 * "what did I just make". Then the two local destinations as one split row, and
 * the link last and full width — it is the only one of the three that needs an
 * account, an upload and a wait, and it should not look like a third button of
 * the same weight as Copy.
 */
function Finished({
  result,
  state,
  share,
  poster,
  transcript,
}: {
  result: NonNullable<ExportState["result"]>;
  state: ExportState;
  share: ShareState;
  poster: string | null;
  transcript: ShareTranscript | null;
}) {
  const auth = useAuth();
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  /**
   * Whether Share was pressed while signed out.
   *
   * Held so the upload can start by itself once the token arrives. Without it
   * the user signs in, comes back to the app and finds the same button waiting
   * to be pressed a second time — which reads as the first press having failed.
   */
  const [pendingShare, setPendingShare] = useState(false);

  // Reset when the file changes, so a second export does not open with the
  // previous one's tick still showing.
  useEffect(() => {
    setCopied(false);
    setLinkCopied(false);
    setPendingShare(false);
  }, [result.path]);

  const beginShare = useCallback(() => {
    const name = result.path.split("/").pop() ?? "";
    void share.start(name.replace(/\.[^.]+$/, ""), poster, state.durationMs, transcript);
  }, [result.path, poster, share, state.durationMs, transcript]);

  // The other half of `pendingShare`: the sign-in finished, so do what the
  // press asked for. Guarded on `share.progress` being empty so a token
  // arriving while an upload is already running cannot start a second one.
  useEffect(() => {
    if (!pendingShare || auth.status !== "signed-in") return;
    setPendingShare(false);
    if (!share.progress) beginShare();
  }, [pendingShare, auth.status, share.progress, beginShare]);

  const name = result.path.split("/").pop() ?? "";

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline gap-3 px-4 py-3 text-[11px] text-editor-muted">
        {/* `min-w-0` or the name refuses to truncate and pushes the size out of
            the dialog: a flex item's floor is its content width until it is
            told otherwise. */}
        <span className="min-w-0 flex-1 truncate" title={result.path}>
          Exported {name}
        </span>
        {result.bytes !== null && (
          <span className="tabular-nums">{formatFileSize(result.bytes)}</span>
        )}
      </div>

      {/* Edge to edge and split by a rule, so the pair reads as one row of
          places to put the file rather than two buttons that happen to be
          side by side. */}
      <div className="grid grid-cols-2 border-y border-editor-line">
        <Local
          icon={<FolderIcon />}
          label="Reveal in Finder"
          onClick={() => void window.prequel.library.reveal(result.path)}
        />
        <Local
          icon={copied ? <CheckIcon /> : <CopyIcon />}
          label={copied ? "Copied" : "Copy to clipboard"}
          divided
          onClick={async () => {
            const done = await window.prequel.editor.export.copy(result.path);
            setCopied(done.ok);
          }}
        />
      </div>

      <div className="flex flex-col gap-2 p-4">
        {share.url ? (
          // The link replaces the button that made it. Leaving a Share button
          // there afterwards invites a second upload of the same file, and the
          // only thing anyone wants at this point is the URL on the clipboard.
          <div className="flex items-center gap-2 rounded-lg bg-white/8 py-1.5 pr-1.5 pl-2.5">
            <span className="text-export [&_svg]:size-3.5">
              <LinkIcon />
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-editor-muted">
              {share.url.replace(/^https?:\/\//, "")}
            </span>
            <button
              type="button"
              className="rounded px-2 py-1 text-[11px] font-medium text-editor-fg hover:bg-white/10"
              onClick={async () => {
                await navigator.clipboard.writeText(share.url ?? "");
                setLinkCopied(true);
                window.setTimeout(() => setLinkCopied(false), 1600);
              }}
            >
              {linkCopied ? "Copied" : "Copy link"}
            </button>
          </div>
        ) : (
          // Not disabled while waiting: pressing it again falls through to
          // `signIn` below, which starts a fresh handshake. See `SignIn` in
          // `workspace/AccountMenu.tsx`.
          <Action
            tone={share.uploading ? "running" : "go"}
            icon={share.uploading ? undefined : <LinkIcon />}
            label={shareLabel(auth.status, share, pendingShare)}
            hoverSuffix={share.uploading ? "Cancel" : null}
            fraction={share.fraction}
            onClick={() => {
              if (share.uploading) {
                share.cancel();
                return;
              }

              if (auth.status === "signed-in") {
                beginShare();
                return;
              }

              // Signed out. The browser opens, and the effect above finishes the
              // job when the deep link comes back — one press, not two.
              setPendingShare(true);
              void window.prequel.auth.signIn();
            }}
          />
        )}

        {share.error && (
          <p className="text-[11px] text-dock-record" title={share.error}>
            {share.error}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The dialog's one button, whatever it is doing at the time.
 *
 * `fraction` fills it from the left while work runs, rather than putting a
 * separate bar under it: the button *is* the progress, so there is nothing to
 * reserve height for before it starts and nothing to collapse after it ends.
 */
function Action({
  tone,
  icon,
  label,
  hoverSuffix,
  fraction,
  onClick,
}: {
  /** Blue starts something, green is something already going. */
  tone: "go" | "running";
  icon?: React.ReactNode;
  label: string;
  /** Added to the label under the pointer, where pressing does something else. */
  hoverSuffix?: string | null;
  fraction?: number | null;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className={cn(
        "relative isolate flex h-10 items-center justify-center gap-2 overflow-hidden rounded-lg",
        "text-[12px] font-medium text-white transition-[filter] hover:brightness-110 [&_svg]:size-3.5",
        // The track behind an indeterminate fill, so a button that has not been
        // able to report a number yet still looks like one that is working.
        tone === "running" ? "bg-export/25" : "bg-selected",
      )}
    >
      {tone === "running" && (
        // Behind the label, and `transform` rather than `width` — this is
        // repainted on every percent and animating a layout property would
        // reflow the dialog under an export that is still running.
        <span
          aria-hidden="true"
          className="absolute inset-0 -z-10 origin-left bg-export transition-transform duration-150"
          // Empty, not full, while there is no number yet: a bar filled to the
          // end under the word "Preparing" says the opposite of what is true.
          style={{ transform: `scaleX(${String(fraction ?? 0)})` }}
        />
      )}
      {icon}
      {hovered && hoverSuffix ? `${label} · ${hoverSuffix}` : label}
    </button>
  );
}

/** One of the two local destinations under a finished export. */
function Local({
  icon,
  label,
  divided,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  /** Carries the rule between the pair, so the row has no outer edges. */
  divided?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex items-center justify-center gap-2 py-3 text-[11px] text-editor-muted",
        "transition-colors hover:bg-white/5 hover:text-editor-fg [&_svg]:size-3.5",
        divided && "border-l border-editor-line",
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * What the one button says while an export is being set up or is running.
 *
 * Every stage before `rendering` has no frame count to divide by, and a button
 * reading "Exporting 0%" through the first few seconds of a long recording is
 * read as an export that has stalled — so those stages say what they are doing
 * instead of claiming a number.
 */
function buttonLabel(state: ExportState): string {
  const stage = state.progress?.stage;
  if (stage === "preparing") return "Preparing…";
  if (stage === "finalising") return "Finishing…";

  const fraction = fractionOf(state);
  if (fraction !== null) return `Exporting ${String(Math.round(fraction * 100))}%`;

  return stage === "failed" ? "Try again" : "Export";
}

/** How far through the render is, 0–1, or null before there is a total. */
function fractionOf(state: ExportState): number | null {
  const total = state.progress?.framesTotal ?? 0;
  if (total <= 0) return null;
  return Math.min((state.progress?.framesDone ?? 0) / total, 1);
}

/**
 * What the share button says, which is four different things.
 *
 * `waiting` is its own word because the app is doing nothing visible while a
 * browser is open somewhere else, and a button still reading "Share video"
 * through all of that is a button people press again.
 */
function shareLabel(status: AuthState["status"], share: ShareState, pendingShare: boolean): string {
  if (share.uploading) {
    return share.fraction === null
      ? "Preparing…"
      : `Uploading ${String(Math.round(share.fraction * 100))}%`;
  }

  // Says it is still waiting and that the button is worth pressing anyway.
  // Reached only in the moment before the app notices it has focus again — once
  // it does, the status is `signed-out` and this reads "Sign in to share".
  if (status === "waiting") return "Waiting for your browser… · Try again";
  if (status === "signed-out")
    return pendingShare ? "Waiting for your browser…" : "Sign in to share";

  return share.error ? "Try again" : "Share video";
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
 * select nothing at all, and a row of tiles with none of them outlined looks
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
