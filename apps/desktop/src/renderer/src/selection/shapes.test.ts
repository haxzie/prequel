/**
 * Which shape a click on the area overlay means.
 *
 * Every case here is a pointer inside more than one rectangle at once, which is
 * the normal state of affairs on a real screen — a card inside a panel inside a
 * window — and the one thing the picker has to get right, because choosing the
 * outer one makes everything inside it impossible to pick.
 */
import { describe, expect, it } from "vitest";

import { sameRegion, smallestAt } from "./shapes";

/** A window, a panel inside it, and a card inside that. */
const WINDOW = { x: 0, y: 0, width: 1000, height: 800 };
const PANEL = { x: 100, y: 100, width: 400, height: 400 };
const CARD = { x: 150, y: 150, width: 100, height: 100 };

/** As the detector hands them over: largest first. */
const NESTED = [WINDOW, PANEL, CARD];

describe("smallestAt", () => {
  it("takes the innermost shape under the pointer", () => {
    expect(smallestAt(NESTED, 200, 200)).toEqual(CARD);
  });

  it("takes the panel beside the card, not the window around both", () => {
    expect(smallestAt(NESTED, 400, 400)).toEqual(PANEL);
  });

  it("falls out to the window where nothing smaller reaches", () => {
    expect(smallestAt(NESTED, 800, 700)).toEqual(WINDOW);
  });

  it("answers the same whatever order the shapes arrive in", () => {
    // The detector sorts largest first and the overlay relies on it, but a rule
    // that only works on sorted input is one that breaks silently the day
    // something else builds the list.
    expect(smallestAt([CARD, WINDOW, PANEL], 200, 200)).toEqual(CARD);
  });

  it("counts the edge as inside", () => {
    // A shape's border is the thing the user is aiming at — it is the only part
    // of it they can see — so the pixel under it has to belong to it.
    expect(smallestAt([CARD], CARD.x, CARD.y)).toEqual(CARD);
    expect(smallestAt([CARD], CARD.x + CARD.width, CARD.y + CARD.height)).toEqual(CARD);
  });

  it("is null outside everything, and on an empty screen", () => {
    expect(smallestAt(NESTED, 1200, 900)).toBeNull();
    expect(smallestAt([], 200, 200)).toBeNull();
  });
});

describe("sameRegion", () => {
  it("compares by value, so a rebuilt shape is the same shape", () => {
    expect(sameRegion({ ...CARD }, { ...CARD })).toBe(true);
  });

  it("separates two shapes that differ on one edge only", () => {
    expect(sameRegion(CARD, { ...CARD, width: CARD.width + 1 })).toBe(false);
  });

  it("treats two nulls as the same and one null as different", () => {
    expect(sameRegion(null, null)).toBe(true);
    expect(sameRegion(CARD, null)).toBe(false);
    expect(sameRegion(null, CARD)).toBe(false);
  });
});
