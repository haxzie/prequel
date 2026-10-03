/**
 * `prequel` — the command line, and the one surface an agent drives.
 *
 * Runs under the app's own Electron binary as a plain Node process, so there is
 * no second runtime to ship and no version of Node to depend on being
 * installed: the shim in `~/.local/bin/prequel` sets `ELECTRON_RUN_AS_NODE` and
 * hands this file to it. See `main/cli/shim.ts`, which writes that shim.
 *
 * Three rules hold everywhere in here, because they are what makes the tool
 * usable by something that cannot see the screen:
 *
 * - **One object on stdout, always.** `--json`, or any time stdout is not a
 *   terminal, which is every time an agent runs it.
 * - **Progress goes to stderr.** A render that printed frame counts on stdout
 *   would make its own answer unparseable.
 * - **Exit codes mean something.** 0 done, 1 the command failed, 2 the command
 *   line was wrong. An agent retries a 2 differently from a 1.
 */
import { spawn, spawnSync } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import {
  CLI_PROTOCOL,
  CLI_SOCKET,
  commandName,
  type CliFrame,
  type CliRequest,
} from "../shared/cli.js";
import { parse } from "./args.js";
import { answerLocally } from "./local.js";
import { help, human, progressLine } from "./print.js";

/**
 * Where this file is, which is the only thing that locates the app and its
 * resources.
 *
 * From `process.argv[1]`, the script path the shim handed the Electron binary —
 * not `import.meta.url` and not `__dirname`. This bundle is built as CommonJS
 * so Node can run it with no `package.json` beside it (see
 * `scripts/build-cli.mjs`), and the bundler replaces `import.meta` with an
 * empty object in that format: `import.meta.url` is silently `undefined`, which
 * would make every path below resolve from the wrong place.
 */
const here = dirname(process.argv[1] ?? process.execPath);

/**
 * How long to wait for the app to come up before giving up on it.
 *
 * Twenty seconds. A cold launch on a Mac that has just booted is seconds, and a
 * first launch may be showing a permission prompt — but a wait with no end is
 * worse than a failure, because the agent holding the shell cannot tell one
 * from the other and neither can the person watching it.
 */
const LAUNCH_TIMEOUT_MS = 20_000;

/**
 * How long a copy that is *already* running is given to answer.
 *
 * Three seconds. Nothing is being started, so this is only the time it takes a
 * listening app to accept a connection on a socket in its own support
 * directory — and the alternative explanation, a Prequel too old to have a
 * command line at all, is worth reaching quickly rather than after twenty
 * seconds that look exactly like a hang.
 */
const SKEW_TIMEOUT_MS = 3_000;

/**
 * The app's version, read off the `package.json` that ships beside the bundle.
 *
 * Read rather than compiled in, so a shim left pointing at an older copy of the
 * app reports that copy's version. A hard-coded string would report the version
 * of whatever built the CLI, which is exactly the lie worth avoiding here.
 */
function version(): string {
  for (const path of [join(here, "..", "..", "package.json"), join(here, "..", "package.json")]) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown };
      if (typeof parsed.version === "string") return parsed.version;
    } catch {
      // Not there, or not ours. Try the next.
    }
  }
  return "unknown";
}

/**
 * The socket the app listens on.
 *
 * Built the same way `app.getPath("userData")` builds it rather than asked for,
 * because asking would mean loading Electron. `app.setName("Prequel")` in
 * `main/index.ts` is what makes the two agree — change one and this breaks with
 * a "not running" message about an app that is running.
 */
function socketPath(): string {
  const override = process.env["PREQUEL_SOCKET"];
  if (override) return override;
  return join(homedir(), "Library", "Application Support", "Prequel", CLI_SOCKET);
}

/**
 * The `.app` this file is inside, or null in a development build.
 *
 * Walked up from here rather than hard-coded to `/Applications`, so a copy
 * running from `~/Applications` or from a build directory launches itself
 * rather than a different install of Prequel.
 */
function bundlePath(): string | null {
  const parts = here.split(sep);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index]?.endsWith(".app")) return parts.slice(0, index + 1).join(sep);
  }
  return null;
}

