/**
 * Exporting a capture the moment it is made, without an editor.
 *
 * The quick view's one heavy action. There is no save sheet and no window: a
 * recording is rendered with the first cut the editor would have made and a
 * screenshot is the picture itself, both into Downloads — which is where a Mac
 * puts a file that has just been made and is on its way somewhere else.
 *
 * Deliberately on top of `renderRecording` rather than beside it. That path
 * already builds its slices through the editor's own `buildSlices`, so a quick
 * export and an export from the editor are the same geometry — and it already
 * refuses the projects a headless render cannot draw. A fresh capture is never
 * one of those: captions, text overlays and a named cursor tag are all things
 * somebody has to open the editor to ask for.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";

import { app, clipboard, nativeImage } from "electron";

import type { QuickExportOutcome } from "../shared/contract.js";
import { mayExport } from "../shared/contract.js";
import { STILL_FILE_NAME } from "../shared/manifest.js";
import { isRecordedExport, recordExport } from "./exports.js";
import { copyExport, exportFileName, stillFileName } from "./export.js";
import { firstCut } from "./first-cut.js";
import { entitlement, refreshEntitlement } from "./licence.js";
import { log } from "./log.js";
import { renderRecording } from "./render.js";
import { insideRecordings } from "./session.js";

/** Downloads, made if it is not there. See `chooseExportTarget` for why. */
function downloads(name: string): string {
  const dir = app.getPath("downloads");
  mkdirSync(dir, { recursive: true });
  return join(dir, name);
}

/**
 * Whether this licence may export, asking the server when the cache says no.
 *
 * The same policy the editor's Export button follows, for the same reason:
 * somebody who has just paid on the website and come back is exactly the
 * person a stale "expired" is worst for. The cached answer is taken when it
 * allows the export, so the common press costs no round trip.
 */
async function mayExportNow(): Promise<boolean> {
  if (mayExport(entitlement())) return true;
  return mayExport(await refreshEntitlement());
}

/**
 * Exports a capture as it stands, and answers with the file.
 *
 * `needsUpgrade` rather than a throw when the licence does not cover it: that
 * is the one refusal the quick view can act on, and a failed export is not
 * what it is.
 */
export async function quickExport(dir: string, still: boolean): Promise<QuickExportOutcome> {
  if (!insideRecordings(dir)) {
    throw new Error(`refusing to export a directory outside the recordings folder: ${dir}`);
  }

  if (!(await mayExportNow())) return { path: null, needsUpgrade: true };

  if (still) {
    // Copied, not re-rasterised. The quick view's Export is the shot as it was
    // taken — the dressing a screenshot can be given is the editor's, and
    // asking for it there is what Open in Studio is for.
    const output = downloads(stillFileName());
    copyFileSync(join(dir, STILL_FILE_NAME), output);
    // No length, which the Exports pane shows as a dash rather than `0:00`.
    recordExport(output, null);
    log("info", "screenshot exported from the quick view", output);
    return { path: output, needsUpgrade: false };
  }

  // The zooms, before the render reads the project off disk. Without this a
  // capture exported straight from the quick view comes out flat: the pass
  // runs when the *editor* first opens a recording, and this is the path where
  // it never does.
  firstCut(dir);

  const result = await renderRecording(
    dir,
    // H.264 and the project's own frame, rate and short edge. Named here
    // rather than left to `renderRecording`'s default output, which writes
    // beside the library — a file somebody has just asked for goes to
    // Downloads, which is where the save sheet points for the same reason.
    { out: downloads(exportFileName("h264")), format: "h264" },
    // Nothing to report to. The quick view watches `exportProgress`, which
    // `startExport` broadcasts to every window — the same frames the editor's
    // own dialog counts.
    () => undefined,
  );

  log("info", "recording exported from the quick view", result.file);
  return { path: result.file, needsUpgrade: false };
}

/**
 * Puts a capture on the pasteboard.
 *
 * A screenshot goes on as a picture and a video as a file, which is what each
 * is for: a shot is pasted into a message or a document, and a video is
 * attached to one. Pasting a picture needs no export to have happened, which
 * is why the quick view offers Copy on a still straight away.
 */
export function copyCapture(dir: string, still: boolean, exported: string | null): void {
  if (!insideRecordings(dir)) {
    console.warn(`[quickview] refusing to copy a directory outside the recordings folder: ${dir}`);
    return;
  }

  if (still) {
    const image = nativeImage.createFromPath(join(dir, STILL_FILE_NAME));
    if (image.isEmpty()) {
      console.warn("[quickview] the screenshot could not be read, so nothing was copied");
      return;
    }
    clipboard.writeImage(image);
    log("info", "screenshot copied to the pasteboard", basename(dir));
    return;
  }

  if (!exported || !isRecordedExport(exported)) {
    console.warn("[quickview] nothing to copy: this recording has not been exported");
    return;
  }

  // `public.file-url`, the type Finder itself writes on Copy. Text would paste
  // the path into Slack as characters and give Finder nothing at all.
  copyExport(exported);
}
