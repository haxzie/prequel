/**
 * Turning a command line into a request, and nothing else.
 *
 * Pure, with no socket and no filesystem in it, because this is the part that
 * has to be exactly right: an agent that mistypes a flag must be told which
 * flag, and the difference between "unknown command" and "unknown flag" is the
 * difference between it retrying something that can work and retrying the same
 * thing forever. Tested in `args.test.ts`.
 */
import {
  BARE_WORD_DEFAULTS,
  COMMANDS,
  WORD_ALIASES,
  commandName,
  findCommand,
  type CliCommandSpec,
  type CliFlagSpec,
} from "../shared/cli.js";

export interface ParsedCommand {
  kind: "command";
  spec: CliCommandSpec;
  params: Record<string, unknown>;
  /** Print JSON even on a terminal. */
  json: boolean;
}

export interface ParsedHelp {
  kind: "help";
  /** The command asked about, or empty for the whole guide. */
  path: readonly string[];
  json: boolean;
}

export interface ParsedUsage {
  kind: "usage";
  message: string;
  /** What to point at: the command that was understood, if any. */
  path: readonly string[];
  /**
   * Carried even on a failure, so the error is printed in whichever form the
   * caller asked for. An agent that passed `--json` and got prose back has to
   * parse prose to find out it mistyped a flag.
   */
  json: boolean;
}

export type Parsed = ParsedCommand | ParsedHelp | ParsedUsage;

/**
 * The longest run of words that names a command.
 *
 * Two words first, then one. `record stop` and `record` would both be prefixes
 * of a one-word match, and taking the shortest would make `prequel record stop`
 * mean "record, with a stray argument" — which is a recording nobody asked for.
 */
function resolve(
  words: readonly string[],
): { spec: CliCommandSpec; used: number; params?: Readonly<Record<string, unknown>> } | null {
  const canonical = words.map((word) => WORD_ALIASES[word] ?? word);

  for (const length of [2, 1]) {
    if (canonical.length < length) continue;
    const spec = findCommand(canonical.slice(0, length));
    if (spec) return { spec, used: length };
  }

  // A single word that only ever means one thing — `prequel targets`,
  // `prequel windows`. Tried on the word as typed *and* on its alias, so
  // `prequel monitors` lands on the display listing rather than on nothing.
  for (const first of [words[0], canonical[0]]) {
    if (!first) continue;
    const completed = BARE_WORD_DEFAULTS[first];
    if (!completed) continue;
    const spec = findCommand(completed.path);
    if (spec) return { spec, used: 1, params: completed.params };
  }

  return null;
}

/** `short-edge` → `shortEdge`. The wire speaks the same names the app does. */
export function camel(flag: string): string {
  return flag.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function flagSpec(spec: CliCommandSpec, name: string): CliFlagSpec | undefined {
  return spec.flags?.find((flag) => flag.name === name);
}

/**
 * A `--no-thing` switch, which is how every negative flag here is spelled.
 *
 * Returned as `thing: false` rather than `noThing: true`, so the app reads one
 * field with two possible values instead of two fields that can contradict
 * each other.
 */
function negated(spec: CliCommandSpec, name: string): string | null {
  if (!name.startsWith("no-")) return null;
  const positive = name.slice(3);
  return flagSpec(spec, name) ? null : positive;
}

function number(value: string, what: string): number | { error: string } {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return { error: `${what} must be a number, not "${value}"` };
  return parsed;
}

/**
 * `x,y,width,height` in points.
 *
 * One token rather than four flags: an area is a rectangle, and four separate
 * numbers is four chances to put them in the wrong order — which records the
 * wrong part of the screen and looks like a bug in the capture.
 */
export function region(
  value: string,
): { x: number; y: number; width: number; height: number } | { error: string } {
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length !== 4) {
    return { error: `an area is x,y,width,height in points — got "${value}"` };
  }

  const numbers = parts.map(Number);
  if (numbers.some((part) => !Number.isFinite(part))) {
    return { error: `an area's four values must all be numbers — got "${value}"` };
  }

  const [x, y, width, height] = numbers as [number, number, number, number];
  if (width <= 0 || height <= 0) {
    return { error: `an area must have a width and a height — got "${value}"` };
  }

  return { x, y, width, height };
}