/** Where the skill ships, beside the bundle. */
function skillSource(): string {
  return resolve(here, "..", "..", "resources", "skill", "SKILL.md");
}

function fail(code: string, message: string, json: boolean): never {
  if (json) process.stdout.write(`${JSON.stringify({ error: { code, message } })}\n`);
  process.stderr.write(`error: ${message}\n`);
  process.exit(code === "usage" ? 2 : 1);
}

function emit(value: unknown, json: boolean): void {
  if (json) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else {
    const text = human(value);
    if (text.trim() !== "") process.stdout.write(`${text}\n`);
  }
}

/**
 * Connects, or answers why not.
 *
 * `ENOENT` is the app never having run since the socket was last cleaned up;
 * `ECONNREFUSED` is a socket file left behind by a crash. Both mean "not
 * listening", and both are worth launching for — the second one only because
 * the server unlinks a stale socket on the way up.
 */
function connect(path: string): Promise<Socket | null> {
  return new Promise((done) => {
    const socket = createConnection(path);
    socket.once("connect", () => done(socket));
    socket.once("error", () => {
      socket.destroy();
      done(null);
    });
  });
}

/** Whether a copy of Prequel is already running, whatever version it is. */
function appIsRunning(): boolean {
  return spawnSync("pgrep", ["-x", "Prequel"], { stdio: "ignore" }).status === 0;
}

async function launch(json: boolean): Promise<Socket> {
  const bundle = bundlePath();

  /**
   * Never `open -a Prequel`.
   *
   * That resolves by *name*, to whichever copy macOS knows about — which is not
   * this one when the command line is running from a development build, where
   * there is no `.app` above it at all. It launched the installed app instead:
   * a different, older Prequel that cannot answer this socket, so the command
   * sat for twenty seconds and failed, having put a recording panel and a live
   * camera on screen for its trouble. Every retry woke it again.
   *
   * A command line belongs to exactly one bundle. If it cannot find that
   * bundle, the honest answer is to say which app to start, not to start
   * something else.
   */
  if (!bundle) {
    fail(
      "failed",
      "this `prequel` was built from a development checkout, and the app it belongs to is not running. Start it with `pnpm dev:desktop`, or install a packaged Prequel and reinstall the command from its menu bar",
      json,
    );
  }

  // Read before the launch, because `open` makes it true either way. It is what
  // separates the two reasons the socket never appears: an app that will not
  // start at all, and one that is running but predates the command line.
  const wasRunning = appIsRunning();

  // Said straight away, and on stderr so stdout stays parseable. Twenty seconds
  // of silence is indistinguishable from a command that has hung.
  if (!json) process.stderr.write("starting Prequel…\n");

  // `--args --cli` so the app knows it was started to answer a command and
  // stays in the menu bar. Without it, launching the app to list the windows
  // drops the recording panel over the screen the agent was about to record.
  const child = spawn("open", ["-a", bundle, "--args", "--cli"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  const path = socketPath();
  // A copy that is already up has nothing to start, so there is no cold launch
  // to wait through: either it is listening or it is a version that cannot.
  // The long budget is for the launch itself.
  const deadline = Date.now() + (wasRunning ? SKEW_TIMEOUT_MS : LAUNCH_TIMEOUT_MS);
  while (Date.now() < deadline) {
    const socket = await connect(path);
    if (socket) return socket;
    await new Promise((wait) => setTimeout(wait, 150));
  }

  if (wasRunning) {
    fail(
      "failed",
      "Prequel is running but is not answering this command, which means it is older than the `prequel` you are using. Update Prequel, then reinstall the command from its menu bar",
      json,
    );
  }

  fail(
    "failed",
    `Prequel did not come up within ${String(LAUNCH_TIMEOUT_MS / 1000)}s. Open it once by hand and check that it is installed`,
    json,
  );
}

/**
 * Sends one request and waits for its answer.
 *
 * No timeout: a render of a ten-minute take legitimately runs for minutes, and
 * a cap here would kill it part way and leave a half-written file. The socket
 * closing early is the failure case, and it is reported as one.
 */
function send(socket: Socket, request: CliRequest, json: boolean): Promise<unknown> {
  return new Promise((done, broken) => {
    let buffer = "";

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");

      // Newline-delimited JSON. A frame can arrive split across two reads, and
      // two frames can arrive in one — both happen under a render reporting
      // progress — so the buffer is drained a line at a time.
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (line.trim() === "") continue;

        let frame: CliFrame;
        try {
          frame = JSON.parse(line) as CliFrame;
        } catch {
          broken(new Error(`the app sent something that is not JSON: ${line.slice(0, 200)}`));
          return;
        }

        if ("event" in frame) {
          // Stderr either way, and as JSON under `--json` so a watching agent
          // can follow a long render without parsing prose.
          process.stderr.write(
            json ? `${JSON.stringify(frame.data)}\n` : `${progressLine(frame.data)}\n`,
          );
          continue;
        }

        socket.end();
        if (frame.ok) done(frame.value);
        else fail(frame.error.code, frame.error.message, json);
        return;
      }
    });

    socket.once("error", broken);
    socket.once("close", () => {
      broken(
        new Error(
          "the app closed the connection before answering. See ~/Library/Logs/Prequel/main.log",
        ),
      );
    });

    socket.write(`${JSON.stringify(request)}\n`);
  });
}

