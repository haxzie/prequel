/**
 * The editor's audio graph.
 *
 * Each track gets its own gain, so the microphone and the system audio can be
 * balanced against each other while the edit plays. The arithmetic is a plain
 * multiply, which is exactly what the exporter's mixer does to the raw samples
 * — the same operation on both sides is what keeps the preview honest about
 * what the export will sound like.
 *
 * The typing and click sounds are two more buses on the same graph. Their
 * voices arrive rendered, from the addon, and are placed here as buffer
 * sources at the moments the plan says — nothing in the renderer decides what
 * a keystroke sounds like or which one plays, for the reason nothing in it
 * decides where the camera sits.
 *
 * The music row is a gain per *file* rather than a bus. A bed's level moves
 * inside itself — it fades up and down, and the playback loop writes the
 * envelope sixty times a second — so the level belongs to the thing being
 * played rather than to a mix the user sets once. The arithmetic is still a
 * plain multiply, and `shared/music.ts` is what works out the number on both
 * sides.
 */
import type { SoundBank, SoundSample } from "../../../shared/contract";
import type { TrackKind } from "../../../shared/manifest";

/**
 * How quickly a gain change takes effect.
 *
 * Assigning `gain.value` on a live graph steps the signal discontinuously and
 * clicks audibly; a short ramp is inaudible and costs nothing.
 */
const RAMP_SECONDS = 0.01;

export interface TrackGain {
  volume: number;
  muted: boolean;
}

/** A track, or one of the two synthesised sources. */
export type MixBus = TrackKind | "keys" | "clicks";

/** One profile's voices as buffers: kind index → variant → buffer. */
type Voices = Map<number, AudioBuffer[]>;

export class AudioMixer {
  private context: AudioContext | null = null;
  private readonly gains = new Map<MixBus, GainNode>();
  /** Elements already wired in. A second `createMediaElementSource` on the
      same element throws, and the failure is fatal to the whole graph. */
  private readonly connected = new WeakSet<HTMLMediaElement>();
  /** Banks by profile id, decoded into buffers once. */
  private readonly banks = new Map<string, Voices>();
  /** Seconds before a voice's press its buffer begins, per profile. */
  private readonly onsets = new Map<string, number>();
  /** Sources started and not yet ended, so a pause or a seek can stop them. */
  private readonly live = new Set<AudioBufferSourceNode>();
  /** The picker's demo, while one is playing. A second press replaces it. */
  private preview: AudioBufferSourceNode | null = null;
  /** One gain per music file, so two beds of different songs are two levels. */
  private readonly musicGains = new Map<string, GainNode>();
  /** The last level written to each, so an unchanged frame costs nothing. */
  private readonly musicLevels = new Map<string, number>();

  /**
   * Routes an element through its own gain.
   *
   * Lazily creates the context: constructing one before a user gesture leaves
   * it suspended, and a suspended context silently plays nothing.
   */
  connect(kind: TrackKind, element: HTMLMediaElement): void {
    if (this.connected.has(element)) return;

    const context = this.ensureContext();

    // One gain per kind, shared by every element of it. A recording extended
    // with a second take has one microphone file per take, and a gain created
    // per element would leave the bus holding whichever was wired last — so the
    // volume slider would move one take and not the other.
    let gain = this.gains.get(kind);
    if (!gain) {
      gain = context.createGain();
      gain.connect(context.destination);
      this.gains.set(kind, gain);
    }

    context.createMediaElementSource(element).connect(gain);
    this.connected.add(element);
  }

  /**
   * Routes one music file's element through a gain of its own.
   *
   * Keyed by the file rather than by the bed: two beds cut from the same song
   * share one `<audio>` element — there is only one of each file in the DOM —
   * and a gain per bed would leave the element on whichever was wired last.
   */
  connectMusic(file: string, element: HTMLMediaElement): void {
    if (this.connected.has(element)) return;

    const context = this.ensureContext();

    let gain = this.musicGains.get(file);
    if (!gain) {
      gain = context.createGain();
      // Silent until the loop says otherwise. A bed is almost always fading in
      // from nothing, and a graph that started at full level would open with a
      // click on the first frame of playback.
      gain.gain.value = 0;
      gain.connect(context.destination);
      this.musicGains.set(file, gain);
    }

    context.createMediaElementSource(element).connect(gain);
    this.connected.add(element);
  }

