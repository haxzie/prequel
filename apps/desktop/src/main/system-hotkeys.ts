/**
 * Taking a shortcut off macOS, and giving it back.
 *
 * `globalShortcut.register` cannot win ⇧⌘5. A handful of chords are *symbolic
 * hotkeys* — the WindowServer dispatches them to Apple's own services before
 * any application's hotkey table is consulted — and ⇧⌘5 is the one that opens
 * the screenshot and recording toolbar. Registering it succeeds, so Settings
 * draws the chord as bound and the key still opens Apple's toolbar: the exact
 * silently-wrong binding `shortcuts.ts` refuses to create.
 *
 * The only way to hold one is to switch the system's off first. That is a write
 * to `com.apple.symbolichotkeys` — the user's own preferences domain, so no
 * entitlement and no TCC prompt — followed by `activateSettings -u`, which
 * applies it live rather than at the next login.
 *
 * Because it is somebody's Mac-wide setting and not ours, two rules hold
 * throughout. What was there before is read and kept, so a user who had already
 * remapped the hotkey gets *their* mapping back rather than Apple's default. And
 * it is given back on quit: an app that is not running has no business holding a
 * key, and narrowing the window to a crash is what keeps "Prequel is uninstalled
 * and ⇧⌘5 does nothing" from being the lasting state. `claimSystemHotkey` repairs
 * exactly that case on the next launch, which is why the claim is written to a
 * file rather than held in memory.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { app } from "electron";

import { type SystemHotkey, systemHotkeyFor } from "../shared/system-hotkeys.js";
import { log } from "./log.js";

const DOMAIN = "com.apple.symbolichotkeys";
const KEY = "AppleSymbolicHotKeys";
const ACTIVATE =
  "/System/Library/PrivateFrameworks/SystemAdministration.framework/Resources/activateSettings";

/** Where the claim is recorded, so a crash does not lose it. */
const FILE = "system-hotkeys.json";

/** One entry of `AppleSymbolicHotKeys`, as `plutil` renders it. */
export type HotkeyEntry = {
  enabled?: boolean;
  value?: { type?: string; parameters?: number[] };
};

type Claim = { id: number; previous: HotkeyEntry | null };

/**
 * Whether disabling this id is what stands between us and the chord.
 *
 * False when the entry is already off — nothing to take — and false when its
 * parameters are not the ones the chord describes, which means the user has
 * remapped the hotkey to something else and ⇧⌘5 is already free. Switching it
 * off then would break a mapping they chose in exchange for nothing.
 */
export function holdsTheChord(hotkey: SystemHotkey, entry: HotkeyEntry | null): boolean {
  if (!entry) return true; // Absent means the default, and the default is on.
  if (entry.enabled === false) return false;

  const parameters = entry.value?.parameters;
  if (!parameters) return true; // `{enabled = 1}` with no mapping is the default one.
  return (
    parameters.length === 3 &&
    parameters.every((value, index) => value === hotkey.parameters[index])
  );
}

/**
 * The entry to write, as typed JSON.
 *
 * Typed is the whole point. The obvious spelling — `defaults write … -dict-add
 * 184 '{enabled = 0; …}'` — stores every leaf as a *string*: `"enabled":"0"`,
 * `"parameters":["53",…]`. `defaults` reports success, the plist looks right in
 * `defaults read`, and the hotkey stays on, because Apple's own entries hold a
 * boolean and three integers. `plutil -replace … -json` is the spelling that
 * writes those.
 */
export function asJson(entry: HotkeyEntry): string {
  const value = entry.value?.parameters
    ? { type: entry.value.type ?? "standard", parameters: entry.value.parameters }
    : undefined;
  return JSON.stringify({ enabled: entry.enabled !== false, ...(value ? { value } : {}) });
}

/**
 * Makes `accelerator` ours, giving back whatever was held before it.
 *
 * Idempotent, and safe to call on every launch with the chord already in use:
 * holding the id we want is the one case that does nothing at all, which is
 * also how a claim that outlived a crash is recognised rather than re-taken.
 */
export function claimSystemHotkey(accelerator: string): void {
  const wanted = systemHotkeyFor(accelerator);
  const held = readClaim();

  if (held && wanted && held.id === wanted.id) return;
  if (held) giveBack(held);
  if (!wanted) return;

  const entry = readEntry(wanted.id);
  if (!holdsTheChord(wanted, entry)) {
    log("info", `macOS does not hold ${wanted.chord}; nothing to switch off`);
    return;
  }

  const disabled: HotkeyEntry = {
    enabled: false,
    value: { type: entry?.value?.type ?? "standard", parameters: wanted.parameters },
  };

  if (!writeEntry(wanted.id, disabled)) return;
  writeClaim({ id: wanted.id, previous: entry });
  log("info", `took ${wanted.chord} from macOS; Prequel answers it now`);
}

