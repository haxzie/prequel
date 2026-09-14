/**
 * Dividing a recording into chapters, from what was said in it.
 *
 * The desktop app sends the transcript of the finished cut — word times already
 * in output milliseconds, words in cut-out footage already gone — and this asks
 * a language model where the subject changes. Nothing here listens to audio:
 * a recording that was never transcribed has no chapters, and that is the
 * intended answer rather than a gap to fill from this side.
 *
 * **Four ways to an answer, tried in order: OpenAI, Anthropic, Kimi, and a
 * heuristic that needs no network at all.** The models are a chain rather
 * than a choice because every one of them is down sometimes, and a share link
 * opened during that hour should still have a table of contents. The
 * heuristic is the floor: boundaries at the longest pauses, titled with the
 * words that follow them. It is worse than a model and better than nothing,
 * and a row it wrote is retried against the models later — see
 * `retryChaptersIfDue`.
 *
 * Every model answer goes through `normaliseChapters`, which is pure, tested,
 * and the only thing that decides what the player sees. A model that puts a
 * chapter past the end of the file, two at the same second, or none at zero is
 * not a failure — it is Tuesday — and the player would draw every one of those
 * as a broken scrub bar.
 *
 * Raw `fetch` for all three, as `transcribe.ts` already does for OpenAI,
 * rather than three SDKs in a Worker for one call each. What is recorded about
 * a call — the model and the tokens — is the same shape from all of them.
 */
import { and, eq, isNull, lte, or } from "drizzle-orm";

import { schema, type Chapter } from "@prequel/db";

import type { Database } from "../db.ts";
import type { Deferrable, Env } from "../env.ts";

/** What the desktop app sends: the finished cut's words, in output time. */
export interface TranscriptWord {
  /** Milliseconds into the finished file. */
  at: number;
  end: number;
  text: string;
}

export interface Transcript {
  /** BCP-47, as the transcriber reported it. Given to the model so titles match. */
  language: string;
  words: TranscriptWord[];
}

export type ChapterSource = "model" | "heuristic" | "none";

