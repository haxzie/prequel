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
 * Only ever a *positive* answer. Electron reads this off the Apple event
 * `loginwindow` sends — `kAEOpenApplication` carrying `keyAELaunchedAsLogInItem`
 * — and a Mac that restarts with "Reopen windows when logging back in" ticked
 * relaunches Prequel through Launch Services instead, which sends no such
 * event. So `true` means a login for certain and `false` means nothing at all.
 * Use `startedByItself` to decide whether to show anything.
 */
export function wasOpenedAtLogin(): boolean {
  return app.getLoginItemSettings().wasOpenedAtLogin;
}

/**
 * Whether this launch is one nobody asked for.
 *
 * The difference matters: a deliberate launch should put the recording panel on
 * screen, and a boot should not — a panel that appears over the desktop every
 * time the Mac starts is something to be dismissed, not something to be used.
 *
 * The flag above is not enough on its own, and trusting it is what put the
 * panel and a blank camera bubble in front of people after every restart. The
 * second half is the one that holds: if Prequel starts itself at login then it
 * is already running by the time anyone wants it, so a cold launch is the
 * system's doing far more often than a person's — and for the rare time it is
 * not, the tray icon is one click away. Switch the login item off and a launch
 * becomes unambiguous again, so the panel comes back with it.
 */
export function startedByItself(): boolean {
  return wasOpenedAtLogin() || opensAtLogin();
}

/**
 * What a switch should show: on, off, or that there is nothing to switch.
 *
 * `null` for a development build, where `setOpensAtLogin` refuses. Without a
 * third state the refusal was invisible: the renderer asked for "on", got the
 * unchanged "off" back, and drew the switch off again. From the outside that is
 * a control that does not work, and the only sign otherwise was a line in the
 * log — every click a user made was recorded as ignored while they kept trying.
 */
export function loginItemState(): boolean | null {
  return app.isPackaged ? opensAtLogin() : null;
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
