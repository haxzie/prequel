/**
 * What every `prequel` command actually does.
 *
 * Each handler calls the same modules the windows call — `CaptureFlow`,
 * `projects.ts`, `startExport`, `startTranscribe` — rather than reimplementing
 * anything. That is the whole design: a recording made from the command line
 * must be the same recording, in the same place, with the same first cut, as
 * one made by pressing the button. A second path through capture would be a
 * second recorder to keep working.
 *
 * Every refusal carries a code from `CliErrorCode`, because an agent branches
 * on it: `busy` means stop the take first, `not_found` means the id is stale.
 */
import { readFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";

import { app, screen, shell } from "electron";

import type { CliErrorCode, CliProgress } from "../../shared/cli.js";
import { CLI_PROTOCOL } from "../../shared/cli.js";
import {
  IPC_CHANNELS,
  type AuthState,
  type ExportFormat,
  type PendingSelection,
  type ShareProgress,
  type Target,
  type TranscribeProgress,
} from "../../shared/contract.js";
import {
  MANIFEST_FILE_NAME,
  findTrack,
  isStill,
  parseManifest,
  seamsOf,
} from "../../shared/manifest.js";
import { autoZooms, momentsOf } from "../../shared/autoedit.js";
import {
  PROJECT_FILE_NAME,
  sanitiseProject,
  sourceShape,
  type Project,
} from "../../shared/project.js";
import { TRANSCRIPT_FILE_NAME } from "../../shared/transcript.js";
import { authState, beginSignIn, onAuthChanged, signOut } from "../auth.js";
import { catalogue } from "../backgrounds.js";
import { watch } from "../broadcast.js";
import type { CaptureFlow } from "../capture-flow.js";
import { loadProject, saveProject } from "../editor-project.js";
import { readEditorSession } from "../editor-session.js";
import { log, logPath } from "../log.js";
import { permissionStates } from "../permissions.js";
import type { Preferences } from "../preferences.js";
import { listProjects } from "../projects.js";
import { getRecorder } from "../recorder.js";
import { renderRecording, RenderFailed, RenderNeedsEditor } from "../render.js";
import { startShare } from "../share.js";
import { transcriptForShare } from "../../renderer/src/editor/shareTranscript.js";
import { place } from "../../renderer/src/editor/timeline.js";
import { mine as myScenes } from "../scene-presets.js";
import {
  insideRecordings,
  RECORDINGS_DIR,
  recordingPath,
  revealRecordings,
  SESSIONS_DIR,
  type RecordingSession,
} from "../session.js";
import { startTranscribe } from "../transcribe/index.js";
import { checkForUpdates, downloadUpdate, installUpdate, onUpdateChanged } from "../update.js";
import { installShim } from "./shim.js";

/** A refusal with a reason an agent can branch on. */
export class CliError extends Error {
  constructor(
    readonly code: CliErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export interface CliContext {
  flow: CaptureFlow;
  session: RecordingSession;
  preferences: Preferences;
}

/**
 * How long the answer is given to reach the client before the app quits.
 *
 * Half a second, over a Unix socket on the same machine, for a line of JSON
 * that has already been written. It is slack rather than a measurement — the
 * cost of being wrong is an upgrade that looks like a crash.
 */
const INSTALL_DELAY_MS = 500;

type Report = (progress: CliProgress) => void;
type Handler = (params: Record<string, unknown>, report: Report) => Promise<unknown>;

// ── Reading parameters ──────────────────────────────────────────────────────
//
// The client has already checked these against the catalogue, so anything wrong
// here arrived from something hand-rolling the protocol. Checked all the same:
// this process starts screen recordings and deletes directories.

function text(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function count(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function flag(params: Record<string, unknown>, key: string): boolean {
  return params[key] === true;
}

function required(params: Record<string, unknown>, key: string): string {
  const value = text(params, key);
  if (!value) throw new CliError("usage", `${key} is required`);
  return value;
}

/**
 * A recording's folder name, resolved to a directory that exists.
 *
 * The id *is* the folder name — the same identifier `prequel-media://` uses —
 * and it arrives from outside the app, so it goes through the same guard every
 * other library operation uses. `..` and an absolute path both resolve outside
 * the library and are refused rather than followed.
 */
function recordingDir(params: Record<string, unknown>, key = "id"): string {
  const id = required(params, key);
  const dir = recordingPath(id) ?? (insideRecordings(id) ? id : null);

  if (!dir) {
    throw new CliError("not_found", `"${id}" is not a recording in this library`);
  }

  if (!existsSync(join(dir, MANIFEST_FILE_NAME))) {
    throw new CliError(
      "not_found",
      `"${basename(dir)}" has no recording in it. \`prequel recordings list\` has the ids`,
    );
  }

  return dir;
}

/** Only the three export settings, read off whatever flags were passed. */
function renderOptions(params: Record<string, unknown>): {
  out?: string;
  format?: ExportFormat;
  shortEdge?: number;
  fps?: number;
  presetId?: string;
} {
  const format = text(params, "format");
  return {
    out: text(params, "out"),
    format: format as ExportFormat | undefined,
    shortEdge: count(params, "shortEdge"),
    fps: count(params, "fps"),
    presetId: text(params, "preset"),
  };
}

// ── Capture ─────────────────────────────────────────────────────────────────

/**
 * The capture sources this take should use, written to the panel's own settings.
 *
 * Every one of them is set, not only the ones asked for: a take started from
 * the command line with no `--camera` must not record the camera somebody left
 * switched on in the panel this morning. "Nothing is recorded that was not
 * asked for" is the promise the skill makes, and this is where it is kept.
 *
 * Written to `RecordingPreferences` rather than carried with the take so the
 * panel on screen agrees with what is being recorded. The alternative — a
 * hidden per-take override — is two answers to "is the camera on".
 */
async function applySources(
  context: CliContext,
  params: Record<string, unknown>,
): Promise<{ camera: string | null; microphone: boolean; systemAudio: boolean }> {
  const asked = params["camera"];
  let cameraLabel: string | null = null;

  if (asked !== undefined && asked !== false) {
    const cameras = (await getRecorder()).listCameras();
    if (cameras.length === 0) {
      throw new CliError("not_found", "this Mac has no camera attached");
    }

    if (asked === true) {
      // `--camera` with no value: the first one, which on a laptop is the
      // built-in and is what somebody who did not name one meant.
      cameraLabel = cameras[0]!.name;
    } else {
      const wanted = String(asked).toLowerCase();
      const found =
        cameras.find((camera) => camera.name.toLowerCase() === wanted) ??
        cameras.find((camera) => camera.id.toLowerCase() === wanted) ??
        cameras.find((camera) => camera.name.toLowerCase().includes(wanted));

      if (!found) {
        throw new CliError(
          "not_found",
          `no camera called "${String(asked)}". \`prequel camera list\` has the names`,
        );
      }
      cameraLabel = found.name;
    }
  }

  const microphone = flag(params, "microphone");
  const systemAudio = flag(params, "systemAudio");

  // The default input's real name, because the panel resolves a device by
  // label when the id does not match — which it never does across processes,
  // Chromium's `deviceId` being salted per origin. A made-up label would leave
  // the panel showing the microphone on with nothing named under it.
  const input = microphone
    ? ((await getRecorder()).listMicrophones().find((device) => device.isDefault) ?? null)
    : null;

  context.preferences.update({
    // The label is the durable half of the pair and the only one the recorder
    // can use — see `RecordingPreferences`. The id is the renderer's salted
    // `deviceId`, which this side cannot invent, so the panel heals it from the
    // label when it next opens.
    cameraId: cameraLabel,
    cameraLabel,
    micId: microphone ? (input?.id ?? "default") : null,
    micLabel: microphone ? (input?.name ?? "System default input") : null,
    systemAudio,
  });

  return { camera: cameraLabel, microphone, systemAudio };
}

/** The display the pointer is on, as a target the recorder understands. */
async function displayTarget(id: number | undefined): Promise<Target> {
  const targets = await (await getRecorder()).listTargets();
  const displays = targets.filter((target) => target.kind === "Display");

  if (displays.length === 0) {
    throw new CliError("failed", "ScreenCaptureKit listed no displays");
  }

  if (id === undefined) {
    const nearest = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    return displays.find((display) => display.id === nearest.id) ?? displays[0]!;
  }

  const found = displays.find((display) => display.id === id);
  if (!found) {
    throw new CliError(
      "not_found",
      `no display with id ${String(id)}. \`prequel target list --displays\` has the ids`,
    );
  }
  return found;
}

async function windowTarget(id: number): Promise<Target> {
  const targets = await (await getRecorder()).listTargets();
  const found = targets.find((target) => target.kind === "Window" && target.id === id);

  if (!found) {
    throw new CliError(
      "not_found",
      `no window with id ${String(id)}. Window ids change when windows close — read \`prequel target list --windows\` again`,
    );
  }
  return found;
}

/** Seconds of nothing, for `--countdown`. */
function wait(seconds: number): Promise<void> {
  return new Promise((done) => setTimeout(done, Math.max(0, seconds) * 1000));
}

async function start(
  context: CliContext,
  params: Record<string, unknown>,
  selection: Omit<PendingSelection, "crop"> & { crop: PendingSelection["crop"] },
): Promise<unknown> {
  if (context.session.isBusy()) {
    throw new CliError(
      "busy",
      `a take is already ${context.session.snapshot().status}. Stop it with \`prequel record stop\``,
    );
  }

  const granted = (await permissionStates()).find((state) => state.id === "screen")?.granted;
  if (!granted) {
    throw new CliError(
      "denied",
      "macOS has not granted Screen Recording to Prequel. Open System Settings → Privacy & Security → Screen & System Audio Recording, switch Prequel on, then run this again",
    );
  }

  const sources = await applySources(context, params);

  const countdown = count(params, "countdown");
  if (countdown !== undefined && countdown > 0) await wait(countdown);

  const fps = count(params, "fps");

  // Quiet unless somebody asked for the panel. A take started from a command
  // is one nobody is standing over: the floating pill and the camera bubble
  // are Prequel's own furniture laid over the screen being captured, and they
  // are excluded from the video — so the only person they could reach is the
  // one who did not ask for them. The tray still shows the take and still
  // stops it.
  const quiet = params["panel"] !== true;

  await context.flow.recordTarget(selection, { quiet, ...(fps === undefined ? {} : { fps }) });

  const state = context.session.snapshot();
  if (state.status === "idle") {
    throw new CliError(
      "failed",
      state.error?.message ?? "the recording did not start. See ~/Library/Logs/Prequel/main.log",
    );
  }

  return {
    status: state.status,
    target: {
      kind: selection.target.kind,
      id: selection.target.id,
      title: selection.target.title,
      appName: selection.target.appName,
    },
    crop: selection.crop,
    sources,
    dir: state.outputPath,
  };
}

// ── The library ─────────────────────────────────────────────────────────────

/** Milliseconds, from the manifest's nanoseconds. */
function millis(nanoseconds: number): number {
  return Math.round(nanoseconds / 1_000_000);
}

function readManifest(dir: string) {
  return parseManifest(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8"));
}

/**
 * A recording's project, loaded the way the editor loads it.
 *
 * Through `loadProject` rather than by reading the file, because a recording
 * nobody has edited has no `project.json` at all and the answer then is the
 * defaults the editor would have shown — not an error.
 */
function projectOf(dir: string) {
  const manifest = readManifest(dir);
  const screenTrack = findTrack(manifest, "screen")?.segments?.[0];
  return loadProject(
    dir,
    manifest.id,
    manifest.duration,
    sourceShape(
      manifest.source,
      screenTrack && { width: screenTrack.width ?? null, height: screenTrack.height ?? null },
      isStill(manifest),
    ),
    seamsOf(manifest),
  );
}

function accountOf(state: AuthState): unknown {
  // Only what a window is allowed to know, which is the same thing a terminal
  // is allowed to know: the token never leaves main. See `main/auth.ts`.
  return state.status === "signed-in"
    ? { status: state.status, email: state.account.email, name: state.account.name }
    : { status: state.status };
}

export function cliHandlers(context: CliContext): Record<string, Handler> {
  const { flow, session, preferences } = context;

  return {
    // ── The app ─────────────────────────────────────────────────────────────
    async status() {
      const state = session.snapshot();
      return {
        running: true,
        version: app.getVersion(),
        protocol: CLI_PROTOCOL,
        permissions: await permissionStates(),
        account: accountOf(authState()),
        session: {
          status: state.status,
          elapsedMs: state.elapsedMs,
          target: state.target && {
            kind: state.target.kind,
            id: state.target.id,
            title: state.target.title,
            appName: state.target.appName,
          },
          dir: state.outputPath,
        },
        paths: {
          recordings: RECORDINGS_DIR,
          library: SESSIONS_DIR,
          log: logPath(),
          preferences: flow.preferencesPath(),
        },
      };
    },

    async open() {
      flow.open();
      return { opened: true };
    },

    /**
     * Signs in, and waits for the browser.
     *
     * Waited on rather than returned immediately, unlike the button in the app:
     * a command that exits before the sign-in lands would have the next command
     * fail as signed out, and an agent has no window to watch.
     */
    async login(_params, report) {
      const already = authState();
      if (already.status === "signed-in") return { account: accountOf(already) };

      report({ stage: "waiting", message: "a browser tab has opened; sign in there" });

      return new Promise((done, failed) => {
        const stop = onAuthChanged((state) => {
          if (state.status === "signed-in") {
            stop();
            done({ account: accountOf(state) });
          } else if (state.status === "signed-out") {
            stop();
            failed(new CliError("failed", "the sign-in was not completed"));
          }
        });

        beginSignIn();
      });
    },

    async logout() {
      await signOut();
      return { signedOut: true };
    },

    // ── What is there to record ─────────────────────────────────────────────
    async "target.list"(params) {
      const targets = await (await getRecorder()).listTargets();
      const app_ = text(params, "app")?.toLowerCase();

      const wanted = targets.filter((target) => {
        if (flag(params, "displays") && target.kind !== "Display") return false;
        if (flag(params, "windows") && target.kind !== "Window") return false;
        if (app_ && !target.appName.toLowerCase().includes(app_)) return false;
        return true;
      });

      return { targets: wanted };
    },

    async "camera.list"() {
      return { cameras: (await getRecorder()).listCameras() };
    },

    async "microphone.list"() {
      const recorder = await getRecorder();
      const microphones = recorder.listMicrophones();

      return {
        microphones: microphones.map((microphone) => ({
          id: microphone.id,
          name: microphone.name,
          default: microphone.isDefault,
        })),
        // Said rather than implied. A take records whichever input macOS treats
        // as the default, so listing four of them without this reads as a
        // choice the recorder does not actually offer.
        note: "A take records the system default input. Change it in System Settings → Sound",
      };
    },

    /**
     * Updates the app, and the command with it.
     *
     * One command for both because they are one thing: the CLI is a file inside
     * the bundle, so a new app *is* a new `prequel`. All the shim needs is to go
     * on pointing at it, which `installShim` guarantees — rewritten here as well
     * as on every launch, so an upgrade run against a copy that has moved
     * repairs the command rather than leaving it naming a bundle that is gone.
     *
     * The install quits the app. That is why the answer is written before it
     * happens rather than after, and why a running take refuses: `quitAndInstall`
     * tears the recorder down mid-capture, and the take would be unfinished on
     * disk with nothing to say why.
     */
    async upgrade(params, report) {
      if (!app.isPackaged) {
        throw new CliError(
          "unsupported",
          "this is a development build and updates itself by being rebuilt — `pnpm --filter @prequel/desktop ship`",
        );
      }

      // Refreshed first, and whatever the check finds: the command pointing at
      // this copy of the app is the half of "upgrade" that can be done with no
      // network at all, and it is the half that is broken when somebody has
      // moved Prequel.
      const cli = installShim();

      if (session.isBusy()) {
        throw new CliError(
          "busy",
          `a take is ${session.snapshot().status}. Installing an update quits the app, which would lose it — stop the take first`,
        );
      }

      report({ stage: "checking" });
      const found = await checkForUpdates();

      if (found.status === "error") {
        throw new CliError("failed", found.message ?? "the update check failed");
      }

      if (!found.version || found.version === found.current) {
        return {
          status: "current",
          current: found.current,
          version: null,
          cli: { path: cli.path, rewritten: cli.changed },
          restarting: false,
        };
      }

      if (flag(params, "check")) {
        return {
          status: "available",
          current: found.current,
          version: found.version,
          notes: found.notes,
          cli: { path: cli.path, rewritten: cli.changed },
          restarting: false,
        };
      }

      const stop = onUpdateChanged((state) =>
        report({ stage: "downloading", done: state.percent, total: 100 }),
      );
      let downloaded;
      try {
        downloaded = await downloadUpdate();
      } finally {
        stop();
      }

      if (downloaded.status !== "ready") {
        throw new CliError(
          "failed",
          downloaded.message ??
            `the update did not download (${downloaded.status}). Download it from prequel.sh instead`,
        );
      }

      // After the answer is on its way, not before. `quitAndInstall` takes the
      // socket down with the app, and a command that is killed mid-sentence
      // reads as a failed upgrade rather than a successful one.
      setTimeout(() => installUpdate(), INSTALL_DELAY_MS);

      return {
        status: "installing",
        current: found.current,
        version: found.version,
        cli: { path: cli.path, rewritten: cli.changed },
        // Said plainly, because anything holding a connection to the app is
        // about to lose it and will want to wait before asking again.
        restarting: true,
      };
    },

    // ── Recording ───────────────────────────────────────────────────────────
    async "record.display"(params) {
      const target = await displayTarget(count(params, "id"));
      return start(context, params, {
        mode: "screen",
        target,
        crop: null,
        label: "Entire screen",
      });
    },

    async "record.window"(params) {
      const id = count(params, "id");
      if (id === undefined) throw new CliError("usage", "a window id is required");
      const target = await windowTarget(id);
      return start(context, params, {
        mode: "window",
        target,
        crop: null,
        label: target.title || target.appName,
      });
    },

    async "record.area"(params) {
      const area = params["region"];
      if (typeof area !== "object" || area === null) {
        throw new CliError("usage", "an area is x,y,width,height in points");
      }

      const target = await displayTarget(count(params, "display"));
      const crop = area as { x: number; y: number; width: number; height: number };

      // Checked against the display rather than clamped to it. A rectangle that
      // runs off the screen records black down one side, which looks like a
      // broken capture rather than like the wrong numbers.
      const bounds = target.bounds;
      if (
        crop.x < 0 ||
        crop.y < 0 ||
        crop.x + crop.width > bounds.width ||
        crop.y + crop.height > bounds.height
      ) {
        throw new CliError(
          "usage",
          `that area does not fit on display ${String(target.id)}, which is ${String(Math.round(bounds.width))}×${String(Math.round(bounds.height))} points`,
        );
      }

      return start(context, params, { mode: "area", target, crop, label: "Area" });
    },

    async "record.stop"(params, report) {
      if (!session.isBusy()) {
        throw new CliError("idle", "nothing is recording");
      }

      const open = flag(params, "open");
      await flow.stop({ open });

      const finished = session.snapshot().lastResult;
      if (!finished) {
        throw new CliError(
          "failed",
          "the take stopped without producing a recording. See ~/Library/Logs/Prequel/main.log",
        );
      }

      const dir = finished.outputPath;
      const manifest = readManifest(dir);
      const project = firstCut(dir);

      const answer: Record<string, unknown> = {
        id: basename(dir),
        dir,
        durationMs: millis(manifest.duration),
        // What the first cut found, which is the whole claim of the app: an
        // agent that recorded nothing worth zooming at should be able to see
        // that before it renders.
        zooms: project.zooms.length,
        clicks: manifest.clicks?.length ?? 0,
        project: join(dir, PROJECT_FILE_NAME),
      };

      if (flag(params, "render")) {
        answer["render"] = await renderRecording(dir, renderOptions(params), report);
      }

      return answer;
    },

    async "record.pause"() {
      const state = session.snapshot();
      if (state.status !== "recording") {
        throw new CliError("idle", `nothing to pause: the recorder is ${state.status}`);
      }
      await flow.togglePause();
      return { status: session.snapshot().status };
    },

    async "record.resume"() {
      const state = session.snapshot();
      if (state.status !== "paused") {
        throw new CliError("idle", `nothing to resume: the recorder is ${state.status}`);
      }
      await flow.togglePause();
      return { status: session.snapshot().status };
    },

    async "record.cancel"() {
      if (!session.isBusy()) throw new CliError("idle", "nothing is recording");
      await flow.discard();
      return { discarded: true };
    },

    async "record.status"() {
      const state = session.snapshot();
      return {
        status: state.status,
        elapsedMs: state.elapsedMs,
        dir: state.outputPath,
        target: state.target && {
          kind: state.target.kind,
          id: state.target.id,
          title: state.target.title,
          appName: state.target.appName,
        },
      };
    },

    // ── The library ─────────────────────────────────────────────────────────
    async "recordings.list"(params) {
      const limit = count(params, "limit") ?? 20;
      const offset = count(params, "offset") ?? 0;
      const { projects, total } = listProjects(limit, offset);

      return {
        total,
        recordings: projects.map((project) => ({
          id: basename(project.dir),
          name: project.name,
          createdAt: new Date(project.createdAt).toISOString(),
          editedAt: project.editedAt ? new Date(project.editedAt).toISOString() : null,
        })),
      };
    },

    async "recordings.show"(params) {
      const dir = recordingDir(params);
      const manifest = readManifest(dir);
      const project = projectOf(dir);

      return {
        id: basename(dir),
        name: project.name ?? basename(dir),
        dir,
        createdAt: manifest.started_at ?? null,
        durationMs: millis(manifest.duration),
        frame: project.frame,
        tracks: manifest.tracks.map((track) => ({
          kind: track.kind,
          segments: track.segments.length,
          width: track.segments[0]?.width ?? null,
          height: track.segments[0]?.height ?? null,
        })),
        slices: (project.tracks[0]?.slices ?? []).map((slice) => ({
          id: slice.id,
          startMs: millis(slice.source.start),
          endMs: millis(slice.source.end),
          speed: slice.speed,
        })),
        zooms: project.zooms.length,
        clicks: manifest.clicks?.length ?? 0,
        transcript: existsSync(join(dir, TRANSCRIPT_FILE_NAME)),
        project: join(dir, PROJECT_FILE_NAME),
      };
    },

    async "recordings.open"(params) {
      const dir = recordingDir(params);
      flow.openEditor(dir);
      return { opened: true, dir };
    },

    /**
     * Moves a recording to the Trash.
     *
     * The Trash, and not the permanent delete `discard` uses: this is minutes
     * of somebody's work being removed by a command with no dialog in front of
     * it, and the one thing that makes that acceptable is that it can be put
     * back. No confirmation sheet either — a modal nobody can see would hang
     * the command for ever.
     */
    async "recordings.delete"(params) {
      const dir = recordingDir(params);
      await shell.trashItem(dir);
      log("info", `moved ${dir} to the Trash from the command line`);
      return { deleted: true, trashed: dir };
    },

    async "recordings.reveal"(params) {
      const dir = recordingDir(params);
      await revealRecordings(dir);
      return { revealed: true };
    },

    // ── Rendering ───────────────────────────────────────────────────────────
    async render(params, report) {
      const dir = recordingDir(params);

      // Checked before the render rather than after. A ten-minute file written
      // and then refused for want of a sign-in is ten minutes of somebody's
      // machine spent on a command that was never going to finish.
      if (flag(params, "share") && authState().status !== "signed-in") {
        throw new CliError("signed_out", "sharing needs an account. Run `prequel login` first");
      }

      let result;
      try {
        result = await renderRecording(dir, renderOptions(params), report);
      } catch (cause) {
        if (cause instanceof RenderNeedsEditor) throw new CliError("needs_editor", cause.message);
        if (cause instanceof RenderFailed) throw new CliError("failed", cause.message);
        throw cause;
      }

      if (!flag(params, "share")) return result;
      return { ...result, url: await share(dir, result, report) };
    },

    // ── The edit ────────────────────────────────────────────────────────────
    async "project.path"(params) {
      const dir = recordingDir(params);
      const path = join(dir, PROJECT_FILE_NAME);
      return {
        path,
        // False for a recording nobody has edited, which is not a problem: the
        // app writes the file on the first edit, and `project show` answers
        // with the defaults until it does.
        exists: existsSync(path),
      };
    },

    async "project.show"(params) {
      return projectOf(recordingDir(params));
    },

    /**
     * Whether an edited `project.json` is one the app will load.
     *
     * The real sanitiser, not a copy of its rules — the same function the editor
     * loads a project through. A file this says is valid is one the app opens
     * and the exporter renders; anything else is caught here rather than by a
     * render that quietly ignores the edit.
     */
    async "project.check"(params) {
      const dir = recordingDir(params);
      const path = join(dir, PROJECT_FILE_NAME);

      if (!existsSync(path)) {
        return { valid: true, exists: false, message: "nothing has been edited yet" };
      }

      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(path, "utf8"));
      } catch (cause) {
        throw new CliError("usage", `${PROJECT_FILE_NAME} is not valid JSON: ${String(cause)}`);
      }

      const manifest = readManifest(dir);
      const sanitised = sanitiseProject(raw, manifest.id, manifest.duration, seamsOf(manifest));

      if (!sanitised) {
        throw new CliError(
          "usage",
          `the app would ignore this ${PROJECT_FILE_NAME} and open the recording with its defaults. ` +
            `Check \`version\` is ${String((raw as { version?: unknown }).version ?? "missing")} → the one \`prequel project schema\` names, and that \`recordingId\` is "${manifest.id}"`,
        );
      }

      // What the sanitiser changed on the way in: a clamped value, a dropped
      // slice, a look this build does not have. Reported rather than silently
      // applied, because an agent that wrote 1.8 into a field that tops out at
      // 1 would otherwise believe it took.
      const changed = differences(raw, sanitised);

      return {
        valid: true,
        exists: true,
        changed,
        message:
          changed.length === 0
            ? "the app will load this exactly as written"
            : "the app will load this, with the values below adjusted to fit",
      };
    },

    // ── What a project can be set to ────────────────────────────────────────
    async "backgrounds.list"(params) {
      const hosted = await catalogue();
      const only = text(params, "category")?.toLowerCase();

      return {
        // Null when the catalogue could not be fetched, which is a network
        // answer rather than an empty list of wallpapers.
        categories: hosted === null ? null : hosted.categories.map((category) => category.id),
        wallpapers:
          hosted === null
            ? null
            : hosted.backgrounds
                .filter((background) => !only || background.category.toLowerCase() === only)
                // The file name and nothing else: that is what a project stores
                // and what `backgrounds ensure` copies in. The URLs, the md5 and
                // the blurhash are the catalogue's own bookkeeping.
                .map((background) => ({
                  file: background.file,
                  name: background.label,
                  category: background.category,
                  width: background.width,
                  height: background.height,
                })),
        note: "A project's background is set in `defaults.background.background`. `prequel project schema` says how",
      };
    },

    async "scenes.list"() {
      const scenes = await myScenes();
      return { scenes: scenes.map((scene) => ({ id: scene.id, name: scene.name })) };
    },

    // ── Transcripts ─────────────────────────────────────────────────────────
    async "transcript.generate"(params, report) {
      const dir = recordingDir(params);

      const finished = new Promise<void>((done, failed) => {
        const stop = watch(IPC_CHANNELS.transcribeProgress, (payload) => {
          const progress = payload as TranscribeProgress;
          if (progress.dir !== dir) return;

          report({ stage: progress.stage, done: progress.progress ?? undefined, total: 1 });

          if (progress.stage === "done") {
            stop();
            done();
          } else if (progress.stage === "failed" || progress.stage === "cancelled") {
            stop();
            failed(
              new CliError(
                "failed",
                progress.error?.message ?? `the transcription ${progress.stage}`,
              ),
            );
          }
        });
      });

      await startTranscribe(dir);
      await finished;

      const session_ = await readEditorSession(dir);
      return {
        language: session_.transcript?.language ?? null,
        words: session_.transcript?.words.length ?? 0,
        path: join(dir, TRANSCRIPT_FILE_NAME),
      };
    },

    async "transcript.show"(params) {
      const dir = recordingDir(params);
      const path = join(dir, TRANSCRIPT_FILE_NAME);

      if (!existsSync(path)) {
        throw new CliError(
          "not_found",
          `this recording has no transcript. Make one with \`prequel transcript generate ${basename(dir)}\``,
        );
      }

      const session_ = await readEditorSession(dir);
      if (!session_.transcript) {
        throw new CliError("failed", `${TRANSCRIPT_FILE_NAME} could not be read`);
      }

      return session_.transcript;
    },
  };
}

/**
 * Makes the first cut on a take the command line has just recorded.
 *
 * The zooms. They are the whole claim of the app — "zooms on every click" — and
 * until now a recording made from here had none of them: the pass runs when the
 * editor *opens* a recording for the first time, so a take recorded, rendered
 * and handed back without a window ever being opened came out flat. Nobody
 * would have seen that happen; they would only have seen a duller video than
 * the same recording makes by hand.
 *
 * Written to `project.json` rather than left in memory, so the editor agrees
 * with the file the command line rendered: the pass is guarded on a project
 * having no zooms of its own, and one that now has them is not run again.
 * Deleting them all still leaves them deleted — the app does not argue.
 */
function firstCut(dir: string): Project {
  const manifest = readManifest(dir);
  const project = projectOf(dir);

  if (project.zooms.length > 0) return project;

  const moments = momentsOf(manifest);
  if (moments.length === 0) return project;

  const zooms = autoZooms(moments, {
    duration: manifest.duration,
    // Without a pointer track a `cursor` zoom has nothing to follow, and the
    // pass makes fixed regions instead. The same question the editor asks.
    hasCursor: (manifest.cursor?.length ?? 0) > 0 && manifest.cursor_baked !== true,
  });
  if (zooms.length === 0) return project;

  const cut = { ...project, zooms };
  saveProject(dir, cut);
  log("info", `first cut: ${String(zooms.length)} zooms`, dir);
  return cut;
}

/**
 * Uploads a finished render and answers with its link.
 *
 * No poster. The still on the library row and the link preview is a frame the
 * renderer decodes, and there is no window here — the share page falls back to
 * its own placeholder, which is a plainer card rather than a broken one. The
 * transcript goes up when there is one, because that is what gives the link its
 * chapters.
 */
async function share(
  dir: string,
  result: { file: string; width: number; height: number; durationMs: number | null },
  report: Report,
): Promise<string> {
  const session = await readEditorSession(dir);
  const project = projectOf(dir);

  // The panel's corrections laid over what was recognised, which is the rule
  // the editor's own share follows: the generated words carry the language and
  // stay on disk untouched, the project's carry the edits.
  const generated = session.transcript;
  const corrected = project.transcript;
  const transcript = generated && corrected ? { ...generated, words: corrected.words } : generated;

  const finished = new Promise<string>((done, failed) => {
    const stop = watch(IPC_CHANNELS.shareProgress, (payload) => {
      const progress = payload as ShareProgress;
      if (progress.path !== result.file) return;

      report({ stage: progress.stage, done: progress.bytesSent, total: progress.bytesTotal });

      if (progress.stage === "done" && progress.url) {
        stop();
        done(progress.url);
      } else if (progress.stage === "failed" || progress.stage === "cancelled") {
        stop();
        failed(new CliError("failed", progress.error?.message ?? `the upload ${progress.stage}`));
      }
    });
  });

  await startShare({
    path: result.file,
    poster: null,
    title: project.name ?? basename(dir),
    durationMs: result.durationMs ?? 0,
    width: result.width,
    height: result.height,
    fps: project.output.fps,
    shortEdge: project.output.shortEdge,
    // Through the editor's own converter, not a copy of it: the words are on
    // the session clock and the share page's chapters are measured against the
    // exported file, so a word whose moment was cut away has to be dropped
    // rather than moved. Two implementations of that would put the chapters of
    // a trimmed recording in the wrong places, and only on links made from here.
    transcript: transcriptForShare(transcript, place(project.tracks[0]?.slices ?? [])),
  });

  return finished;
}

/**
 * Which fields the sanitiser moved, as dotted paths.
 *
 * Compared value by value rather than by deep equality on the whole document,
 * so the answer is a list of what to fix rather than "something changed". Only
 * leaves are reported: a parent that differs only because a child does would
 * be noise in front of the line that matters.
 */
export function differences(before: unknown, after: unknown, path = ""): string[] {
  if (before === after) return [];

  const both =
    typeof before === "object" && before !== null && typeof after === "object" && after !== null;
  if (!both) return [path || "."];

  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after)) return [path || "."];
    if (before.length !== after.length)
      return [`${path}[] (${String(before.length)} → ${String(after.length)})`];
    return before.flatMap((item, index) =>
      differences(item, after[index], `${path}[${String(index)}]`),
    );
  }

  const keys = new Set([
    ...Object.keys(before as Record<string, unknown>),
    ...Object.keys(after as Record<string, unknown>),
  ]);

  return [...keys].flatMap((key) =>
    differences(
      (before as Record<string, unknown>)[key],
      (after as Record<string, unknown>)[key],
      path ? `${path}.${key}` : key,
    ),
  );
}
