"use client";

/**
 * The take, played back.
 *
 * A drawn player rather than `controls` on the media element. The native one is
 * a white slab in the middle of a dark stage, it is a different shape in every
 * browser, and its transport sits wherever the element happens to be, which put
 * the buttons somewhere different on every tool. This one is the dock in a
 * different arrangement: same pill, same lane along the bottom of the stage, so
 * the controls are in the same place before, during and after a recording.
 *
 * The media element is still what plays. Nothing here reimplements decoding or
 * seeking; it reads `currentTime` and writes it.
 *
 * Split into a hook and two views because the two halves are drawn into
 * different parts of the stage: the picture goes in the box and the bar goes in
 * the dock's lane, and they are siblings rather than one inside the other.
 */

import { Download, Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import { formatDuration, formatSize } from "@/lib/free-tools/recording";

import type { Recording } from "./useStudio";

const DIVIDER = "h-[18px] w-px flex-none self-center bg-dock-line";

/**
 * The player's state, held whether or not there is a take yet.
 *
 * Takes a nullable recording because hooks cannot be conditional and the stage
 * only has a file in one of its six states. The alternative is mounting the
 * player inside the review branch, which would put its bar inside the picture
 * box rather than in the lane along the bottom.
 */
export function usePlayer(recording: Recording | null) {
  const media = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const barFill = useRef<HTMLSpanElement | null>(null);
  const readout = useRef<HTMLSpanElement | null>(null);
  /** 0 to 1, read by the waveform's own loop. Never state: it moves per frame. */
  const progress = useRef(0);
  const [playing, setPlaying] = useState(false);
  /**
   * The length, in seconds, as the player should treat it.
   *
   * Seeded from what the recorder measured. `MediaRecorder` writes no duration
   * into the file it streams out, so a browser loading the blob reports
   * `Infinity` and a scrub bar has no range to work against. The measured
   * figure is right to the second and is there immediately; the element's own
   * duration replaces it if the browser ever works one out.
   */
  const [duration, setDuration] = useState(0.1);

  // A new take resets the lot. The element is the same DOM node across
  // recordings, so without this the second take opens with the first one's
  // length on the clock and a half-filled bar.
  useEffect(() => {
    setDuration(Math.max(0.1, (recording?.durationMs ?? 0) / 1000));
    setPlaying(false);
    progress.current = 0;
    if (barFill.current) barFill.current.style.transform = "scaleX(0)";
    if (readout.current) readout.current.textContent = "0:00";
  }, [recording]);

  /**
   * The position, written straight into the DOM.
   *
   * Not through React state. This runs on every animation frame while the take
   * plays, and a state update per frame re-renders a tree to move one bar and
   * retype four characters. Same rule the editor's timeline follows.
   */
  const paint = useCallback(() => {
    const element = media.current;
    if (!element) return;

    const at = element.currentTime;
    progress.current = duration > 0 ? Math.min(1, at / duration) : 0;
    if (barFill.current) barFill.current.style.transform = `scaleX(${progress.current})`;
    if (readout.current) readout.current.textContent = formatDuration(at * 1000);
  }, [duration]);

  useEffect(() => {
    if (!playing) return;

    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      paint();
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [paint, playing]);

  const toggle = useCallback(() => {
    const element = media.current;
    if (!element) return;
    if (element.paused) void element.play();
    else element.pause();
  }, []);

  const seek = useCallback(
    (to: number) => {
      const element = media.current;
      if (!element) return;
      element.currentTime = to;
      paint();
    },
    [paint],
  );

  /** Everything the element itself has to be given, in one spread. */
  const bind = {
    src: recording?.url,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onLoadedMetadata: () => {
      const element = media.current;
      if (element && Number.isFinite(element.duration) && element.duration > 0) {
        setDuration(element.duration);
      }
    },
    onTimeUpdate: paint,
  };

  return { media, bind, barFill, readout, progress, playing, duration, toggle, seek };
}

export type PlayerHandle = ReturnType<typeof usePlayer>;

/** The picture: the video itself, or the take drawn as a waveform. */
export function PlayerView({
  player,
  recording,
  kind,
}: {
  player: PlayerHandle;
  recording: Recording;
  kind: "video" | "audio";
}): ReactNode {
  if (kind === "video") {
    return (
      <video
        {...player.bind}
        ref={player.media as RefObject<HTMLVideoElement>}
        playsInline
        onClick={player.toggle}
        className="max-h-full max-w-full cursor-pointer rounded-xl bg-black"
      />
    );
  }

  return (
    <>
      {/* Hidden, and the only reason it exists is that it decodes and plays.
          Everything a person touches is drawn. */}
      <audio
        {...player.bind}
        ref={player.media as RefObject<HTMLAudioElement>}
        className="hidden"
      />
      <Waveform peaks={recording.peaks} progress={player.progress} />
    </>
  );
}

/**
 * The take as a waveform, with the part already played in the brand's orange.
 *
 * Drawn from the peaks the recorder collected off the live meter while the take
 * ran, so it is the sound that was recorded rather than a decoration. A silent
 * take draws a flat line, which is the honest picture of a microphone that was
 * not working.
 */
function Waveform({ peaks, progress }: { peaks: number[]; progress: RefObject<number> }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;

    let drawnAt = -1;
    let frame = 0;

    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = (element.width = element.clientWidth * ratio);
      const height = (element.height = element.clientHeight * ratio);
      ctx.clearRect(0, 0, width, height);

      // One bar every four device pixels, whatever the take's length: half an
      // hour is eighteen thousand peaks and five seconds is fifty, and both
      // have to fill the same canvas.
      const bars = Math.max(1, Math.floor(width / (4 * ratio)));
      const gap = width / bars;
      const played = progress.current * bars;
      // Peaks per bar, and it is deliberately allowed below one. Clamping it up
      // to one maps bar *n* to peak *n* and leaves a short take drawn in the
      // first fifth of the canvas with a flat line after it, which reads as a
      // recording that stopped early.
      const span = peaks.length / bars;

      for (let bar = 0; bar < bars; bar += 1) {
        let peak = 0;
        const from = Math.floor(bar * span);
        const to = Math.max(from + 1, Math.floor((bar + 1) * span));
        for (let i = from; i < to && i < peaks.length; i += 1) {
          peak = Math.max(peak, peaks[i] ?? 0);
        }
        const barHeight = Math.max(2 * ratio, peak * height * 0.9);
        ctx.fillStyle = bar < played ? "#e14b15" : "rgba(236, 238, 241, 0.3)";
        ctx.fillRect(bar * gap + gap * 0.25, (height - barHeight) / 2, gap * 0.5, barHeight);
      }
    };

    // A loop that almost never draws. The position is a ref written by the
    // player's own frame loop, so this one watches it and redraws only when the
    // playhead has crossed into another bar: redrawing on every frame would
    // repaint a few hundred rectangles to move one of them.
    const watch = () => {
      frame = requestAnimationFrame(watch);
      const at = Math.round(progress.current * 1000);
      if (at === drawnAt) return;
      drawnAt = at;
      draw();
    };

    draw();
    frame = requestAnimationFrame(watch);

    // Redrawn on resize too: the canvas is sized off its own box, and a window
    // dragged narrower leaves a stretched waveform otherwise.
    const observer = new ResizeObserver(() => {
      drawnAt = -1;
    });
    observer.observe(element);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [peaks, progress]);

  return <canvas ref={canvas} className="h-full max-h-56 w-full" aria-hidden />;
}

