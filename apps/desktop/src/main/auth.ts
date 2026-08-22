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
 * `transcribe/install-id.ts`.
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
  if (pending) return { status: "waiting" };
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

  void shell.openExternal(url.toString());
  emit();
}

export function cancelSignIn(): void {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending = null;
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
      user: { name: string; email: string; image: string | null };
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
        avatarUrl: result.user.image,
        teamName: result.team?.name ?? null,
      },
    });

    log("info", `signed in as ${result.user.email}`);
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
export async function signOut(): Promise<void> {
  const token = authToken();
  write(null);
  emit();

  if (!token) return;

  try {
    await apiFetch("/v1/desktop/revoke", { method: "POST", token });
  } catch (cause) {
    console.warn("[auth] could not revoke the device token:", cause);
  }
}
