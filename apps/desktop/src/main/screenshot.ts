/**
 * Taking a screenshot, and making it something the editor can open.
 *
 * A screenshot is a recording of one frame. Not a figure of speech — it is
 * literally a session directory with a `session.json` in it, whose `screen`
 * track has a single segment naming a PNG, and the editor opens it through the
 * same `readEditorSession` every take goes through.
 *
 * That is the whole design, and it is the same one `import-video.ts` uses for
 * footage from outside: there is no second document type, no second project
 * shape and no second editor, because the dressing a screenshot wants —
 * a background, padding, a corner, a border, a shadow, a tilt — is exactly
 * what `SliceSettings` already describes and `buildRenderPlan` already draws.
 * A parallel model would be a second implementation of the geometry, which is
 * the one thing `shared/layout.ts` exists to prevent.
 *
 * What a still *is* missing is a clock. `duration` is `STILL_DURATION` rather
 * than zero so the editor has a span to resolve a slice, a text and a framing
 * zoom against; nothing plays it, and `isStill` is what every surface that
 * would otherwise draw a transport asks first.
 */
import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";

import type { Manifest, Region } from "../shared/manifest.js";
import { MANIFEST_FILE_NAME, MANIFEST_VERSION, STILL_FILE_NAME } from "../shared/manifest.js";
import type { Target } from "../shared/contract.js";
import { STILL_DURATION } from "../shared/project.js";
import { log } from "./log.js";
import { deleteRecording, newRecordingPath } from "./session.js";
import { getRecorder } from "./recorder.js";

/** What the shot turned out to be, and where it landed. */
export interface Screenshot {
  /** The session directory, which is what the editor is opened on. */
  dir: string;
  width: number;
  height: number;
}

/** What to shoot, as the panel already measured it. */
export interface ShotRequest {
  target: Target;
  /** The dragged region, in points relative to the target's origin. */
  crop: Region | null;
  /** `CGWindowID`s to keep out of the shot — our own windows. */
  excludedWindowIds: number[];
  /**
   * Whether the pointer is baked into the shot.
   *
   * Off is the useful default and the addon's own, but it is a choice somebody
   * can want the other way — a screenshot demonstrating a hover state needs the
   * arrow in it — so it is carried rather than assumed here.
   */
  showCursor: boolean;
}

/**
 * The `session.json` a screenshot gets, as though it had been recorded.
 *
 * Pure, so the shape this writes is testable without a display, a grant or an
 * editor — which is the only way it can be tested at all, since the one thing
 * that produces the picture needs all three.
 */
export function stillManifest(
  shot: { width: number; height: number },
  source: {
    kind: string;
    id: number;
    title: string;
    appName?: string;
    scaleFactor: number;
    crop?: Region;
  },
  options: { id?: string; startedAt?: string } = {},
): Manifest {
  return {
    version: MANIFEST_VERSION,
    id: options.id ?? randomUUID(),
    started_at: options.startedAt ?? new Date().toISOString(),
    duration: STILL_DURATION,
    // The flag, and the only thing that distinguishes this from a one-second
    // screen recording. Everything that would reach for a decoder reads it.
    still: true,
    source: {
      kind: source.kind,
      id: source.id,
      title: source.title,
      ...(source.appName ? { app_name: source.appName } : {}),
      scale_factor: source.scaleFactor,
      // Carried for the same reason a recording carries it: so a second shot of
      // the same area opens with the region already dragged.
      ...(source.crop ? { crop: source.crop } : {}),
    },
    tracks: [
      {
        kind: "screen",
        segments: [
          {
            file_name: STILL_FILE_NAME,
            start: 0,
            end: STILL_DURATION,
            width: shot.width,
            height: shot.height,
            // One frame, and the recorder's own account of how much it wrote.
            samples: 1,
            dropped: 0,
          },
        ],
      },
    ],
    takes: [{ dir: "", start: 0, end: STILL_DURATION }],
    // Baked is how a session says it has no pointer layer, and a still has
    // none: there is nothing to restyle, smooth, hide or follow. True whether
    // the arrow was drawn into the shot or left out — either way, what is in
    // the picture is all there is.
    cursor_baked: true,
  };
}

/**
 * The region of the *display* a shot covers, for the manifest.
 *
 * `crop` arrives relative to the target's own origin — which is what
 * ScreenCaptureKit wants — and `SourceInfo.crop` is in the display's own
 * points, which is what the area picker reads back. Rebased here, the one
 * place that knows both.
 */
function sourceCrop(target: Target, crop: Region | null): Region | undefined {
  if (!crop) return undefined;
  return {
    x: target.bounds.x + crop.x,
    y: target.bounds.y + crop.y,
    width: crop.width,
    height: crop.height,
  };
}

/**
 * `SourceInfo.kind` for a shot — the same three words a recording writes.
 *
 * An area is a display capture with a crop, which is exactly what it is for a
 * recording too, and it is named rather than inferred for the reason the
 * recorder names it: the crop is applied during capture and a finished picture
 * cannot say afterwards whether it was one.
 */
function sourceKind(target: Target, crop: Region | null): string {
  if (target.kind === "Window") return "window";
  return crop ? "area" : "display";
}

/**
 * Takes a screenshot and leaves a session on disk ready to open.
 *
 * Null when it did not work, having already said why. The directory goes with
 * it: an empty folder beside the recordings is one every library listing has to
 * walk past for ever.
 *
 * The PNG is written before the manifest, deliberately. The manifest is a
 * promise that the file it names holds a picture of that size, and writing it
 * first would leave a session that opens and draws nothing if the capture
 * failed — which reads as a broken editor rather than a failed screenshot.
 */
export async function takeScreenshot(request: ShotRequest): Promise<Screenshot | null> {
  const dir = newRecordingPath();

  try {
    const shot = await (
      await getRecorder()
    ).captureStill({
      targetKind: request.target.kind,
      targetId: request.target.id,
      bounds: request.target.bounds,
      scaleFactor: request.target.scaleFactor,
      outputPath: join(dir, STILL_FILE_NAME),
      ...(request.crop ? { crop: request.crop } : {}),
      showCursor: request.showCursor,
      excludedWindowIds: request.excludedWindowIds,
    });

    writeFileSync(
      join(dir, MANIFEST_FILE_NAME),
      JSON.stringify(
        stillManifest(shot, {
          kind: sourceKind(request.target, request.crop),
          id: request.target.id,
          title: request.target.title,
          appName: request.target.appName,
          scaleFactor: request.target.scaleFactor,
          ...(sourceCrop(request.target, request.crop)
            ? { crop: sourceCrop(request.target, request.crop) }
            : {}),
        }),
        null,
        2,
      ),
    );

    log("info", "screenshot taken", {
      dir: basename(dir),
      size: `${String(shot.width)}×${String(shot.height)}`,
      target: request.target.kind,
      cropped: request.crop !== null,
    });

    return { dir, width: shot.width, height: shot.height };
  } catch (cause) {
    // Said out loud and the folder cleared up. A screenshot that fails silently
    // leaves the panel looking like it ignored the button, which is
    // indistinguishable from a bug in the button.
    console.error("[shot] could not take a screenshot:", cause);
    deleteRecording(dir);
    return null;
  }
}
