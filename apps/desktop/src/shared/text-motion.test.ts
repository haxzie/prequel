/**
 * The keys a text unit is drawn from.
 *
 * What matters is not the shape of any one motion but the properties every
 * consumer relies on: keys in order, a hold between the entrance and the
 * exit, a text that has been trimmed shorter than its motions still arriving
 * before it leaves, and a stagger that finishes when the window does.
 */
import { describe, expect, it } from "vitest";

import type { Rect } from "./layout.js";
import { TEXT_MOTIONS, textKeys, unitKindFor, type TextTiming } from "./text-motion.js";

const S = 1_000_000_000;
const REST: Rect = { x: 100, y: 200, width: 300, height: 60 };
const SPAN = { start: 2 * S, end: 6 * S };

const timing = (over: Partial<TextTiming> = {}): TextTiming => ({
  enter: "rise",
  exit: "fade",
  enterMs: 500,
  exitMs: 400,
  ...over,
});

const one = { index: 0, count: 1 };

describe("textKeys", () => {
  it("sorts its keys and never repeats a moment", () => {
    for (const enter of TEXT_MOTIONS) {
      for (const exit of TEXT_MOTIONS) {
        const keys = textKeys(REST, one, timing({ enter: enter.id, exit: exit.id }), SPAN, 10);
        for (let index = 1; index < keys.length; index += 1) {
          expect(keys[index]!.at).toBeGreaterThan(keys[index - 1]!.at);
        }
      }
    }
  });

  it("holds the unit at rest between the entrance and the exit", () => {
    const keys = textKeys(REST, one, timing(), SPAN, 10);
    const held = keys.filter(
      (key) => key.at >= SPAN.start + 0.5 * S && key.at <= SPAN.end - 0.4 * S,
    );

    expect(held.length).toBeGreaterThanOrEqual(2);
    for (const key of held) {
      expect(key).toMatchObject({ ...REST, opacity: 1, blur: 0 });
    }
  });

  it("arrives hidden and leaves hidden", () => {
    for (const motion of TEXT_MOTIONS) {
      if (motion.id === "none") continue;
      const keys = textKeys(REST, one, timing({ enter: motion.id, exit: motion.id }), SPAN, 10);
      expect(keys[0]!.opacity).toBe(0);
      expect(keys[keys.length - 1]!.opacity).toBe(0);
    }
  });

  it("finishes arriving before it starts leaving, however short the span", () => {
    // 300 ms long, with 500 ms of entrance and 400 ms of exit asked for.
    const short = { start: S, end: S + 0.3 * S };
    const keys = textKeys(REST, one, timing(), short, 10);

    const arrived = keys.find((key) => key.opacity === 1)!;
    const leaving = [...keys].reverse().find((key) => key.opacity === 1)!;
    expect(arrived.at).toBeLessThanOrEqual(short.start + 0.15 * S);
    expect(leaving.at).toBeGreaterThanOrEqual(short.end - 0.15 * S);
    expect(arrived.at).toBeLessThanOrEqual(leaving.at);
  });

  it("staggers its units so the last one lands exactly when the window ends", () => {
    const count = 5;
    const last = textKeys(REST, { index: 4, count }, timing({ enter: "words" }), SPAN, 10);
    const first = textKeys(REST, { index: 0, count }, timing({ enter: "words" }), SPAN, 10);

    const landed = (keys: typeof last) => keys.find((key) => key.opacity === 1)!.at;
    expect(landed(last)).toBe(SPAN.start + 0.5 * S);
    expect(landed(first)).toBeLessThan(landed(last));
  });

  it("switches a typed glyph on rather than fading it", () => {
    const keys = textKeys(REST, { index: 2, count: 4 }, timing({ enter: "typewriter" }), SPAN, 10);
    const on = keys.findIndex((key) => key.opacity === 1);
    expect(keys[on - 1]!.opacity).toBe(0);
    expect(keys[on]!.at - keys[on - 1]!.at).toBe(1);
  });

  it("never blurs wider than it was told it may", () => {
    const keys = textKeys(REST, one, timing({ enter: "blur", exit: "blur" }), SPAN, 12);
    for (const key of keys) {
      expect(key.blur).toBeLessThanOrEqual(12);
      expect(key.blur).toBeGreaterThanOrEqual(0);
    }
    expect(keys[0]!.blur).toBe(12);
  });

  it("draws a motionless text at rest for the whole span", () => {
    const keys = textKeys(REST, one, timing({ enter: "none", exit: "none" }), SPAN, 10);
    for (const key of keys) expect(key).toMatchObject({ ...REST, opacity: 1 });
  });
});

describe("unitKindFor", () => {
  it("cuts a field up only for the two staggered motions", () => {
    for (const motion of TEXT_MOTIONS) {
      const kind = unitKindFor(motion.id);
      if (motion.id === "typewriter") expect(kind).toBe("char");
      else if (motion.id === "words") expect(kind).toBe("word");
      else expect(kind).toBe("block");
    }
  });
});
