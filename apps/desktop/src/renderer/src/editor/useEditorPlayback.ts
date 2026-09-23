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

import type { EditorSession, SoundBank, SoundSample, TrackMedia } from "../../../shared/contract";
import type { MediaTime, TrackKind } from "../../../shared/manifest";
import { AudioMixer, type MixBus, type TrackGain } from "./audio";
import { CLICK_KIND, CueScheduler, decodeCues, type PlacedCue } from "./keysound";
import { writeTicker } from "../lib/ticker";
import { Playback, followElement, syncElement } from "./playback";
import {
  hasJumped,
  place,
  sliceAt,
  toFileTime,
  toSourceTime,
  totalDuration,
  type Slice,
} from "./timeline";

/** How close to the edge the playhead gets before the view follows it. */
const FOLLOW_MARGIN = 80;

/**
 * The width of the playhead's time label.
 *
 * Fixed rather than fitted to the text, and exported so the element and the
 * clamp below cannot disagree about it. A label that resized as the digits
 * changed would shimmy left and right around the line sixty times a second,
 * because it is centred on it — the one place a variable width is visible.
 */
export const HEAD_LABEL_W = 54;

/** Tracks that carry sound, and therefore need a gain of their own. */
const AUDIO_KINDS: TrackKind[] = ["microphone", "system_audio"];

/**
 * How far ahead of the playhead sounds are armed, in nanoseconds.
 *
 * Four hundred milliseconds: long enough that a frame which runs late — a
 * heavy composite, a garbage collection — still has its sounds in the graph
 * before their moment, short enough that a pause throws away little and a
 * volume change reaches the next press soon.
 */
const SOUND_LOOKAHEAD_NS: MediaTime = 400_000_000;

/** Which keyboard and mouse a clip's sounds are of, or null for off. */
export interface SoundChoice {
  keys: string | null;
  clicks: string | null;
}

/**
 * What a media element can stand for: a track, or the camera's person matte.
 *
 * The matte is not a `TrackKind` — it is never a lane, never mixed, never
 * probed — but it is a `<video>` the loop has to keep on the camera's clock,
 * so it needs a key of its own in the same map.
 */
export type MediaKey = TrackKind | "camera_matte";

export interface EditorPlayback {
  playback: Playback;
  playing: boolean;
  duration: MediaTime;
  /** Ref callback for a track's media element. */
  register: (key: MediaKey) => (element: HTMLMediaElement | null) => void;
  /**
   * The live element for a track, or null.
   *
   * Read per frame by the compositor, which draws from the element directly —
   * a video's contents change without React being told, so anything sampling
   * one has to reach for it rather than receive it as a prop.
   */
  getElement: (key: MediaKey) => HTMLVideoElement | null;
  /** Attach to the element whose text should be the running timecode. */
  timecodeRef: (element: HTMLElement | null) => void;
  /**
   * The same timecode again, on the playhead itself.
   *
   * A second element rather than a second loop: the string is already being
   * built here, and two loops formatting the same clock would eventually show
   * two different times on one frame.
   */
  headTimeRef: (element: HTMLElement | null) => void;
  /**
   * The slice the picture is currently showing, or null before there is one.
   *
   * State rather than a ref, because the settings resolved from it reach React —
   * the drag handles and the selection ring are rendered, not painted. It only
   * changes when the playhead crosses a boundary, so this is a render per cut
   * rather than a render per frame.
   */
  sliceId: string | null;
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
  setGain: (bus: MixBus, gain: TrackGain) => void;
  /**
   * Hands the mixer a keyboard's or mouse's voices, by profile id.
   *
   * The renderer never makes these; it asks main for them and passes them
   * through. A cue whose profile has no bank yet is skipped, and arrives on a
   * later tick once the bank does.
   */
  setSoundBank: (profile: string, bank: SoundBank | null) => void;
  /**
   * Tells the loop which profiles a clip uses, so a cue in that clip plays
   * the right keyboard. Read per cue at arming time, never stored per cue.
   */
  setSoundChoice: (choose: (sliceId: string) => SoundChoice) => void;
  /**
   * Plays one voice now — a letter, or a click — so a profile can be heard
   * while paused, the moment it is chosen.
   */
  audition: (bus: "keys" | "clicks", profile: string) => void;
  /**
   * Plays a whole five-second demo now — the picker's play button, as
   * distinct from `audition`'s single note on choosing a profile.
   */
  playSample: (bus: "keys" | "clicks", sample: SoundSample) => void;
  /** Which tracks currently have a frame to show. */
  visible: Set<TrackKind>;
}

