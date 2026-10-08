/**
 * What the browser will actually write, and what to call the file.
 *
 * Everything here is asked of the browser at the moment it is needed rather
 * than decided in advance. `MediaRecorder` support is the one part of these
 * tools that genuinely differs between Chrome, Safari and Firefox, and a
 * hard-coded container is how a tool comes to produce a zero byte download on
 * one of them.
 */

/** A container the recorder managed to negotiate, and how to name it. */
export type Encoding = {
  /** Passed straight to `MediaRecorder`. Empty means "the browser's own pick". */
  mimeType: string;
  /** The file extension that container needs, without the dot. */
  extension: string;
  /** Printed on the page, so nobody has to guess what they just downloaded. */
  label: string;
};

/**
 * Containers in the order they are wanted, video first.
 *
 * MP4 leads because it is the file that opens everywhere: in QuickTime, in
 * Premiere, in a Slack preview, on a phone. Chrome can mux it from the H.264
 * encoder and Safari writes nothing else. WebM is the fallback and is what
 * Chrome and Firefox reach when MP4 muxing is unavailable, which is still a
 * file every browser and every editor worth the name will open.
 *
 * `avc1.42E01E` is baseline H.264, named explicitly because
 * `isTypeSupported("video/mp4")` answers true in browsers that then refuse the
 * stream once a codec is actually required of them.
 */
const VIDEO_ENCODINGS: Encoding[] = [
  { mimeType: 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"', extension: "mp4", label: "MP4 · H.264" },
  { mimeType: "video/mp4", extension: "mp4", label: "MP4" },
  { mimeType: 'video/webm;codecs="vp9,opus"', extension: "webm", label: "WebM · VP9" },
  { mimeType: 'video/webm;codecs="vp8,opus"', extension: "webm", label: "WebM · VP8" },
  { mimeType: "video/webm", extension: "webm", label: "WebM" },
];

const AUDIO_ENCODINGS: Encoding[] = [
  { mimeType: 'audio/mp4;codecs="mp4a.40.2"', extension: "m4a", label: "M4A · AAC" },
  { mimeType: "audio/mp4", extension: "m4a", label: "M4A" },
  { mimeType: 'audio/webm;codecs="opus"', extension: "webm", label: "WebM · Opus" },
  { mimeType: "audio/webm", extension: "webm", label: "WebM" },
  { mimeType: "audio/ogg;codecs=opus", extension: "ogg", label: "Ogg · Opus" },
];

/**
 * The best container this browser admits to, or null if there is no recorder.
 *
 * The null case is the whole reason this returns rather than throws: the page
 * has something to say to a visitor on an unsupported browser, and it can only
 * say it if asking the question is safe.
 */
export function negotiateEncoding(kind: "video" | "audio"): Encoding | null {
  if (typeof MediaRecorder === "undefined") return null;

  const wanted = kind === "video" ? VIDEO_ENCODINGS : AUDIO_ENCODINGS;
  const supported = wanted.find((encoding) => MediaRecorder.isTypeSupported(encoding.mimeType));

  // An empty `mimeType` is legal and means the browser chooses. Reached only
  // where a recorder exists and admits to none of the five above, which is a
  // browser nobody has reported yet; a download in an unknown container beats
  // a tool that refuses to record.
  return supported ?? { mimeType: "", extension: "webm", label: "WebM" };
}

/**
 * Bits per second for a frame of this size at this rate.
 *
 * 0.1 bits per pixel per frame, which is around 6 Mbps at 1080p30 and is the
 * region where screen content with small text stops showing mush around the
 * glyphs. Ceilinged at 24 Mbps: `MediaRecorder` will happily accept a larger
 * figure and spend the whole of a long recording's memory honouring it, since
 * every chunk is held in the tab until the file is saved.
 */
export function videoBitrate(width: number, height: number, fps: number): number {
  return Math.min(24_000_000, Math.round(width * height * fps * 0.1));
}

export const AUDIO_BITRATE = 128_000;

/**
 * `prequel-screen-recording-2026-10-08-1432.mp4`.
 *
 * Local time and not ISO, because the only thing this name has to do is sort
 * sensibly in a Downloads folder and tell someone which take it was. Colons are
 * illegal in a filename on Windows and silently rewritten by macOS, so the time
 * is punctuated with a dash.
 */
export function recordingFilename(kind: string, extension: string, at = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = [
    at.getFullYear(),
    pad(at.getMonth() + 1),
    pad(at.getDate()),
    `${pad(at.getHours())}${pad(at.getMinutes())}`,
  ].join("-");

  return `prequel-${kind}-${stamp}.${extension}`;
}

/** `1:04`, or `1:02:03` once there is an hour of it. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (value: number) => String(value).padStart(2, "0");

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** `18.4 MB`. Decimal megabytes, which is what a Finder window says. */
export function formatSize(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