/**
 * Writes the agent skill where Claude Code looks for it.
 *
 * Here rather than in the app because it is a file copy with no part of the
 * recorder in it, and because an agent installing its own instructions should
 * not have to launch a menu-bar app to do it.
 */
function installSkill(params: Record<string, unknown>, json: boolean): void {
  const source = skillSource();
  let text: string;
  try {
    text = readFileSync(source, "utf8");
  } catch {
    fail("failed", `the skill is missing from this install (expected at ${source})`, json);
  }

  if (params["print"] === true) {
    process.stdout.write(text);
    return;
  }

  const root =
    typeof params["dir"] === "string"
      ? params["dir"]
      : join(homedir(), ".claude", "skills", "prequel");
  const target = join(root, "SKILL.md");

  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(target, text);
  } catch (cause) {
    fail("failed", `could not write ${target}: ${String(cause)}`, json);
  }

  emit({ path: target, wrote: true }, json);
}

async function run(): Promise<void> {
  const parsed = parse(process.argv.slice(2));

  // Stdout is a pipe whenever something other than a person is reading it,
  // which is the whole audience this tool is built for. `--json` is then only
  // needed by somebody who wants the raw answer in their own terminal.
  const json = parsed.json || !process.stdout.isTTY;

  if (parsed.kind === "usage") {
    if (json) {
      process.stdout.write(
        `${JSON.stringify({ error: { code: "usage", message: parsed.message } })}\n`,
      );
    }
    process.stderr.write(`error: ${parsed.message}\n`);
    if (parsed.path.length > 0 && !json) process.stderr.write(`\n${help(parsed.path)}\n`);
    process.exit(2);
  }

  if (parsed.kind === "help") {
    if (json) emit(answerLocally("guide", version()), true);
    else process.stdout.write(`${help(parsed.path)}\n`);
    return;
  }

  const name = commandName(parsed.spec.path);

  if (name === "skill.install") {
    installSkill(parsed.params, json);
    return;
  }

  const local = answerLocally(name, version());
  if (local !== null) {
    emit(local, json);
    return;
  }

  const path = socketPath();
  let socket = await connect(path);

  if (!socket) {
    if (parsed.spec.launches === false) {
      // `status` and `record status` answer honestly rather than starting the
      // app to find out: "is Prequel running" must not be a question that
      // changes the answer.
      emit({ running: false, version: version(), protocol: CLI_PROTOCOL }, json);
      return;
    }
    socket = await launch(json);
  }

  const value = await send(
    socket,
    { id: 1, protocol: CLI_PROTOCOL, command: name, params: parsed.params },
    json,
  );

  emit(value, json);
}

/**
 * Anything that got out, as a failure rather than a stack trace.
 *
 * A Node stack on stdout is both unparseable and unreadable; the message is
 * what says whether to try again.
 */
void run().catch((cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  process.stderr.write(`error: ${message}\n`);
  if (!process.stdout.isTTY) {
    process.stdout.write(`${JSON.stringify({ error: { code: "failed", message } })}\n`);
  }
  process.exit(1);
});
