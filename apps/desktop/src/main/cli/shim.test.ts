/**
 * The shell script the app writes into `~/.local/bin`.
 *
 * Worth a test because it is the one file here read by something other than us.
 * A quoting mistake in it is a `prequel` that fails on every Mac whose user name
 * has a space in it — and the person it fails for has no way to tell that from
 * the app not working.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: false, getAppPath: () => "/Applications/Prequel.app/Contents/Resources/app" },
}));

const { shimScript } = await import("./shim.js");

const ELECTRON = "/Applications/Prequel.app/Contents/MacOS/Prequel";
const CLI = "/Applications/Prequel.app/Contents/Resources/app.asar.unpacked/out/cli/prequel.cjs";

describe("shimScript", () => {
  it("runs the bundle under the app's own Electron, as Node", () => {
    const script = shimScript(ELECTRON, CLI);
    expect(script).toContain("ELECTRON_RUN_AS_NODE=1");
    expect(script).toContain(`exec env ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" "$@"`);
  });

  it("quotes both paths, so a space in them cannot split a word", () => {
    const script = shimScript(
      "/Users/a b/Applications/Prequel.app/Contents/MacOS/Prequel",
      "/Users/a b/out/cli/prequel.cjs",
    );
    expect(script).toContain(
      `ELECTRON='/Users/a b/Applications/Prequel.app/Contents/MacOS/Prequel'`,
    );
    expect(script).toContain(`CLI='/Users/a b/out/cli/prequel.cjs'`);
  });

  it("passes the arguments on rather than swallowing them", () => {
    // `"$@"` and not `$@`: without the quotes, `prequel record area 0,0,10,10`
    // survives but `--out "My demo.mp4"` becomes two arguments.
    expect(shimScript(ELECTRON, CLI)).toContain('"$@"');
  });

  it("says what is wrong when the app has moved", () => {
    // The common failure: Prequel is dragged to the Trash or replaced, and the
    // shim outlives it. A missing file with no message reads as a broken shell.
    const script = shimScript(ELECTRON, CLI);
    expect(script).toContain('if [ ! -f "$CLI" ]');
    expect(script).toContain("exit 1");
    expect(script).toContain("Reinstall");
  });

  it("starts with a shebang and nothing before it", () => {
    expect(shimScript(ELECTRON, CLI).startsWith("#!/bin/sh\n")).toBe(true);
  });
});
