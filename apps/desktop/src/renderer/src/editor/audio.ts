/**
 * The editor's audio graph.
 *
 * Each track gets its own gain, so the microphone and the system audio can be
 * balanced against each other while the edit plays. The arithmetic is a plain
 * multiply, which is exactly what the exporter's mixer does to the raw samples
 * — the same operation on both sides is what keeps the preview honest about
 * what the export will sound like.
 */
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

export class AudioMixer {
  private context: AudioContext | null = null;
  private readonly gains = new Map<TrackKind, GainNode>();
  /** Elements already wired in. A second `createMediaElementSource` on the
      same element throws, and the failure is fatal to the whole graph. */
  private readonly connected = new WeakSet<HTMLMediaElement>();

  /**
   * Routes an element through its own gain.
   *
   * Lazily creates the context: constructing one before a user gesture leaves
   * it suspended, and a suspended context silently plays nothing.
   */
  connect(kind: TrackKind, element: HTMLMediaElement): void {
    if (this.connected.has(element)) return;

    this.context ??= new AudioContext();
    const gain = this.context.createGain();

    this.context.createMediaElementSource(element).connect(gain);
    gain.connect(this.context.destination);

    this.gains.set(kind, gain);
    this.connected.add(element);
  }

  /** Applies a track's volume, ramped so the change cannot click. */
  set(kind: TrackKind, { volume, muted }: TrackGain): void {
    const gain = this.gains.get(kind);
    if (!gain || !this.context) return;

    const target = muted ? 0 : Math.max(0, volume);
    gain.gain.setTargetAtTime(target, this.context.currentTime, RAMP_SECONDS);
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
    void this.context?.close();
    this.context = null;
    this.gains.clear();
  }
}
