/**
 * The command line, parsed.
 *
 * These are the tests that matter most in the CLI: an agent cannot see the
 * screen, so the only thing standing between it and a recording of the wrong
 * window is this parser. Every case here is one somebody will type.
 */
import { describe, expect, it } from "vitest";

import { COMMANDS, commandName } from "../shared/cli.js";
import { camel, parse, region } from "./args.js";

describe("parse", () => {
  it("resolves the longest command, not the shortest", () => {
    // `record` alone is not a command and `record stop` is. Taking one word
    // would make `prequel record stop` mean "record, with a stray argument",
    // which is a recording nobody asked for.
    const parsed = parse(["record", "stop"]);
    expect(parsed.kind).toBe("command");
    if (parsed.kind !== "command") return;
    expect(commandName(parsed.spec.path)).toBe("record.stop");
  });

  it("takes the plural somebody actually typed", () => {
    for (const [typed, meant] of [
      [["targets", "list"], "target.list"],
      [["transcripts", "generate"], "transcript.generate"],
      [["recordings", "ls"], "recordings.list"],
      [["monitors"], "target.list"],
      [["record", "monitor", "1"], "record.display"],
    ] as const) {
      const parsed = parse([...typed, ...(typed[0] === "transcripts" ? ["abc"] : [])]);
      expect(parsed.kind, typed.join(" ")).toBe("command");
      if (parsed.kind !== "command") continue;
      expect(commandName(parsed.spec.path)).toBe(meant);
    }
  });

  it("completes a bare word that can only mean one thing", () => {
    const parsed = parse(["recordings"]);
    expect(parsed.kind).toBe("command");
    if (parsed.kind !== "command") return;
    expect(commandName(parsed.spec.path)).toBe("recordings.list");
  });

  it("refuses a bare `record`", () => {
    // Deliberately not completed. Every other bare word is a question; this one
    // would start capturing something nobody named.
    expect(parse(["record"]).kind).toBe("usage");
  });

  it("reads a required argument, typed", () => {
    const parsed = parse(["record", "window", "4221"]);
    expect(parsed.kind).toBe("command");
    if (parsed.kind !== "command") return;
    expect(parsed.params["id"]).toBe(4221);
  });

  it("refuses a missing required argument with the flag's own summary", () => {
    const parsed = parse(["render"]);
    expect(parsed.kind).toBe("usage");
    if (parsed.kind !== "usage") return;
    expect(parsed.message).toContain("<id>");
  });

  it("refuses an argument that should be a number", () => {
    const parsed = parse(["record", "window", "chrome"]);
    expect(parsed.kind).toBe("usage");
    if (parsed.kind !== "usage") return;
    expect(parsed.message).toContain("number");
  });

  it("accepts a flag's value either way round", () => {
    for (const argv of [
      ["render", "abc", "--out", "demo.mp4"],
      ["render", "abc", "--out=demo.mp4"],
    ]) {
      const parsed = parse(argv);
      expect(parsed.kind).toBe("command");
      if (parsed.kind !== "command") continue;
      expect(parsed.params["out"]).toBe("demo.mp4");
    }
  });

  it("treats a flag with an optional value as a switch when nothing follows", () => {
    // `--camera` is the default camera; `--camera "Studio Display"` names one.
    // Getting this wrong would swallow the next flag as a camera name.
    const parsed = parse(["record", "display", "--camera", "--microphone"]);
    expect(parsed.kind).toBe("command");
    if (parsed.kind !== "command") return;
    expect(parsed.params["camera"]).toBe(true);
    expect(parsed.params["microphone"]).toBe(true);
  });

  it("reads a named camera", () => {
    const parsed = parse(["record", "display", "--camera", "FaceTime HD Camera"]);
    expect(parsed.kind).toBe("command");
    if (parsed.kind !== "command") return;
    expect(parsed.params["camera"]).toBe("FaceTime HD Camera");
  });

  it("turns --no-x into x: false rather than a second field", () => {
    // `record stop --open` is a switch, so `--no-open` is how an agent says
    // the opposite without the app having to declare both. One field with two
    // values, never two fields that can contradict each other.
    const parsed = parse(["record", "stop", "--no-open"]);
    expect(parsed.kind).toBe("command");
    if (parsed.kind !== "command") return;
    expect(parsed.params["open"]).toBe(false);
    expect(parsed.params["noOpen"]).toBeUndefined();
  });

  it("answers `prequel windows` with the window list alone", () => {
    const parsed = parse(["windows"]);
    expect(parsed.kind).toBe("command");
    if (parsed.kind !== "command") return;
    expect(commandName(parsed.spec.path)).toBe("target.list");
    expect(parsed.params["windows"]).toBe(true);
  });

  it("names the flags a command does take when one is wrong", () => {
    const parsed = parse(["render", "abc", "--quality", "high"]);
    expect(parsed.kind).toBe("usage");
    if (parsed.kind !== "usage") return;
    expect(parsed.message).toContain("--quality");
    expect(parsed.message).toContain("--short-edge");
  });

  it("checks a flag against its choices", () => {
    const parsed = parse(["render", "abc", "--format", "webm"]);
    expect(parsed.kind).toBe("usage");
    if (parsed.kind !== "usage") return;
    expect(parsed.message).toContain("h264");
  });

  it("carries --json onto a usage failure", () => {
    // An agent that asked for JSON and got prose back has to parse prose to
    // learn it mistyped a flag.
    const parsed = parse(["--json", "render", "abc", "--format", "webm"]);
    expect(parsed.kind).toBe("usage");
    if (parsed.kind !== "usage") return;
    expect(parsed.json).toBe(true);
  });

  it("accepts --json anywhere", () => {
    for (const argv of [
      ["--json", "status"],
      ["status", "--json"],
    ]) {
      const parsed = parse(argv);
      expect(parsed.kind).toBe("command");
      if (parsed.kind !== "command") continue;
      expect(parsed.json).toBe(true);
    }
  });

  it("answers an empty command line with the guide", () => {
    expect(parse([]).kind).toBe("help");
    expect(parse(["--help"]).kind).toBe("help");
  });

  it("asks about one command with --help", () => {
    const parsed = parse(["record", "area", "--help"]);
    expect(parsed.kind).toBe("help");
    if (parsed.kind !== "help") return;
    expect(parsed.path).toEqual(["record", "area"]);
  });

  it("refuses extra positionals rather than ignoring them", () => {
    const parsed = parse(["recordings", "show", "one", "two"]);
    expect(parsed.kind).toBe("usage");
    if (parsed.kind !== "usage") return;
    expect(parsed.message).toContain("two");
  });
});

