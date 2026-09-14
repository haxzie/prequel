/**
 * What the player is allowed to see.
 *
 * `normaliseChapters` is the only thing standing between a language model's
 * answer and the scrub bar, and every rule in it is a picture that looked wrong:
 * a marker off the end of the bar, two drawn on top of each other, a nameless
 * sliver at the start. The model is asked not to do any of these and is not
 * believed, so the tests here feed it exactly those answers.
 */
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  heuristicChapters,
  makeChapters,
  MAX_CHAPTERS,
  normaliseChapters,
  transcriptLines,
  wantsChapters,
  type Transcript,
} from "../src/lib/chapters.ts";

const MINUTE = 60_000;

/** `count` words, one a second, from `from`. */
function spoken(count: number, from = 0): Transcript {
  return {
    language: "en",
    words: Array.from({ length: count }, (_, index) => ({
      at: from + index * 1000,
      end: from + index * 1000 + 800,
      text: `w${index}`,
    })),
  };
}

/** `text` said one word a second, with a `pause` after any word ending in `|`. */
function said(text: string, pause = 3_000): Transcript {
  const words: Transcript["words"] = [];
  let at = 0;
  for (const token of text.split(/\s+/).filter(Boolean)) {
    const breath = token.endsWith("|");
    const clean = breath ? token.slice(0, -1) : token;
    words.push({ at, end: at + 800, text: clean });
    at += breath ? pause : 1000;
  }
  return { language: "en", words };
}

describe("wantsChapters", () => {
  it("declines a short recording, however much was said", () => {
    expect(wantsChapters(spoken(500), 45_000)).toBe(false);
  });

  it("declines a long recording where almost nothing was said", () => {
    expect(wantsChapters(spoken(10), 10 * MINUTE)).toBe(false);
  });

  it("wants a recording that is both long enough and spoken enough", () => {
    expect(wantsChapters(spoken(60), 2 * MINUTE)).toBe(true);
  });
});

describe("normaliseChapters", () => {
  const duration = 10 * MINUTE;

  it("keeps a well-formed answer as it is", () => {
    const chapters = normaliseChapters(
      [
        { at: 0, title: "Setting up" },
        { at: 3 * MINUTE, title: "Recording a demo" },
        { at: 7 * MINUTE, title: "Sharing the link" },
      ],
      duration,
    );

    expect(chapters).toEqual([
      { at: 0, title: "Setting up" },
      { at: 3 * MINUTE, title: "Recording a demo" },
      { at: 7 * MINUTE, title: "Sharing the link" },
    ]);
  });

  it("always starts the first chapter at zero", () => {
    // Four seconds in, which is the model landing on the first sentence rather
    // than on the start. Moved back rather than given an "Introduction" of
    // four seconds nobody could click.
    const late = normaliseChapters(
      [
        { at: 4_000, title: "Setting up" },
        { at: 5 * MINUTE, title: "Recording" },
      ],
      duration,
    );
    expect(late[0]).toEqual({ at: 0, title: "Setting up" });

    // A minute in leaves a real stretch of recording before it, which needs a
    // name of its own rather than being folded into the second subject.
    const gap = normaliseChapters(
      [
        { at: MINUTE, title: "Recording" },
        { at: 5 * MINUTE, title: "Sharing" },
      ],
      duration,
    );
    expect(gap.map((chapter) => chapter.at)).toEqual([0, MINUTE, 5 * MINUTE]);
    expect(gap[0]?.title).toBe("Introduction");
  });

  it("drops a chapter past the end, and one too close to it", () => {
    const chapters = normaliseChapters(
      [
        { at: 0, title: "Start" },
        { at: 5 * MINUTE, title: "Middle" },
        { at: duration - 5_000, title: "Almost the end" },
        { at: duration + MINUTE, title: "Past the end" },
      ],
      duration,
    );

    expect(chapters.map((chapter) => chapter.title)).toEqual(["Start", "Middle"]);
  });

  it("merges chapters that sit too close together", () => {
    const chapters = normaliseChapters(
      [
        { at: 0, title: "Start" },
        { at: 3 * MINUTE, title: "One" },
        // Five seconds later: one marker drawn twice. The first of the pair
        // wins, because that is where the subject changed.
        { at: 3 * MINUTE + 5_000, title: "One again" },
        { at: 6 * MINUTE, title: "Two" },
      ],
      duration,
    );

    expect(chapters.map((chapter) => chapter.title)).toEqual(["Start", "One", "Two"]);
  });

  it("sorts whatever order the model chose", () => {
    const chapters = normaliseChapters(
      [
        { at: 6 * MINUTE, title: "Two" },
        { at: 0, title: "Start" },
        { at: 3 * MINUTE, title: "One" },
      ],
      duration,
    );

    expect(chapters.map((chapter) => chapter.at)).toEqual([0, 3 * MINUTE, 6 * MINUTE]);
  });

  it("caps the count", () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      at: index * 30_000,
      title: `Part ${index}`,
    }));

    expect(normaliseChapters(many, 20 * MINUTE)).toHaveLength(MAX_CHAPTERS);
  });

  it("is nothing rather than one chapter", () => {
    // A single chapter is a title, and the bar would be divided into one piece.
    expect(normaliseChapters([{ at: 0, title: "Everything" }], duration)).toEqual([]);
    expect(normaliseChapters([], duration)).toEqual([]);
  });

  it("cleans titles the way models write them", () => {
    const chapters = normaliseChapters(
      [
        { at: 0, title: '1. "Setting up."' },
        { at: 3 * MINUTE, title: "Chapter 2: Recording   a\ndemo" },
        { at: 6 * MINUTE, title: "" },
        { at: 8 * MINUTE, title: "x".repeat(100) },
      ],
      duration,
    );

    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "Setting up",
      "Recording a demo",
      `${"x".repeat(59)}…`,
    ]);
  });

  it("snaps a boundary to the nearest word start", () => {
    // Words at whole seconds; the model said 2:59.6, and the word that starts
    // that sentence is at 3:00.
    const transcript = spoken(600);
    const chapters = normaliseChapters(
      [
        { at: 0, title: "Start" },
        { at: 3 * MINUTE - 400, title: "Later" },
      ],
      duration,
      transcript,
    );

    expect(chapters[1]?.at).toBe(3 * MINUTE);
  });

  it("does not snap across a pause", () => {
    // Nothing said between 2:00 and 4:00. A boundary at 3:00 stays where the
    // model put it rather than jumping a minute to the previous sentence.
    const transcript: Transcript = {
      language: "en",
      words: [...spoken(120).words, ...spoken(120, 4 * MINUTE).words],
    };
    const chapters = normaliseChapters(
      [
        { at: 0, title: "Start" },
        { at: 3 * MINUTE, title: "Later" },
      ],
      duration,
      transcript,
    );

    expect(chapters[1]?.at).toBe(3 * MINUTE);
  });
});

