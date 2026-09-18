/**
 * Exercises the real Node-API boundary against the compiled addon.
 *
 * These assertions deliberately hold whether or not the test runner has the
 * Screen Recording grant — hosted CI can never have it, so anything that
 * requires real capture belongs in the mac-runner suite instead. What is
 * verified here is the boundary itself: the addon loads, marshals arguments,
 * resolves Promises, and turns Rust `Err`s into thrown JS errors.
 */
import { describe, expect, it } from "vitest";

import {
  listCameras,
  listTargets,
  requestScreenAccess,
  screenAccessStatus,
  soundBank,
  soundCues,
} from "../index.js";

describe("native addon", () => {
  it("loads and exports its surface", () => {
    expect(typeof screenAccessStatus).toBe("function");
    expect(typeof requestScreenAccess).toBe("function");
    expect(typeof listTargets).toBe("function");
  });

  it("reports a permission status from the enum", () => {
    expect(["Granted", "Denied"]).toContain(screenAccessStatus());
  });

  it("is stable across calls", () => {
    expect(screenAccessStatus()).toBe(screenAccessStatus());
  });

  it("returns a Promise from listTargets", () => {
    const pending = listTargets();
    expect(pending).toBeInstanceOf(Promise);
    // Swallow the rejection when unauthorised; the next test asserts on it.
    void pending.catch(() => undefined);
  });

  it("either lists targets or rejects with the permission code", async () => {
    const granted = screenAccessStatus() === "Granted";

    if (granted) {
      const targets = await listTargets();
      expect(targets.length).toBeGreaterThan(0);

      const display = targets.find((t) => t.kind === "Display");
      expect(display, "a Mac always has at least one display").toBeDefined();
      expect(display!.bounds.width).toBeGreaterThan(0);
      expect(display!.scaleFactor).toBeGreaterThan(0);

      // Every target must carry the identity the shell keys exclusion off.
      for (const target of targets) {
        expect(Number.isInteger(target.id)).toBe(true);
        expect(target.id).toBeGreaterThan(0);
      }
    } else {
      // A Rust Err must surface as a thrown JS error carrying the code.
      await expect(listTargets()).rejects.toThrow(/SCREEN_ACCESS_DENIED/);
    }
  });

  it("lists cameras synchronously, with or without one attached", () => {
    // Unlike targets this needs no grant and no display, so it holds on CI —
    // a machine with no camera returns an empty array rather than throwing.
    const cameras = listCameras();
    expect(Array.isArray(cameras)).toBe(true);

    for (const camera of cameras) {
      expect(camera.id).toBeTruthy();
      expect(camera.name).toBeTruthy();
    }
  });

  it("gives every camera a distinct id", () => {
    // The shell stores one of these; a collision would make the stored choice
    // ambiguous the next time the app starts.
    const ids = listCameras().map((camera) => camera.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("sounds", () => {
  const events = {
    pressAt: Float64Array.from([500e6, 620e6, 760e6, 1_400e6]),
    pressClass: Uint8Array.from([0, 0, 1, 2]),
    clickAt: Float64Array.from([2_000e6]),
    seed: "binding-test",
  };

  it("plans one cue per event, in time order, as typed arrays", () => {
    const cues = soundCues(events);
    expect(cues.at).toBeInstanceOf(Float64Array);
    expect(cues.at.length).toBe(5);
    expect(Array.from(cues.at)).toEqual([500e6, 620e6, 760e6, 1_400e6, 2_000e6]);
    // Letter, letter, space, backspace, then click — the class indices, and
    // 5 for a click.
    expect(Array.from(cues.kind)).toEqual([0, 0, 1, 2, 5]);
    for (const gain of cues.gain) expect(gain).toBeGreaterThan(0);
  });

  it("plans the same recording the same way twice", () => {
    const a = soundCues(events);
    const b = soundCues(events);
    expect(Array.from(a.variant)).toEqual(Array.from(b.variant));
    expect(Array.from(a.gain)).toEqual(Array.from(b.gain));
    const c = soundCues({ ...events, seed: "another take" });
    expect(Array.from(c.gain)).not.toEqual(Array.from(a.gain));
  });

  it("renders a bank whose offsets index its samples", () => {
    const bank = soundBank("tactile");
    expect(bank.sampleRate).toBe(48_000);
    expect(Array.from(bank.kinds)).toEqual([0, 1, 2, 3, 4]);
    expect(bank.offsets.length).toBe(bank.kinds.length * bank.variants + 1);
    expect(bank.offsets[bank.offsets.length - 1]).toBe(bank.samples.length);
    expect(bank.samples.length).toBeGreaterThan(0);
    // Every voice fits the 300 ms cap and has its press inside it.
    for (let i = 0; i + 1 < bank.offsets.length; i++) {
      const length = bank.offsets[i + 1] - bank.offsets[i];
      expect(length).toBeGreaterThan(bank.onset);
      expect(length).toBeLessThanOrEqual(48_000 * 0.3);
    }

    const clicks = soundBank("soft");
    expect(Array.from(clicks.kinds)).toEqual([5]);
  });

  it("refuses a keyboard it has never heard of", () => {
    expect(() => soundBank("box-white")).toThrow(/UNKNOWN_SOUND/);
  });
});
