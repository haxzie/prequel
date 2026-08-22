/**
 * The two properties the sign-in handshake rests on.
 *
 * A `prequel://` link is not a private channel — macOS logs it, and another
 * application can register the same scheme and be handed it instead. What makes
 * intercepting one useless is that the code it carries cannot be redeemed
 * without a verifier that never left this process, and that a link whose state
 * does not match is ignored outright.
 *
 * Both are tested here because both fail silently: a broken state check does not
 * throw, it just accepts a link it should not have, and nothing downstream
 * notices.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let userData = "";
const opened: string[] = [];

vi.mock("electron", () => ({
  app: { getPath: () => userData },
  shell: {
    openExternal: (url: string) => {
      opened.push(url);
      return Promise.resolve();
    },
  },
}));

vi.mock("./log.js", () => ({ log: () => undefined }));

const exchanges: { code: string; verifier: string }[] = [];
let exchangeResult: unknown = null;

vi.mock("./api.js", () => ({
  appUrl: () => "https://prequel.sh",
  apiUrl: () => "https://api.prequel.sh",
  ApiError: class ApiError extends Error {},
  apiFetch: (_path: string, init: { body: string }) => {
    exchanges.push(JSON.parse(init.body) as { code: string; verifier: string });
    if (exchangeResult === null) return Promise.reject(new Error("refused"));
    return Promise.resolve(exchangeResult);
  },
}));

/**
 * Re-imported per test rather than once.
 *
 * `auth.ts` caches the parsed `auth.json` in a module-level variable, which is
 * right in the app — `userData` cannot change under a running process — and
 * wrong here, where every test gets a fresh directory. Without the reset a test
 * that reads a corrupt file is answered from the previous test's sign-in.
 */
let auth: typeof import("./auth.js");

const ACCOUNT = {
  token: "prq_test",
  user: { name: "Ana", email: "ana@example.com", image: null },
  team: { id: "org_1", name: "Acme" },
};

beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), "prequel-auth-"));
  opened.length = 0;
  exchanges.length = 0;
  exchangeResult = null;

  vi.resetModules();
  auth = await import("./auth.js");
});

afterEach(() => rmSync(userData, { recursive: true, force: true }));

/** The `state` the app put in the URL it opened. */
function openedState(): string {
  return new URL(opened.at(-1) ?? "").searchParams.get("state") ?? "";
}

describe("the deep-link exchange", () => {
  it("sends the verifier, never the challenge", async () => {
    auth.beginSignIn();

    const challenge = new URL(opened[0] ?? "").searchParams.get("challenge") ?? "";
    exchangeResult = ACCOUNT;

    await auth.completeSignIn("code-1", openedState());

    expect(exchanges).toHaveLength(1);
    // The whole point of PKCE: what travelled through the browser was the
    // hash, and what redeems the code is the preimage.
    expect(exchanges[0]?.verifier).not.toBe(challenge);
    expect(exchanges[0]?.code).toBe("code-1");
  });

  it("ignores a link whose state does not match", async () => {
    auth.beginSignIn();
    exchangeResult = ACCOUNT;

    await auth.completeSignIn("code-1", "some-other-state");

    expect(exchanges).toHaveLength(0);
    expect(auth.authState().status).toBe("waiting");
  });

  it("does not cancel the sign-in a mismatched link interrupted", async () => {
    auth.beginSignIn();
    exchangeResult = ACCOUNT;

    // Otherwise anybody able to open a URL could abort a sign-in in progress,
    // which is a denial of service for the cost of one link.
    await auth.completeSignIn("code-1", "wrong");
    await auth.completeSignIn("code-1", openedState());

    expect(auth.authState().status).toBe("signed-in");
  });

  it("ignores a link when no sign-in is under way", async () => {
    await auth.completeSignIn("code-1", "anything");
    expect(exchanges).toHaveLength(0);
    expect(auth.authState().status).toBe("signed-out");
  });

  it("consumes the pending sign-in, so a replayed link does nothing", async () => {
    auth.beginSignIn();
    const state = openedState();
    exchangeResult = ACCOUNT;

    await auth.completeSignIn("code-1", state);
    await auth.completeSignIn("code-1", state);

    expect(exchanges).toHaveLength(1);
  });
});

describe("auth.json", () => {
  it("keeps the token out of the state the renderer sees", async () => {
    auth.beginSignIn();
    exchangeResult = ACCOUNT;
    await auth.completeSignIn("code-1", openedState());

    const state = auth.authState();
    expect(state.status).toBe("signed-in");
    // A window has no use for a bearer credential, and the renderer is the half
    // of the app that loads remote pictures.
    expect(JSON.stringify(state)).not.toContain("prq_test");
    expect(auth.authToken()).toBe("prq_test");
  });

  it("is written so only the user can read it", async () => {
    auth.beginSignIn();
    exchangeResult = ACCOUNT;
    await auth.completeSignIn("code-1", openedState());

    const mode = statSync(join(userData, "auth.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("treats a corrupt file as signed out rather than throwing", () => {
    writeFileSync(join(userData, "auth.json"), "{ not json");
    expect(auth.authState().status).toBe("signed-out");
  });

  it("treats a file with no token as signed out", () => {
    writeFileSync(join(userData, "auth.json"), JSON.stringify({ account: ACCOUNT.user }));
    expect(auth.authState().status).toBe("signed-out");
  });

  it("leaves nothing behind after signing out", async () => {
    auth.beginSignIn();
    exchangeResult = ACCOUNT;
    await auth.completeSignIn("code-1", openedState());
    await auth.signOut();

    expect(auth.authToken()).toBeNull();
    expect(() => readFileSync(join(userData, "auth.json"))).toThrow();
  });
});
