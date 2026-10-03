/**
 * Putting `prequel` on the PATH.
 *
 * The CLI is a JavaScript bundle inside the app, and the app ships its own Node
 * — Electron's. So what lands in `~/.local/bin` is a three-line shell script
 * that runs that bundle under that binary. No second runtime to install, no
 * dependency on whatever Node the user happens to have, and nothing to notarise
 * separately.
 *
 * `~/.local/bin` rather than `/usr/local/bin`: writing there needs
 * administrator rights, which means a password prompt from a menu-bar app for
 * something the user only half asked for. `~/.local/bin` is on the PATH in a
 * default zsh on current macOS and is where `pipx`, `uv` and Claude Code all
 * put theirs.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { app } from "electron";

import { log } from "../log.js";

/** Where the shim goes, and the name the user types. */
export function shimPath(): string {
  return join(homedir(), ".local", "bin", "prequel");
}

/**
 * The bundle the shim runs.
 *
 * Outside the asar archive on purpose: `ELECTRON_RUN_AS_NODE` makes the binary
 * a plain Node process, and a Node process handed a path inside an archive is
 * one more thing that has to work for the command line to work at all. The
 * archive buys nothing here — it is one file.
 */
export function cliBundlePath(): string {
  if (app.isPackaged) {
    return join(
      app.getAppPath().replace(/app\.asar$/, "app.asar.unpacked"),
      "out",
      "cli",
      "prequel.cjs",
    );
  }

  // A development build, where `getAppPath()` is `apps/desktop`. The bundle is
  // whatever `pnpm build` last wrote, which is also what `pnpm dev` does not
  // rebuild — see the note in `scripts/build-cli.mjs`.
  return join(app.getAppPath(), "out", "cli", "prequel.cjs");
}

/**
 * The script itself.
 *
 * Pure, and tested: this is the one file in the app that is read by a shell
 * rather than by us, so a quoting mistake in it is a command that fails on
 * every machine whose user name has a space in it.
 */
export function shimScript(electron: string, cli: string): string {
  return `#!/bin/sh
# Written by Prequel. Runs its command line tool under the app's own runtime.
# Replaced whenever the app starts, so updating Prequel updates this too.
CLI='${cli}'
ELECTRON='${electron}'

if [ ! -f "$CLI" ]; then
  echo "error: Prequel's command line tool is missing from $CLI. Reinstall it from the Prequel menu." >&2
  exit 1
fi

exec env ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" "$@"
`;
}

/**
 * Writes the shim, and says whether anything changed.
 *
 * Called on every launch rather than once, because the path inside it points at
 * this copy of the app: moving Prequel from Downloads to Applications, or
 * replacing it with an update that unpacks somewhere else, leaves a shim
 * pointing at a bundle that is not there. The failure then is a command that
 * works until the day it does not, which is the worst kind.
 *
 * Idempotent: an unchanged script is not rewritten, so this costs one read on a
 * normal launch.
 */
export function installShim(): { path: string; changed: boolean } {
  const path = shimPath();
  const script = shimScript(process.execPath, cliBundlePath());

  try {
    if (existsSync(path) && readFileSync(path, "utf8") === script) {
      return { path, changed: false };
    }

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, script, { mode: 0o755 });
    chmodSync(path, 0o755);
    log("info", `wrote the prequel command to ${path}`);
    return { path, changed: true };
  } catch (cause) {
    // Never fatal. A menu-bar screen recorder that refused to start because it
    // could not write a shell script would be absurd; the tray item says so
    // when somebody asks for it by hand.
    log("warn", `could not write ${path}`, cause);
    return { path, changed: false };
  }
}

/** Whether anything is installed at `~/.local/bin/prequel`, right or stale. */
export function shimExists(): boolean {
  return existsSync(shimPath());
}

/**
 * Whether the shim is in place and points at this copy.
 *
 * Read for the tray item's label: "Install Command Line Tool" against
 * "Reinstall" is the difference between a thing to do and a thing already done.
 */
export function shimInstalled(): boolean {
  try {
    return readFileSync(shimPath(), "utf8") === shimScript(process.execPath, cliBundlePath());
  } catch {
    return false;
  }
}

/**
 * Whether `~/.local/bin` is somewhere a shell will look.
 *
 * Checked so the message after installing can say what to do about it. The
 * PATH seen here is the one `launchd` gave the app, which is not the user's
 * interactive PATH — so this can only ever be a hint, and it is written as one.
 */
export function shimOnPath(): boolean {
  const parts = (process.env["PATH"] ?? "").split(":");
  return parts.includes(dirname(shimPath()));
}
