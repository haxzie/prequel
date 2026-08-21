import { env } from "@prequel/env";

/**
 * Long enough for a several-minute recording to be transcribed, short enough
 * that the route cannot hang. Whisper runs at several times real time, but a
 * cold queue at OpenAI's end adds to it.
 */
const TIMEOUT_MS = 120_000;

const TRANSCRIPTIONS = "https://api.openai.com/v1/audio/transcriptions";

/**
 * The only OpenAI model that returns word timestamps.
 *
 * `timestamp_granularities` is not supported by the gpt-4o transcribe models at
 * all, so despite being the older model this is the only one that can drive a
 * caption, let alone a word-by-word highlight. Its word times are interpolated
 * from segment boundaries rather than measured, which the desktop app declares
 * as `timings: "interpolated"` and compensates for by snapping boundaries to
 * the audio.
 */
const MODEL = "whisper-1";

/**
 * The largest upload to accept, in bytes.
 *
 * Deliberately below both ceilings above it. OpenAI accepts 25 MB; a serverless
 * host in front of this typically accepts far less — Vercel's function body
 * limit is 4.5 MB and is infrastructure, not something application code can
 * raise. Rejecting here gives a message that says what is wrong, where letting
 * it through gives whichever hop is narrowest a chance to answer 413 with
 * nothing useful in it.
 */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * How many transcriptions one install may run per window, and how long it is.
 *
 * In memory, so it resets on every deploy and is per-instance rather than
 * global. Worth saying plainly: with no account system behind this endpoint
 * there is no way to make it airtight, and a comment implying otherwise would
 * be worse than the limit. What it buys is that a single client cannot run this
 * in a loop; the size cap bounds what any one call can cost.
 */
const LIMIT = 12;
const WINDOW_MS = 60 * 60 * 1000;

const used = new Map<string, number[]>();

/**
 * Transcribes a recording's microphone track with OpenAI.
 *
 * The audio passes through this server. That is not the arrangement anyone
 * would pick — it costs egress twice and puts a user's microphone on our
 * infrastructure — but OpenAI's ephemeral keys are scoped to the Realtime API,
 * so there is no short-lived credential that would let the desktop app upload
 * to `/v1/audio/transcriptions` directly. The only other option is embedding
 * the real key in a downloadable app.
 *
 * Nothing is written to disk here, and the audio is not retained past the
 * forward.
 *
 * This is the only runtime link between the site and the desktop app. They
 * still share no code — the rule in `AGENTS.md` is about imports across that
 * boundary, not an HTTP endpoint — and the JSON returned here is the whole
 * contract between them.
 */
export async function POST(request: Request): Promise<Response> {
  if (!env.OPENAI_API_KEY) {
    // 503 rather than 500: nothing is broken, the deployment simply has no key,
    // and the editor says transcription is unavailable rather than failed.
    return Response.json({ message: "Transcription is not configured." }, { status: 503 });
  }

  const install = request.headers.get("x-prequel-install")?.slice(0, 64);
  if (!install) {
    return Response.json({ message: "Missing install identifier." }, { status: 400 });
  }

  if (!take(install)) {
    return Response.json(
      { message: "Too many transcriptions in the last hour. Try again later." },
      { status: 429 },
    );
  }

  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");

  if (!(audio instanceof Blob)) {
    return Response.json({ message: "No audio was sent." }, { status: 400 });
  }

  if (audio.size > MAX_BYTES) {
    return Response.json(
      { message: "This recording's audio is too long to transcribe." },
      { status: 413 },
    );
  }

  try {
    const body = new FormData();
    // The name carries the container: OpenAI infers the format from the
    // extension, and an unnamed blob comes back as an unsupported format.
    body.append("file", audio, "mic.m4a");
    body.append("model", MODEL);
    // `verbose_json` is a precondition, not a preference — word timestamps are
    // only present in that shape, and asking for them with any other response
    // format is an error rather than a quietly plainer result.
    body.append("response_format", "verbose_json");
    body.append("timestamp_granularities[]", "word");

    const response = await fetch(TRANSCRIPTIONS, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(`transcribe: OpenAI answered ${response.status}`);
      return Response.json({ message: "We couldn't transcribe that just now." }, { status: 502 });
    }

    const result = (await response.json()) as {
      language?: string;
      words?: { word: string; start: number; end: number }[];
    };

    return Response.json({
      // Converted here rather than in the app: seconds are OpenAI's unit and
      // nanoseconds are the session clock's, and one conversion in one place is
      // the difference between a caption that lands and one that drifts.
      words: (result.words ?? []).map((word) => ({
        at: seconds(word.start),
        end: seconds(word.end),
        text: word.word,
        // Whisper scores segments, not words. Reporting 1 rather than inventing
        // a per-word number keeps the field honest — nothing downstream treats
        // it as meaningful for this provider.
        confidence: 1,
      })),
      language: result.language ?? "en",
      model: MODEL,
    });
  } catch (error) {
    console.error("transcribe: OpenAI unreachable", error);
    return Response.json({ message: "We couldn't transcribe that just now." }, { status: 502 });
  }
}

function seconds(value: number): number {
  return Math.round(value * 1_000_000_000);
}

/** Records one use and says whether it was within the window's allowance. */
function take(install: string): boolean {
  const now = Date.now();
  const recent = (used.get(install) ?? []).filter((at) => now - at < WINDOW_MS);

  if (recent.length >= LIMIT) {
    used.set(install, recent);
    return false;
  }

  recent.push(now);
  used.set(install, recent);

  // Swept here rather than on a timer: the map only grows while requests are
  // arriving, and a timer would keep a serverless instance alive to run it.
  if (used.size > 10_000) {
    for (const [key, uses] of used) {
      if (uses.every((at) => now - at >= WINDOW_MS)) used.delete(key);
    }
  }

  return true;
}