describe("transcriptLines", () => {
  it("stamps each line with where it starts", () => {
    const lines = transcriptLines(spoken(20), 8_000).split("\n");

    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("[0:00] w0 w1 w2 w3 w4 w5 w6 w7");
    expect(lines[1]).toBe("[0:08] w8 w9 w10 w11 w12 w13 w14 w15");
    expect(lines[2]).toBe("[0:16] w16 w17 w18 w19");
  });

  it("stamps minutes past the first", () => {
    expect(transcriptLines(spoken(1, 61_000))).toBe("[1:01] w0");
  });
});

describe("heuristicChapters", () => {
  it("divides at the longest pauses and titles each with its opening words", () => {
    // Three and a half minutes with two breaths in it. The pauses win, so the
    // chapters land on them rather than on the even thirds.
    const transcript = said(
      [
        ...Array.from({ length: 60 }, (_, i) => `open${i}`),
        "settings.|",
        ...Array.from({ length: 70 }, (_, i) => `record${i}`),
        "clip.|",
        ...Array.from({ length: 70 }, (_, i) => `share${i}`),
        "done.",
      ].join(" "),
      5_000,
    );
    const duration = transcript.words.at(-1)!.end + 1_000;

    const chapters = heuristicChapters(transcript, duration);

    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "Open0 open1 open2 open3 open4 open5…",
      "Record0 record1 record2 record3 record4 record5…",
      "Share0 share1 share2 share3 share4 share5…",
    ]);
    expect(chapters[1]?.at).toBe(transcript.words[61]!.at);
    expect(chapters[2]?.at).toBe(transcript.words[132]!.at);
  });

  it("divides evenly at sentence starts when nobody pauses", () => {
    // Four minutes of continuous speech. No pause is long enough, so the
    // split is even, and each cut is pulled to the sentence start nearest it.
    const words = Array.from({ length: 240 }, (_, i) => (i % 20 === 19 ? `w${i}.` : `w${i}`));
    const transcript = said(words.join(" "));
    const duration = 4 * MINUTE;

    const chapters = heuristicChapters(transcript, duration);

    expect(chapters.length).toBeGreaterThanOrEqual(3);
    expect(chapters[0]?.at).toBe(0);
    for (const chapter of chapters.slice(1)) {
      const index = transcript.words.findIndex((word) => word.at === chapter.at);
      // The word before each boundary ends a sentence.
      expect(transcript.words[index - 1]!.text.endsWith(".")).toBe(true);
    }
  });

  it("drops the filler a sentence opens with", () => {
    const transcript = said(
      [
        ...Array.from({ length: 60 }, (_, i) => `w${i}`),
        "there.|",
        "So um okay let's open the settings panel now",
        ...Array.from({ length: 40 }, (_, i) => `x${i}`),
      ].join(" "),
      5_000,
    );
    const chapters = heuristicChapters(transcript, transcript.words.at(-1)!.end + 1_000);

    expect(chapters[1]?.title).toBe("Let's open the settings panel now…");
  });

  it("is nothing for a recording too short to divide", () => {
    expect(heuristicChapters(spoken(500), 30_000)).toEqual([]);
  });
});