/** What gets written to the row, whichever way the chapters were made. */
export interface ChapterResult {
  chapters: Chapter[] | null;
  source: ChapterSource;
  /** `openai/gpt-4o-mini`, `heuristic`, or null when there was nothing to make. */
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * Below either of these, no chapters at all.
 *
 * A forty-second clip with three chapters is a scrub bar chopped into pieces a
 * thumb cannot land on, and a table of contents for a recording shorter than
 * the time it takes to read it. The word floor catches the other case: a long
 * recording with almost nothing said, where the model would be dividing
 * silence.
 */
export const MIN_DURATION_MS = 60_000;
export const MIN_WORDS = 50;

/**
 * How close two chapters may sit, as a fraction of the recording.
 *
 * A fraction rather than a fixed number of seconds so the rule scales: fifteen
 * seconds apart is fine in a two-minute clip and a segment nobody could grab in
 * an hour-long one. Floored at fifteen seconds so a short recording still
 * cannot be sliced finer than the bar can show.
 */
const MIN_GAP_FRACTION = 0.04;
const MIN_GAP_MS = 15_000;

/** The most chapters any recording gets, whatever the model offers. */
export const MAX_CHAPTERS = 12;

const MAX_TITLE_CHARS = 60;

/**
 * How long the whole chain may take, and how long any one model gets.
 *
 * The chain runs inside `waitUntil`, which Cloudflare cuts off not long after
 * the response has gone; a chain that could run three models for thirty
 * seconds each would be killed mid-way and write nothing. So there is one
 * budget for the lot, each model gets what is left of it, and whatever has not
 * answered by the end loses to the heuristic — which the retry on view then
 * gives another go.
 */
const CHAIN_BUDGET_MS = 25_000;
const PER_MODEL_MS = 12_000;

/**
 * How long a heuristic row waits before the models are tried again.
 *
 * An hour is long enough for an outage to have passed and short enough that a
 * link opened tomorrow has the better chapters. Per row, so an outage at
 * OpenAI is not multiplied by however many people open a link during it.
 */
export const RETRY_AFTER_MS = 60 * 60 * 1000;

/** `provider/model`, as stored on the row. */
export const HEURISTIC_MODEL = "heuristic";

/**
 * Whether this recording is worth dividing at all.
 *
 * Decided before the model is asked, not after, because the decision costs
 * nothing and the call does not.
 */
export function wantsChapters(transcript: Transcript, durationMs: number): boolean {
  return durationMs >= MIN_DURATION_MS && transcript.words.length >= MIN_WORDS;
}

/**
 * The transcript as the model reads it: one line per few seconds, each stamped
 * with where it starts.
 *
 * Stamped lines rather than a stamp per word. The model has to answer in
 * seconds, and a wall of `[12.4]word [12.7]word` gives it several thousand
 * numbers to lose its place among; a stamp every line is enough to land a
 * chapter on the sentence it belongs to, and the boundary is then snapped to
 * a word start below anyway.
 */
export function transcriptLines(transcript: Transcript, lineMs = 8_000): string {
  const lines: string[] = [];
  let lineStart = -1;
  let line: string[] = [];

  for (const word of transcript.words) {
    if (lineStart < 0 || word.at - lineStart >= lineMs) {
      if (line.length > 0) lines.push(`[${stamp(lineStart)}] ${line.join(" ")}`);
      lineStart = word.at;
      line = [];
    }
    line.push(word.text);
  }
  if (line.length > 0) lines.push(`[${stamp(lineStart)}] ${line.join(" ")}`);

  return lines.join("\n");
}

function stamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function minGap(durationMs: number): number {
  return Math.max(MIN_GAP_MS, durationMs * MIN_GAP_FRACTION);
}

/**
 * Turns whatever came back into chapters the player can draw.
 *
 * Every rule here is a picture that looked wrong: a chapter past the end is a
 * marker off the right of the bar; two within a second of each other are one
 * marker drawn twice; a first chapter at 0:04 leaves a nameless sliver at the
 * start; an empty title is a tooltip with nothing in it. The model is asked not
 * to do any of these and is not believed.
 *
 * Boundaries are snapped to the nearest word start when a transcript is given,
 * so a chapter begins where somebody starts talking rather than in the middle
 * of a word — the difference between seeking to a chapter and seeking to half
 * a syllable before it.
 */
export function normaliseChapters(
  raw: readonly { at: number; title: string }[],
  durationMs: number,
  transcript?: Transcript,
): Chapter[] {
  const gap = minGap(durationMs);
  const starts = transcript?.words.map((word) => word.at) ?? [];

  const cleaned = raw
    .map((chapter) => ({
      at: snapToWord(Math.max(0, Math.floor(chapter.at)), starts),
      title: cleanTitle(chapter.title),
    }))
    .filter((chapter) => Number.isFinite(chapter.at) && chapter.title.length > 0)
    // Strictly inside the file. A chapter *at* the end would be a segment of
    // zero width, and the last `gap` is too short to be worth its own name.
    .filter((chapter) => chapter.at < durationMs - gap)
    .sort((a, b) => a.at - b.at);

  const chapters: Chapter[] = [];
  for (const chapter of cleaned) {
    const previous = chapters.at(-1);
    if (previous && chapter.at - previous.at < gap) continue;
    chapters.push(chapter);
    if (chapters.length === MAX_CHAPTERS) break;
  }

  // The first chapter always starts at zero, whatever the model said. The bar
  // has to be divided all the way from the left, and a recording's opening
  // seconds belong to the first thing that was said rather than to nothing.
  if (chapters.length > 0 && chapters[0]!.at !== 0) {
    // Only when the model's own first chapter is not simply late. One that
    // starts inside the first gap is the opening, moved; one further in has
    // left an actual stretch of recording before it that needs a name.
    if (chapters[0]!.at < gap) chapters[0]!.at = 0;
    else chapters.unshift({ at: 0, title: "Introduction" });
  }
  if (chapters.length > MAX_CHAPTERS) chapters.length = MAX_CHAPTERS;

  // One chapter is a title, not a table of contents, and the bar would be
  // divided into one piece.
  return chapters.length >= 2 ? chapters : [];
}

/**
 * The nearest word start within a second, or the time as given.
 *
 * A second either way is generous for a boundary the model placed by reading a
 * stamped line, and no further: snapping across a pause would move a chapter
 * to the previous sentence's last word.
 */
function snapToWord(at: number, starts: readonly number[]): number {
  let best = at;
  let distance = 1_000;
  for (const start of starts) {
    const d = Math.abs(start - at);
    if (d < distance) {
      distance = d;
      best = start;
    }
  }
  return best;
}

/**
 * A title fit for a list: one line, no surrounding quotes or numbering, and
 * short enough to sit beside a timecode without wrapping.
 */
function cleanTitle(title: unknown): string {
  if (typeof title !== "string") return "";
  const trimmed = title
    .replace(/\s+/g, " ")
    // Models number things — "1. Setup", "Chapter 2: Deploying" — and the
    // list draws its own numbers.
    .replace(/^\s*(chapter\s*)?\d+\s*[.:)-]\s*/i, "")
    .replace(/^["'“”‘’]+|["'“”‘’.]+$/g, "")
    .trim();
  return trimmed.length > MAX_TITLE_CHARS
    ? `${trimmed.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`
    : trimmed;
}

// ---------------------------------------------------------------------------
// The heuristic
// ---------------------------------------------------------------------------

/**
 * A pause this long between two words is somebody drawing breath before a new
 * thought, which is where a chapter goes when nobody cleverer is available.
 */
const PAUSE_MS = 900;

/** How many words of the chapter's opening make its title. */
const TITLE_WORDS = 6;

/**
 * Words that open a sentence without saying anything, dropped from the front
 * of a heuristic title so it reads "Opening the settings" and not "So um
 * opening the settings". The list is deliberately short: a word that is
 * sometimes filler and sometimes not — "like", "well" — is left alone, because
 * a title that loses its first real word is worse than one that keeps an um.
 */
const OPENERS = new Set([
  "um",
  "uh",
  "umm",
  "uhh",
  "so",
  "okay",
  "ok",
  "alright",
  "right",
  "and",
  "yeah",
  "now",
  "then",
]);

/**
 * Chapters with no model at all.
 *
 * The bar is divided at the longest pauses in the recording, kept at least a
 * gap apart, and where speech never pauses it is divided evenly at the nearest
 * sentence start instead. Each chapter is titled with the first few words said
 * after its boundary, which is the one thing a transcript can say about a
 * stretch of recording without understanding it.
 *
 * Deliberately conservative about count: one chapter per minute or so, never
 * more than eight. A model finds the real subject changes; this only finds
 * places where somebody stopped talking, and too many of those is a bar cut
 * into slivers with titles that mean nothing.
 */
export function heuristicChapters(transcript: Transcript, durationMs: number): Chapter[] {
  if (!wantsChapters(transcript, durationMs)) return [];

  const words = transcript.words;
  const gap = minGap(durationMs);
  const target = Math.min(Math.max(Math.floor(durationMs / MIN_DURATION_MS), 2), 8);

  // Every word start is a candidate boundary. A pause before it is worth the
  // pause's length; a sentence start with no pause is worth a little, so the
  // even split below prefers it to the middle of a clause.
  const scored: { index: number; score: number }[] = [];
  for (let i = 1; i < words.length; i += 1) {
    const previous = words[i - 1]!;
    const pause = words[i]!.at - previous.end;
    const sentence = /[.?!]["'”’)]*$/.test(previous.text);
    scored.push({ index: i, score: pause >= PAUSE_MS ? pause : sentence ? 1 : 0 });
  }

  const chosen: number[] = [];
  const accepts = (index: number) => {
    const at = words[index]!.at;
    if (at < gap || at >= durationMs - gap) return false;
    return chosen.every((other) => Math.abs(words[other]!.at - at) >= gap);
  };

  // Longest pauses first, until there are enough.
  for (const candidate of scored
    .filter((entry) => entry.score >= PAUSE_MS)
    .sort((a, b) => b.score - a.score)) {
    if (chosen.length >= target - 1) break;
    if (accepts(candidate.index)) chosen.push(candidate.index);
  }

  // Not enough pauses — a demo narrated without a breath. Divide the rest of
  // the time evenly and take the nearest sentence start to each cut, or the
  // nearest word when there is not one.
  if (chosen.length < target - 1) {
    for (let k = 1; k < target && chosen.length < target - 1; k += 1) {
      const ideal = (durationMs * k) / target;
      // A sentence start within ten seconds beats a mid-clause word that
      // happens to be closer.
      const distance = (entry: { index: number; score: number }) =>
        Math.abs(words[entry.index]!.at - ideal) - (entry.score > 0 ? 10_000 : 0);
      const nearest = scored
        .filter((entry) => accepts(entry.index))
        .sort((a, b) => distance(a) - distance(b))[0];
      if (nearest) chosen.push(nearest.index);
    }
  }

  const boundaries = [0, ...chosen.sort((a, b) => a - b)];
  const raw = boundaries.map((index, n) => ({
    at: words[index]!.at,
    title: openingWords(words, index, boundaries[n + 1] ?? words.length),
  }));

  return normaliseChapters(raw, durationMs, transcript);
}

/** The first few words of a chapter, as a title. */
function openingWords(words: readonly TranscriptWord[], from: number, to: number): string {
  let start = from;
  while (start < to - 1 && OPENERS.has(words[start]!.text.toLowerCase().replace(/[^a-z]/g, ""))) {
    start += 1;
  }

  const taken = words.slice(start, Math.min(start + TITLE_WORDS, to)).map((word) => word.text);
  let title = taken.join(" ").replace(/[,;:]+$/, "");
  if (title.length === 0) return "";

  title = title.charAt(0).toUpperCase() + title.slice(1);
  // Cut mid-sentence, and it should read that way. A title that happens to
  // end at a full stop is a whole thought and keeps its own punctuation.
  if (to - start > TITLE_WORDS && !/[.?!]$/.test(title)) title += "…";
  return title;
}

// ---------------------------------------------------------------------------
// The models
// ---------------------------------------------------------------------------

/** What a model call produced, before normalisation. */
interface Answer {
  chapters: { at: number; title: string }[];
  inputTokens: number;
  outputTokens: number;
}

/** One link in the chain. */
interface Provider {
  /** `provider/model`, for the row. */
  model: string;
  /** Null when the deployment has no key for it; the chain skips it. */
  key(env: Env): string | undefined;
  ask(key: string, prompt: Prompt, signal: AbortSignal): Promise<Answer | null>;
}

interface Prompt {
  system: string;
  transcript: string;
}

const OPENAI_MODEL = "gpt-4o-mini";
const ANTHROPIC_MODEL = "claude-opus-5";
const KIMI_MODEL = "kimi-k3";

/** The schema every model is held to. The same object serves all three. */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    chapters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          at: { type: "integer", description: "Seconds from the start." },
          title: { type: "string" },
        },
        required: ["at", "title"],
      },
    },
  },
  required: ["chapters"],
} as const;

