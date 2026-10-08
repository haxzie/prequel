/**
 * The containers the converter knows, and what ffmpeg is told to do with them.
 *
 * Pure: no ffmpeg, no DOM, no browser API. The arguments are a function of two
 * formats and nothing else, which is what lets every converter page be the same
 * tool with a different pair passed in — and what keeps the one place that
 * decides "how do we make an MP4" from being eight places.
 */

export type FormatId = "any" | "mp4" | "mov" | "webm" | "avi" | "mkv" | "mp3" | "m4a" | "wav";

export type Format = {
  id: FormatId;
  /** How it is written in a sentence and on a button. */
  label: string;
  /** Without the dot. What the downloaded file is called. */
  extension: string;
  /** What the file picker accepts, and what a drop is checked against. */
  accept: string;
  kind: "video" | "audio";
  /** One sentence of what the format actually is, used in the page's copy. */
  blurb: string;
};

export const FORMATS: Record<FormatId, Format> = {
  any: {
    id: "any",
    label: "Video",
    extension: "mp4",
    accept: "video/*",
    kind: "video",
    blurb: "Any video your browser can read: MP4, MOV, WebM, AVI, MKV and the rest.",
  },
  mp4: {
    id: "mp4",
    label: "MP4",
    extension: "mp4",
    // Both spellings, because a file dragged from an iPhone backup is
    // `video/mp4` and the same file exported by some editors is `video/x-m4v`.
    accept: "video/mp4,video/x-m4v,.mp4,.m4v",
    kind: "video",
    blurb:
      "The format everything plays. H.264 video and AAC audio in an MP4 container opens on every phone, every browser and every editor.",
  },
  mov: {
    id: "mov",
    label: "MOV",
    extension: "mov",
    accept: "video/quicktime,.mov",
    kind: "video",
    blurb:
      "QuickTime's container, and what a Mac screen recording or an iPhone video arrives as. Often holds the same H.264 an MP4 does, which is why the conversion is usually instant.",
  },
  webm: {
    id: "webm",
    label: "WebM",
    extension: "webm",
    accept: "video/webm,.webm",
    kind: "video",
    blurb:
      "Google's royalty-free container, holding VP8 or VP9 video and Opus audio. What a browser recording comes out as, and what Safari before 17 would not play.",
  },
  avi: {
    id: "avi",
    label: "AVI",
    extension: "avi",
    accept: "video/x-msvideo,video/avi,.avi",
    kind: "video",
    blurb:
      "Microsoft's container from 1992, usually holding DivX or Xvid video. Still what old camcorders, dash cams and screen capture software from the DVD era write.",
  },
  mkv: {
    id: "mkv",
    label: "MKV",
    extension: "mkv",
    accept: "video/x-matroska,.mkv",
    kind: "video",
    blurb:
      "Matroska: a container that holds almost anything, including several audio tracks and subtitles. Plays in VLC and almost nowhere else without help.",
  },
  mp3: {
    id: "mp3",
    label: "MP3",
    extension: "mp3",
    accept: "audio/mpeg,.mp3",
    kind: "audio",
    blurb:
      "The audio file everything opens, lossy and about a megabyte a minute at 192 kbps. Thirty years old and still the safest thing to send somebody.",
  },
  m4a: {
    id: "m4a",
    label: "M4A",
    extension: "m4a",
    accept: "audio/mp4,audio/x-m4a,.m4a",
    kind: "audio",
    blurb:
      "AAC audio in an MP4 container. Smaller than MP3 at the same quality, and what the Apple ecosystem writes by default.",
  },
  wav: {
    id: "wav",
    label: "WAV",
    extension: "wav",
    accept: "audio/wav,audio/x-wav,.wav",
    kind: "audio",
    blurb:
      "Uncompressed PCM audio. Ten megabytes a minute, no quality lost, and what an editor or a transcription model wants to be given.",
  },
};

/**
 * Audio bitrate for a lossy target.
 *
 * 192 kbps. Past the point where speech or a screen recording's audio gains
 * anything, and under the point where the file stops being easy to send.
 */
const AUDIO_BITRATE = "192k";

/**
 * What ffmpeg is asked to do, for a pair.
 *
 * `copy` is tried first wherever the pair allows it: an MOV holding H.264 and
 * AAC is already the inside of an MP4, so rewrapping it is a second of file
 * copying rather than three minutes of transcoding, and it loses nothing. The
 * caller runs `transcode` when `copy` comes back non-zero, which is what
 * happens when the streams are ProRes, DivX or anything else MP4 will not hold.
 *
 * Returning both rather than deciding here keeps this file free of ffmpeg: the
 * decision needs an exit code, and an exit code needs a run.
 */
export function conversionArgs(
  from: FormatId,
  to: FormatId,
  input: string,
  output: string,
): { copy: string[] | null; transcode: string[] } {
  const target = FORMATS[to];

  if (target.kind === "audio") {
    const codec =
      to === "mp3"
        ? ["-c:a", "libmp3lame", "-b:a", AUDIO_BITRATE]
        : to === "m4a"
          ? ["-c:a", "aac", "-b:a", AUDIO_BITRATE]
          : // WAV is PCM by definition, so there is no bitrate to set. 16-bit
            // at the source's own sample rate, which is what every editor and
            // every transcription model expects to be handed.
            ["-c:a", "pcm_s16le"];

    return {
      // An MP4 or a MOV holding AAC can have that stream lifted straight out
      // into an M4A. Everything else has to be decoded.
      copy: to === "m4a" ? ["-i", input, "-vn", "-c:a", "copy", output] : null,
      // `-vn` is the whole point: drop the video, keep the sound.
      transcode: ["-i", input, "-vn", ...codec, output],
    };
  }

  if (to === "webm") {
    return {
      // No copy path. WebM takes VP8, VP9 or AV1 and nothing else, so anything
      // arriving as H.264 has to be re-encoded whatever we would prefer.
      copy: null,
      transcode: [
        "-i",
        input,
        // VP8 rather than VP9. VP9 at the same quality is roughly four times
        // the encode time, and this runs single-threaded in WebAssembly on the
        // machine the visitor is sitting at: a two minute clip is the
        // difference between a wait and an abandoned tab.
        "-c:v",
        "libvpx",
        "-b:v",
        "1M",
        "-crf",
        "30",
        "-c:a",
        "libvorbis",
        output,
      ],
    };
  }

  // Everything else lands in MP4.
  return {
    // Only from containers that can already hold what MP4 holds. An AVI full of
    // DivX cannot be rewrapped, and asking costs a failed run before the real
    // one.
    copy:
      from === "mov" || from === "mkv" || from === "any"
        ? ["-i", input, "-c", "copy", "-movflags", "+faststart", output]
        : null,
    transcode: [
      "-i",
      input,
      "-c:v",
      "libx264",
      // `veryfast` and CRF 23. Slower presets buy a few percent of file size
      // for multiples of the encode time, which is the wrong trade when the
      // encoder is WebAssembly on one thread.
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      // The index at the front, so the file starts playing before it has
      // finished downloading. Costs nothing here and is the difference between
      // a video that streams and one that does not.
      "-movflags",
      "+faststart",
      output,
    ],
  };
}

/** `recording.mov` becomes `recording.mp3`. */
export function convertedName(original: string, extension: string): string {
  const stem = original.replace(/\.[^.]+$/, "") || "converted";
  return `${stem}.${extension}`;
}