export function parse(argv: readonly string[]): Parsed {
  let json = false;
  let help = false;
  const tokens: string[] = [];

  // Global switches are pulled out first so `--json` may go anywhere, including
  // before the command. An agent writes it as a habit rather than in position.
  for (const token of argv) {
    if (token === "--json") json = true;
    else if (token === "--help" || token === "-h") help = true;
    else if (token === "--version" || token === "-v") tokens.push("version");
    else tokens.push(token);
  }

  const words: string[] = [];
  for (const token of tokens) {
    if (token.startsWith("-")) break;
    words.push(token);
  }

  if (words.length === 0) {
    // `prequel` on its own, and `prequel --help`. Both mean "what can you do",
    // which is the guide rather than an error.
    return { kind: "help", path: [], json };
  }

  const found = resolve(words);
  if (!found) {
    return {
      kind: "usage",
      message: `unknown command: ${words.join(" ")}. Run \`prequel guide\` for the list`,
      path: [],
      json,
    };
  }

  const { spec, used } = found;
  if (help) return { kind: "help", path: spec.path, json };

  const rest = tokens.slice(used);
  const params: Record<string, unknown> = { ...found.params };
  const positionals: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]!;

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const [name, inline] = splitFlag(token.slice(2));

    const off = negated(spec, name);
    if (off !== null) {
      // `--no-cursor` is declared as its own flag where the app wants one;
      // where it is not, it switches off a flag that exists.
      if (!flagSpec(spec, off) && !flagSpec(spec, name)) {
        return unknownFlag(spec, name, json);
      }
      params[camel(off)] = false;
      continue;
    }

    const flag = flagSpec(spec, name);
    if (!flag) return unknownFlag(spec, name, json);

    if (flag.value === "none") {
      if (inline !== null) {
        return {
          kind: "usage",
          message: `--${name} takes no value`,
          path: spec.path,
          json,
        };
      }
      params[camel(name)] = true;
      continue;
    }

    // `--out=file.mp4` and `--out file.mp4` are the same thing. Both are
    // written by hand often enough that accepting one and not the other is a
    // trap rather than a convention.
    let value = inline;
    if (value === null) {
      const next = rest[index + 1];
      const takesNext = next !== undefined && !next.startsWith("--");
      if (takesNext) {
        value = next;
        index += 1;
      } else if (flag.value === "optional-string") {
        // `--camera` with nothing after it: the default device.
        params[camel(name)] = true;
        continue;
      } else {
        return { kind: "usage", message: `--${name} needs a value`, path: spec.path, json };
      }
    }

    if (flag.value === "number") {
      const parsed = number(value, `--${name}`);
      if (typeof parsed !== "number") {
        return { kind: "usage", message: parsed.error, path: spec.path, json };
      }
      params[camel(name)] = parsed;
      continue;
    }

    if (flag.choices && !flag.choices.includes(value)) {
      return {
        kind: "usage",
        message: `--${name} must be one of ${flag.choices.join(", ")} — got "${value}"`,
        path: spec.path,
        json,
      };
    }

    params[camel(name)] = value;
  }

  const expected = spec.args ?? [];
  if (positionals.length > expected.length) {
    const extra = positionals.slice(expected.length).join(" ");
    return {
      kind: "usage",
      message: `${commandName(spec.path)} does not take "${extra}"`,
      path: spec.path,
      json,
    };
  }

  for (const [index, arg] of expected.entries()) {
    const given = positionals[index];
    if (given === undefined) {
      if (arg.required) {
        return {
          kind: "usage",
          message: `${spec.path.join(" ")} needs <${arg.name}>: ${arg.summary}`,
          path: spec.path,
          json,
        };
      }
      continue;
    }

    if (arg.kind === "number") {
      const parsed = number(given, `<${arg.name}>`);
      if (typeof parsed !== "number") {
        return { kind: "usage", message: parsed.error, path: spec.path, json };
      }
      params[arg.name] = parsed;
      continue;
    }

    if (arg.kind === "region") {
      const parsed = region(given);
      if ("error" in parsed) {
        return { kind: "usage", message: parsed.error, path: spec.path, json };
      }
      params[arg.name] = parsed;
      continue;
    }

    params[arg.name] = given;
  }

  return { kind: "command", spec, params, json };
}

function splitFlag(token: string): [string, string | null] {
  const equals = token.indexOf("=");
  if (equals === -1) return [token, null];
  return [token.slice(0, equals), token.slice(equals + 1)];
}

/**
 * A wrong flag, with the right ones listed.
 *
 * The list is the whole point: a flag rejected without one leaves an agent
 * guessing, and guessing at a recorder's flags means recording again.
 */
function unknownFlag(spec: CliCommandSpec, name: string, json: boolean): ParsedUsage {
  const known = (spec.flags ?? []).map((flag) => `--${flag.name}`);
  const suffix = known.length > 0 ? `. Takes: ${known.join(", ")}` : "";
  return {
    kind: "usage",
    message: `unknown flag --${name} for ${spec.path.join(" ")}${suffix}`,
    path: spec.path,
    json,
  };
}

/** Every command, for the guide. Re-exported so the client needs one import. */
export { COMMANDS };