  /**
   * Sets one music file's level, as the playback loop works it out per frame.
   *
   * Only on a change, and the comparison is not a micro-optimisation:
   * `setTargetAtTime` schedules an automation event on the parameter, and
   * sixty a second for the length of a song is a queue of them that never
   * empties.
   *
   * The same short ramp every other level change here uses: a fade written as
   * sixty steps a second is already smooth, and the ramp only covers the
   * distance between two of them.
   */
  setMusicGain(file: string, level: number): void {
    const context = this.context;
    const gain = this.musicGains.get(file);
    if (!context || !gain) return;

    const target = Math.max(0, level);
    // A hundredth, which is well below what anybody can hear and far above the
    // step a fade takes between two frames.
    if (Math.abs((this.musicLevels.get(file) ?? -1) - target) < 0.005) return;

    this.musicLevels.set(file, target);
    gain.gain.setTargetAtTime(target, context.currentTime, RAMP_SECONDS);
  }

  /** Applies a bus's volume, ramped so the change cannot click. */
  set(bus: MixBus, { volume, muted }: TrackGain): void {
    // The sound buses exist before anything is scheduled on them, so a gain
    // set while the graph is still empty is not lost.
    const context = bus === "keys" || bus === "clicks" ? this.ensureContext() : this.context;
    const gain = this.gains.get(bus);
    if (!gain || !context) return;

    const target = muted ? 0 : Math.max(0, volume);
    gain.gain.setTargetAtTime(target, context.currentTime, RAMP_SECONDS);
  }

  /**
   * Keeps a profile's voices, ready to place.
   *
   * Decoded into `AudioBuffer`s at the bank's own rate: WebAudio resamples a
   * buffer whose rate differs from the context's, so the bank never has to
   * know what the output device runs at.
   */
  setBank(profile: string, bank: SoundBank | null): void {
    if (!bank) {
      this.banks.delete(profile);
      return;
    }

    const context = this.ensureContext();
    const voices: Voices = new Map();
    bank.kinds.forEach((kind, slot) => {
      const variants: AudioBuffer[] = [];
      for (let variant = 0; variant < bank.variants; variant++) {
        const index = slot * bank.variants + variant;
        const from = bank.offsets[index] ?? 0;
        const to = bank.offsets[index + 1] ?? from;
        const buffer = context.createBuffer(1, Math.max(1, to - from), bank.sampleRate);
        // Copied out rather than viewed: `copyToChannel` wants a plain
        // `ArrayBuffer`-backed array, and a typed array off IPC may not be.
        buffer.copyToChannel(Float32Array.from(bank.samples.subarray(from, to)), 0);
        variants.push(buffer);
      }
      voices.set(kind, variants);
    });
    this.onsets.set(profile, bank.onset / bank.sampleRate);
    this.banks.set(profile, voices);
  }

  /**
   * Places one voice so its press lands at `when`, on the context's clock.
   *
   * `stopAt` is the cut, if one falls inside the voice: a sound is cut where
   * the picture is, and the exporter truncates the same voice at the same
   * sample. A voice whose start is already past — a tick that ran late, or a
   * press a few milliseconds behind a seek — starts now from partway in rather
   * than being dropped, which is what the ear expects of a sound it is late
   * for.
   */
  schedule(
    bus: "keys" | "clicks",
    profile: string,
    kind: number,
    variant: number,
    when: number,
    stopAt: number | null,
    gain: number,
    pan: number,
  ): void {
    const context = this.context;
    const out = this.gains.get(bus);
    const buffer = this.banks.get(profile)?.get(kind)?.[variant];
    if (!context || !out || !buffer) return;

    const source = context.createBufferSource();
    source.buffer = buffer;

    const level = context.createGain();
    level.gain.value = gain;
    const panner = context.createStereoPanner();
    panner.pan.value = pan;

    source.connect(panner).connect(level).connect(out);

    const startAt = when - (this.onsets.get(profile) ?? 0);
    const now = context.currentTime;
    if (startAt >= now) {
      source.start(startAt);
    } else {
      source.start(now, Math.min(now - startAt, buffer.duration));
    }
    if (stopAt !== null) source.stop(Math.max(stopAt, now));

    this.live.add(source);
    source.onended = () => {
      this.live.delete(source);
      source.disconnect();
      panner.disconnect();
      level.disconnect();
    };
  }