function promptFor(transcript: Transcript, durationMs: number): Prompt {
  const seconds = Math.floor(durationMs / 1000);
  return {
    system: [
      "You write chapter markers for a screen recording, from its transcript.",
      "Each line of the transcript begins with the time it was said, as [m:ss].",
      `The recording is ${seconds} seconds long.`,
      "",
      "Divide it into chapters where the subject actually changes. Between 3 and 8",
      "chapters for most recordings; fewer if it stays on one thing, never more",
      `than ${MAX_CHAPTERS}. Chapters must be at least 20 seconds apart, and the`,
      "first must start at 0.",
      "",
      "A title is a short noun phrase of at most six words, in the language the",
      "recording is in — like a heading, not a sentence. Say what is shown or",
      "done, not that it is shown: 'Connecting the database', not 'The presenter",
      "connects the database'. No numbering, no quotes, no trailing full stop.",
      "",
      "`at` is the chapter's start in whole seconds from the beginning.",
      'Answer with JSON of the form {"chapters": [{"at": 0, "title": "..."}, ...]}',
      "and nothing else.",
    ].join("\n"),
    transcript: transcriptLines(transcript),
  };
}

/** The model's list, from the JSON it answered with. Seconds become milliseconds here. */
function parseAnswer(content: string): { at: number; title: string }[] | null {
  let parsed: { chapters?: { at?: unknown; title?: unknown }[] };
  try {
    parsed = JSON.parse(content) as typeof parsed;
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.chapters)) return null;

  return parsed.chapters
    .filter((chapter) => typeof chapter.at === "number")
    .map((chapter) => ({
      // The model answers in seconds and the row stores milliseconds; this
      // is the one conversion.
      at: (chapter.at as number) * 1000,
      title: typeof chapter.title === "string" ? chapter.title : "",
    }));
}