describe("makeChapters", () => {
  /** Which providers answer, and with what. A missing entry is a 500. */
  let answers: Partial<Record<"openai" | "anthropic" | "moonshot", unknown>> = {};
  /** The hosts asked, in order. */
  let asked: string[] = [];

  const transcript = spoken(120);
  const duration = 2 * MINUTE;
  const list = [
    { at: 0, title: "Getting started" },
    { at: 60, title: "The second half" },
  ];

  function stub() {
    asked = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const host = new URL(input instanceof Request ? input.url : String(input)).hostname;
      const which = host.includes("openai")
        ? "openai"
        : host.includes("anthropic")
          ? "anthropic"
          : "moonshot";
      asked.push(which);

      const answer = answers[which];
      if (answer === undefined) return new Response("down", { status: 503 });
      if (which === "anthropic") {
        return Response.json({
          content: [{ type: "text", text: JSON.stringify(answer) }],
          stop_reason: "end_turn",
          usage: { input_tokens: 700, output_tokens: 40 },
        });
      }
      return Response.json({
        choices: [{ message: { content: JSON.stringify(answer) } }],
        usage: { prompt_tokens: 500, completion_tokens: 30 },
      });
    });
  }

  const keys = {
    ...env,
    OPENAI_API_KEY: "openai",
    ANTHROPIC_API_KEY: "anthropic",
    MOONSHOT_API_KEY: "moonshot",
  };

  afterEach(() => vi.unstubAllGlobals());

  it("takes OpenAI's answer first, and records the model and the tokens", async () => {
    answers = { openai: { chapters: list }, anthropic: { chapters: list } };
    stub();

    const result = await makeChapters(keys, transcript, duration);

    expect(asked).toEqual(["openai"]);
    expect(result.source).toBe("model");
    expect(result.model).toBe("openai/gpt-4o-mini");
    expect(result.inputTokens).toBe(500);
    expect(result.outputTokens).toBe(30);
    expect(result.chapters?.[1]).toEqual({ at: 60_000, title: "The second half" });
  });

  it("falls through to Anthropic, then Kimi, in that order", async () => {
    answers = { anthropic: { chapters: list } };
    stub();

    const viaAnthropic = await makeChapters(keys, transcript, duration);
    expect(asked).toEqual(["openai", "anthropic"]);
    expect(viaAnthropic.model).toBe("anthropic/claude-opus-5");
    expect(viaAnthropic.inputTokens).toBe(700);

    answers = { moonshot: { chapters: list } };
    stub();

    const viaKimi = await makeChapters(keys, transcript, duration);
    expect(asked).toEqual(["openai", "anthropic", "moonshot"]);
    expect(viaKimi.model).toBe("moonshot/kimi-k3");
  });

  it("skips a model with no key rather than counting it as a failure", async () => {
    answers = { moonshot: { chapters: list } };
    stub();

    const result = await makeChapters(
      { ...env, MOONSHOT_API_KEY: "moonshot" },
      transcript,
      duration,
    );

    expect(asked).toEqual(["moonshot"]);
    expect(result.model).toBe("moonshot/kimi-k3");
  });

  it("moves on from a model whose answer is unusable", async () => {
    // One chapter is a title, not a table of contents. OpenAI's answer is
    // well-formed and worthless, so the next model is asked.
    answers = {
      openai: { chapters: [{ at: 0, title: "Everything" }] },
      anthropic: { chapters: list },
    };
    stub();

    const result = await makeChapters(keys, transcript, duration);

    expect(asked).toEqual(["openai", "anthropic"]);
    expect(result.model).toBe("anthropic/claude-opus-5");
  });

  it("falls back to the heuristic when every model is down", async () => {
    answers = {};
    stub();

    const result = await makeChapters(keys, transcript, duration);

    expect(asked).toEqual(["openai", "anthropic", "moonshot"]);
    expect(result.source).toBe("heuristic");
    expect(result.model).toBe("heuristic");
    expect(result.inputTokens).toBe(0);
    expect(result.chapters?.length).toBeGreaterThanOrEqual(2);
    expect(result.chapters?.[0]?.at).toBe(0);
  });

  it("asks nothing about a recording too short to divide", async () => {
    answers = { openai: { chapters: list } };
    stub();

    const result = await makeChapters(keys, spoken(500), 30_000);

    expect(asked).toEqual([]);
    expect(result).toEqual({
      chapters: null,
      source: "none",
      model: null,
      inputTokens: null,
      outputTokens: null,
    });
  });
});
