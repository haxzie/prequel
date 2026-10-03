/**
 * Rendering a recording with no window open.
 *
 * The editor renders by building an export request in the renderer, where the
 * fonts and the canvas are. This does the same thing from main, for the command
 * line — through the *same* `buildSlices`, so the geometry cannot differ. What
 * it cannot do is draw: burned-in captions, text overlays and a named cursor
 * tag are bitmaps a window rasterises, and a headless render of a project using
 * any of them would write a video that is quietly missing them. Those are
 * refused by name instead, which is the one failure mode worth more than the
 * convenience.
 */
import { existsSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";

import {
  cursorTag,
  IPC_CHANNELS,
  type ExportFormat,
  type ExportProgress,
} from "../shared/contract.js";
import type { CliProgress } from "../shared/cli.js";
import { findPreset } from "../shared/presets.js";
import { outputFrame, resolveSettings, type Project } from "../shared/project.js";
import { buildSlices } from "../renderer/src/editor/exportSlices.js";
import { watch } from "./broadcast.js";
import { readEditorSession, withBackground } from "./editor-session.js";
import { renderedDurationMs, startExport } from "./export.js";
import { log } from "./log.js";
import { RECORDINGS_DIR } from "./session.js";

export interface RenderOptions {
  out?: string;
  format?: ExportFormat;
  shortEdge?: number;
  fps?: number;
  presetId?: string;
}

export interface RenderResult {
  file: string;
  width: number;
  height: number;
  durationMs: number | null;
  bytes: number | null;
}

/**
 * What this project needs a window for, as a list of reasons.
 *
 * Returned rather than thrown so the caller can name every one of them at once:
 * a project with captions *and* titles told only about the captions gets edited
 * and refused a second time.
 */
export function needsEditor(project: Project, words: number): string[] {
  const reasons: string[] = [];

  const settings = [
    resolveSettings(project.defaults, undefined),
    ...(project.tracks[0]?.slices ?? []).map((slice) =>
      resolveSettings(project.defaults, slice.overrides),
    ),
  ];

  // The switch *and* something to draw. `captionsOn` is true on every new
  // project — a recording with a microphone transcribes itself when it is
  // opened, so by the time anyone looks there are captions to show — and
  // refusing on the switch alone would refuse almost every recording ever
  // made, including the take an agent has just this moment recorded and never
  // opened. With no words there is nothing to rasterise and a headless render
  // is identical to the editor's.
  if (words > 0 && settings.some((resolved) => resolved.captions.captionsOn)) {
    reasons.push("burned-in captions");
  }

  if (project.texts.some((row) => row.slices.length > 0)) {
    reasons.push("text overlays");
  }

  // A tag is drawn only when the style has one *and* a name was typed, which is
  // why both halves are checked. `trimName` in the renderer also caps the
  // length; emptiness is all that matters here.
  if (
    settings.some(
      (resolved) =>
        cursorTag(resolved.layout.cursorStyle) !== null &&
        (resolved.layout.cursorName ?? "").trim() !== "",
    )
  ) {
    reasons.push("a named cursor tag");
  }

  return reasons;
}

/**
 * Where a rendered file goes when nobody said.
 *
 * `~/Movies/Prequel`, beside the library rather than inside it: the library is
 * `.recordings`, a dot-directory of working state, and writing the one file
 * somebody asked for into it is how that folder became unusable before.
 * Downloads is where the save dialog opens for a person, but a file written by
 * a command needs to be where the recording is, not where a browser puts things.
 */
function defaultOutput(dir: string, project: Project, format: ExportFormat): string {
  mkdirSync(RECORDINGS_DIR, { recursive: true });

  const extension = format === "gif" ? ".gif" : ".mp4";
  const stem = (project.name ?? basename(dir)).replace(/[/:]/g, "-");

  // Never overwrites. Two renders of the same recording are the ordinary case —
  // a different frame, a tweaked background — and silently replacing the first
  // is a file somebody may already have sent.
  let candidate = join(RECORDINGS_DIR, `${stem}${extension}`);
  let index = 2;
  while (existsSync(candidate)) {
    candidate = join(RECORDINGS_DIR, `${stem} ${String(index)}${extension}`);
    index += 1;
  }

  return candidate;
}

export async function renderRecording(
  dir: string,
  options: RenderOptions,
  report: (progress: CliProgress) => void,
): Promise<RenderResult> {
  const session = await readEditorSession(dir);

  // The same repair the editor makes on the way in: a project whose background
  // names a catalogue picture this Mac has never held would render the gap
  // rather than the picture.
  const project = await withBackground(dir, session.project);

  // Either the recording's own transcript or the one corrected in the captions
  // panel, because the panel's overlay is what the editor draws when it exists.
  const words = (project.transcript?.words ?? session.transcript?.words ?? []).length;

  const blocked = needsEditor(project, words);
  if (blocked.length > 0) {
    throw new RenderNeedsEditor(
      `this edit uses ${blocked.join(" and ")}, which only the editor can draw. ` +
        `Open it with \`prequel recordings open\` and export from there`,
    );
  }

  const format = options.format ?? project.output.format;
  const fps = options.fps ?? project.output.fps;
  const shortEdge = options.shortEdge ?? project.output.shortEdge;

  // A named preset changes the shape of the finished video, which is the one
  // output setting that is a property of the project rather than of the render.
  // Applied to a copy: a render must not edit the file it is rendering.
  const preset = options.presetId ? findPreset(options.presetId) : undefined;
  if (options.presetId && !preset && options.presetId !== project.frame.presetId) {
    throw new RenderFailed(
      `no frame preset called "${options.presetId}". \`prequel presets list\` has the ids`,
    );
  }

  const frame = preset ? { width: preset.width, height: preset.height } : project.frame;
  const size = outputFrame(frame, shortEdge);

  const output = options.out
    ? withExtension(options.out, format)
    : defaultOutput(dir, project, format);

  log("info", "rendering from the command line", {
    dir,
    output,
    frame: `${String(size.width)}×${String(size.height)}`,
    fps,
    format,
  });

  const finished = new Promise<RenderResult>((done, failed) => {
    const stop = watch(IPC_CHANNELS.exportProgress, (payload) => {
      const progress = payload as ExportProgress;

      report({
        stage: progress.stage,
        done: progress.framesDone,
        total: progress.framesTotal,
      });

      if (progress.stage === "done") {
        stop();
        done({
          file: progress.outputPath ?? output,
          width: size.width,
          height: size.height,
          // The frames written over the rate they were written at, which is
          // the finished file's own length rather than the recording's: every
          // cut and every sped-up clip is already accounted for.
          durationMs: renderedDurationMs(progress.framesTotal, fps),
          bytes: progress.bytes ?? null,
        });
        return;
      }

      if (progress.stage === "failed" || progress.stage === "cancelled") {
        stop();
        failed(
          new RenderFailed(
            progress.error?.message ?? `the render ${progress.stage} without saying why`,
          ),
        );
      }
    });
  });

  await startExport({
    dir: session.dir,
    output,
    width: size.width,
    height: size.height,
    fps,
    format,
    slices: buildSlices(
      session,
      { ...project, frame: { ...project.frame, ...frame } },
      size,
      EMPTY_CUES,
      EMPTY_TEXTS,
      // Never a tag: `needsEditor` has already refused any project that asks
      // for one, because the label is a bitmap only a window can draw.
      () => undefined,
    ),
    sound: session.sound,
  });

  return finished;
}

/** Nothing to draw, because nothing asked for anything drawn. See `needsEditor`. */
const EMPTY_CUES = new Map();
const EMPTY_TEXTS = new Map();

/**
 * Forces the extension to match the format.
 *
 * The same rule the save dialog follows: a GIF written into a file called
 * `.mp4` is one nothing on the system will open, and `--out demo.mp4 --format
 * gif` is an easy pair to type.
 */
function withExtension(path: string, format: ExportFormat): string {
  const wanted = format === "gif" ? ".gif" : ".mp4";
  return extname(path).toLowerCase() === wanted ? path : path + wanted;
}

export class RenderNeedsEditor extends Error {}
export class RenderFailed extends Error {}
