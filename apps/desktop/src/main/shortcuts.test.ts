/**
 * Escape is released by the very thing it triggers.
 *
 * The press cancels the picker, cancelling the picker closes the panel, and the
 * panel closing gives the key back — so `unregister` ran on the stack of the
 * callback Electron was still dispatching. On macOS that unhooks the Carbon
 * handler from inside its own `NotifyKeyPressed`, and the browser process goes
 * down with it: two users, twice, with a stack entirely inside HIToolbox.
 */
import { beforeEach, describe as suite, expect, it, vi } from "vitest";

/** Every call `globalShortcut` saw, in order. */
const calls: string[] = [];
/** What is registered, and to what. */
const bound = new Map<string, () => void>();

vi.mock("electron", () => ({
  globalShortcut: {
    register: (accelerator: string, handler: () => void) => {
      calls.push(`register ${accelerator}`);
      if (bound.has(accelerator)) return false;
      bound.set(accelerator, handler);
      return true;
    },
    unregister: (accelerator: string) => {
      calls.push(`unregister ${accelerator}`);
      bound.delete(accelerator);
    },
    unregisterAll: () => {
      calls.push("unregisterAll");
      bound.clear();
    },
    isRegistered: (accelerator: string) => bound.has(accelerator),
  },
}));

vi.mock("./log.js", () => ({ log: () => undefined }));
vi.mock("./system-hotkeys.js", () => ({
  claimSystemHotkey: () => true,
  restoreSystemHotkey: () => undefined,
}));

const { bindEscape, unbindEscape, teardownShortcuts } = await import("./shortcuts.js");

/** Lets everything queued for the next tick run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(async () => {
  teardownShortcuts();
  await settle();
  calls.length = 0;
  bound.clear();
});

suite("Escape, while the picker is up", () => {
  it("is never given back on the key handler's own stack", async () => {
    // The shape of the crash, as close as this can get without Electron: the
    // handler asks for the key to be released, and nothing may touch the
    // registration until it has returned.
    bindEscape(() => unbindEscape());
    await settle();

    const press = bound.get("Escape");
    expect(press).toBeDefined();

    calls.length = 0;
    press!();
    expect(calls).toEqual([]);

    await settle();
    expect(calls).toEqual(["unregister Escape"]);
    expect(bound.has("Escape")).toBe(false);
  });

  it("ends up bound to the last thing asked for", async () => {
    // The panel syncs Escape on every change it emits, so several asks land in
    // one turn. What matters is where it ends up, and that it is registered
    // once rather than once per ask.
    const first = vi.fn();
    const second = vi.fn();

    bindEscape(first);
    unbindEscape();
    bindEscape(second);
    await settle();

    expect(calls.filter((call) => call.startsWith("register"))).toHaveLength(1);
    bound.get("Escape")!();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("is rebound to a new picker's handler rather than the old one's", async () => {
    // `register` over an accelerator we already hold fails, which is why this
    // takes it off first — without that the second picker's Escape cancelled
    // the first picker, which is gone.
    const first = vi.fn();
    const second = vi.fn();

    bindEscape(first);
    await settle();
    bindEscape(second);
    await settle();

    bound.get("Escape")!();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("is not put back on by a request that was still on its way at quit", async () => {
    bindEscape(() => undefined);
    teardownShortcuts();
    await settle();

    expect(bound.has("Escape")).toBe(false);
  });
});