/**
 * Gives back whatever is held. Called on quit, and before taking another.
 *
 * Synchronous on purpose: `will-quit` is the last moment this can happen, and
 * an async restore started there loses its race with the process exiting.
 */
export function restoreSystemHotkey(): void {
  const held = readClaim();
  if (held) giveBack(held);
}

function giveBack(claim: Claim): void {
  // No previous entry means the key was absent, and absent is not the same as
  // disabled: it is "whatever Apple ships". Deleting restores that, where
  // writing `enabled = 1` would freeze today's default into their settings.
  const restored = claim.previous ? writeEntry(claim.id, claim.previous) : deleteEntry(claim.id);
  log(
    restored ? "info" : "warn",
    restored ? `gave hotkey ${claim.id} back to macOS` : `could not give hotkey ${claim.id} back`,
  );
  // Forgotten either way. A restore that failed will fail again next launch for
  // the same reason, and keeping the record would retry it on every launch
  // forever; the warning above is the thing that says what happened.
  forgetClaim();
}

function readEntry(id: number): HotkeyEntry | null {
  try {
    // Read through `defaults export` rather than off the plist file: cfprefsd
    // flushes to disk on its own schedule, so a change made in System Settings
    // moments ago is in the daemon and not yet in the file. Reading the stale
    // copy is how we would come to restore a mapping the user had replaced.
    const json = execFileSync(
      "/bin/sh",
      ["-c", `defaults export ${DOMAIN} - | plutil -extract ${KEY}.${id} json -o - -- -`],
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
    );
    return JSON.parse(json) as HotkeyEntry;
  } catch {
    // `plutil` exits non-zero when the key path is missing, which is the
    // ordinary case on a Mac where nobody has touched the shortcut.
    return null;
  }
}

function writeEntry(id: number, entry: HotkeyEntry): boolean {
  return edit(`-replace ${KEY}.${id} -json ${quote(asJson(entry))}`);
}

function deleteEntry(id: number): boolean {
  return edit(`-remove ${KEY}.${id}`);
}

/**
 * Exports the domain, edits one key, imports it back.
 *
 * All three steps go through `defaults`, so all three see what cfprefsd holds.
 * Editing `~/Library/Preferences` directly — with `PlistBuddy`, say — writes
 * behind the daemon's cache, and the next flush overwrites it: the hotkey comes
 * back minutes later with nothing having touched it.
 *
 * `defaults` cannot address a nested key, which is why `plutil` sits in the
 * middle. It rewrites the whole domain, so a change made in the Keyboard pane
 * during these few milliseconds would be lost — the only writer of this domain
 * is System Settings, so that is one pane open at one instant.
 */
function edit(plutilArgs: string): boolean {
  try {
    execFileSync(
      "/bin/sh",
      [
        "-c",
        `defaults export ${DOMAIN} - | plutil ${plutilArgs} -o - -- - | defaults import ${DOMAIN} -`,
      ],
      { timeout: 10_000, stdio: "ignore" },
    );
    return activate();
  } catch (cause) {
    log("warn", `could not update ${DOMAIN}: ${String(cause)}`);
    return false;
  }
}

/** Single-quoted for `/bin/sh`. The JSON is ours, but it still goes through a shell. */
function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Applies the change now rather than at the next login.
 *
 * Without this the write lands in the file and the old hotkey keeps firing for
 * the rest of the session — a shortcut that starts working tomorrow reads as one
 * that does not work.
 */
function activate(): boolean {
  try {
    execFileSync(ACTIVATE, ["-u"], { timeout: 10_000, stdio: "ignore" });
    return true;
  } catch (cause) {
    log("warn", `could not reload the keyboard settings: ${String(cause)}`);
    return false;
  }
}

function claimFile(): string {
  return join(app.getPath("userData"), FILE);
}

function readClaim(): Claim | null {
  try {
    const stored = JSON.parse(readFileSync(claimFile(), "utf8")) as Partial<Claim>;
    if (typeof stored.id !== "number") return null;
    return { id: stored.id, previous: (stored.previous as HotkeyEntry | null) ?? null };
  } catch {
    return null;
  }
}

function writeClaim(claim: Claim): void {
  try {
    writeFileSync(claimFile(), JSON.stringify(claim), "utf8");
  } catch (cause) {
    // The hotkey is already switched off at this point, and losing the record
    // means nothing will ever switch it back on. Loud, because it is the one
    // failure here that leaves the Mac worse than it started.
    console.error("[hotkeys] took a system hotkey but could not record it:", cause);
  }
}

function forgetClaim(): void {
  try {
    rmSync(claimFile(), { force: true });
  } catch {
    // Already gone, or a read-only userData. Re-reading it next launch finds a
    // hotkey that is no longer disabled and restores a second time, which is
    // the same write twice rather than a wrong one.
  }
}
