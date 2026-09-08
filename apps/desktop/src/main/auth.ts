/**
 * Signing this Mac in, and remembering that it is.
 *
 * The app cannot hold the web session: that cookie is scoped to `.prequel.sh`,
 * a domain Electron never visits, and the renderer cannot make a remote request
 * at all. So it holds an opaque device token instead, and getting one to it is
 * the interesting part.
 *
 * The only channel between a browser and a native app on macOS is a URL, and a
 * URL is not private — `open` logs it, and any other app that registers the
 * scheme can be handed it instead. So what travels over `prequel://` is a code
 * that is worthless on its own; redeeming it needs a verifier that never left
 * this process. That is PKCE, used for the problem it was invented for.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { app, shell } from "electron";

import type { AuthAccount, AuthState } from "../shared/contract.js";
import { apiFetch, ApiError, appUrl } from "./api.js";
import { flush, track } from "./analytics.js";
import { log } from "./log.js";

const FILE = "auth.json";

/**
 * How long the app will sit waiting for a deep link.
 *
 * Slightly longer than the code's own five minutes at the server, so the answer
 * a user gets is the specific one — "that link expired" — rather than this
 * timing out first and reporting nothing in particular.
 */
const WAIT_MS = 6 * 60 * 1000;

/**
 * How long after the app is back in front a sign-in keeps saying so.
 *
 * Handling a `prequel://` link activates the app, so the window is focused a
 * moment *before* `completeSignIn` runs. Going quiet on focus alone would flash
 * "Sign in" in the gap between the browser handing over and the token landing.
 * Long enough to cover that hop, short enough that somebody who closed the tab
 * is not left reading about a browser they have already shut.
 */
const SETTLE_MS = 1500;

interface Stored {
  token: string;
  account: AuthAccount;
}

/**
 * A sign-in that has been started and not yet finished.
 *
 * The verifier lives here and nowhere else. It is never written to disk and
 * never sent anywhere except in the exchange itself, which is the whole reason
 * intercepting the deep link is not enough to steal an account.
 */
interface Pending {
  verifier: string;
  state: string;
  timer: NodeJS.Timeout;
  /**
   * Whether the app has lost focus since this began.
   *
   * The browser taking over is the only evidence the user ever got there, and
   * without it the focus the app already holds when the button is pressed would
   * count as them coming back from a browser they had not yet seen.
   */
  left: boolean;
  /**
   * Whether the wait has stopped being announced.
   *
   * Separate from cancelling, and the distinction is the whole point: the
   * handshake stays alive and a link that arrives minutes later still signs the
   * user in. All this says is that nothing should go on describing a browser
   * they have come back from.
   */
  quiet: boolean;
  settle: NodeJS.Timeout | null;
}

let cached: Stored | null | undefined;
let pending: Pending | null = null;
let listeners: ((state: AuthState) => void)[] = [];

function file(): string {
  return join(app.getPath("userData"), FILE);
}

/**
 * `auth.json`, not `preferences.json`.
 *
 * `RecordingPreferences` rides along in the `DockState` main broadcasts to every
 * window, so a token stored there would be readable by every renderer — the same
 * reasoning that put the install id in its own file, written down in
 * `install-id.ts`.
 */
function read(): Stored | null {
  if (cached !== undefined) return cached;

  try {
    const stored = JSON.parse(readFileSync(file(), "utf8")) as Partial<Stored>;

    cached =
      typeof stored.token === "string" && stored.token.length > 0 && stored.account
        ? { token: stored.token, account: stored.account }
        : null;
  } catch {
    // No file yet, or an unreadable one. Either way nobody is signed in, and
    // there is nothing here worth recovering.
    cached = null;
  }

  return cached;
}

function write(value: Stored | null): void {
  cached = value;

  try {
    if (value === null) {
      unlinkSync(file());
    } else {
      // `0o600` because this is a bearer credential. Everything else in
      // `userData` is preferences; this one is a password in all but name.
      writeFileSync(file(), JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
    }
  } catch (cause) {
    // A read-only userData directory should not stop somebody sharing. The
    // token stays in memory for this launch and is asked for again next time.
    console.warn("[auth] could not persist the sign-in:", cause);
  }
}

/** The bearer token, for `share.ts` and anything else that calls the API. */
export function authToken(): string | null {
  return read()?.token ?? null;
}

export function authState(): AuthState {
  if (pending && !pending.quiet) return { status: "waiting" };
  const stored = read();
  return stored ? { status: "signed-in", account: stored.account } : { status: "signed-out" };
}

export function onAuthChanged(listener: (state: AuthState) => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
  };
}

function emit(): void {
  const state = authState();
  for (const listener of listeners) listener(state);
}

/**
 * Opens the browser and waits.
 *
 * Returns as soon as the browser is open, not when the sign-in finishes —
 * the result arrives on the `authChanged` broadcast, because the user may take
 * minutes, may sign in on a different account, or may simply close the tab.
 * Making a caller await that would leave a button spinning forever.
 */
export function beginSignIn(): void {
  cancelSignIn();

  // 32 bytes, base64url: 43 characters, which is what the server's schema
  // expects at minimum and what RFC 7636 calls for.
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(16).toString("base64url");

  const challenge = createHash("sha256").update(verifier).digest("base64url");

  pending = {
    verifier,
    state,
    left: false,
    quiet: false,
    settle: null,
    // Cleared rather than left forever. A `waiting` state with nothing coming is
    // a Sign in button that never comes back, and the user has no way to tell
    // that from a slow network.
    timer: setTimeout(() => {
      log("info", "sign-in timed out waiting for the deep link");
      cancelSignIn();
      emit();
    }, WAIT_MS),
  };

  const url = new URL("/desktop/auth", appUrl());
  url.searchParams.set("challenge", challenge);
  url.searchParams.set("state", state);

  track("sign_in_started");

  void shell.openExternal(url.toString());
  emit();
}