export function useEditorPlayback(
  session: EditorSession | null,
  slices: readonly Slice[],
): EditorPlayback {
  const playback = useMemo(() => new Playback(), []);
  const mixer = useMemo(() => new AudioMixer(), []);
  const scheduler = useMemo(() => new CueScheduler(), []);
  /** The plan, unpacked once per session. */
  const cues = useMemo(() => (session?.sound ? decodeCues(session.sound) : []), [session]);
  /** Which profiles a clip plays. A ref: read inside the loop, set from React. */
  const soundChoice = useRef<(sliceId: string) => SoundChoice>(() => ({
    keys: null,
    clicks: null,
  }));

  const elements = useRef(new Map<MediaKey, HTMLMediaElement>());
  const timecode = useRef<HTMLElement | null>(null);
  const headTime = useRef<HTMLElement | null>(null);
  const playhead = useRef<HTMLElement | null>(null);
  const scroller = useRef<HTMLElement | null>(null);
  const metrics = useRef({ content: 0, view: 0 });
  /** Where the last tick landed in source time, so a jump can be told from playing on. */
  const lastSource = useRef<MediaTime | null>(null);
  /**
   * Where the last tick landed in *project* time, for the sounds.
   *
   * A different question from `lastSource`'s. A cut that drops footage is a
   * jump in source time — the decoder has to seek — but the edit plays
   * straight through it, and the sounds armed past the cut are exactly where
   * they should be. Only a move of the playhead itself throws them away.
   */
  const lastProject = useRef<MediaTime | null>(null);
  /** Project time the pointer is over, or null. See `setHover`. */
  const hover = useRef<MediaTime | null>(null);

  const [playing, setPlaying] = useState(false);
  const [sliceId, setSliceId] = useState<string | null>(null);
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
    // Only rewritten when it changes, which is only near the two ends. The
    // playhead's own transform moves every frame; this one almost never does.
    let nudged: number | null = null;

    // Where armed cues go. Which keyboard is looked up per cue, at arming
    // time, from the clip the cue falls in — a cue armed 400 ms ahead in the
    // next clip plays that clip's keyboard, not this one's.
    const sink = {
      schedule(placedCue: PlacedCue, when: number, stopAt: number | null) {
        const choice = soundChoice.current(placedCue.sliceId);
        const click = placedCue.cue.kind === CLICK_KIND;
        const profile = click ? choice.clicks : choice.keys;
        if (!profile) return;
        mixer.schedule(
          click ? "clicks" : "keys",
          profile,
          placedCue.cue.kind,
          placedCue.cue.variant,
          when,
          stopAt,
          placedCue.cue.gain,
          placedCue.cue.pan,
        );
      },
      cancel() {
        mixer.cancelScheduled();
      },
    };

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

      // Which slice is on screen, on the same clock the picture is resolved
      // against — so hovering the timeline previews the layout of the moment
      // under the pointer as well as the frame.
      const activeSlice = sliceAt(placed, showing);

      // React bails out of an identical value, so this is only a render when
      // the playhead actually crosses a cut.
      setSliceId(activeSlice?.id ?? null);

      // Running off the end stops the clock rather than leaving it counting
      // past media that is no longer there.
      if (playback.isPlaying && playback.hasEnded(now)) playback.pause();

      // A seek only where the playhead actually landed somewhere else. Every
      // slice boundary used to count, which flushed the decoder at ordinary cuts
      // that need no seek at all — see `hasJumped`.
      const jumped = hasJumped(lastSource.current, source);
      lastSource.current = source;
      const projectJumped = hasJumped(lastProject.current, at);
      lastProject.current = at;

      const nowVisible = new Set<TrackKind>();

      for (const [kind, track] of tracks) {
        const element = elements.current.get(kind);
        if (!element) continue;

        const fileTime = source === null ? null : toFileTime(track, source);
        if (fileTime !== null) nowVisible.add(kind);

        const speed = activeSlice?.speed ?? 1;
        // Pitch-corrected playback would disagree with the naive resample the
        // exporter applies (there is no time-stretch DSP on either side of
        // this codebase) — matched here so the preview never sounds different
        // from the file it is standing in for.
        if (element.preservesPitch !== (speed === 1)) element.preservesPitch = speed === 1;
        syncElement(element, fileTime, playback.isPlaying, { seek: jumped, baseRate: speed });
      }

      // The sounds, armed a little ahead. `at` is on the frame clock and
      // `currentTime` on the audio clock; both are read here, in the same
      // tick, and the scheduler re-anchors one to the other every time.
      scheduler.tick({
        projectNow: at,
        contextNow: mixer.currentTime,
        playing: playback.isPlaying,
        jumped: projectJumped,
        placed,
        cues,
        lookaheadNs: SOUND_LOOKAHEAD_NS,
        sink,
      });

      // The matte follows the camera *element* rather than the clock: it has
      // to show the mask for the picture the camera is showing, and two
      // elements corrected against the clock on their own can sit a quarter
      // of a second apart while playing — see `followElement`. Never in
      // `visible` — it is not a lane.
      const matte = elements.current.get("camera_matte");
      const cameraElement = elements.current.get("camera");
      if (matte && cameraElement) {
        followElement(matte, cameraElement, nowVisible.has("camera"), playback.isPlaying);
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

      if (headTime.current) {
        // Clamped to the content rather than centred blindly. The timeline is
        // an `overflow-x` scroller, so a label centred on a head at zero has
        // its left half cut off by the scroller's edge — and zero is where the
        // head sits on every recording that has not been played yet.
        const half = HEAD_LABEL_W / 2;
        const nudge = Math.min(Math.max(x, half), Math.max(content - half, half)) - x;

        if (nudge !== nudged) {
          nudged = nudge;
          headTime.current.style.transform = `translate3d(calc(-50% + ${nudge}px), 0, 0)`;

          // Square the corners on whichever side the label has come to rest
          // against. `nudge` is only ever non-zero because the clamp above has
          // stopped the label at an edge, and its sign says which: pushed
          // right means its left edge is on the content's left. A capsule
          // sitting flush against the end of the strip reads as having been cut
          // off there; squaring the two corners that touch says it has arrived.
          headTime.current.style.borderRadius =
            nudge > 0 ? "0 999px 999px 0" : nudge < 0 ? "999px 0 0 999px" : "999px";
        }
      }

      // Written only when the displayed value actually changes — the string is
      // rebuilt cheaply, but the DOM write is not free, and there are two of
      // them now.
      const text = format(at);
      if (text !== shown) {
        shown = text;
        // Through `writeTicker` rather than straight onto the node: an element
        // that draws its digits as sliding columns registers a writer, and the
        // loop must not care which kind it is holding.
        if (timecode.current) writeTicker(timecode.current, text);
        if (headTime.current) writeTicker(headTime.current, text);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      // The slices changed under the armed cues — a split, a reorder, a
      // trim. Their project times are stale; the next tick arms afresh.
      mixer.cancelScheduled();
      scheduler.reset();
    };
  }, [session, placed, duration, playback, tracks, mixer, scheduler, cues]);

  const register = useCallback(
    (key: MediaKey) => (element: HTMLMediaElement | null) => {
      if (!element) {
        elements.current.delete(key);
        return;
      }
      elements.current.set(key, element);
      if (key !== "camera_matte" && AUDIO_KINDS.includes(key)) mixer.connect(key, element);
    },
    [mixer],
  );

  const getElement = useCallback(
    (key: MediaKey) => (elements.current.get(key) as HTMLVideoElement | undefined) ?? null,
    [],
  );

  // Stable, because these are ref callbacks: a new function identity makes
  // React detach and reattach the ref on every render, which for the playhead
  // means a frame where the loop has nothing to write to.
  const timecodeRef = useCallback((element: HTMLElement | null) => {
    timecode.current = element;
  }, []);

  const headTimeRef = useCallback((element: HTMLElement | null) => {
    headTime.current = element;
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
  const setGain = useCallback((bus: MixBus, gain: TrackGain) => mixer.set(bus, gain), [mixer]);
  const setSoundBank = useCallback(
    (profile: string, bank: SoundBank | null) => mixer.setBank(profile, bank),
    [mixer],
  );
  const setSoundChoice = useCallback((choose: (sliceId: string) => SoundChoice) => {
    soundChoice.current = choose;
  }, []);
  const audition = useCallback(
    (bus: "keys" | "clicks", profile: string) => {
      mixer.resume();
      // A letter, or the click: kind 0 in a keyboard bank is Letter, and a
      // mouse bank has only the click. Variant 0, centred, at unity — the
      // bus gain is the clip's volume, as it would be in playback.
      mixer.schedule(
        bus,
        profile,
        bus === "keys" ? 0 : CLICK_KIND,
        0,
        mixer.currentTime,
        null,
        1,
        0,
      );
    },
    [mixer],
  );
  const playSample = useCallback(
    (bus: "keys" | "clicks", sample: SoundSample) => {
      mixer.resume();
      mixer.playSample(bus, sample);
    },
    [mixer],
  );

  // Memoised for the same reason the ref callbacks above are stable, one level
  // up: this object is the dependency of every rAF loop in the editor — the
  // preview's draw loop, the caption panel's, and `TimelineStrip`'s scroller
  // ref. Returned as a literal it had a fresh identity on every render, so a
  // preview drag — which dispatches once per `pointermove` — cancelled and
  // re-scheduled all of them on every pointer event, throwing away each loop's
  // local "what did I last write" cache and repainting from nothing.
  //
  // Everything here but the four state values is already stable, so in practice
  // this changes identity only when playback actually starts, stops, crosses a
  // cut, or a track appears.
  return useMemo(
    () => ({
      playback,
      playing,
      duration,
      register,
      getElement,
      sliceId,
      timecodeRef,
      headTimeRef,
      playheadRef,
      scrollerRef,
      setTrackMetrics,
      sourceAt,
      setHover,
      onInteract,
      setGain,
      setSoundBank,
      setSoundChoice,
      audition,
      playSample,
      visible,
    }),
    [
      playback,
      playing,
      duration,
      register,
      getElement,
      sliceId,
      timecodeRef,
      headTimeRef,
      playheadRef,
      scrollerRef,
      setTrackMetrics,
      sourceAt,
      setHover,
      onInteract,
      setGain,
      setSoundBank,
      setSoundChoice,
      audition,
      playSample,
      visible,
    ],
  );
}

/**
 * `m:ss.cc`, rebuilt on every frame so it stays cheap.
 *
 * Exported so the hover line's label reads the same as the playhead's. Two
 * timecodes a pixel apart in different formats is the sort of thing that looks
 * like one of them is wrong.
 */
export function format(ns: MediaTime): string {
  const total = Math.max(0, ns) / 1_000_000_000;
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  const hundredths = Math.floor((total * 100) % 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}
