/**
 * Drives every track from the master clock.
 *
 * One `requestAnimationFrame` loop reads the clock, works out where each track
 * should be, and corrects it. The playhead and the timecode are written
 * straight to the DOM from inside that loop rather than through React: they
 * change sixty times a second, and re-rendering the editor on every tick would
 * spend the frame budget reconciling instead of drawing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EditorSession, TrackMedia } from "../../../shared/contract";
import type { MediaTime, TrackKind } from "../../../shared/manifest";
import { AudioMixer, type TrackGain } from "./audio";
import { Playback, syncElement } from "./playback";
import { hasJumped, place, toFileTime, toSourceTime, totalDuration, type Slice } from "./timeline";

/** How close to the edge the playhead gets before the view follows it. */
const FOLLOW_MARGIN = 80;

/** Tracks that carry sound, and therefore need a gain of their own. */
const AUDIO_KINDS: TrackKind[] = ["microphone", "system_audio"];

export interface EditorPlayback {
  playback: Playback;
  playing: boolean;
  duration: MediaTime;
  /** Ref callback for a track's media element. */
  register: (kind: TrackKind) => (element: HTMLMediaElement | null) => void;
  /**
   * The live element for a track, or null.
   *
   * Read per frame by the compositor, which draws from the element directly —
   * a video's contents change without React being told, so anything sampling
   * one has to reach for it rather than receive it as a prop.
   */
  getElement: (kind: TrackKind) => HTMLVideoElement | null;
  /** Attach to the element whose text should be the running timecode. */
  timecodeRef: (element: HTMLElement | null) => void;
  /**
   * The playhead itself. Its `transform` is rewritten once per frame.
   *
   * A transform rather than `left`: `left` is a layout property, so animating
   * it reflows the whole timeline sixty times a second — which is what makes a
   * playhead judder rather than glide. A transform only recomposites.
   */
  playheadRef: (element: HTMLElement | null) => void;
  /**
   * The timeline's scroller, so the view can follow the playhead.
   *
   * Driven from the playback loop rather than from a second one: the position
   * is already being computed there, and two loops racing to set `scrollLeft`
   * would fight each other.
   */
  scrollerRef: (element: HTMLElement | null) => void;
  /**
   * The timeline's measurements, pushed in when they change.
   *
   * Cached rather than measured inside the loop. Reading `scrollWidth` or
   * `clientWidth` forces the browser to flush layout, and doing that in the
   * same frame as writing `scrollLeft` thrashes it — the single worst thing to
   * do sixty times a second.
   */
  setTrackMetrics: (contentWidth: number, viewWidth: number) => void;
  /**
   * Where the playhead is in *source* time, which is what the media and the
   * pointer track are both indexed by.
   *
   * A function rather than state: it is read inside the render loop, sixty
   * times a second, and holding it in React would re-render the editor on
   * every frame.
   */
  sourceAt: (now?: number) => MediaTime | null;
  /**
   * Where the pointer is hovering the timeline, or null when it is not.
   *
   * The media and the preview follow this instead of the playhead while it is
   * set, so hovering shows the frame under the cursor without moving the
   * playhead to it. Ignored during playback — the frames are already going past.
   *
   * A setter over a ref rather than state: `pointermove` fires far more often
   * than a frame, and holding it in React would re-render the editor on each one.
   */
  setHover: (at: MediaTime | null) => void;
  /** Called on every user-driven change so the audio context can resume. */
  onInteract: () => void;
  setGain: (kind: TrackKind, gain: TrackGain) => void;
  /** Which tracks currently have a frame to show. */
  visible: Set<TrackKind>;
}