describe("region", () => {
  it("reads x,y,width,height", () => {
    expect(region("10,20,640,480")).toEqual({ x: 10, y: 20, width: 640, height: 480 });
  });

  it("refuses anything but four numbers", () => {
    for (const bad of ["10,20,640", "10,20,640,480,2", "a,b,c,d", ""]) {
      expect(region(bad), bad).toHaveProperty("error");
    }
  });

  it("refuses a rectangle with no area", () => {
    // Zero either way captures nothing, and the recording would be a file that
    // will not play rather than an error anybody could read.
    expect(region("0,0,0,100")).toHaveProperty("error");
    expect(region("0,0,100,-5")).toHaveProperty("error");
  });

  it("reads an area through the command line", () => {
    const parsed = parse(["record", "area", "0,0,1280,800"]);
    expect(parsed.kind).toBe("command");
    if (parsed.kind !== "command") return;
    expect(parsed.params["region"]).toEqual({ x: 0, y: 0, width: 1280, height: 800 });
  });
});

describe("the catalogue", () => {
  it("names every flag in kebab case", () => {
    // The wire speaks camel case and the command line speaks kebab. A flag
    // declared as `shortEdge` would be typed `--shortEdge` and arrive as
    // `shortEdge`, which works — and then somebody writes `--short-edge`,
    // which is what every other flag looks like, and is told it is unknown.
    for (const command of COMMANDS) {
      for (const flag of command.flags ?? []) {
        expect(flag.name, `${commandName(command.path)} --${flag.name}`).toBe(
          flag.name.toLowerCase(),
        );
      }
    }
  });

  it("has no two commands with the same name", () => {
    const names = COMMANDS.map((command) => commandName(command.path));
    expect(new Set(names).size).toBe(names.length);
  });

  it("puts required arguments before optional ones", () => {
    // Positionals are read in order, so an optional argument in front of a
    // required one can never be left out.
    for (const command of COMMANDS) {
      const args = command.args ?? [];
      const firstOptional = args.findIndex((arg) => !arg.required);
      if (firstOptional === -1) continue;
      expect(
        args.slice(firstOptional).every((arg) => !arg.required),
        commandName(command.path),
      ).toBe(true);
    }
  });

  it("parses every command in the catalogue", () => {
    // The guide is what an agent reads before it does anything. A command
    // listed there that the parser cannot resolve is a tool that documents
    // something it refuses to run.
    for (const command of COMMANDS) {
      const argv = [
        ...command.path,
        ...(command.args ?? [])
          .filter((arg) => arg.required)
          .map((arg) =>
            arg.kind === "number" ? "1" : arg.kind === "region" ? "0,0,100,100" : "x",
          ),
      ];

      const parsed = parse(argv);
      expect(parsed.kind, argv.join(" ")).toBe("command");
    }
  });
});

describe("camel", () => {
  it("turns a kebab flag into the field the app reads", () => {
    expect(camel("short-edge")).toBe("shortEdge");
    expect(camel("system-audio")).toBe("systemAudio");
    expect(camel("out")).toBe("out");
  });
});
