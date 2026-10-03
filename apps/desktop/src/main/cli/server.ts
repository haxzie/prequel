/**
 * The socket the `prequel` command talks to.
 *
 * A Unix socket in the app's support directory, beside `auth.json`. Not a local
 * HTTP port: a port is reachable by every page in every browser on this Mac,
 * and this connection can start a screen recording. The socket's file
 * permissions are the whole of the authentication, which is why it is created
 * 0600 and why that is asserted after `listen` rather than assumed from the
 * process umask.
 *
 * One request per line, one answer per line. The server is deliberately thin —
 * it reads frames, finds a handler and reports what happened. What the commands
 * actually do is `commands.ts`.
 */
import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, join } from "node:path";

import { app } from "electron";

import {
  CLI_PROTOCOL,
  CLI_SOCKET,
  findCommand,
  type CliFrame,
  type CliProgress,
  type CliRequest,
} from "../../shared/cli.js";
import { log } from "../log.js";
import { cliHandlers, CliError, type CliContext } from "./commands.js";

let server: Server | null = null;

/** Where the socket lives. The CLI builds the same path without Electron. */
export function cliSocketPath(): string {
  const override = process.env["PREQUEL_SOCKET"];
  if (override) return override;
  return join(app.getPath("userData"), CLI_SOCKET);
}

export function startCliServer(context: CliContext): void {
  if (server) return;

  const path = cliSocketPath();
  const handlers = cliHandlers(context);

  // A socket left behind by a crash refuses connections forever: `listen`
  // fails with EADDRINUSE on a path that exists, whether or not anything is
  // listening. Removing it first is safe because the single-instance lock in
  // `main/index.ts` means no other copy of Prequel can be holding it.
  try {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) unlinkSync(path);
  } catch (cause) {
    log("error", "could not clear the CLI socket", cause);
    return;
  }

  server = createServer((socket) => void serve(socket, handlers));

  server.on("error", (cause) => {
    // Logged and dropped. The app is a screen recorder first: losing the
    // command line is worth a line in the log, never a failed launch.
    log("error", "the CLI socket failed", cause);
    server = null;
  });

  server.listen(path, () => {
    try {
      chmodSync(path, 0o600);
    } catch (cause) {
      log("warn", "could not tighten the CLI socket's permissions", cause);
    }
    log("info", `CLI socket listening at ${path}`);
  });

  app.on("will-quit", () => stopCliServer());
}

export function stopCliServer(): void {
  if (!server) return;
  server.close();
  server = null;

  // Unlinked on the way out as well as on the way in, so a clean quit does not
  // leave a path behind that the next launch has to recognise as dead.
  try {
    const path = cliSocketPath();
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // Already gone, or not ours to remove. The next start clears it.
  }
}

type Handlers = Record<
  string,
  (params: Record<string, unknown>, report: (progress: CliProgress) => void) => Promise<unknown>
>;

async function serve(socket: Socket, handlers: Handlers): Promise<void> {
  let buffer = "";

  const write = (frame: CliFrame): void => {
    if (socket.destroyed) return;
    socket.write(`${JSON.stringify(frame)}\n`);
  };

  // A client that goes away mid-render is normal — somebody pressed Ctrl-C —
  // and must not take the app down with an unhandled EPIPE.
  socket.on("error", (cause) => log("warn", "a CLI client dropped", cause));

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");

    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (line.trim() !== "") void handle(line);
    }
  });

  async function handle(line: string): Promise<void> {
    let request: CliRequest;
    try {
      request = JSON.parse(line) as CliRequest;
    } catch {
      write({ id: 0, ok: false, error: { code: "usage", message: "that was not JSON" } });
      return;
    }

    const id = typeof request.id === "number" ? request.id : 0;

    if (request.protocol !== CLI_PROTOCOL) {
      write({
        id,
        ok: false,
        error: {
          code: "usage",
          message:
            `this app speaks CLI protocol ${String(CLI_PROTOCOL)} and the \`prequel\` command speaks ` +
            `${String(request.protocol)}. The shim in ~/.local/bin points at a different copy of Prequel — ` +
            `reinstall it from the tray menu`,
        },
      });
      return;
    }

    const spec = request.command ? findCommand(request.command.split(".")) : undefined;
    const handler = handlers[request.command];
    if (!spec || !handler) {
      write({
        id,
        ok: false,
        error: { code: "usage", message: `unknown command: ${String(request.command)}` },
      });
      return;
    }

    try {
      const value = await handler(request.params ?? {}, (progress) =>
        write({ id, event: "progress", data: progress }),
      );
      write({ id, ok: true, value: value ?? {} });
    } catch (cause) {
      const error =
        cause instanceof CliError
          ? { code: cause.code, message: cause.message }
          : {
              code: "failed" as const,
              message: cause instanceof Error ? cause.message : String(cause),
            };

      // Logged as well as returned: the user running the command sees the
      // message, and a packaged app's log is the only place anyone can look
      // afterwards to find out what the recorder actually said.
      log("error", `cli ${request.command} failed: ${error.message}`);
      write({ id, ok: false, error });
    }
  }
}
