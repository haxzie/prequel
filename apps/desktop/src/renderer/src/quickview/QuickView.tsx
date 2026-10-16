import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import type { ProjectComposition, QuickViewCapture } from "../../../shared/contract";
import {
  CheckIcon,
  CloseIcon,
  CopyIcon,
  ExportIcon,
  FolderIcon,
  SpinnerIcon,
} from "../editor/icons";
import { AddClipIcon, StudioIcon, WarningIcon } from "./icons";

/**
 * The card a finished capture lands in.
 *
 * What it replaces is the editor opening by itself. Most captures are sent
 * somewhere rather than edited — a shot into a message, a take into a thread —
 * and for those the editor was a 784 KB window over the screen that had just
 * been recorded, with Export four clicks further in. So the three things
 * anybody wants from a fresh capture are on the picture of it: export it, copy
 * it, open it properly.
 *
 * The buttons name no directory. Main performs every one of them on whatever
 * it is showing — see `main/windows/quickview.ts` — so this view holds what is
 * on screen and nothing that could ask for anything else.
 */

/** Where the card is in the one journey it has. */
type Stage = "idle" | "exporting" | "exported" | "upgrade" | "failed";

/** How long a Copy keeps its tick before going back to saying Copy. */
const COPIED_MS = 1600;

export function QuickView() {
  const [capture, setCapture] = useState<QuickViewCapture | null>(null);
  const [shot, setShot] = useState<ProjectComposition | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  /** Frames written over frames to write, or null before the first tick. */
  const [progress, setProgress] = useState<number | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** True from the moment Dismiss is pressed until the window is gone. */
  const [leaving, setLeaving] = useState(false);

  // Asked for rather than waited for: the push arrives when the capture
  // changes, and the first one is sent while this chunk is still loading.
  useEffect(() => {
    void window.prequel.quickView.state().then(setCapture);
    return window.prequel.quickView.onChanged((next) => {
      setCapture(next);
      // Every bit of the journey belongs to the capture that was on the card,
      // not to the card. Without this the next take opens on the last one's
      // "Exported!", with a Copy that would put the previous file on the
      // pasteboard.
      setShot(null);
      setStage("idle");
      setProgress(null);
      setExported(null);
      setCopied(false);
      setLeaving(false);
    });
  }, []);

  // The picture. Through the composition rather than the raw track, so the
  // card shows what the library will show for this recording — one question,
  // one answer, and `projects.composition` is where it is already answered.
  const dir = capture?.dir ?? null;
  useEffect(() => {
    if (!dir) return;
    let live = true;
    void window.prequel.projects.composition(dir).then((result) => {
      if (live && result.ok) setShot(result.value);
    });
    return () => {
      live = false;
    };
  }, [dir]);

  // Only while an export of ours is running. The channel is a broadcast —
  // every window hears every export — and the terminal stages are the
  // resolved promise below, so nothing here acts on them twice.
  useEffect(() => {
    if (stage !== "exporting") return;
    return window.prequel.editor.export.onProgress((update) => {
      if (update.framesTotal > 0) setProgress(update.framesDone / update.framesTotal);
    });
  }, [stage]);

  const exportNow = useCallback(() => {
    setStage("exporting");
    setProgress(null);
    void window.prequel.quickView.export().then((result) => {
      if (!result.ok) {
        setStage("failed");
        return;
      }
      if (result.value.needsUpgrade) {
        setStage("upgrade");
        return;
      }
      setExported(result.value.path);
      setStage("exported");
    });
  }, []);

  const copyNow = useCallback(() => {
    void window.prequel.quickView.copy(exported);
    setCopied(true);
  }, [exported]);

  // Back to "Copy" on its own. A tick that stays is a button that has stopped
  // saying what it does.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!capture) return null;

  const still = capture.still;

  return (
    // The window is `PANEL_INSET` larger all round, which is the margin the
    // shadow is cast into — the same arrangement as the dock and the camera
    // bubble, and `overCard` in main measures the rectangle this leaves.
    //
    // The card is the whole of it and the controls float on the picture. They
    // were straddling its edges, which made the card smaller than its window
    // for no gain: the capture is the thing being looked at, and a pill hanging
    // off a corner is a pill over the desktop rather than over the take.
    //
    // The whole card drags: it is a thing laid on the desktop over the screen
    // somebody has just recorded, and the first thing they may want is it out
    // of the way of what is underneath. Every control inside is `no-drag`.
    <div
      // Keyed on the capture, so the entrance plays again for the next one.
      // The window is reused and this component stays mounted across captures;
      // without a key the second take's card would simply appear.
      key={capture.dir}
      className={
        // The frame: a thick band of dark glass with the capture seated inside
        // it. Padding rather than a border property — a 8px border would be a
        // flat ring of colour, and this is a tinted sheet the desktop shows
        // through, which is what gives the card depth before the shadow does
        // any work.
        //
        // No `backdrop-blur` on this one, unlike the pills. A backdrop filter
        // can only blur what is behind it *in the page*, and behind the frame
        // is the transparent window: the desktop is not the renderer's to
        // sample, so a blur here costs a compositing layer and changes
        // nothing. The pills sit over the capture, which is why theirs works.
        //
        // The shadow is three layers rather than one. A single wide blur is a
        // grey cloud under the card; a contact shadow, a mid one and a wide
        // soft one is how something looks like it is resting above a surface.
        // All of it is cast into `--quickview-margin`, and the two have to
        // agree or the blur is cut off square — see `QUICK_VIEW_MARGIN`.
        "drag relative m-(--quickview-margin) flex-1 rounded-[18px] p-[8px] " +
        "border border-white/10 bg-black/45 " +
        "shadow-[0_2px_5px_rgba(0,0,0,0.3),0_10px_22px_-8px_rgba(0,0,0,0.45),0_26px_54px_-14px_rgba(0,0,0,0.6)] " +
        (leaving ? "animate-quickview-out" : "animate-quickview-in")
      }
      // The window goes when the exit has actually finished, rather than after
      // a duration repeated here that would drift from the one in the CSS.
      // `animationend` bubbles, and the spinner inside is an animation too —
      // so only this element's own. The spinner never ends, which is exactly
      // the sort of thing that makes a bug like this show up months later.
      onAnimationEnd={(event) => {
        if (leaving && event.target === event.currentTarget) {
          void window.prequel.quickView.close();
        }
      }}
    >
      {/* The capture, clipped inside the frame. Its radius is the frame's less
          the band, so the two arcs are concentric — equal radii would leave the
          inner corner looking tighter than the outer one. */}
      <div className="h-full w-full overflow-hidden rounded-[10px] bg-[#0e0f12]">
        <Preview shot={shot} />
      </div>

      {/* Dismiss. Inside the top-right corner, the only control that is a
          circle because it is the only one with no word on it. */}
      <Pill
        round
        label="Dismiss"
        className="absolute top-[14px] right-[14px]"
        onClick={() => setLeaving(true)}
      >
        <CloseIcon />
      </Pill>

      {/* The status slot, in the middle of the picture: the one thing on the
          card that is either the next step or an answer, and the only place
          nothing else competes with it. Open in Studio until an export says
          otherwise — one pill throughout, so the card never changes shape. */}
      {/* Laid over the whole card so the pill is centred on the picture
          rather than on a row — and so click-through, or it would be a sheet
          of glass over the two buttons below it. */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        {stage === "exporting" ? (
          <Pill muted label={exportingLabel(progress)}>
            <SpinnerIcon />
          </Pill>
        ) : stage === "exported" ? (
          <Pill muted label="Exported" tone="done">
            <CheckIcon />
          </Pill>
        ) : stage === "failed" ? (
          // Said out loud. An export that failed silently leaves a card whose
          // button looks like it missed, which is indistinguishable from a
          // broken button — and the reason is in the log either way.
          <Pill muted label="Export failed" tone="warn">
            <WarningIcon />
          </Pill>
        ) : stage === "upgrade" ? (
          <Pill label="Upgrade to export" onClick={() => void window.prequel.licence.upgrade()}>
            <ExportIcon />
          </Pill>
        ) : (
          <Pill label="Open in Studio" onClick={() => void window.prequel.quickView.edit()}>
            <StudioIcon />
          </Pill>
        )}
      </div>

      {/* Bottom left: the file. Export before there is one, Finder after. */}
      <div className="absolute bottom-[14px] left-[14px]">
        {stage === "exported" && exported ? (
          <Pill
            label="Open in Finder"
            onClick={() => void window.prequel.quickView.reveal(exported)}
          >
            <FolderIcon />
          </Pill>
        ) : stage === "exporting" ? null : (
          <Pill label={stage === "failed" ? "Try again" : "Export"} onClick={exportNow}>
            <ExportIcon />
          </Pill>
        )}
      </div>

      {/* Bottom right: what to do with it. A shot can be copied straight
          away — there is nothing to render, the picture is the picture — and a
          take can only be copied once there is a file to copy, so until then
          this is the other thing a take invites: more of it. */}
      <div className="absolute right-[14px] bottom-[14px]">
        {still || stage === "exported" ? (
          <Pill label={copied ? "Copied" : "Copy"} onClick={copyNow}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Pill>
        ) : stage === "exporting" ? null : (
          <Pill label="Add Clip" onClick={() => void window.prequel.quickView.addClip()}>
            <AddClipIcon />
          </Pill>
        )}
      </div>
    </div>
  );
}

/** "Exporting" until there are frames to count, and a figure after. */
function exportingLabel(progress: number | null): string {
  if (progress === null) return "Exporting…";
  return `Exporting ${String(Math.round(progress * 100))}%`;
}

/**
 * The capture itself.
 *
 * A screenshot is a PNG and an `<img>`; a take is a video seeked to the frame
 * the library's tile uses, which is a quarter of the way into the *kept*
 * material rather than the first frame — a recording opens on a click or a
 * window still settling, and the first frame is the one moment guaranteed to
 * be unrepresentative. Nothing plays: this is a picture of what was captured,
 * not a player.
 */
function Preview({ shot }: { shot: ProjectComposition | null }) {
  const video = useRef<HTMLVideoElement>(null);
  const at = shot?.screen?.at ?? 0;

  if (!shot?.screen) {
    // A capture whose picture cannot be read still gets a card: the buttons
    // are what the card is for, and all of them work without it.
    return <div className="h-full w-full bg-[#0e0f12]" />;
  }

  if (shot.stillScreen) {
    return <img src={shot.screen.url} alt="" className="h-full w-full object-cover" />;
  }

  return (
    <video
      ref={video}
      src={shot.screen.url}
      muted
      playsInline
      preload="metadata"
      // Seeked once the file knows how long it is. Setting `currentTime`
      // before metadata arrives is ignored, which leaves the element on frame
      // zero with nothing to say it was asked for another.
      onLoadedMetadata={() => {
        const element = video.current;
        if (element) element.currentTime = Math.min(at, element.duration || at);
      }}
      className="h-full w-full object-cover"
    />
  );
}

/**
 * One control on the card: a pill of frosted glass over the capture.
 *
 * Floating rather than in a toolbar, because the picture is what tells you
 * which capture this is and a strip of chrome would cover it. `no-drag` on
 * every one: the card itself is the drag handle, and a button inside a drag
 * region moves the window instead of activating.
 */
function Pill({
  label,
  children,
  onClick,
  round = false,
  muted = false,
  tone,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  /** No word on it, so it is drawn as a circle. */
  round?: boolean;
  /** Says something rather than does something: no hover, no press. */
  muted?: boolean;
  tone?: "done" | "warn";
  className?: string;
}) {
  // Frosted, not painted. The fill is thin enough that the capture behind it
  // smears through the blur — which is what makes these read as glass laid on
  // the picture rather than as black chips stuck over it. `backdrop-filter`
  // only sees what is behind it *in this window*, and the picture fills the
  // window, so there is always something for it to work on.
  //
  // The saturation is the other half: a plain blur of a dark screenshot comes
  // out grey, and a sheet of glass takes the colour of what it is over.
  //
  // One rim, all the way round, and nothing inside it. There was an inset 1px
  // white line along the top as well, for a bevel — and a hairline directly
  // under a border of nearly the same light is not a bevel, it is a thicker
  // top edge: two 1px lines at 2× is four device pixels of light on one side
  // of the pill and two on the other three. It read as a border that had been
  // set wrong, which is exactly what it was.
  const base =
    "no-drag pointer-events-auto flex items-center gap-2 rounded-full " +
    "border border-white/15 bg-black/40 text-white " +
    "backdrop-blur-2xl backdrop-saturate-150 " +
    "shadow-[0_8px_22px_rgba(0,0,0,0.45)] " +
    "[&_svg]:size-[14px] [&_svg]:shrink-0";
  const shape = round
    ? "size-[30px] justify-center [&_svg]:size-[13px]"
    : "h-[30px] px-3 text-[12px] font-medium";
  const behaviour = muted ? "cursor-default" : "hover:bg-black/55 active:scale-[0.98]";

  return (
    <button
      type="button"
      aria-label={label}
      title={round ? label : undefined}
      disabled={muted}
      onClick={onClick}
      className={`${base} ${shape} ${behaviour} ${className}`}
    >
      <span
        className={
          tone === "done" ? "text-emerald-400" : tone === "warn" ? "text-amber-400" : undefined
        }
      >
        {children}
      </span>
      {round ? null : <span>{label}</span>}
    </button>
  );
}
