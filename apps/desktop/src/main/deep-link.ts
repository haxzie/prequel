/**
 * `prequel://` URLs, and the two completely different ways macOS delivers one.
 *
 * If the app is already running, the URL arrives as an `open-url` event. If it
 * is not, macOS launches it and the URL is in `process.argv` — and if a second
 * copy is launched while the first holds the single-instance lock, it arrives in
 * the `second-instance` handler's `argv` instead. All three have to be wired or
 * signing in works only in whichever state happened to be tested.
 */
import { resolve } from "node:path";

import { app } from "electron";

import { completeSignIn } from "./auth.js";
import { log } from "./log.js";

export const SCHEME = "prequel";

/**
 * URLs that arrived before anything was ready to act on them.
 *
 * `open-url` can fire before `whenReady`, which is precisely what happens on a
 * cold launch from a link — the most common case there is. Dropping those would
 * make signing in fail exactly when the app was not already open.
 */
const queued: string[] = [];
let ready = false;

/**
 * Claims the scheme, and starts listening.
 *
 * Call at module scope, before `whenReady`. `open-url` has to be attached early
 * for the reason above, and `setAsDefaultProtocolClient` is cheap.
 */
export function registerDeepLinks(): void {
  claimScheme();

  app.on("open-url", (event, url) => {
    // Without this macOS may also treat the URL as a file to open, which
    // surfaces as a second, meaningless window.
    event.preventDefault();
    handle(url);
  });
}

/**
 * Registers Prequel as the handler for `prequel://`.
 *
 * The dev-mode branch is not optional. Under `pnpm dev` the running binary is
 * Electron itself, so the default registration points the scheme at Electron
 * with no idea which project to open — the link resolves to a bare Electron
 * window and the sign-in silently never arrives. Passing the executable and the
 * script path explicitly is what makes a deep link testable before packaging.
 */
function claimScheme(): void {
  const claimed = app.isPackaged
    ? app.setAsDefaultProtocolClient(SCHEME)
    : app.setAsDefaultProtocolClient(SCHEME, process.execPath, [
        // `argv[1]` is the entry electron-vite handed Electron. Resolved
        // because macOS stores what it is given, and a relative path recorded
        // here stops working the moment the shell's directory differs.
        resolve(process.argv[1] ?? ""),
      ]);

  if (!claimed) {
    // Another build — often an older copy in /Applications — already owns the
    // scheme. Signing in will open that one instead, which looks like the link
    // doing nothing at all.
    log("warn", `could not claim the ${SCHEME}:// scheme`);
  }
}

/** Lets queued URLs through. Call once the app is ready to act on them. */
export function flushDeepLinks(): void {
  ready = true;
  for (const url of queued.splice(0)) handle(url);
}

/**
 * Picks a `prequel://` URL out of a launch argv.
 *
 * Used for both the cold launch and `second-instance`. Matched rather than
 * indexed: the position varies with how the app was started, and on a cold
 * launch macOS adds arguments of its own.
 */
export function deepLinkFromArgv(argv: string[]): string | null {
  return argv.find((argument) => argument.startsWith(`${SCHEME}://`)) ?? null;
}

export function handleDeepLinkArgv(argv: string[]): void {
  const url = deepLinkFromArgv(argv);
  if (url) handle(url);
}

function handle(url: string): void {
  if (!ready) {
    queued.push(url);
    return;
  }

  const parsed = parseDeepLink(url);
  if (!parsed) return;

  void completeSignIn(parsed.code, parsed.state);
}

/**
 * The one link shape the app answers to: `prequel://auth?code=…&state=…`.
 *
 * Both halves are required. A link missing either is not a truncated sign-in to
 * be salvaged — it is a link this app did not start, and the only safe reading
 * of one is to ignore it.
 */
export function parseDeepLink(url: string): { code: string; state: string } | null {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // `URL` keeps the colon on the protocol, and the host is where `auth` lands
  // for a scheme with no `//`-style authority of its own.
  if (parsed.protocol !== `${SCHEME}:` || parsed.hostname !== "auth") return null;

  const code = parsed.searchParams.get("code");
  const state = parsed.searchParams.get("state");

  return code && state ? { code, state } : null;
}
