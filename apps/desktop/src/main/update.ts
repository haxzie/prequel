/**
 * Keeping an installed copy current.
 *
 * A menu-bar app is the app a user forgets is installed. There is no Dock icon
 * to notice, no window sitting open, and nothing that ever mentions a version —
 * so without this, the build somebody installed once is the build they keep, and
 * every fix ships to nobody.
 *
 * The feed is `apps/api`, not GitHub. Two reasons, and the first is the smaller
 * one: `api.github.com` allows 60 requests an hour per address, and a shared
 * office address spends that between them. The second is that a release which
 * turns out to be bad can be withheld at the Worker in seconds, which is the
 * only lever there is once a build is out.
 *
 * Squirrel.Mac validates the downloaded bundle against the running app's
 * *designated requirement*. A Developer ID signature gives one that is stable
 * across versions; an ad-hoc signature — which is what a build with no
 * certificate gets, see `electron-builder.yml` — pins it to that build's own
 * hash, so nothing will ever match it. Such a build downloads the update
 * happily and then fails at install. Electron exposes no way to ask what signed
 * the running app, so this cannot be caught up front; the error state's copy
 * offers the download page instead, which is the right recovery for that case
 * and for a corrupted download alike.
 */
import { app, shell } from "electron";
import electronUpdater from "electron-updater";

import type { UpdateState } from "../shared/contract.js";
import { IDLE_UPDATE } from "../shared/contract.js";
import { apiFetch, apiUrl, appUrl } from "./api.js";
import { log } from "./log.js";

// electron-updater is CommonJS, and its named exports do not survive the interop
// under `verbatimModuleSyntax` — `import { autoUpdater }` type-checks and is
// `undefined` at runtime.
const { autoUpdater } = electronUpdater;

/**
 * `current` is filled in on the way out rather than stored.
 *
 * `app.getVersion()` throws before the app is ready, and this module is
 * imported at the top of `index.ts` — a version captured here would be captured
 * too early.
 */
let state: Omit<UpdateState, "current"> = IDLE_UPDATE;

let listeners: ((state: UpdateState) => void)[] = [];
let configured = false;

/**
 * How long a check stays fresh, for the checks the app makes on its own.
 *
 * The panel is opened by a gesture, not on a schedule — several times in a
 * minute while somebody picks a window, and then not again until Thursday — so
 * "every time it opens" has to mean something other than a request per press.
 * Half an hour is far below the rate anything is released at and far above the
 * rate a menu bar app is opened at, which makes this invisible in both
 * directions.
 *
 * A check somebody *asked* for is never held back by this; see below.
 */
const RECHECK_MS = 30 * 60 * 1000;

let lastCheckedAt = 0;

export function updateState(): UpdateState {
  return { ...state, current: app.getVersion() };
}

export function onUpdateChanged(listener: (state: UpdateState) => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
  };
}

