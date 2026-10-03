/**
 * What a person sees. Agents read the JSON.
 *
 * Generic rather than a renderer per command: every answer here is either a
 * list of objects or a handful of fields, and a bespoke table for each would be
 * twenty more places for the human output to say something the JSON does not.
 * The JSON is the contract — this only has to be readable.
 */
import {
  COMMANDS,
  commandName,
  findCommand,
  type CliCommandSpec,
  type CliProgress,
} from "../shared/cli.js";

/** Fields no table needs: long, or only ever useful to a machine. */
const HIDDEN = new Set(["seed", "poster", "url", "defaults", "params", "variants"]);

export function human(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);

  const entries = Object.entries(value as Record<string, unknown>);

  // One array under one key is the shape of every `list` answer. Printed as a
  // table, because the whole reason somebody is reading this on a terminal is
  // to pick an id out of it.
  const lists = entries.filter(([, field]) => Array.isArray(field) && field.length > 0);
  const scalars = entries.filter(([, field]) => !Array.isArray(field));

  const lines: string[] = [];
  for (const [key, field] of lists) {
    if (lists.length > 1) lines.push(`${key}:`);
    lines.push(table(field as unknown[]));
  }

  if (scalars.length > 0) {
    if (lines.length > 0) lines.push("");
    for (const [key, field] of scalars) {
      if (field === null || field === undefined) continue;
      lines.push(`${key}: ${inline(field)}`);
    }
  }

  return lines.join("\n");
}

function inline(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function table(rows: readonly unknown[]): string {
  if (rows.some((row) => typeof row !== "object" || row === null)) {
    return rows.map((row) => `  ${inline(row)}`).join("\n");
  }

  const objects = rows as readonly Record<string, unknown>[];
  const columns: string[] = [];
  for (const row of objects) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key) && !HIDDEN.has(key)) columns.push(key);
    }
  }

  const cells = objects.map((row) => columns.map((column) => inline(row[column])));
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...cells.map((row) => row[index]?.length ?? 0)),
  );

  const header = columns.map((column, index) => column.padEnd(widths[index]!)).join("  ");
  const body = cells.map((row) =>
    row
      .map((cell, index) => cell.padEnd(widths[index]!))
      .join("  ")
      .trimEnd(),
  );

  return [`  ${header.trimEnd()}`, ...body.map((line) => `  ${line}`)].join("\n");
}

/** One progress line, for stderr. Stdout stays parseable whatever happens. */
export function progressLine(progress: CliProgress): string {
  const counted =
    progress.total && progress.total > 0
      ? ` ${String(progress.done ?? 0)}/${String(progress.total)}`
      : "";
  return `${progress.stage}${counted}${progress.message ? ` — ${progress.message}` : ""}`;
}

/** The whole command list, or one command in detail. */
export function help(path: readonly string[]): string {
  if (path.length === 0) {
    const lines = [
      "prequel — record the screen and get back a finished video.",
      "",
      "Every command takes --json and answers with one object on stdout.",
      "`prequel guide --json` is the whole contract, for an agent to read first.",
      "",
    ];

    let group = "";
    for (const command of COMMANDS) {
      const first = command.path[0]!;
      if (first !== group) {
        group = first;
        lines.push("");
      }
      lines.push(`  ${command.path.join(" ").padEnd(24)}${command.summary}`);
    }

    return lines.join("\n");
  }

  const spec = findCommand(path);
  if (!spec) return `unknown command: ${path.join(" ")}`;
  return one(spec);
}

function one(spec: CliCommandSpec): string {
  const usage = [
    "prequel",
    ...spec.path,
    ...(spec.args ?? []).map((arg) => (arg.required ? `<${arg.name}>` : `[${arg.name}]`)),
    ...((spec.flags ?? []).length > 0 ? ["[flags]"] : []),
  ].join(" ");

  const lines = [spec.summary, "", `  ${usage}`, ""];

  for (const arg of spec.args ?? []) {
    lines.push(`  <${arg.name}>`.padEnd(26) + arg.summary);
  }

  for (const flag of spec.flags ?? []) {
    const value =
      flag.value === "none"
        ? ""
        : flag.value === "optional-string"
          ? " [value]"
          : ` <${flag.value}>`;
    lines.push(`  --${flag.name}${value}`.padEnd(26) + flag.summary);
    if (flag.choices) lines.push("".padEnd(26) + `one of: ${flag.choices.join(", ")}`);
  }

  lines.push("", `  answers with: ${spec.returns}`);
  if (spec.local) lines.push("  needs no running app");
  return lines.join("\n");
}

export { commandName };