/**
 * OpenAI and Kimi speak the same protocol, so they share a caller. The one
 * difference is the response format: OpenAI enforces the schema, Kimi's
 * endpoint only promises JSON, and `normaliseChapters` copes with either.
 */
async function askCompletions(
  url: string,
  key: string,
  model: string,
  prompt: Prompt,
  format: unknown,
  signal: AbortSignal,
  extra: Record<string, unknown> = {},
): Promise<Answer | null> {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.transcript },
      ],
      response_format: format,
      ...extra,
    }),
    signal,
  });

  if (!response.ok) {
    console.error(`chapters: ${model} answered ${response.status}`);
    return null;
  }

  const result = (await response.json()) as {
    choices?: { message?: { content?: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = result.choices?.[0]?.message?.content;
  if (!content) return null;

  const chapters = parseAnswer(content);
  if (!chapters) return null;

  return {
    chapters,
    inputTokens: result.usage?.prompt_tokens ?? 0,
    outputTokens: result.usage?.completion_tokens ?? 0,
  };
}

const openai: Provider = {
  model: `openai/${OPENAI_MODEL}`,
  key: (env) => env.OPENAI_API_KEY,
  ask: (key, prompt, signal) =>
    askCompletions(
      "https://api.openai.com/v1/chat/completions",
      key,
      OPENAI_MODEL,
      prompt,
      { type: "json_schema", json_schema: { name: "chapters", strict: true, schema: SCHEMA } },
      signal,
    ),
};

const anthropic: Provider = {
  model: `anthropic/${ANTHROPIC_MODEL}`,
  key: (env) => env.ANTHROPIC_API_KEY,
  async ask(key, prompt, signal) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        // Room for the thinking that runs before the answer as well as the
        // answer; both count against it.
        max_tokens: 4_000,
        system: prompt.system,
        messages: [{ role: "user", content: prompt.transcript }],
        // Summarising text that is already in front of it, not reasoning
        // about it: the lowest effort is the right one, and it keeps this
        // link in the chain inside its share of the budget.
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      }),
      signal,
    });

    if (!response.ok) {
      console.error(`chapters: ${ANTHROPIC_MODEL} answered ${response.status}`);
      return null;
    }

    const result = (await response.json()) as {
      content?: { type: string; text?: string }[];
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    // A refusal answers 200 with no usable text; it is a miss like any other.
    if (result.stop_reason === "refusal") return null;

    const text = result.content?.find((block) => block.type === "text")?.text;
    if (!text) return null;

    const chapters = parseAnswer(text);
    if (!chapters) return null;

    return {
      chapters,
      inputTokens: result.usage?.input_tokens ?? 0,
      outputTokens: result.usage?.output_tokens ?? 0,
    };
  },
};