export function cancelSignIn(): void {
  if (!pending) return;
  clearTimeout(pending.timer);
  if (pending.settle) clearTimeout(pending.settle);
  pending = null;
}

/**
 * The app lost focus while a sign-in was under way.
 *
 * Which is what pressing Sign in is supposed to cause — `shell.openExternal`
 * hands the screen to the browser. Recorded rather than acted on, because it is
 * only half of the signal `noteAppFocused` below needs.
 */
export function noteAppBlurred(): void {
  if (pending) pending.left = true;
}

/**
 * The app is back in front, and no deep link came with it.
 *
 * Somebody looking at the app again is somebody who is no longer in the browser,
 * and a Sign in button reading "Waiting for your browser…" at that point is
 * describing a window they have closed — while being the one control that would
 * start another attempt. So the wait stops being announced and the button reads
 * `signed-out` again.
 *
 * What this deliberately does not do is cancel. The code is good at the server
 * for five minutes, and somebody who came back to check something and returned
 * to the tab still gets signed in. Cancelling here would turn that into a link
 * `completeSignIn` ignores, which is silent — the worse half of the bug this
 * fixes rather than a fix for it.
 */
export function noteAppFocused(): void {
  if (!pending || pending.quiet || !pending.left || pending.settle) return;

  pending.settle = setTimeout(() => {
    if (!pending) return;
    pending.quiet = true;
    pending.settle = null;
    emit();
  }, SETTLE_MS);
}

/**
 * Finishes a sign-in from the deep link the browser sent back.
 *
 * Called by `deep-link.ts`. Every rejection path here is silent to the user by
 * design: a `prequel://auth` URL can arrive from anywhere, including from
 * another application, and the only correct response to one that does not match
 * a sign-in this process started is to ignore it.
 */
export async function completeSignIn(code: string, state: string): Promise<void> {
  if (!pending) {
    log("warn", "ignored an auth deep link with no sign-in under way");
    return;
  }

  if (state !== pending.state) {
    // Not our handshake. Deliberately does not cancel the pending one — that
    // would let anybody who can open a URL abort a sign-in in progress.
    log("warn", "ignored an auth deep link whose state did not match");
    return;
  }

  const { verifier } = pending;
  cancelSignIn();

  try {
    const result = await apiFetch<{
      token: string;
      user: { name: string; email: string };
      team: { id: string; name: string } | null;
    }>("/v1/desktop/token", {
      method: "POST",
      body: JSON.stringify({ code, verifier, label: hostname() }),
    });

    write({
      token: result.token,
      account: {
        name: result.user.name,
        email: result.user.email,
        teamName: result.team?.name ?? null,
      },
    });

    log("info", `signed in as ${result.user.email}`);

    // The one event the Worker treats specially: it becomes a PostHog
    // `$identify` carrying the install id, which is what merges everything this
    // Mac did before signing in onto the account. Flushed immediately rather
    // than left to the timer, so the merge lands before anything else does.
    track("signed_in", { has_team: result.team !== null });
    void flush();
  } catch (cause) {
    console.error(
      "[auth] the sign-in exchange failed:",
      cause instanceof ApiError ? cause.message : cause,
    );
  }

  emit();
}

/** Opens the team's library in the default browser. */
export function openDashboard(): void {
  void shell.openExternal(new URL("/app", appUrl()).toString());
}

/**
 * Signs out, locally first.
 *
 * The token is dropped before the server is told, and the server being
 * unreachable does not stop it. Somebody pressing Sign out on a train expects
 * to be signed out; leaving them signed in because a request failed is the
 * wrong way round. The row is left revoked on the next successful call, and it
 * is useless here either way.
 */
/**
 * Drops a sign-in the server has stopped accepting.
 *
 * Distinct from `signOut`, which is somebody's decision: no `signed_out` event
 * to attribute to them, and no revoke call, because the token being refused is
 * what got us here and asking it to revoke itself would fail the same way.
 *
 * Without this the app sits in a state where it says it is signed in and every
 * authenticated call disagrees — the account shows in the sidebar, the
 * entitlement can never be fetched, and the reason is a line in a log nobody
 * reads. Saying "signed out" is not a worse state than that one; it is the true
 * one, and it is the only one with a button on it that fixes anything.
 */
export function forgetRejectedSignIn(): void {
  if (!read()) return;

  console.warn("[auth] the stored sign-in was refused; signing out");
  write(null);
  emit();
}

export async function signOut(): Promise<void> {
  const token = authToken();

  // Before the token is dropped, so the event is still attributed to the account
  // signing out rather than to the anonymous install left behind. Not awaited:
  // signing out must not wait on a network, which is the whole point of the
  // ordering below. `flush` reads the token synchronously before it suspends, so
  // starting it on this line is enough — moving it after `write(null)` would
  // send the event as nobody.
  track("signed_out");
  void flush();

  write(null);
  emit();

  if (!token) return;

  try {
    await apiFetch("/v1/desktop/revoke", { method: "POST", token });
  } catch (cause) {
    console.warn("[auth] could not revoke the device token:", cause);
  }
}
