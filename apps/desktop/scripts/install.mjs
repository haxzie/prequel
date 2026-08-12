/**
 * Replaces the copy of Prequel in /Applications with the one just built.
 *
 * Opening the .dmg and dragging is the same steps by hand, and it is the step
 * that gets skipped: a stale /Applications copy looks exactly like a build that
 * did not take, and the only symptom is a fix that "did not work".
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RELEASE_DIR = "release";
const APP_NAME = "Prequel.app";
const INSTALLED = join("/Applications", APP_NAME);

/** How long a running copy is given to tear down before it is killed outright. */
const QUIT_TIMEOUT_MS = 5000;
const QUIT_POLL_MS = 250;

/**
 * The freshly built bundle.
 *
 * electron-builder names the directory after the architecture — `mac-arm64`
 * today, `mac-universal` if this ever ships a fat binary — so it is found
 * rather than assumed.
 */
function builtApp() {
  if (!existsSync(RELEASE_DIR)) {
    throw new Error(`no ${RELEASE_DIR}/ — run \`pnpm package\` first`);
  }

  const candidates = readdirSync(RELEASE_DIR)
    .filter((entry) => entry.startsWith("mac"))
    .map((entry) => join(RELEASE_DIR, entry, APP_NAME))
    .filter((path) => existsSync(path));

  if (candidates.length === 0) {
    throw new Error(`no ${APP_NAME} under ${RELEASE_DIR}/mac* — run \`pnpm package\` first`);
  }
  if (candidates.length > 1) {
    throw new Error(`several builds under ${RELEASE_DIR}/: ${candidates.join(", ")}`);
  }

  return candidates[0];
}

/** PIDs of anything running out of a Prequel bundle, installed or built. */
function running() {
  // `-f` matches the whole command line, which is how the helper processes are
  // caught as well: killing only the main process leaves them orphaned holding
  // the capture devices.
  const found = spawnSync("/usr/bin/pgrep", ["-f", APP_NAME], { encoding: "utf8" });
  return (found.stdout ?? "")
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

function sleep(ms) {
  // Synchronous on purpose: this script is a sequence of steps, and each one
  // has to finish before the next is safe.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Stops any running copy.
 *
 * `SIGTERM` first, because `main/index.ts` handles it and tears the recorder
 * down — the tray is the only quit path in a `LSUIElement` app, so there is no
 * Cmd-Q to fall back on. Only then `SIGKILL`, which skips that teardown and can
 * leave a recording half-written.
 */
function quitRunning() {
  let pids = running();
  if (pids.length === 0) return;

  console.log(`Quitting ${pids.length} running process(es)…`);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone between listing and signalling.
    }
  }

  for (let waited = 0; waited < QUIT_TIMEOUT_MS; waited += QUIT_POLL_MS) {
    sleep(QUIT_POLL_MS);
    pids = running();
    if (pids.length === 0) return;
  }

  console.warn("Still running after SIGTERM — killing.");
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // As above.
    }
  }
  sleep(QUIT_POLL_MS);
}

const source = builtApp();

quitRunning();

if (existsSync(INSTALLED)) {
  console.log(`Removing ${INSTALLED}…`);
  execFileSync("/bin/rm", ["-rf", INSTALLED]);
}

// `ditto` rather than `cp -R`: it is the tool that preserves a bundle's
// symlinks, extended attributes and code signature intact. A bundle copied with
// `cp` can fail signature validation, and macOS reports that as a damaged app
// rather than as a bad copy.
console.log(`Installing ${source} → ${INSTALLED}…`);
execFileSync("/usr/bin/ditto", [source, INSTALLED]);

console.log("Launching…");
execFileSync("/usr/bin/open", [INSTALLED]);

// The Screen Recording grant is keyed to the bundle's identity, and an ad-hoc
// signature changes with every build — so the first launch after installing may
// ask for it again. That is macOS being correct, not the app losing its
// permission.
console.log(`Installed. It lives in the menu bar — ${APP_NAME} has no Dock icon.`);
