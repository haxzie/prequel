/**
 * Prequel takes ⇧⌘5 off macOS, so the thing worth testing is that it gives it
 * back — as what was there, not as what Apple ships today, and after a crash as
 * well as after a quit. A hotkey this never restores is a Mac whose screenshot
 * toolbar is gone with nothing on screen to say which app took it.
 *
 * The types are tested too, because the first implementation got them wrong in a
 * way nothing surfaced: `defaults write -dict-add` with an old-style plist
 * stores `"enabled":"0"` — a string — and macOS reads that as no instruction at
 * all. Every command reported success and ⇧⌘5 kept opening Apple's toolbar.
 *
 * `execFileSync` is stood in for by a small interpreter over the three shell
 * pipelines the module runs, so these assert the state the domain ends in rather
 * than the strings passed to a mock.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HotkeyEntry } from "./system-hotkeys.js";

/** The fake `AppleSymbolicHotKeys` dictionary, keyed by id as the real one is. */
let domain: Record<string, HotkeyEntry>;
let activated: number;
let userData: string;

vi.mock("electron", () => ({
  app: { getPath: () => userData },
}));

vi.mock("./log.js", () => ({ log: () => {} }));

vi.mock("node:child_process", () => ({
  execFileSync: (file: string, args: string[]) => {
    if (file.endsWith("activateSettings")) {
      activated += 1;
      return "";
    }

    const command = args[1] ?? "";

    const extract = /-extract AppleSymbolicHotKeys\.(\d+) json/.exec(command);
    if (extract) {
      const entry = domain[extract[1]!];
      // `plutil` exits non-zero on a missing key path, which is the ordinary
      // case on a Mac where nobody has touched the shortcut.
      if (!entry) throw new Error("No value at that key path");
      return JSON.stringify(entry);
    }

    const replace = /-replace AppleSymbolicHotKeys\.(\d+) -json '(.*?)'(?= -o )/.exec(command);
    if (replace) {
      domain[replace[1]!] = JSON.parse(replace[2]!) as HotkeyEntry;
      return "";
    }

    const remove = /-remove AppleSymbolicHotKeys\.(\d+)/.exec(command);
    if (remove) {
      delete domain[remove[1]!];
      return "";
    }

    throw new Error(`unexpected command: ${command}`);
  },
}));

/** ⇧⌘5 as macOS ships it: id 184, '5' at keycode 23, Shift+Command. */
const TOOLBAR = { enabled: true, value: { type: "standard", parameters: [53, 23, 1179648] } };

async function load() {
  // Fresh module, so the claim is read off disk rather than out of a previous
  // test's memory — which is also how a launch after a crash reads it.
  vi.resetModules();
  return import("./system-hotkeys.js");
}

beforeEach(() => {
  domain = {};
  activated = 0;
  userData = mkdtempSync(join(tmpdir(), "prequel-hotkeys-"));
});

afterEach(() => rmSync(userData, { recursive: true, force: true }));

describe("claiming ⇧⌘5", () => {
  it("switches the system's off, with a boolean and three integers", async () => {
    const { claimSystemHotkey } = await load();
    claimSystemHotkey("Shift+Cmd+5");

    expect(domain["184"]).toEqual({
      enabled: false,
      value: { type: "standard", parameters: [53, 23, 1179648] },
    });
    // Strings here are the silent failure: macOS ignores them.
    expect(typeof domain["184"]!.enabled).toBe("boolean");
    for (const value of domain["184"]!.value!.parameters!) expect(typeof value).toBe("number");
    // Written and not reloaded is a shortcut that starts working tomorrow.
    expect(activated).toBeGreaterThan(0);
  });

  it("does nothing for a chord macOS does not want", async () => {
    const { claimSystemHotkey } = await load();
    claimSystemHotkey("Shift+Cmd+R");
    expect(domain).toEqual({});
    expect(activated).toBe(0);
  });

  it("leaves a hotkey the user has already remapped alone", async () => {
    // ⇧⌘5 moved to ⇧⌘8: the chord is free, so there is nothing to take and
    // taking it would break a mapping they chose for nothing in return.
    domain["184"] = { enabled: true, value: { type: "standard", parameters: [56, 28, 1179648] } };
    const { claimSystemHotkey } = await load();
    claimSystemHotkey("Shift+Cmd+5");

    expect(domain["184"]!.enabled).toBe(true);
    expect(activated).toBe(0);
  });

  it("leaves a hotkey the user has already switched off alone", async () => {
    domain["184"] = { enabled: false, value: TOOLBAR.value };
    const { claimSystemHotkey } = await load();
    claimSystemHotkey("Shift+Cmd+5");
    expect(activated).toBe(0);
  });
});

