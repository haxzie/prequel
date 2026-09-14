/**
 * The transcript as a subtitle track.
 *
 * The desktop app can burn captions into the picture, and many recordings are
 * shared without them — which leaves the person at the other end with no way
 * to read along. This turns the transcript the app uploads for chapters into
 * WebVTT, so the player can offer subtitles on every recording that was
 * transcribed, whatever the export looked like.
 *
 * The grouping rules are the desktop's (`shared/captions.ts`), in milliseconds
 * rather than nanoseconds: a cue breaks at a breath, at the end of a sentence,
 * when it has run long enough that it would read as frozen, or when a line is
 * full. Repeated rather than imported, because `apps/api` shares no code with
 * the desktop app — the HTTP endpoints are the contract.
 */
import type { Transcript, TranscriptWord } from "./chapters.ts";

/** The ceiling on one cue's span, before it reads as frozen rather than live. */
const MAX_CUE_MS = 5_000;

/**
 * Silence this long between two words breaks the cue: short enough to break at
 * a breath, long enough not to break between two words of the same phrase.
 */
const GAP_MS = 700;

/**
 * How long a cue is held past its last word, towards the next cue and never
 * past it. Without this a caption blinks out in every pause between phrases.
 */
const HOLD_MS = 400;

/**
 * Roughly a line of subtitle at the size browsers draw them. Two lines to a
 * cue, which is the most anyone reads under a picture.
 */
const CHARS_PER_LINE = 42;
const LINES = 2;

/** The same sounds the desktop drops: they carry nothing and hold a cue up. */
const FILLER = /^(u+h+|u+m+|e+r+|e+rm+|a+h+|m+h+m+|h+m+|mm+|uh-huh|er+m*)[.,!?]*$/i;

export interface Cue {
  /** Milliseconds into the file. */
  at: number;
  end: number;
  lines: string[];
}

/** Groups the words into cues, by the rules above. Pure. */
export function cuesFrom(words: readonly TranscriptWord[]): Cue[] {
  const cues: Cue[] = [];
  let current: TranscriptWord[] = [];
  let lines: string[] = [];

  const flush = () => {
    const first = current[0];
    const last = current.at(-1);
    if (!first || !last) return;
    cues.push({ at: first.at, end: last.end, lines: lines.filter((line) => line.length > 0) });
    current = [];
    lines = [];
  };

  for (const word of words) {
    const text = word.text.trim();
    if (!text || FILLER.test(text)) continue;

    const previous = current.at(-1);
    const opened = current[0];
    if (previous && opened) {
      const silence = word.at - previous.end >= GAP_MS;
      const overlong = word.end - opened.at > MAX_CUE_MS;
      // The punctuation is on the *previous* word: a full stop ends the cue it
      // belongs to, rather than starting the next one.
      const sentence = /[.!?]["')\]]?$/.test(previous.text);
      if (silence || overlong || sentence) flush();
    }

    const line = lines.at(-1);
    if (line === undefined) {
      lines.push(text);
    } else if (line.length + 1 + text.length <= CHARS_PER_LINE) {
      lines[lines.length - 1] = `${line} ${text}`;
    } else if (lines.length < LINES) {
      lines.push(text);
    } else {
      flush();
      lines.push(text);
    }
    current.push(word);
  }
  flush();

  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index]!;
    const next = cues[index + 1];
    const reach = cue.end + HOLD_MS;
    cue.end = next ? Math.min(reach, next.at) : reach;
    // A word that ends where it starts — its end was cut away in the editor —
    // still needs a moment on screen to be read.
    if (cue.end <= cue.at) cue.end = cue.at + 1;
  }

  return cues;
}

/** `HH:MM:SS.mmm`, which is the one form every WebVTT parser accepts. */
export function vttTimestamp(ms: number): string {
  const whole = Math.max(0, Math.round(ms));
  const hours = Math.floor(whole / 3_600_000);
  const minutes = Math.floor((whole % 3_600_000) / 60_000);
  const seconds = Math.floor((whole % 60_000) / 1000);
  const millis = whole % 1000;
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(hours)}:${two(minutes)}:${two(seconds)}.${String(millis).padStart(3, "0")}`;
}

/**
 * The whole file. `line:-3` lifts the cue a row off the bottom edge, so it
 * clears the player's own control bar when that is showing.
 */
export function vttFrom(transcript: Transcript): string {
  const body = cuesFrom(transcript.words)
    .map(
      (cue) =>
        `${vttTimestamp(cue.at)} --> ${vttTimestamp(cue.end)} line:-3\n${cue.lines
          .map(escapeCue)
          .join("\n")}`,
    )
    .join("\n\n");

  return `WEBVTT\n\n${body}\n`;
}

/** The three characters WebVTT reads as markup. Nothing said is markup. */
function escapeCue(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Whisper's language names, as ISO 639-1.
 *
 * `whisper-1` reports `"german"`, not `"de"`, and the desktop app stores what
 * the provider said. A `<track srclang>` wants the tag; browsers shrug at a
 * name, but a screen reader picking a voice does not. Anything that already
 * looks like a tag passes through, and an unknown name is kept as it is
 * rather than guessed at.
 */
const LANGUAGE_TAGS: Record<string, string> = {
  english: "en",
  german: "de",
  french: "fr",
  spanish: "es",
  italian: "it",
  portuguese: "pt",
  dutch: "nl",
  swedish: "sv",
  norwegian: "no",
  danish: "da",
  finnish: "fi",
  polish: "pl",
  czech: "cs",
  slovak: "sk",
  hungarian: "hu",
  romanian: "ro",
  bulgarian: "bg",
  greek: "el",
  turkish: "tr",
  russian: "ru",
  ukrainian: "uk",
  hebrew: "he",
  arabic: "ar",
  persian: "fa",
  hindi: "hi",
  bengali: "bn",
  tamil: "ta",
  telugu: "te",
  malayalam: "ml",
  kannada: "kn",
  marathi: "mr",
  gujarati: "gu",
  urdu: "ur",
  indonesian: "id",
  malay: "ms",
  vietnamese: "vi",
  thai: "th",
  chinese: "zh",
  japanese: "ja",
  korean: "ko",
  catalan: "ca",
  croatian: "hr",
  serbian: "sr",
  slovenian: "sl",
  lithuanian: "lt",
  latvian: "lv",
  estonian: "et",
  filipino: "fil",
  tagalog: "tl",
  swahili: "sw",
  afrikaans: "af",
  welsh: "cy",
  icelandic: "is",
};

export function languageTag(language: string): string {
  const trimmed = language.trim();
  if (/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(trimmed)) return trimmed.toLowerCase();
  return LANGUAGE_TAGS[trimmed.toLowerCase()] ?? trimmed;
}
