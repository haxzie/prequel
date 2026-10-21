/**
 * The music bed: where a track plays, how far into its file, and how loud.
 *
 * Every number the preview and the export both need, in one place. The reason
 * is the one `shared/layout.ts` gives for geometry: two implementations of
 * "which second of the file belongs here" is how a preview and an export come
 * to disagree, and with sound that is only ever noticed after the file is
 * written.
 *
 * The exporter is Rust and cannot import this, so `crates/prequel-render/src/
 * music.rs` is a hand-kept mirror — the same arithmetic, the same clamps, and
 * a test either side with the same numbers in it. Filters are kept the same
 * way and for the same reason; the comment there says so too.
 *
 * **A music slice lives entirely in project time.** Zooms and texts are pinned
 * to the recording because they are about a moment of footage; a music bed is
 * about the finished film. It starts a few seconds in, it runs for as long as
 * it runs, and a cut made in the middle of the video must not slide it — which
 * is exactly what anchoring it to the source would do.
 *
 * Free of any Node, Electron or DOM import: main places files, the renderer
 * plays them and the export request is built from the same fields.
 */
// Nanoseconds, from the manifest rather than from `project.ts` — that module
// imports the two interfaces below, and taking its alias back would be a
// cycle between the two files for the sake of one name.
import type { MediaTime as Ns } from "./manifest.js";

/** The shortest a bed may be trimmed to. Below a second there is no bed. */
export const MIN_MUSIC_LENGTH: Ns = 1_000_000_000;

/** The loudest a bed may be mixed, matching the track volumes' own ceiling. */
export const MAX_MUSIC_VOLUME = 2;

/**
 * How long a bed fades up and down by default, in nanoseconds.
 *
 * Music that starts at full level reads as a mistake — the ear hears the edit
 * rather than the music — so a bed arrives with both ends shaped. Short enough
 * that a ten-second bed is still mostly music.
 */
export const DEFAULT_MUSIC_FADE: Ns = 1_500_000_000;

/** The longest fade either end may be given. */
export const MAX_MUSIC_FADE: Ns = 10_000_000_000;

/**
 * The audio containers the music row accepts.
 *
 * Both sides of the app have to read whatever comes back: AVFoundation decodes
 * the export and Chromium decodes the preview, and these five are the overlap
 * — the same reasoning `VIDEO_KINDS` is written with. An `.ogg` would preview
 * and then export as silence, which is the worst shape a failure can have
 * here, since nobody finds out until the video is finished.
 *
 * `m4a` first, because it is what the catalogue serves and what a file picker
 * should suggest.
 */
export const AUDIO_KINDS = ["m4a", "mp3", "wav", "aiff", "aif", "flac"] as const;

/**
 * A name the music row may play.
 *
 * Bare, so there is no path in it and nothing to traverse: it is joined
 * against the recording's directory by the exporter and put into a
 * `prequel-media:` URL by the preview. Checked here as well as there, because
 * a hand-edited `project.json` is a thing that happens.
 */
export const MUSIC_FILE_NAME = new RegExp(
  `^[a-z0-9][a-z0-9._-]*\.(${AUDIO_KINDS.join("|")})$`,
  "i",
);

/**
 * The music the app ships, and the only bed it can lay with no network.
 *
 * The floor under the hosted library — the same arrangement the backgrounds
 * have, and for the same reason: a picker that is empty on a train is a
 * feature that does not work. One track, because the bundle pays for every one
 * of them and most people will reach for their own file or the catalogue.
 *
 * Keep in step with `apps/desktop/resources/music`: `ensureMusic` copies the
 * file named here out of that folder, and a name with nothing behind it is a
 * bed that plays silence. `music.test.ts` is the guard.
 *
 * Shaped like a catalogue entry rather than a `MusicFile` so the picker can
 * show it the way it shows a hosted track, credit included.
 */
export interface ShippedTrack {
  id: string;
  label: string;
  /** Inside `resources/music`, and the name a recording copies it in as. */
  file: string;
  /** Nanoseconds, as `afinfo` reports them for the shipped encode. */
  duration: Ns;
  /** Who made it. Shown under the picker, where the licence asks for a credit. */
  attribution: string;
}

export const SHIPPED_MUSIC: ShippedTrack[] = [
  {
    id: "lofi-loop",
    label: "Lo-fi Loop",
    file: "lofi-loop.m4a",
    duration: 124_440_000_000,
    attribution: "Zephira Music, via Pixabay",
  },
];

/** The shipped track of that name, or undefined for a hosted one. */
export function shippedMusic(file: string): ShippedTrack | undefined {
  return SHIPPED_MUSIC.find((track) => track.file === file);
}

/** One file brought into a recording for the music row. */
export interface MusicFile {
  /**
   * Its name inside the recording's directory.
   *
   * Relative, and bare: it is served to the preview through
   * `prequel-media://recording/…` and joined against the session directory by
   * the exporter, which refuses anything that is not a plain name.
   */
  file: string;
  /** What the picker calls it — the catalogue's label, or the file's own name. */
  label: string;
  /**
   * How long the file is, in nanoseconds.
   *
   * Stored rather than probed on open. Trimming needs it on every pointer
   * move, the catalogue already knows it, and an imported file is probed once
   * as it is copied in — asking AVFoundation sixty times a second for a number
   * that cannot change would be the other way to get it.
   */
  duration: Ns;
  /** The catalogue id this was fetched from, or absent for an imported file. */
  libraryId?: string;
}

