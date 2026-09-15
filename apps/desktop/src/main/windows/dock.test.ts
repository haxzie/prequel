/**
 * The dock's window is larger than its panel, and a transparent window still
 * takes every click over it. What is worth pinning is the rectangle main lets
 * the mouse through around: it has to be exactly what the renderer draws the
 * pill into — `DOCK_HEADROOM` down from the top, `PANEL_INSET` in from the
 * other three edges — or a strip of the band above the pill goes on blocking
 * the app behind, or a strip of the pill itself stops answering.
 */
import { describe, expect, it, vi } from "vitest";

import { DOCK_HEADROOM, PANEL_HEIGHT, PANEL_INSET } from "../../shared/contract.js";

// Only `overPanel` is under test, and it touches nothing in Electron. The
// mock stands in for the module so importing `dock.ts` outside Electron works.
vi.mock("electron", () => ({ screen: {}, Menu: {}, BrowserWindow: {}, app: {}, shell: {} }));

const { overPanel } = await import("./dock.js");

/** A setup-sized window at an arbitrary place on screen. */
const WINDOW = {
  x: 300,
  y: 900,
  width: 420 + PANEL_INSET * 2,
  height: PANEL_HEIGHT + DOCK_HEADROOM + PANEL_INSET,
};

const PANEL = {
  left: WINDOW.x + PANEL_INSET,
  right: WINDOW.x + WINDOW.width - PANEL_INSET,
  top: WINDOW.y + DOCK_HEADROOM,
  bottom: WINDOW.y + WINDOW.height - PANEL_INSET,
};

describe("where the dock takes the mouse", () => {
  it("is over the pill", () => {
    expect(overPanel(WINDOW, { x: PANEL.left, y: PANEL.top })).toBe(true);
    expect(overPanel(WINDOW, { x: PANEL.right - 1, y: PANEL.bottom - 1 })).toBe(true);
    expect(
      overPanel(WINDOW, { x: (PANEL.left + PANEL.right) / 2, y: (PANEL.top + PANEL.bottom) / 2 }),
    ).toBe(true);
  });

  it("is not the band above it, where the tooltips are drawn", () => {
    // The whole reason this exists: the band is the part of the window a user
    // notices, because it is 32 points of nothing that swallows clicks.
    expect(overPanel(WINDOW, { x: PANEL.left + 10, y: WINDOW.y })).toBe(false);
    expect(overPanel(WINDOW, { x: PANEL.left + 10, y: PANEL.top - 1 })).toBe(false);
  });

  it("is not the shadow margin on the other three sides", () => {
    expect(overPanel(WINDOW, { x: PANEL.left - 1, y: PANEL.top + 10 })).toBe(false);
    expect(overPanel(WINDOW, { x: PANEL.right, y: PANEL.top + 10 })).toBe(false);
    expect(overPanel(WINDOW, { x: PANEL.left + 10, y: PANEL.bottom })).toBe(false);
  });

  it("is nothing outside the window at all", () => {
    expect(overPanel(WINDOW, { x: WINDOW.x - 1, y: PANEL.top + 10 })).toBe(false);
    expect(overPanel(WINDOW, { x: PANEL.left + 10, y: WINDOW.y + WINDOW.height })).toBe(false);
  });
});
