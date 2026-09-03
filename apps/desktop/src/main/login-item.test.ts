/**
 * The refusal has to be visible.
 *
 * `setOpensAtLogin` declines in a development build, on purpose: registering
 * electron's own binary would leave an "Electron" entry in the user's Login
 * Items that outlives the dev session. What it did not do was say so. The
 * renderer asked for "on", read back the unchanged "off", and drew the switch
 * off again — a control that visibly does nothing, whose only explanation was a
 * line in the log saying every press had been ignored.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { packaged: false, openAtLogin: false, wasOpenedAtLogin: false };

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return state.packaged;
    },
    getLoginItemSettings: () => ({
      openAtLogin: state.openAtLogin,
      wasOpenedAtLogin: state.wasOpenedAtLogin,
    }),
    setLoginItemSettings: ({ openAtLogin }: { openAtLogin: boolean }) => {
      state.openAtLogin = openAtLogin;
    },
    getPath: () => "/tmp",
    getVersion: () => "0.0.0",
    getName: () => "Prequel",
  },
}));

const { loginItemState, opensAtLogin, setOpensAtLogin, startedByItself } =
  await import("./login-item.js");

describe("the login item", () => {
  beforeEach(() => {
    state.packaged = true;
    state.openAtLogin = false;
    state.wasOpenedAtLogin = false;
  });

  it("reads through to macOS rather than to a stored copy", () => {
    state.openAtLogin = true;
    expect(loginItemState()).toBe(true);
    expect(opensAtLogin()).toBe(true);
  });

  it("takes the switch when there is a bundle to register", () => {
    setOpensAtLogin(true);
    expect(loginItemState()).toBe(true);
  });

  it("says there is nothing to switch in a development build", () => {
    // Not `false`. False is a switch that is off and can be turned on, which is
    // the lie that made this look broken — the caller has no way to tell it
    // apart from a refusal, so it shows an empty switch and lets the user press
    // it all day.
    state.packaged = false;
    expect(loginItemState()).toBeNull();

    setOpensAtLogin(true);
    expect(loginItemState()).toBeNull();
  });

  it("leaves the user's own Login Items alone in a development build", () => {
    // The reason it refuses at all: the executable under `pnpm dev` is
    // electron's own binary, and registering that starts a copy of nothing
    // every morning long after the dev session is over.
    state.packaged = false;
    setOpensAtLogin(true);

    state.packaged = true;
    expect(opensAtLogin()).toBe(false);
  });

  /**
   * The bug this predicate exists for.
   *
   * macOS only sets `wasOpenedAtLogin` when `loginwindow` sends the Apple event
   * that says so. A Mac restarted with "Reopen windows when logging back in"
   * relaunches Prequel through Launch Services instead, the flag comes back
   * false, and the old rule read that as a person asking for the app — so the
   * panel and a blank camera bubble arrived over the desktop after every boot.
   */
  it("stays out of the way after a restart that sets no login flag", () => {
    state.openAtLogin = true;
    expect(startedByItself()).toBe(true);
  });

  it("still recognises a plain login", () => {
    state.wasOpenedAtLogin = true;
    expect(startedByItself()).toBe(true);
  });

  it("treats a launch as deliberate once the login item is off", () => {
    // The half that keeps the panel: nothing starts Prequel on this Mac, so a
    // running copy is one somebody asked for.
    expect(startedByItself()).toBe(false);
  });
});
