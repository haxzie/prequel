/**
 * A log file, because a packaged app has no console.
 *
 * `pnpm dev` prints to the terminal; a build dropped into /Applications prints
 * into the void. Anything that only goes wrong once installed — a missing
 * resource, a permission refused, a quit that never completes — is invisible
 * without somewhere on disk to look afterwards.
 *
 * Deliberately small and synchronous. This has to survive the moments it exists
 * for: an uncaught exception, and `will-quit`, where an async write would be
 * cut off by the process exiting.
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

import { app } from "electron";

/** Rolled over past this, so one long-running session cannot fill a disk. */
const MAX_BYTES = 2 * 1024 * 1024;

let file: string | null = null;

export type LogLevel = "info" | "warn" | "error";

/** Where the log lives. `~/Library/Logs/Prequel/main.log` on macOS. */
export function logPath(): string {
  if (file) return file;

  const dir = app.getPath("logs");
  mkdirSync(dir, { recursive: true });
  file = join(dir, "main.log");
  return file;
}

/**
 * Starts logging, and routes crashes into the file.
 *
 * Call once, as early as possible — the interesting failures happen during
 * startup, before any window exists to report them.
 */
export function initLogging(): void {
  try {
    rollOver();
  } catch {
    // A log that cannot be rotated is still worth writing to.
  }

  // Mirrored rather than replaced: `console.warn` still reaches the terminal
  // under `pnpm dev`, and now also reaches the file in a packaged build. Every
  // existing `console.warn` in the app becomes a log line for free.
  for (const level of ["warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      write(level, args.map(format).join(" "));
    };
  }

  process.on("uncaughtException", (error) => {
    log("error", "uncaught exception", error);
  });

  process.on("unhandledRejection", (reason) => {
    log("error", "unhandled rejection", reason);
  });

  log("info", `— session start — ${app.getName()} ${app.getVersion()}`, {
    packaged: app.isPackaged,
    electron: process.versions["electron"],
    platform: `${process.platform} ${process.arch}`,
  });
}

/**
 * Writes one line. Never throws: logging must not be the thing that fails.
 *
 * For anything a developer should also trip over, prefer `console.warn` or
 * `console.error` — those are mirrored here *and* reach the terminal under
 * `pnpm dev`. This is for the lifecycle breadcrumbs that would only be noise
 * there.
 */
export function log(level: LogLevel, message: string, detail?: unknown): void {
  const suffix = detail === undefined ? "" : ` ${format(detail)}`;
  write(level, `${message}${suffix}`);
}

function write(level: LogLevel, message: string): void {
  try {
    appendFileSync(logPath(), `${new Date().toISOString()} [${level}] ${message}\n`);
  } catch {
    // Nowhere to write, and nowhere to report that either.
  }
}

/** Errors carry a stack; everything else is JSON, falling back to `String`. */
function format(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Keeps one previous log, so a crash-on-launch loop cannot erase the cause. */
function rollOver(): void {
  const path = logPath();
  if (statSync(path).size < MAX_BYTES) return;
  renameSync(path, `${path}.1`);
}