/**
 * Play, position, and what to do with the file.
 *
 * In the dock's lane and in the dock's clothes, because it is the same lane:
 * the controls on these tools never move between states. Download is the white
 * button, as the one thing left to do.
 */
export function PlayerBar({
  player,
  recording,
  onReset,
  onDownload,
}: {
  player: PlayerHandle;
  recording: Recording;
  onReset: () => void;
  /** Fired alongside the save, so the page can make its one pitch. */
  onDownload: () => void;
}): ReactNode {
  return (
    <div className="dock-theme pointer-events-auto flex w-full max-w-3xl items-center gap-2 rounded-[10px] bg-dock-bg p-1.5 text-dock-fg shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
      <button
        type="button"
        aria-label={player.playing ? "Pause" : "Play"}
        title={player.playing ? "Pause" : "Play"}
        onClick={player.toggle}
        className="grid size-[30px] flex-none place-items-center rounded-lg transition-colors hover:bg-dock-hover [&_svg]:size-[17px]"
      >
        {player.playing ? <Pause /> : <Play />}
      </button>

      <span className="flex-none font-mono text-[11px] tabular-nums">
        <span ref={player.readout}>0:00</span>
        <span className="text-dock-muted"> / {formatDuration(player.duration * 1000)}</span>
      </span>

      {/* The track, with a transparent range input over it. The input carries
          the semantics and the keyboard, the bar is what is seen. Same
          arrangement as the sliders in the rail, for the same reason. */}
      <div className="relative h-[30px] min-w-0 flex-1 overflow-hidden rounded-full bg-white/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-dock-selected/70">
        <span
          ref={player.barFill}
          className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-white/15"
          style={{ transform: "scaleX(0)" }}
          aria-hidden
        />
        <input
          type="range"
          aria-label="Position"
          min={0}
          max={player.duration}
          step={0.01}
          defaultValue={0}
          onChange={(event) => player.seek(Number(event.target.value))}
          className="absolute inset-0 size-full cursor-ew-resize appearance-none bg-transparent opacity-0 outline-none"
        />
      </div>

      <span className={DIVIDER} />

      {/* The format and the size live on the title rather than in the bar. Both
          are answers to "what am I about to save", which is a question asked of
          the button itself. */}
      <a
        href={recording.url}
        download={recording.filename}
        onClick={onDownload}
        title={`${recording.label} · ${formatSize(recording.size)}`}
        className="flex h-[30px] flex-none items-center gap-2 rounded-full bg-white px-3.5 text-[13px] font-medium text-black transition-colors hover:bg-white/90"
      >
        <Download className="size-4" />
        Download
      </a>

      <button
        type="button"
        onClick={onReset}
        className="flex h-[30px] flex-none items-center gap-2 rounded-full px-3 text-[13px] font-medium text-dock-fg transition-colors hover:bg-dock-hover"
      >
        <RotateCcw className="size-4" />
        Record again
      </button>
    </div>
  );
}