const kimi: Provider = {
  model: `moonshot/${KIMI_MODEL}`,
  key: (env) => env.MOONSHOT_API_KEY,
  ask: (key, prompt, signal) =>
    askCompletions(
      "https://api.moonshot.ai/v1/chat/completions",
      key,
      KIMI_MODEL,
      prompt,
      { type: "json_object" },
      signal,
      // K3 always reasons; the least of it is plenty for a table of contents,
      // and the reasoning is billed as output.
      { reasoning_effort: "low" },
    ),
};

/** In the order they are tried. */
const CHAIN: readonly Provider[] = [openai, anthropic, kimi];

/**
 * The chapters for a transcript, by whatever made them.
 *
 * Down the chain until something answers with a usable list, then the
 * heuristic. A model that is not configured is skipped without being counted
 * as a failure; a model that fails — refused, timed out, answered nonsense —
 * is logged by name and the next one is asked. Nothing here throws: the
 * result says how the chapters were made, and the caller writes it down.
 */
export async function makeChapters(
  env: Env,
  transcript: Transcript,
  durationMs: number,
): Promise<ChapterResult> {
  const none: ChapterResult = {
    chapters: null,
    source: "none",
    model: null,
    inputTokens: null,
    outputTokens: null,
  };
  if (!wantsChapters(transcript, durationMs)) return none;

  const prompt = promptFor(transcript, durationMs);
  const deadline = Date.now() + CHAIN_BUDGET_MS;

  for (const provider of CHAIN) {
    const key = provider.key(env);
    if (!key) continue;

    const left = deadline - Date.now();
    if (left <= 0) {
      console.warn(`chapters: out of time before ${provider.model}`);
      break;
    }

    try {
      const answer = await provider.ask(
        key,
        prompt,
        AbortSignal.timeout(Math.min(PER_MODEL_MS, left)),
      );
      if (!answer) continue;

      const chapters = normaliseChapters(answer.chapters, durationMs, transcript);
      if (chapters.length === 0) {
        console.warn(`chapters: ${provider.model} answered with nothing usable`);
        continue;
      }

      return {
        chapters,
        source: "model",
        model: provider.model,
        inputTokens: answer.inputTokens,
        outputTokens: answer.outputTokens,
      };
    } catch (error) {
      console.error(`chapters: ${provider.model} unreachable`, error);
    }
  }

  const fallback = heuristicChapters(transcript, durationMs);
  if (fallback.length === 0) return none;

  return {
    chapters: fallback,
    source: "heuristic",
    model: HEURISTIC_MODEL,
    inputTokens: 0,
    outputTokens: 0,
  };
}

