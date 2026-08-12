/**
 * Records a real session through the addon: screen and camera together.
 *
 * This is the assertion that matters for separate tracks — not that each file
 * exists, but that the two land on one timeline. A camera track that starts at
 * its own zero looks perfectly fine on its own and is silently out of step by
 * the length of the camera's warm-up once the two are merged.
 *
 * Self-skips without the Screen Recording grant or a camera, so it stays honest
 * on hosted CI, where neither can exist.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  listCameras,
  listTargets,
  screenAccessStatus,
  startRecording,
  stopRecording,
} from "../index.js";

const RECORD_FOR_MS = 4000;

/** Duration of a media file in milliseconds, via ffprobe. */
function durationMs(path: string): number {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
    { encoding: "utf8" },
  );
  return Number.parseFloat(out.trim()) * 1000;
}

describe("a recorded session", () => {
  it("writes screen and camera tracks on one timeline", async () => {
    if (screenAccessStatus() !== "Granted") {
      console.warn("SKIP: no Screen Recording grant");
      return;
    }
    const camera = listCameras()[0];
    if (!camera) {
      console.warn("SKIP: no camera attached");
      return;
    }

    const targets = await listTargets();
    const display = targets.find((t) => t.kind === "Display");
    if (!display) {
      console.warn("SKIP: no display available (asleep?)");
      return;
    }

    const outputPath = join(tmpdir(), "prequel-session-test");
    rmSync(outputPath, { recursive: true, force: true });

    await startRecording({
      targetKind: display.kind,
      targetId: display.id,
      bounds: display.bounds,
      scaleFactor: display.scaleFactor,
      outputPath,
      fps: 30,
      // By name, which is what the shell has: Chromium's device ids are salted
      // per origin and cannot be resolved by AVFoundation.
      camera: camera.name,
      startedAt: new Date().toISOString(),
    });

    await new Promise((resolve) => setTimeout(resolve, RECORD_FOR_MS));
    const result = await stopRecording();

    expect(result.cameraError).toBeFalsy();
    expect(existsSync(join(outputPath, "screen.mp4"))).toBe(true);
    expect(existsSync(join(outputPath, "camera.mp4"))).toBe(true);

    expect(result.frames).toBeGreaterThan(30);
    expect(result.cameraFrames).toBeGreaterThan(30);
    expect(result.cameraWidth).toBeGreaterThanOrEqual(640);

    // The camera opens after the screen has already anchored the clock, so its
    // offset must be positive — and small, or something is badly wrong with the
    // warm-up rather than merely slow.
    expect(result.cameraStartMs).toBeGreaterThan(0);
    expect(result.cameraStartMs).toBeLessThan(2000);

    const screenMs = durationMs(join(outputPath, "screen.mp4"));
    const cameraMs = durationMs(join(outputPath, "camera.mp4"));

    console.log(
      `screen ${screenMs.toFixed(0)}ms · camera ${cameraMs.toFixed(0)}ms ` +
        `starting at +${result.cameraStartMs.toFixed(0)}ms · ` +
        `${result.width}x${result.height} and ${result.cameraWidth}x${result.cameraHeight}`,
    );

    // The whole point: the camera is exactly as long as the recording *minus*
    // the time it took to open. If the two tracks were on separate timelines
    // this would come out at the full screen duration instead.
    const expectedCameraMs = screenMs - result.cameraStartMs;
    expect(Math.abs(cameraMs - expectedCameraMs)).toBeLessThan(250);

    // And the offset has to survive on disk. Once the app forgets it there is
    // no way to recover it from the files themselves — each one is normalised
    // to its own zero.
    const manifestPath = join(outputPath, "session.json");
    expect(existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.version).toBe(1);

    const screenTrack = manifest.tracks.find((t: { kind: string }) => t.kind === "screen");
    const cameraTrack = manifest.tracks.find((t: { kind: string }) => t.kind === "camera");
    expect(screenTrack).toBeDefined();
    expect(cameraTrack).toBeDefined();

    // Nanoseconds in the manifest, milliseconds across the addon boundary.
    expect(screenTrack.start).toBe(0);
    expect(cameraTrack.start / 1e6).toBeCloseTo(result.cameraStartMs, 3);
    expect(cameraTrack.width).toBe(result.cameraWidth);

    rmSync(outputPath, { recursive: true, force: true });
  }, 30_000);
});