/** One bed on the music row. Times are the finished video's, throughout. */
export interface MusicSlice {
  id: string;
  /** Where it begins in the finished video. */
  at: Ns;
  /** How long it plays for, in the finished video. */
  length: Ns;
  /** Which file it plays — a `MusicFile.file` on the same project. */
  file: string;
  /**
   * Nanoseconds into that file the bed begins at.
   *
   * What makes trimming the left edge mean "start later in the song" rather
   * than "start the song later": the bar's left edge moves right and this
   * moves with it, so the music under the playhead does not change.
   */
  offset: Ns;
  /** 0 to `MAX_MUSIC_VOLUME`, a plain multiply on both sides. */
  volume: number;
  muted: boolean;
  fadeIn: Ns;
  fadeOut: Ns;
  /**
   * Whether the file starts again when it runs out.
   *
   * Off by default: a two-minute song under a thirty-second video is the
   * ordinary case, and a bed that silently restarted would be a seam nobody
   * asked for. On, a short loop fills whatever it is stretched to.
   */
  repeat: boolean;
}

/**
 * Which moment of the file plays at project time `at`, or null for silence.
 *
 * Null covers both ends of the same question: the moment is outside the bed,
 * or it is inside the bed but past the end of a file that does not repeat. The
 * second case is the one worth stating — a bed trimmed longer than its song is
 * ordinary, and the tail of it is silence rather than the last frame held.
 */
export function musicFileTime(
  slice: Pick<MusicSlice, "at" | "length" | "offset" | "repeat">,
  at: Ns,
  /** The file's own length. Zero where it is not known yet. */
  fileDuration: Ns,
): Ns | null {
  if (at < slice.at || at >= slice.at + slice.length) return null;
  if (fileDuration <= 0) return null;

  const into = slice.offset + (at - slice.at);
  if (into < fileDuration) return into;

  if (!slice.repeat) return null;
  // From the file's own beginning, not from the offset: a repeat is the song
  // played again, and resuming at the trim point would make every pass after
  // the first start somewhere the first one never did.
  return (into - fileDuration) % fileDuration;
}

/**
 * What a bed at its own full level is worth in the mix.
 *
 * A music file is mastered: the one shipped here is −15 LUFS with its peaks
 * 2dB off the ceiling, which is what a song is meant to be. Speech recorded
 * off a laptop sits twenty-odd dB below that, so a bed mixed in at unity is
 * not a bed — it is the track, with a voice somewhere behind it. Everything
 * under this row was inaudible until this number existed.
 *
 * A quarter is about 12dB down, which is where a bed under narration sits.
 * The row's own control goes to twice its level — see `MAX_LEVEL` — so a video
 * that *is* the music can still be pushed to half of full scale, and the rest
 * of the range is where a bed belongs rather than being spent above it.
 *
 * Mirrored in `crates/prequel-render/src/music.rs`. The two must hold the same
 * number or the preview and the file disagree about how loud the song is.
 */
export const MUSIC_TRIM = 0.25;

/**
 * How loud the bed is at project time `at` — the level, shaped by its fades.
 *
 * Zero outside the bed, so a caller can ask about any moment. The two fades
 * are clamped to half the bed each: at a third of a second of music with two
 * one-second fades, the two ramps would otherwise cross and the bed would be
 * louder in the middle than its own level.
 */
export function musicGain(
  slice: Pick<MusicSlice, "at" | "length" | "volume" | "muted" | "fadeIn" | "fadeOut">,
  at: Ns,
): number {
  if (slice.muted || slice.volume <= 0) return 0;
  if (at < slice.at || at >= slice.at + slice.length) return 0;

  const into = at - slice.at;
  const left = slice.length - into;
  const half = slice.length / 2;

  const up = Math.min(slice.fadeIn, half);
  const down = Math.min(slice.fadeOut, half);

  // Linear, and linear on both sides. An equal-power curve would sound better
  // and would be a second thing to keep in step with the Rust mirror for a
  // difference nobody has asked about.
  const rising = up > 0 ? Math.min(1, into / up) : 1;
  const falling = down > 0 ? Math.min(1, left / down) : 1;

  return MUSIC_TRIM * slice.volume * Math.min(rising, falling);
}

/** The bed covering project time `at`, or undefined. Beds never overlap. */
export function musicAt(slices: readonly MusicSlice[], at: Ns): MusicSlice | undefined {
  return slices.find((slice) => at >= slice.at && at < slice.at + slice.length);
}

/** The file a bed plays, or undefined while it is still being fetched. */
export function musicFileOf(
  files: readonly MusicFile[],
  slice: Pick<MusicSlice, "file">,
): MusicFile | undefined {
  return files.find((entry) => entry.file === slice.file);
}
