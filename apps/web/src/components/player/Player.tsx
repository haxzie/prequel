"use client";

import {
  Captions,
  CaptionsOff,
  Keyboard,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";

import { ScrubBar, type ScrubBarHandle } from "./ScrubBar";
import { Shortcuts, shortcutFor, type Shortcut } from "./shortcuts";
import {
  chapterAt,
  clampTime,
  formatRate,
  formatTime,
  RATES,
  stepRate,
  type Chapter,
} from "./time";

/** What the page around the player may ask of it. */
export interface PlayerHandle {
  /** Goes there, and plays: seeking from a list is intent to watch. */
  seek(seconds: number): void;
}

/** How long the controls stay after the pointer stops, while playing. */
const HIDE_AFTER_MS = 2_400;

/** How long a keyboard nudge — "+10s", "1.5×" — is shown for. */
const FLASH_MS = 700;

/**
 * One frame at the rate most recordings are exported at. `<video>` has no
 * frame-step API, so this is a seek; at 30 fps it lands on the next frame and
 * at 60 it lands two on, which is still what "a nudge" means.
 */
const FRAME_S = 1 / 30;

const RATE_KEY = "prequel.player.rate";
const VOLUME_KEY = "prequel.player.volume";

/**
 * A video player with its own controls.
 *
 * The browser's own were here before, and they are the reason this exists:
 * they look different in every browser, none of them shows where a recording
 * changes subject, and the keyboard does nothing until the player has been
 * clicked. A share link is opened by somebody who has never seen this page,
 * and the first thing they do is press space.
 *
 * Per-frame values — the played fraction, the clock — are written straight to
 * the DOM by `ScrubBar` and the timecode ref, never through React state. The
 * loop runs at the display rate while playing, and a render per frame of a
 * component this size is a dropped frame of the video under it.
 */
export function Player({
  ref,
  src,
  poster,
  title,
  durationMs,
  width,
  height,
  chapters,
  captions,
  onChapter,
  onFrame,
}: {
  ref?: Ref<PlayerHandle>;
  src: string;
  poster: string | null;
  title: string;
  /** From the row, for the clock before the file's own metadata has loaded. */
  durationMs: number;
  /**
   * The file's frame, from the row. Zero when an old row never recorded it.
   *
   * The box is sized from these before a byte of video has arrived. Left to
   * the `<video>` element it is 150 pixels tall until the metadata loads —
   * which for a large file with its index at the end is a while — and the
   * page jumps by the height of the picture when it does.
   */
  width: number;
  height: number;
  chapters: readonly Chapter[];
  /** The subtitle track, when the recording was transcribed. Null hides the toggle. */
  captions: { src: string; language: string } | null;
  /** The chapter now playing, or -1. Fired only when it changes. */
  onChapter?: (index: number) => void;
  /** The file's own frame, once its metadata has loaded. For rows that never recorded one. */
  onFrame?: (width: number, height: number) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const bar = useRef<ScrubBarHandle>(null);
  const clock = useRef<HTMLSpanElement>(null);

  const [playing, setPlaying] = useState(false);
  /** Whether play has ever been pressed. The poster and the big button go on the first press. */
  const [started, setStarted] = useState(false);
  const [duration, setDuration] = useState(durationMs / 1000);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [canPip, setCanPip] = useState(false);
  /**
   * Whether subtitles are showing. Off on every load, and not remembered the
   * way speed and volume are: a recording may already have captions burned
   * into it, and a preference carried over from one that did not would put a
   * second copy of every line under the first — which reads as a bug, on a
   * page whose viewer has no idea a setting exists.
   */
  const [subtitles, setSubtitles] = useState(false);
  const [chapter, setChapter] = useState(-1);
  const [controls, setControls] = useState(true);
  const [menu, setMenu] = useState<"rate" | "keys" | null>(null);
  const [flash, setFlash] = useState<{ text: string; key: number } | null>(null);

  const hideTimer = useRef<number | null>(null);
  const flashTimer = useRef<number | null>(null);
  const clickTimer = useRef<number | null>(null);
  const chapterRef = useRef(-1);
  const chaptersRef = useRef(chapters);
  chaptersRef.current = chapters;
  const onChapterRef = useRef(onChapter);
  onChapterRef.current = onChapter;

  /** Writes the clock, the bar, and the chapter for wherever the video is now. */
  const paint = useCallback(() => {
    const element = video.current;
    if (!element) return;

    const at = element.currentTime;
    const total = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : 0;

    bar.current?.paint(at, total, element.buffered);
    if (clock.current) clock.current.textContent = formatTime(at, total);

    const index = chapterAt(chaptersRef.current, at);
    if (index !== chapterRef.current) {
      chapterRef.current = index;
      setChapter(index);
      onChapterRef.current?.(index);
    }
  }, []);

  // The loop. Started by `play`, stopped by `pause`, and every frame in
  // between writes to the DOM directly — see the component comment.
  useEffect(() => {
    if (!playing) return;

    let handle = 0;
    const tick = () => {
      paint();
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, paint]);

  // What the last visit chose. Read after mount rather than as initial state:
  // this renders on the server too, where there is no storage, and a
  // different first render on the client is a hydration error.
  useEffect(() => {
    const element = video.current;
    if (!element) return;

    const storedRate = Number(window.localStorage.getItem(RATE_KEY));
    if (RATES.includes(storedRate as (typeof RATES)[number])) {
      element.playbackRate = storedRate;
      setRate(storedRate);
    }

    const storedVolume = window.localStorage.getItem(VOLUME_KEY);
    if (storedVolume !== null) {
      const parsed = Number(storedVolume);
      if (parsed >= 0 && parsed <= 1) {
        element.volume = parsed;
        setVolume(parsed);
      }
    }

    setCanPip(
      typeof document !== "undefined" &&
        "pictureInPictureEnabled" in document &&
        document.pictureInPictureEnabled,
    );
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const showControls = useCallback(() => {
    setControls(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControls(false), HIDE_AFTER_MS);
  }, []);

  // Paused, the controls stay: there is nothing under them to look at that is
  // not going to still be there.
  useEffect(() => {
    if (playing) showControls();
    else {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      setControls(true);
    }
  }, [playing, showControls]);

  const say = useCallback((text: string) => {
    setFlash({ text, key: Date.now() });
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), FLASH_MS);
  }, []);

  const toggle = useCallback(() => {
    const element = video.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => undefined);
    else element.pause();
  }, []);

  const seekTo = useCallback(
    (seconds: number) => {
      const element = video.current;
      if (!element) return;
      element.currentTime = clampTime(seconds, element.duration);
      // The loop is not running while paused, so the bar is painted here or
      // it does not move until play.
      paint();
    },
    [paint],
  );

  const seekBy = useCallback(
    (seconds: number) => {
      const element = video.current;
      if (!element) return;
      seekTo(element.currentTime + seconds);
      say(
        `${seconds > 0 ? "+" : "−"}${Math.abs(seconds) < 1 ? "1 frame" : `${Math.abs(seconds)}s`}`,
      );
    },
    [seekTo, say],
  );

  const changeRate = useCallback(
    (next: number) => {
      const element = video.current;
      if (!element) return;
      element.playbackRate = next;
      setRate(next);
      window.localStorage.setItem(RATE_KEY, String(next));
      say(formatRate(next));
    },
    [say],
  );

  const changeVolume = useCallback(
    (next: number, announce = true) => {
      const element = video.current;
      if (!element) return;
      const clamped = Math.min(Math.max(next, 0), 1);
      element.volume = clamped;
      // Turning the volume up is meant to be heard, so it unmutes; setting it
      // to nothing is muting by another name.
      element.muted = clamped === 0;
      window.localStorage.setItem(VOLUME_KEY, String(clamped));
      if (announce) say(`${Math.round(clamped * 100)}%`);
    },
    [say],
  );

  const toggleMute = useCallback(() => {
    const element = video.current;
    if (!element) return;
    // Unmuting at zero volume is silence with the icon saying otherwise.
    if (element.muted && element.volume === 0) element.volume = 0.5;
    element.muted = !element.muted;
    say(element.muted ? "Muted" : `${Math.round(element.volume * 100)}%`);
  }, [say]);

  const toggleFullscreen = useCallback(() => {
    const element = frame.current;
    const media = video.current as
      (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!element || !media) return;

    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (element.requestFullscreen) {
      void element.requestFullscreen().catch(() => undefined);
    } else if (media.webkitEnterFullscreen) {
      // iPhone Safari: no element goes full screen except a video, and that
      // through its own API. The browser's controls take over there, which is
      // the one place they are the right ones.
      media.webkitEnterFullscreen();
    }
  }, []);

  // The track's mode is set from state rather than by the `default` attribute,
  // so it follows the toggle and survives the element being re-rendered. It
  // is `hidden` rather than `disabled` when off so the browser still loads
  // the cues, and turning them on is instant.
  useEffect(() => {
    const track = video.current?.textTracks[0];
    if (!track) return;
    track.mode = subtitles ? "showing" : "hidden";
  }, [subtitles, captions]);

  const toggleSubtitles = useCallback(() => {
    if (!captions) return;
    setSubtitles((on) => {
      say(on ? "Subtitles off" : "Subtitles on");
      return !on;
    });
  }, [captions, say]);

  const togglePip = useCallback(() => {
    const element = video.current;
    if (!element || !document.pictureInPictureEnabled) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture();
    else void element.requestPictureInPicture().catch(() => undefined);
  }, []);

  const goToChapter = useCallback(
    (direction: 1 | -1) => {
      const list = chaptersRef.current;
      if (list.length === 0) return;
      const element = video.current;
      if (!element) return;

      const current = chapterAt(list, element.currentTime);
      // Backwards from a few seconds into a chapter goes to its start, not to
      // the one before — the way a track skip does on any player.
      const into = current >= 0 ? element.currentTime - list[current]!.at : 0;
      const target = direction === 1 ? current + 1 : into > 3 ? current : Math.max(current - 1, 0);

      const chapter = list[target];
      if (!chapter) return;
      seekTo(chapter.at);
      say(chapter.title);
    },
    [seekTo, say],
  );

  useImperativeHandle(
    ref,
    () => ({
      seek(seconds) {
        seekTo(seconds);
        void video.current?.play().catch(() => undefined);
      },
    }),
    [seekTo],
  );

  // The keyboard, for the whole page. A share link *is* the video, so the keys
  // work without the player having been clicked first — the one thing every
  // native player gets wrong — and stop working inside anything editable, so
  // renaming a recording in the dashboard does not pause it on every space.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Escape") {
        if (menu) {
          setMenu(null);
          event.preventDefault();
        }
        return;
      }

      const shortcut = shortcutFor(event, frame.current?.contains(document.activeElement) ?? false);
      if (!shortcut) return;

      event.preventDefault();
      showControls();
      act(shortcut);
    };

    const act = (shortcut: Shortcut) => {
      const element = video.current;
      if (!element) return;

      switch (shortcut.type) {
        case "toggle":
          return toggle();
        case "seekBy":
          return seekBy(shortcut.seconds);
        case "frame":
          // Stepping while playing would fight the loop; the nudge pauses,
          // which is what somebody hunting for a frame wants anyway.
          element.pause();
          return seekBy(shortcut.direction * FRAME_S);
        case "seekFraction":
          return seekTo(element.duration * shortcut.fraction);
        case "start":
          return seekTo(0);
        case "end":
          return seekTo(element.duration);
        case "mute":
          return toggleMute();
        case "volume":
          return changeVolume(element.volume + shortcut.delta);
        case "rate":
          return changeRate(stepRate(element.playbackRate, shortcut.direction));
        case "fullscreen":
          return toggleFullscreen();
        case "pip":
          return togglePip();
        case "captions":
          return toggleSubtitles();
        case "chapter":
          return goToChapter(shortcut.direction);
        case "help":
          return setMenu((open) => (open === "keys" ? null : "keys"));
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    menu,
    toggle,
    seekBy,
    seekTo,
    toggleMute,
    changeVolume,
    changeRate,
    toggleFullscreen,
    togglePip,
    toggleSubtitles,
    goToChapter,
    showControls,
  ]);

  // A click plays; two make it full screen. The first is held for as long as a
  // second might follow, or a double-click would play and pause and then go
  // full screen — three things for one gesture.
  const onSurfaceClick = () => {
    if (clickTimer.current) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
      toggleFullscreen();
      return;
    }
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null;
      toggle();
    }, 220);
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    // A touch is not a hover: on a phone the controls come and go by tapping,
    // and treating every scroll past the player as a hover keeps them up.
    if (event.pointerType === "touch") return;
    showControls();
  };

  const onMedia = {
    onPlay: () => {
      setPlaying(true);
      setStarted(true);
    },
    onPause: () => {
      setPlaying(false);
      paint();
    },
    onLoadedMetadata: () => {
      const element = video.current!;
      setDuration(element.duration);
      if (element.videoWidth > 0 && element.videoHeight > 0) {
        onFrame?.(element.videoWidth, element.videoHeight);
      }
      paint();
    },
    // `progress` is how the buffered range grows while paused; the loop covers
    // it otherwise.
    onProgress: paint,
    onSeeked: paint,
    onVolumeChange: () => {
      const element = video.current!;
      setMuted(element.muted);
      setVolume(element.volume);
    },
    onRateChange: () => setRate(video.current!.playbackRate),
    onEnded: () => setPlaying(false),
  };

  const hidden = playing && !controls && !menu;
  const aspectRatio = width > 0 && height > 0 ? `${width} / ${height}` : "16 / 9";
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const current = chapter >= 0 ? chapters[chapter] : undefined;

  return (
    <div
      ref={frame}
      className={`group/player relative isolate w-full select-none overflow-hidden bg-black text-white ${
        hidden ? "cursor-none" : ""
      }`}
      // Full screen, the browser sizes the box; on the page, the file's own
      // proportions do, and `Watch` caps the width so the height never passes
      // most of the viewport.
      style={fullscreen ? undefined : { aspectRatio }}
      tabIndex={-1}
      aria-label={title}
      onPointerMove={onPointerMove}
      onPointerLeave={() => {
        if (playing && !menu) setControls(false);
      }}
    >
      <video
        ref={video}
        src={src}
        poster={poster ?? undefined}
        playsInline
        // `metadata` rather than `auto`: the browser fetches enough to draw the
        // scrubber and no more, so opening a link does not pull a hundred
        // megabytes down for somebody who never presses play.
        preload="metadata"
        // The box above decides the size; the picture fills it and is
        // letterboxed when the two disagree.
        className="block h-full w-full bg-black object-contain"
        onClick={onSurfaceClick}
        {...onMedia}
      >
        {/* Same-origin, and it has to be — see `captions.vtt/route.ts`. Not
            `default`: the mode is driven from state above. */}
        {captions && (
          <track
            kind="subtitles"
            src={captions.src}
            srcLang={captions.language}
            label="Subtitles"
            onLoad={() => {
              const track = video.current?.textTracks[0];
              if (track) track.mode = subtitles ? "showing" : "hidden";
            }}
          />
        )}
      </video>

      {/* The big button, until the first play. After that a paused video keeps
          its frame clear: the transport is in the bar, and a badge over the
          picture every time somebody pauses to read something is in the way of
          the thing they paused to read. */}
      {!started && (
        <button
          type="button"
          aria-label="Play"
          className="absolute inset-0 grid place-items-center"
          onClick={toggle}
        >
          <span className="grid size-16 place-items-center rounded-full bg-white/90 text-black shadow-lg transition-transform group-hover/player:scale-105">
            <Play className="ml-1 size-7 fill-current" />
          </span>
        </button>
      )}

      {/* What a key just did, for the moment it takes to see it. Keyed so two
          presses in a row restart the fade rather than sharing one. */}
      {flash && (
        <div
          key={flash.key}
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/70 px-4 py-2 text-sm font-medium tabular-nums text-white backdrop-blur"
        >
          {flash.text}
        </div>
      )}

      {menu === "keys" && (
        <Shortcuts
          hasChapters={chapters.length > 0}
          hasCaptions={captions !== null}
          onClose={() => setMenu(null)}
        />
      )}

      <div
        className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pb-2 pt-10 transition-opacity duration-200 ${
          hidden ? "opacity-0" : "opacity-100"
        }`}
        // Pointer events off while hidden, so an invisible bar is not what a
        // click on the bottom of the picture lands on.
        style={{ pointerEvents: hidden ? "none" : "auto" }}
      >
        <ScrubBar
          ref={bar}
          chapters={chapters}
          duration={duration}
          onSeek={seekTo}
          onScrubStart={() => video.current?.pause()}
          label={title}
        />

        <div className="mt-1.5 flex items-center gap-1">
          <Control label={playing ? "Pause (k)" : "Play (k)"} onClick={toggle}>
            {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
          </Control>

          {/* The slider is in the group with the button and appears on hover of
              either, so the bar has one icon's worth of volume until somebody
              reaches for it. */}
          <div className="group/volume flex items-center">
            <Control label={muted ? "Unmute (m)" : "Mute (m)"} onClick={toggleMute}>
              <VolumeIcon />
            </Control>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label="Volume"
              onChange={(event) => changeVolume(Number(event.target.value), false)}
              className="h-1 w-0 cursor-pointer opacity-0 transition-all duration-200 accent-white group-hover/volume:w-16 group-hover/volume:opacity-100 group-focus-within/volume:w-16 group-focus-within/volume:opacity-100"
            />
          </div>

          <div className="ml-1 flex min-w-0 items-center gap-2 text-xs tabular-nums">
            {/* Rendered once; the loop rewrites its text. */}
            <span>
              <span ref={clock}>{formatTime(0, duration)}</span>
              <span className="text-white/60"> / {formatTime(duration)}</span>
            </span>
            {current && (
              <>
                <span className="text-white/40" aria-hidden="true">
                  ·
                </span>
                <span className="truncate text-white/80">{current.title}</span>
              </>
            )}
          </div>

          <div className="flex-1" />

          <div className="relative">
            <Control
              label="Playback speed (< >)"
              onClick={() => setMenu((open) => (open === "rate" ? null : "rate"))}
              wide
            >
              <span className="text-xs font-medium tabular-nums">{formatRate(rate)}</span>
            </Control>
            {menu === "rate" && (
              <RateMenu
                rate={rate}
                onPick={(next) => {
                  changeRate(next);
                  setMenu(null);
                }}
              />
            )}
          </div>

          <Control
            label="Keyboard shortcuts (?)"
            onClick={() => setMenu((open) => (open === "keys" ? null : "keys"))}
          >
            <Keyboard />
          </Control>

          {captions && (
            <Control
              label={subtitles ? "Hide subtitles (c)" : "Show subtitles (c)"}
              onClick={toggleSubtitles}
            >
              {subtitles ? <Captions /> : <CaptionsOff />}
            </Control>
          )}

          {canPip && (
            <Control label="Picture in picture (i)" onClick={togglePip}>
              <PictureInPicture2 />
            </Control>
          )}

          <Control
            label={fullscreen ? "Exit full screen (f)" : "Full screen (f)"}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Minimize /> : <Maximize />}
          </Control>
        </div>
      </div>
    </div>
  );
}

/** One button in the bar. The label is the tooltip and the accessible name. */
function Control({
  label,
  onClick,
  wide,
  children,
}: {
  label: string;
  onClick: () => void;
  /** Room for a word rather than a glyph. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`grid h-8 place-items-center rounded-md text-white/90 transition-colors hover:bg-white/15 hover:text-white [&_svg]:size-[18px] ${
        wide ? "px-2" : "w-8"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function RateMenu({ rate, onPick }: { rate: number; onPick: (rate: number) => void }) {
  return (
    <div
      role="menu"
      className="absolute bottom-full right-0 mb-2 min-w-24 rounded-lg bg-black/85 py-1 text-xs shadow-lg backdrop-blur"
    >
      {RATES.map((candidate) => (
        <button
          key={candidate}
          type="button"
          role="menuitemradio"
          aria-checked={candidate === rate}
          className={`flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left tabular-nums hover:bg-white/15 ${
            candidate === rate ? "text-white" : "text-white/70"
          }`}
          onClick={() => onPick(candidate)}
        >
          {candidate === 1 ? "Normal" : formatRate(candidate)}
          {candidate === rate && <span aria-hidden="true">✓</span>}
        </button>
      ))}
    </div>
  );
}