describe("giving it back", () => {
  it("deletes the entry it added, rather than writing the default back", async () => {
    // Absent is not the same as enabled: it means "whatever macOS ships". Writing
    // `enabled = true` would freeze today's answer into the user's settings.
    const { claimSystemHotkey, restoreSystemHotkey } = await load();
    claimSystemHotkey("Shift+Cmd+5");
    restoreSystemHotkey();

    expect(domain["184"]).toBeUndefined();
  });

  it("restores the user's own mapping, not Apple's", async () => {
    const theirs = { enabled: true, value: { type: "standard", parameters: [53, 23, 1572864] } };
    domain["184"] = { ...theirs };
    const { claimSystemHotkey, restoreSystemHotkey } = await load();

    // Their mapping is ⌥⇧5, which is not the chord, so nothing is taken — and a
    // restore must then not invent one either.
    claimSystemHotkey("Shift+Cmd+5");
    restoreSystemHotkey();
    expect(domain["184"]).toEqual(theirs);
  });

  it("gives it back when the shortcut moves off it", async () => {
    const { claimSystemHotkey } = await load();
    claimSystemHotkey("Shift+Cmd+5");
    expect(domain["184"]!.enabled).toBe(false);

    claimSystemHotkey("Shift+Cmd+R");
    expect(domain["184"]).toBeUndefined();
  });

  it("holds on when the shortcut has not moved", async () => {
    const { claimSystemHotkey } = await load();
    claimSystemHotkey("Shift+Cmd+5");
    const after = activated;

    claimSystemHotkey("Shift+Cmd+5");
    expect(domain["184"]!.enabled).toBe(false);
    // Already ours: the second launch should not write anything at all.
    expect(activated).toBe(after);
  });

  it("repairs a claim that outlived a crash", async () => {
    const first = await load();
    first.claimSystemHotkey("Shift+Cmd+5");
    expect(domain["184"]!.enabled).toBe(false);

    // No `restoreSystemHotkey`: the process was killed. The claim file is all
    // that is left, and the next launch has to be able to act on it.
    const next = await load();
    next.restoreSystemHotkey();
    expect(domain["184"]).toBeUndefined();
  });

  it("restores before registering a different chord after a crash", async () => {
    const first = await load();
    first.claimSystemHotkey("Shift+Cmd+5");

    const next = await load();
    next.claimSystemHotkey("Ctrl+Alt+P");
    expect(domain["184"]).toBeUndefined();
  });

  it("swaps one system hotkey for another", async () => {
    const { claimSystemHotkey } = await load();
    claimSystemHotkey("Shift+Cmd+5");
    claimSystemHotkey("Shift+Cmd+4");

    expect(domain["184"]).toBeUndefined();
    expect(domain["31"]!.enabled).toBe(false);
  });
});

describe("asJson", () => {
  it("drops a value that carries no mapping", async () => {
    // Several of Apple's own entries are a bare `{enabled = 0}`, and inventing
    // parameters for one would rewrite a hotkey we were only putting back.
    const { asJson } = await load();
    expect(asJson({ enabled: false })).toBe('{"enabled":false}');
  });

  it("defaults the type rather than writing a value without one", async () => {
    const { asJson } = await load();
    expect(asJson({ enabled: true, value: { parameters: [53, 23, 1179648] } })).toBe(
      '{"enabled":true,"value":{"type":"standard","parameters":[53,23,1179648]}}',
    );
  });
});