/**
 * Makes the chapters and writes them to the row, whatever the outcome.
 *
 * A heuristic result is stamped with when the models may next be tried; a
 * model result and "nothing to make" are final and clear the stamp.
 */
export async function storeChapters(
  env: Env,
  db: Database,
  videoId: string,
  transcript: Transcript,
  durationMs: number,
): Promise<ChapterResult> {
  const result = await makeChapters(env, transcript, durationMs);

  await db
    .update(schema.video)
    .set({
      chapters: result.chapters,
      chaptersSource: result.source,
      chaptersModel: result.model,
      chaptersInputTokens: result.inputTokens,
      chaptersOutputTokens: result.outputTokens,
      chaptersRetryAt: result.source === "heuristic" ? new Date(Date.now() + RETRY_AFTER_MS) : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.video.id, videoId));

  return result;
}

/** The columns the retry needs to read off a row. */
export interface RetryableRow {
  id: string;
  durationMs: number;
  transcriptKey: string | null;
  chaptersSource: ChapterSource | null;
  chaptersRetryAt: Date | null;
}

/**
 * Gives a heuristic row another go at the models, from a view.
 *
 * Driven by views rather than a cron because a view is the moment better
 * chapters are worth having, and a recording nobody opens again never costs
 * a call. The stamp is moved forward *before* the attempt so two viewers in
 * the same second start one retry, not two; if the attempt fails, the
 * heuristic chapters stay and the stamp stands for another hour.
 *
 * Nothing to do unless every model is unconfigured — then the heuristic is
 * the best this deployment can do and retrying is a query per view for
 * nothing.
 */
export function retryChaptersIfDue(
  env: Env,
  ctx: Deferrable,
  db: Database,
  row: RetryableRow,
): void {
  if (row.chaptersSource !== "heuristic" || !row.transcriptKey) return;
  if (row.chaptersRetryAt && row.chaptersRetryAt.getTime() > Date.now()) return;
  if (!CHAIN.some((provider) => provider.key(env))) return;

  const { id, durationMs, transcriptKey } = row;

  ctx.waitUntil(
    (async () => {
      // The claim is the update itself: only a row whose stamp is still due
      // is moved, so of two viewers racing here exactly one gets a row back.
      const now = new Date();
      const claimed = await db
        .update(schema.video)
        .set({ chaptersRetryAt: new Date(now.getTime() + RETRY_AFTER_MS) })
        .where(
          and(
            eq(schema.video.id, id),
            eq(schema.video.chaptersSource, "heuristic"),
            or(isNull(schema.video.chaptersRetryAt), lte(schema.video.chaptersRetryAt, now)),
          ),
        )
        .returning({ id: schema.video.id });
      if (claimed.length === 0) return;

      const object = await env.MEDIA.get(transcriptKey);
      if (!object) return;

      const transcript = (await object.json()) as Transcript;
      await storeChapters(env, db, id, transcript, durationMs);
    })().catch((error: unknown) => console.error("chapters: retry failed", error)),
  );
}