  /**
   * Plays a picker's demo once, at `gain`, straight to the output.
   *
   * Not a bank voice: the addon hands back the whole demo already mixed and
   * panned, so this decodes and starts it outright rather than going through
   * `schedule`, which places a cue against an `onset`.
   *
   * Deliberately *not* on the sound bus. A bus is muted while its sound is
   * Off, and Off is exactly what someone has selected when they open the
   * picker to find out what these sound like — routed there, every row's play
   * button would do nothing until a sound had already been chosen. The volume
   * is passed in instead, so the preview is still as loud as the slider says.
   */
  playSample(sample: SoundSample, gain: number): void {
    const context = this.ensureContext();

    // One demo at a time. The buttons sit in a list meant to be tried a row at
    // a time, and demos left to overlap stop being comparable.
    this.stopSample();

    const frames = sample.samples.length / sample.channels;
    const buffer = context.createBuffer(sample.channels, frames, sample.sampleRate);
    for (let channel = 0; channel < sample.channels; channel++) {
      const data = new Float32Array(frames);
      for (let frame = 0; frame < frames; frame++) {
        data[frame] = sample.samples[frame * sample.channels + channel] ?? 0;
      }
      buffer.copyToChannel(data, channel);
    }

    const level = context.createGain();
    level.gain.value = Math.max(0, gain);
    level.connect(context.destination);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(level);
    source.start();

    this.preview = source;
    this.live.add(source);
    source.onended = () => {
      if (this.preview === source) this.preview = null;
      this.live.delete(source);
      source.disconnect();
      level.disconnect();
    };
  }

  /** Stops the picker's demo, if one is playing. */
  stopSample(): void {
    const source = this.preview;
    if (!source) return;

    this.preview = null;
    try {
      source.stop(0);
    } catch {
      // Never started; `onended` still runs and does the tidying.
    }
  }

  /** Stops every voice that is playing or waiting to. A pause, or a seek. */
  cancelScheduled(): void {
    for (const source of this.live) {
      // A source that never reached its start throws on `stop` in some
      // browsers; nothing here depends on it having run.
      try {
        source.stop(0);
      } catch {
        // Already stopped.
      }
      source.disconnect();
    }
    this.live.clear();
    this.preview = null;
  }

  /** The audio clock, or zero before there is one. */
  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  /**
   * Resumes the context after a user gesture.
   *
   * Chromium starts an `AudioContext` suspended until the page has been
   * interacted with. Without this, pressing play produces a picture and
   * silence, with nothing to say why.
   */
  resume(): void {
    if (this.context?.state === "suspended") void this.context.resume();
  }

  close(): void {
    this.cancelScheduled();
    void this.context?.close();
    this.context = null;
    this.gains.clear();
    this.musicGains.clear();
    this.musicLevels.clear();
    this.banks.clear();
    this.onsets.clear();
  }

  /**
   * The context, made on first need.
   *
   * Used to be made in `connect` alone, which was fine while every sound came
   * from a media element. A recording with no microphone and no system audio
   * connects nothing, and its typing would have had no graph to play into.
   */
  private ensureContext(): AudioContext {
    if (this.context) return this.context;

    this.context = new AudioContext();
    for (const bus of ["keys", "clicks"] as const) {
      const gain = this.context.createGain();
      gain.connect(this.context.destination);
      this.gains.set(bus, gain);
    }
    return this.context;
  }
}
