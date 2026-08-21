/**
 * Opening at login.
 *
 * A menu-bar recorder is only useful if it is already there when the moment to
 * record arrives — nobody goes looking for a screen recorder in /Applications
 * *before* the thing they wanted to capture happens. So it is on by default,
 * seeded once during the welcome flow rather than re-applied on every launch.
 *
 * macOS holds the state, not `preferences.json`. Login Items is a System
 * Settings pane the user can change at any time, and a stored copy would
 * disagree with it the moment they did — worse, an app that writes its stored
 * value back on every launch quietly undoes their removal. Reading through to
 * the system means there is only ever one answer.
 */
import { app } from "electron";

import { log } from "./log.js";

/** Whether macOS will start Prequel when the user logs in. */
export function opensAtLogin(): boolean {
  return app.getLoginItemSettings().openAtLogin;
}

/**
 * Whether this launch was macOS starting the app at login, rather than a person.
 *
 * The difference matters: a deliberate launch should put the recording panel on
 * screen, and a login should not — a panel that appears over the desktop every
 * time the Mac boots is something to be dismissed, not something to be used.
 */
export function wasOpenedAtLogin(): boolean {
  return app.getLoginItemSettings().wasOpenedAtLogin;
}

export function setOpensAtLogin(enabled: boolean): void {
  // Under `pnpm dev` the executable is electron's own binary in node_modules,
  // and registering *that* leaves an "Electron" entry in the user's Login Items
  // that outlives the dev session and starts a copy of nothing every morning.
  if (!app.isPackaged) {
    log("info", `login item ignored in development (wanted ${enabled ? "on" : "off"})`);
    return;
  }

  // `openAsHidden` is the difference between the app arriving in the menu bar
  // and the app arriving in front of whatever the user is doing.
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true });
  log("info", `login item ${enabled ? "added" : "removed"}`);
}

/**
 * Turns it on for a Mac that has never run Prequel before.
 *
 * Only ever called while the welcome flow is still unfinished, which is what
 * keeps it from being an app that reinstates itself: once a user has been past
 * the switch on the last step of that flow, their answer is the only one that
 * applies.
 */
export function seedLoginItem(): void {
  if (opensAtLogin()) return;
  log("info", "first run: opening at login by default");
  setOpensAtLogin(true);
}