function set(patch: Partial<Omit<UpdateState, "current">>): UpdateState {
  state = { ...state, ...patch };

  const next = updateState();
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Everything that has to be true before the first check, done once.
 *
 * `setFeedURL` in particular: `AppUpdater` memoises its provider on the first
 * check and ignores every later call, so this cannot be left until something
 * asks. The URL comes from `apiUrl()` rather than from the `publish` block in
 * `electron-builder.yml` — that block exists to make the channel file, and a
 * build pointed at a different deployment must not also have to edit it.
 */
function configure(): void {
  if (configured) return;
  configured = true;

  // The window asks before spending a hundred megabytes of someone's tethered
  // connection.
  autoUpdater.autoDownload = false;

  // On macOS this arms Squirrel as soon as the download finishes, so the update
  // lands on the *next quit* whether or not the window's button is ever
  // pressed. That is what we want, and it is not what the name suggests.
  autoUpdater.autoInstallOnAppQuit = true;

  // Measured, not assumed. GitHub serves release assets from Azure Blob, which
  // answers 501 to the multi-range request electron-updater's generic provider
  // sends by default — so the delta path cannot succeed, and leaving it on only
  // buys a wasted round trip before the full download it falls back to. No
  // `.blockmap` is published either; see the release step in build.yml.
  autoUpdater.disableDifferentialDownload = true;

  // A packaged build has no console. Without this, an update that fails leaves
  // nothing behind anywhere.
  autoUpdater.logger = {
    info: (message: unknown) => log("info", `updater: ${String(message)}`),
    warn: (message: unknown) => log("warn", `updater: ${String(message)}`),
    error: (message: unknown) => log("error", `updater: ${String(message)}`),
    debug: () => {},
  };

  autoUpdater.setFeedURL({
    provider: "generic",
    url: `${apiUrl()}/v1/updates/darwin-${process.arch}`,
    // Belt and braces with `disableDifferentialDownload` above: this is the
    // setting that would otherwise send the multi-range request Azure refuses.
    useMultipleRangeRequest: false,
  });

  autoUpdater.on("update-available", (info: { version: string }) => {
    log("info", `update available: ${info.version}`);
    set({ status: "available", version: info.version, percent: 0, message: null });
    void fetchNotes(info.version);
  });

  autoUpdater.on("update-not-available", () => {
    set({ status: "idle", version: null, percent: 0, message: null });
  });

  autoUpdater.on("download-progress", (progress: { percent: number }) => {
    set({ status: "downloading", percent: Math.round(progress.percent) });
  });

  autoUpdater.on("update-downloaded", (info: { version: string }) => {
    log("info", `update downloaded: ${info.version}`);
    set({ status: "ready", version: info.version, percent: 100 });
  });

  autoUpdater.on("error", (cause: Error) => {
    log("error", "updater failed", cause);
    set({
      status: "error",
      message: "Prequel couldn't finish the update. Download the latest version instead.",
    });
  });
}

/**
 * The changelog for a version the updater has already named.
 *
 * Deliberately not asked whether an update *exists*. The channel file settles
 * that, and a second opinion could only disagree with it — which would mean
 * offering a version the updater then refuses to install. Failure here leaves
 * `notes` null and the status alone.
 */
async function fetchNotes(version: string): Promise<void> {
  const body = await apiFetch<{ notes: string | null }>(
    `/v1/updates/notes?version=${encodeURIComponent(version)}`,
  ).catch(() => null);

  if (body?.notes && state.version === version) set({ notes: body.notes });
}

/**
 * Looks for a newer version.
 *
 * Resolves with the state the check ended in, so the caller can decide whether
 * to put a window in front of anyone without subscribing first.
 *
 * Unpacked, this does nothing at all. `electron-updater` would only log and
 * resolve null anyway, but `pnpm dev` should not be calling the Worker either —
 * and an update path that half-works under a dev server is worse to reason
 * about than one that plainly does not run.
 */
export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) {
    log("info", "update check skipped: not a packaged build");
    return set({ status: "idle" });
  }

  // Nothing to check while a download is already going, and `checkForUpdates`
  // during one restarts it.
  if (state.status === "downloading" || state.status === "ready") return updateState();

  configure();
  // Stamped at the start rather than on the way out, so two checks cannot
  // overlap through the await below — and a check that fails still counts, or a
  // machine with no network would ask again on every single press.
  lastCheckedAt = Date.now();
  set({ status: "checking", message: null });

  try {
    await autoUpdater.checkForUpdates();
  } catch (cause) {
    log("error", "update check failed", cause);
    return set({ status: "error", message: "Prequel couldn't check for updates." });
  }

  // `update-available` and `update-not-available` have already run by here and
  // moved the state on; `checking` surviving means neither fired.
  return state.status === "checking" ? set({ status: "idle" }) : updateState();
}

/**
 * The check the app makes for itself, when the panel opens.
 *
 * A menu bar app is the app nobody quits. The launch check in `index.ts` is the
 * only other one there is, so an instance running since a fortnight ago has
 * asked exactly once — and the release it is missing might be the one that fixes
 * whatever it is about to do. Opening the panel is the moment the user is here
 * and has not yet started anything, which makes it the one moment a check costs
 * them nothing.
 *
 * Quiet by design. It moves the state, which is what the tray menu reads when
 * it is built and what the update window listens to; it does not put a window
 * in front of somebody who just pressed to record. The launch check is where an
 * update announces itself, because that is a moment with no other intent in it.
 *
 * Never awaited by the caller: the panel must appear now, and the answer lands
 * whenever it lands.
 */
export function checkForUpdatesIfDue(): void {
  if (Date.now() - lastCheckedAt < RECHECK_MS) return;

  void checkForUpdates().catch((cause: unknown) => {
    // `checkForUpdates` resolves rather than rejecting on a failed check, so
    // this only catches something unforeseen — and a background check must
    // never take the panel down with it.
    log("error", "background update check failed", cause);
  });
}

/**
 * Starts fetching the version already found.
 *
 * Gated on there being one rather than on the status, so the window's retry
 * after a failed download works without a second check.
 */
export async function downloadUpdate(): Promise<UpdateState> {
  if (!state.version || state.status === "downloading" || state.status === "ready") {
    return updateState();
  }

  configure();
  set({ status: "downloading", percent: 0, message: null });

  try {
    await autoUpdater.downloadUpdate();
  } catch (cause) {
    log("error", "update download failed", cause);
    return set({
      status: "error",
      message: "Prequel couldn't download the update. Download the latest version instead.",
    });
  }

  return updateState();
}

/**
 * Quits and comes back on the new version.
 *
 * `quitAndInstall` terminates through `NSApp`, so `before-quit` and `will-quit`
 * both run and teardown happens as it would on any quit. Its two arguments are
 * Windows-only and are deliberately not passed.
 *
 * With `LSUIElement` there is nothing on screen to show that this worked until
 * the app is back in the menu bar. The relaunch is an ordinary launch, so it
 * opens the panel, which is the only signal there is.
 */
export function installUpdate(): void {
  if (state.status !== "ready") return;

  log("info", "quitting to install the update");
  autoUpdater.quitAndInstall();
}

/** The way out when the in-place update cannot work — an unsigned build, mostly. */
export function openDownloadPage(): void {
  void shell.openExternal(`${appUrl()}/download`);
}
