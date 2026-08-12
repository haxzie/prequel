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

import { listCameras, listTargets, requestScreenAccess, screenAccessStatus } from "../index.js";

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
