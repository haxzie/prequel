/**
 * Transcribes a recording's microphone track with OpenAI.
 *
 * The audio passes through this Worker. That is not the arrangement anyone
 * would pick — it costs egress twice and puts a user's microphone on our
 * infrastructure — but OpenAI's ephemeral keys are scoped to the Realtime API,
 * so there is no short-lived credential that would let the desktop app upload
 * to `/v1/audio/transcriptions` directly. The only other option is embedding
 * the real key in a downloadable app.
 *
 * Nothing is written to disk here, and the audio is not retained past the
 * forward.
 *
 * This route used to live in the Next app and moved here with the rest of the
 * API. Two things changed with it: the size cap, which was Vercel's rather than
 * OpenAI's, and the rate limiter, which was in memory and now is not.
 */
import { and, eq, isNull } from "drizzle-orm";
import { Hono, type Context } from "hono";

import { schema } from "@prequel/db";

import { createAuth } from "../auth.ts";
import { database } from "../db.ts";
import type { Env } from "../env.ts";
import { bearerToken, sha256 } from "../lib/ids.ts";
import { sweep, take } from "../lib/rate-limit.ts";

const transcribe = new Hono<{ Bindings: Env }>();

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
 * This is OpenAI's own ceiling for `whisper-1` and nothing else's. It used to be
 * 4 MB because the route sat behind Vercel, whose 4.5 MB function body limit is
 * infrastructure that application code cannot raise. A Worker accepts 100 MB, so
 * the constraint is now the one that actually belongs to the work — roughly six
 * times as much microphone audio per pass.
 *
 * Still checked here rather than left to OpenAI: rejecting locally gives a
 * message that says what is wrong, where forwarding it spends the upload twice
 * to get a 413 with nothing useful in it.
 */
const MAX_BYTES = 25 * 1024 * 1024;

/** Per window, for somebody with no account. */
const ANONYMOUS = { limit: 12, windowSeconds: 60 * 60 };

/**
 * Per window, for a signed-in user.
 *
 * Higher because there is now a name attached to the usage. The anonymous path
 * is what the limiter was always really guarding: with nothing identifying the
 * caller there is no way to make it airtight, and the size cap above is what
 * bounds the cost of any one call.
 */
const SIGNED_IN = { limit: 60, windowSeconds: 60 * 60 };

transcribe.post("/", async (c) => {
  if (!c.env.OPENAI_API_KEY) {
    // 503 rather than 500: nothing is broken, the deployment simply has no key,
    // and the editor says transcription is unavailable rather than failed.
    return c.json({ message: "Transcription is not configured." }, 503);
  }

  const subject = await identify(c);
  if (!subject) return c.json({ message: "Missing install identifier." }, 400);

  const db = database(c.env);

  if (!(await take(db, subject.key, subject.allowance))) {
    return c.json({ message: "Too many transcriptions in the last hour. Try again later." }, 429);
  }

  c.executionCtx.waitUntil(sweep(db, subject.allowance.windowSeconds));

  const form = await c.req.formData().catch(() => null);
  const audio = form?.get("audio");

  if (!(audio instanceof Blob)) return c.json({ message: "No audio was sent." }, 400);

  if (audio.size > MAX_BYTES) {
    return c.json({ message: "This recording's audio is too long to transcribe." }, 413);
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
      headers: { Authorization: `Bearer ${c.env.OPENAI_API_KEY}` },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(`transcribe: OpenAI answered ${response.status}`);
      return c.json({ message: "We couldn't transcribe that just now." }, 502);
    }

    const result = (await response.json()) as {
      language?: string;
      words?: { word: string; start: number; end: number }[];
    };

    return c.json({
      // Converted here rather than in the app: seconds are OpenAI's unit and
      // nanoseconds are the session clock's, and one conversion in one place is
      // the difference between a caption that lands and one that drifts.
      words: (result.words ?? []).map((word) => ({
        at: nanoseconds(word.start),
        end: nanoseconds(word.end),
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
    return c.json({ message: "We couldn't transcribe that just now." }, 502);
  }
});

/**
 * The subject the allowance is counted against.
 *
 * A signed-in caller is counted as themselves and gets the larger allowance;
 * the install id stays for everybody else, which is what keeps transcription
 * working before anyone has made an account. Both credentials are checked
 * because the two clients differ — the editor sends a device token when the app
 * is signed in, a browser would send the cookie — and neither is required.
 *
 * The install id is hashed before it becomes a key. It identifies a machine, and
 * there is no reason for the limiter's table to be a list of them.
 */
async function identify(c: Context<{ Bindings: Env }>) {
  const userId = await signedInUser(c);
  if (userId) return { key: `user:${userId}`, allowance: SIGNED_IN };

  const install = c.req.header("x-prequel-install")?.slice(0, 64);
  if (!install) return null;

  return { key: `install:${await sha256(install)}`, allowance: ANONYMOUS };
}

async function signedInUser(c: Context<{ Bindings: Env }>): Promise<string | null> {
  const bearer = bearerToken(c.req.header("authorization"));

  if (bearer) {
    const [row] = await database(c.env)
      .select({ userId: schema.deviceToken.userId })
      .from(schema.deviceToken)
      .where(
        and(
          eq(schema.deviceToken.tokenHash, await sha256(bearer)),
          isNull(schema.deviceToken.revokedAt),
        ),
      )
      .limit(1);

    return row?.userId ?? null;
  }

  // A cookie only reaches here from a browser, which today means nothing calls
  // this path — it costs one lookup and means a future web-side transcription
  // is not a special case.
  const session = await createAuth(c.env)
    .api.getSession({ headers: c.req.raw.headers })
    .catch(() => null);

  return session?.user.id ?? null;
}

function nanoseconds(value: number): number {
  return Math.round(value * 1_000_000_000);
}

export default transcribe;
