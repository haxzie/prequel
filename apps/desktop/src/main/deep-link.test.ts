/**
 * A `prequel://` URL can arrive from anywhere.
 *
 * Nothing stops another application — or a page the user was looking at — from
 * opening one. The parser is therefore the security boundary, not a convenience:
 * everything it accepts is handed straight to the code exchange, and the state
 * check that follows only works if a malformed link is refused before it.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: true, setAsDefaultProtocolClient: () => true, on: () => undefined },
}));

vi.mock("./auth.js", () => ({ completeSignIn: () => Promise.resolve() }));
vi.mock("./log.js", () => ({ log: () => undefined }));

const { deepLinkFromArgv, parseDeepLink } = await import("./deep-link.js");

describe("parseDeepLink", () => {
  it("reads the code and state out of a sign-in link", () => {
    expect(parseDeepLink("prequel://auth?code=abc&state=xyz")).toEqual({
      code: "abc",
      state: "xyz",
    });
  });

  it("refuses a link with no state", () => {
    // Without the state there is nothing to match against the sign-in this
    // process started, so accepting it would mean acting on a code somebody
    // else's browser produced.
    expect(parseDeepLink("prequel://auth?code=abc")).toBeNull();
  });

  it("refuses a link with no code", () => {
    expect(parseDeepLink("prequel://auth?state=xyz")).toBeNull();
  });

  it("refuses another application's scheme", () => {
    expect(parseDeepLink("https://prequel.sh/auth?code=abc&state=xyz")).toBeNull();
    expect(parseDeepLink("notprequel://auth?code=abc&state=xyz")).toBeNull();
  });

  it("refuses a host the app does not answer to", () => {
    // Only `auth` means anything. A second host added later must be opted into
    // explicitly rather than inherited by anything that parses.
    expect(parseDeepLink("prequel://open?code=abc&state=xyz")).toBeNull();
  });

  it("refuses something that is not a URL at all", () => {
    expect(parseDeepLink("")).toBeNull();
    expect(parseDeepLink("prequel:auth")).toBeNull();
  });
});

describe("deepLinkFromArgv", () => {
  it("finds the link wherever macOS put it", () => {
    // The position varies with how the app was launched, and on a cold start
    // macOS adds arguments of its own — so this is matched, never indexed.
    expect(
      deepLinkFromArgv([
        "/Applications/Prequel.app/Contents/MacOS/Prequel",
        "prequel://auth?code=a&state=b",
      ]),
    ).toBe("prequel://auth?code=a&state=b");

    expect(
      deepLinkFromArgv(["electron", "--inspect", ".", "prequel://auth?code=a&state=b", "--other"]),
    ).toBe("prequel://auth?code=a&state=b");
  });

  it("answers null for an ordinary launch", () => {
    expect(deepLinkFromArgv(["/Applications/Prequel.app/Contents/MacOS/Prequel"])).toBeNull();
  });
});