export function useEditorPlayback(
  session: EditorSession | null,
  slices: readonly Slice[],
): EditorPlayback {
  const playback = useMemo(() => new Playback(), []);
  const mixer = useMemo(() => new AudioMixer(), []);

  const elements = useRef(new Map<TrackKind, HTMLMediaElement>());
  const timecode = useRef<HTMLElement | null>(null);
  const playhead = useRef<HTMLElement | null>(null);
  const scroller = useRef<HTMLElement | null>(null);
  const metrics = useRef({ content: 0, view: 0 });
  /** Where the last tick landed in source time, so a jump can be told from playing on. */
  const lastSource = useRef<MediaTime | null>(null);
  /** Project time the pointer is over, or null. See `setHover`. */
  const hover = useRef<MediaTime | null>(null);

  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState<Set<TrackKind>>(new Set());

  const placed = useMemo(() => place(slices), [slices]);
  const duration = useMemo(() => totalDuration(placed), [placed]);

  const tracks = useMemo(() => {
    const byKind = new Map<TrackKind, TrackMedia>();
    for (const track of session?.media ?? []) byKind.set(track.kind, track);
    return byKind;
  }, [session]);

  useEffect(() => playback.subscribe(setPlaying), [playback]);
  useEffect(() => playback.setDuration(duration), [playback, duration]);
  useEffect(() => () => mixer.close(), [mixer]);

  useEffect(() => {
    if (!session) return;

    let frame = 0;
    let shown = "";

    // The frame's presentation time, not the moment this callback ran. See
    // `Playback.position` for why the difference is the whole of the jitter.
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);

      const at = playback.position(now);
      // What the *picture* should show, which is not always where the playhead
      // is. Hovering the timeline previews a moment without committing to it, so
      // the media follows the pointer while the playhead stays where it was.
      // Only while paused: during playback the frames are already going past,
      // and fighting the clock with the mouse would just stutter.
      const showing = !playback.isPlaying && hover.current !== null ? hover.current : at;
      // Resolved a hair inside the edit. At exactly the end no slice contains
      // the playhead, so every track would report "no frame" at once — and
      // because the preview keeps drawing whatever the screen element last
      // decoded, only the camera actually vanished. The last frame holds for
      // all of them instead, which is what stopping on a frame should look
      // like.
      const source = toSourceTime(placed, Math.min(showing, Math.max(0, duration - 1)));

      // Running off the end stops the clock rather than leaving it counting
      // past media that is no longer there.
      if (playback.isPlaying && playback.hasEnded(now)) playback.pause();

      // A seek only where the playhead actually landed somewhere else. Every
      // slice boundary used to count, which flushed the decoder at ordinary cuts
      // that need no seek at all — see `hasJumped`.
      const jumped = hasJumped(lastSource.current, source);
      lastSource.current = source;

      const nowVisible = new Set<TrackKind>();

      for (const [kind, track] of tracks) {
        const element = elements.current.get(kind);
        if (!element) continue;

        const fileTime = source === null ? null : toFileTime(track, source);
        if (fileTime !== null) nowVisible.add(kind);

        syncElement(element, fileTime, playback.isPlaying, { seek: jumped });
      }

      // Only when it changes: this runs every frame, and a fresh Set each time
      // would re-render the preview sixty times a second.
      setVisible((current) =>
        current.size === nowVisible.size && [...nowVisible].every((kind) => current.has(kind))
          ? current
          : nowVisible,
      );

      const fraction = duration > 0 ? at / duration : 0;
      const { content, view: viewWidth } = metrics.current;
      const x = fraction * content;

      if (playhead.current) {
        // Sub-pixel on purpose: rounding to whole pixels makes the head step
        // rather than glide, and a stepping playhead is exactly what reads as
        // jitter. `translate3d` keeps it on the compositor.
        playhead.current.style.transform = `translate3d(${x}px, 0, 0)`;
      }

      // Keeps the head in view while playing, and only then: scrolling out from
      // under someone dragging a clip edge would be maddening.
      const view = scroller.current;
      if (view && playback.isPlaying && content > viewWidth) {
        const margin = Math.min(FOLLOW_MARGIN, viewWidth / 3);
        const left = view.scrollLeft;

        if (x < left + margin || x > left + viewWidth - margin) {
          view.scrollLeft = x - viewWidth / 2;
        }
      }

      if (timecode.current) {
        // Written only when the displayed value actually changes — the string
        // is rebuilt cheaply, but the DOM write is not free.
        const text = format(at);
        if (text !== shown) {
          shown = text;
          timecode.current.textContent = text;
        }
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [session, placed, duration, playback, tracks]);

  const register = useCallback(
    (kind: TrackKind) => (element: HTMLMediaElement | null) => {
      if (!element) {
        elements.current.delete(kind);
        return;
      }
      elements.current.set(kind, element);
      if (AUDIO_KINDS.includes(kind)) mixer.connect(kind, element);
    },
    [mixer],
  );

  const getElement = useCallback(
    (kind: TrackKind) => (elements.current.get(kind) as HTMLVideoElement | undefined) ?? null,
    [],
  );

  // Stable, because these are ref callbacks: a new function identity makes
  // React detach and reattach the ref on every render, which for the playhead
  // means a frame where the loop has nothing to write to.
  const timecodeRef = useCallback((element: HTMLElement | null) => {
    timecode.current = element;
  }, []);

  const playheadRef = useCallback((element: HTMLElement | null) => {
    playhead.current = element;
  }, []);

  const scrollerRef = useCallback((element: HTMLElement | null) => {
    scroller.current = element;
  }, []);

  const setTrackMetrics = useCallback((content: number, view: number) => {
    metrics.current = { content, view };
  }, []);

  // Hover-aware for the same reason the loop is: the compositor draws the cursor
  // layer and the zoom motion at this moment, and it has to be the moment the
  // frame under them was decoded for.
  const sourceAt = useCallback(
    (now?: number) =>
      toSourceTime(
        placed,
        !playback.isPlaying && hover.current !== null ? hover.current : playback.position(now),
      ),
    [placed, playback],
  );

  const setHover = useCallback((at: MediaTime | null) => {
    hover.current = at;
  }, []);

  const onInteract = useCallback(() => mixer.resume(), [mixer]);
  const setGain = useCallback((kind: TrackKind, gain: TrackGain) => mixer.set(kind, gain), [mixer]);

  return {
    playback,
    playing,
    duration,
    register,
    getElement,
    timecodeRef,
    playheadRef,
    scrollerRef,
    setTrackMetrics,
    sourceAt,
    setHover,
    onInteract,
    setGain,
    visible,
  };
}

/** `m:ss.cc`, rebuilt on every frame so it stays cheap. */
function format(ns: MediaTime): string {
  const total = Math.max(0, ns) / 1_000_000_000;
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  const hundredths = Math.floor((total * 100) % 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}
