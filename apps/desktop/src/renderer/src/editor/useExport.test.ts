/**
 * What each clip is told to play, and at what size.
 *
 * A recording can be extended with another take, so a clip's footage and that
 * footage's dimensions are both per clip. The failure this pins is silent: one
 * pair of dimensions used for every clip crops the second take against the
 * first's, which renders a plausible, wrongly-framed picture and says nothing in
 * any log.
 */
import { describe, expect, it } from "vitest";

import type { EditorSession, TrackMedia } from "../../../shared/contract";
import { MANIFEST_VERSION, type Manifest } from "../../../shared/manifest";
import { newProject, type Project } from "../../../shared/project";
import { buildSlices } from "./useExport";

const S = 1_000_000_000;

/** Ten seconds at 1920×1080, then six more at 1280×720. */
function media(): TrackMedia[] {
  const screen = (
    segment: number,
    file: string,
    offset: number,
    duration: number,
    size: number,
  ) => ({
    kind: "screen" as const,
    segment,
    file,
    url: `prequel-media://recording/take/${file}`,
    offset,
    duration,
    width: size,
    height: Math.round((size * 9) / 16),
    frameRate: 60,
    matteUrl: null,
    matteFile: null,
  });

  return [screen(0, "screen.mp4", 0, 10 * S, 1920), screen(1, "2/screen.mp4", 10 * S, 6 * S, 1280)];
}

function manifest(): Manifest {
  return {
    version: MANIFEST_VERSION,
    id: "Prequel 1",
    started_at: "2026-08-11T12:00:00Z",
    duration: 16 * S,
    source: { kind: "display", id: 1, title: "Display", scale_factor: 2 },
    tracks: [],
    takes: [
      { dir: "", start: 0, end: 10 * S },
      { dir: "2", start: 10 * S, end: 16 * S },
    ],
  };
}

function session(): EditorSession {
  return {
    dir: "/recordings/Prequel 1",
    name: "Prequel 1",
    manifest: manifest(),
    media: media(),
    cursor: null,
    project: project(),
    transcript: null,
    sound: null,
    focusSliceId: null,
  };
}

/** One clip per take, which is what a fresh project of an extended recording is. */
function project(): Project {
  return newProject("Prequel 1", 16 * S, { fullScreen: false, window: null }, [10 * S]);
}

function built() {
  const opened = session();
  return buildSlices(
    opened,
    opened.project,
    { width: 1920, height: 1080 },
    new Map(),
    new Map(),
    new Map(),
  );
}

/** The screen's source rectangle in a slice's plan. */
function screenSource(plan: { items: readonly unknown[] }) {
  const item = plan.items.find(
    (candidate): candidate is { kind: "image"; source: string; srcRect: { width: number } } =>
      (candidate as { kind?: string }).kind === "image" &&
      (candidate as { source?: string }).source === "screen",
  );
  return item?.srcRect ?? null;
}

describe("buildSlices", () => {
  it("names each clip's own file and offset", () => {
    const slices = built();

    expect(slices).toHaveLength(2);
    expect(slices[0]!.media.screen).toEqual({ file: "screen.mp4", offset: 0 });
    // The second take's file is zero-based like every other, so the offset is
    // the only record of where it sits — and the exporter subtracts it once.
    expect(slices[1]!.media.screen).toEqual({ file: "2/screen.mp4", offset: 10 * S });
  });

  it("builds each clip's plan against its own take's dimensions", () => {
    // The hoist that used to sit outside this loop. With one pair of dimensions
    // for the whole recording, the 1280-wide take was cropped as though it were
    // 1920 wide.
    const [first, second] = built();

    expect(screenSource(first!.plan)?.width).toBe(1920);
    expect(screenSource(second!.plan)?.width).toBe(1280);
  });

  it("leaves out a kind no take recorded over the clip", () => {
    // Absent rather than pointed at the nearest take's file: the exporter renders
    // no picture and silence for a kind it is not given, which is what the
    // preview shows too.
    for (const slice of built()) {
      expect(slice.media.camera).toBeUndefined();
      expect(slice.media.microphone).toBeUndefined();
      expect(slice.media.system_audio).toBeUndefined();
    }
  });
});
