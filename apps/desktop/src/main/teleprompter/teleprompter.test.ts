/**
 * The controller is judged on what the island would see.
 *
 * Which is two things: the rare state it broadcasts, and the positions it
 * sends. The engines behind them are driven with fakes — a clock for
 * auto-scroll, a scripted recogniser for voice — so what is pinned is the
 * behaviour a reader notices: the words move when they should, stop when
 * paused, fall back to scrolling when there is nothing to listen with, and
 * keep their place when the script is edited under them.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PREFERENCES, type RecordingPreferences } from "../../shared/contract.js";
import type { ListenUpdate, Recorder } from "../recorder.js";
import { createFakeRecorder } from "../recorder.fake.js";
import type { TeleprompterKeys } from "../shortcuts.js";
import { Teleprompter } from "./index.js";
import { ScriptStore } from "./script.js";

const SCRATCH = mkdtempSync(join(tmpdir(), "prequel-prompter-"));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

vi.mock("electron", () => ({
  app: { getPath: () => SCRATCH },
}));

const SCRIPT = "Welcome to Prequel. Today we record a demo.\nIt sits in the notch.";

/** A listener whose updates the test feeds by hand. */
function scriptedRecorder(): {
  recorder: Recorder;
  hear: (update: ListenUpdate) => void;
  stops: number;
} {
  let onUpdate: ((error: Error | null, update: ListenUpdate) => void) | null = null;
  const handle = {
    stops: 0,
    recorder: {
      ...createFakeRecorder(),
      startListening: (_options, next) => {
        onUpdate = next;
        next(null, { stage: "listening" });
      },
      stopListening: () => {
        handle.stops += 1;
        onUpdate = null;
      },
    } as Recorder,
    hear: (update: ListenUpdate) => onUpdate?.(null, update),
  };
  return handle;
}

function make(preferences: Partial<RecordingPreferences> = {}, recorder?: Recorder) {
  let counter = 0;
  const island = {
    visible: false,
    shape: null as [string, string] | null,
    sent: [] as { position: number; lost: boolean }[],
    prepare: () => ({}) as never,
    show() {
      this.visible = true;
      return { height: 37, width: 200 };
    },
    hide() {
      this.visible = false;
    },
    get isVisible() {
      return this.visible;
    },
    setShape(size: string, width: string) {
      this.shape = [size, width];
    },
    browserWindow: () => ({
      webContents: {
        isDestroyed: () => false,
        send: (_channel: string, position: { position: number; lost: boolean }) =>
          island.sent.push(position),
      },
    }),
  };
  const script = {
    opened: 0,
    closed: 0,
    open: () => (script.opened += 1),
    close: () => (script.closed += 1),
  };
  const keys = {
    bound: null as TeleprompterKeys | null,
    bind: (k: TeleprompterKeys) => (keys.bound = k),
    unbind: () => (keys.bound = null),
  };
  const changes: string[] = [];
  const store = new ScriptStore(
    join(SCRATCH, `script-${String((counter += 1))}-${String(Date.now())}.json`),
  );
  store.set(SCRIPT);
  const prefs = { ...DEFAULT_PREFERENCES, teleprompter: true, ...preferences };

  const prompter = new Teleprompter({
    island: island as never,
    script: script as never,
    store,
    preferences: () => prefs,
    onChange: (state) => changes.push(state.listening),
    keys,
    recorder: () => Promise.resolve(recorder ?? createFakeRecorder()),
  });

  return { prompter, island, script, keys, changes, prefs };
}

/** Lets the engine's promise chain settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe("showing", () => {
  it("follows the panel and the preference, binding the keys only while up", () => {
    const { prompter, island, keys, prefs } = make({ teleprompterMode: "manual" });

    prompter.sync(false);
    expect(island.visible).toBe(false);

    prompter.sync(true);
    expect(island.visible).toBe(true);
    expect(keys.bound).not.toBeNull();
    expect(island.shape).toEqual([prefs.teleprompterSize, prefs.teleprompterWidth]);

    prompter.sync(false);
    expect(island.visible).toBe(false);
    expect(keys.bound).toBeNull();
  });

  it("stays hidden when the preference is off, whatever the panel does", () => {
    const { prompter, island } = make({ teleprompter: false });
    prompter.sync(true);
    expect(island.visible).toBe(false);
  });

  it("closes the script window when a take begins — it would be in the frame", () => {
    const { prompter, script } = make();
    prompter.recordingStarted();
    expect(script.closed).toBe(1);
  });
});

describe("auto-scroll", () => {
  it("advances a word per tick at the chosen speed, and holds while paused", async () => {
    const { prompter, island } = make({ teleprompterMode: "timed", teleprompterSpeed: 120 });
    prompter.sync(true);

    await vi.advanceTimersByTimeAsync(500 * 3 + 10);
    expect(island.sent.at(-1)?.position).toBe(3);

    prompter.togglePause();
    await vi.advanceTimersByTimeAsync(2000);
    expect(island.sent.at(-1)?.position).toBe(3);

    prompter.togglePause();
    await vi.advanceTimersByTimeAsync(510);
    expect(island.sent.at(-1)?.position).toBe(4);
  });

  it("changes pace when the speed does", async () => {
    const prefs = { teleprompterMode: "timed" as const, teleprompterSpeed: 60 };
    const { prompter, island, prefs: live } = make(prefs);
    prompter.sync(true);

    await vi.advanceTimersByTimeAsync(1010);
    expect(island.sent.at(-1)?.position).toBe(1);

    live.teleprompterSpeed = 300;
    prompter.sync(true);
    await vi.advanceTimersByTimeAsync(1010);
    expect(island.sent.at(-1)?.position).toBe(6);
  });

  it("does not try the microphone again on a size change once it has failed", async () => {
    const { prompter, changes, prefs } = make({ teleprompterMode: "voice" });
    prompter.sync(true);
    await settle();
    expect(changes.filter((c) => c === "starting")).toHaveLength(1);

    prefs.teleprompterSize = "large";
    prompter.sync(true);
    await settle();
    expect(changes.filter((c) => c === "starting")).toHaveLength(1);

    // A fresh show is a fresh try: the model may have been installed since.
    prompter.sync(false);
    prompter.sync(true);
    await settle();
    expect(changes.filter((c) => c === "starting")).toHaveLength(2);
  });

  it("stops at the end of the script", async () => {
    const { prompter, island } = make({ teleprompterMode: "timed", teleprompterSpeed: 300 });
    prompter.sync(true);

    await vi.advanceTimersByTimeAsync(200 * 40);
    expect(island.sent.at(-1)?.position).toBe(13);
  });
});

describe("voice follow", () => {
  it("moves the position as the recogniser hears the script", async () => {
    const heard = scriptedRecorder();
    const { prompter, island, changes } = make({ teleprompterMode: "voice" }, heard.recorder);
    prompter.sync(true);
    await settle();
    expect(changes.at(-1)).toBe("on");

    heard.hear({ stage: "partial", text: "welcome to", session: 0 });
    heard.hear({ stage: "partial", text: "welcome to prequel today", session: 0 });
    expect(island.sent.at(-1)?.position).toBe(4);

    prompter.sync(false);
    expect(heard.stops).toBe(1);
  });

  it("falls back to auto-scroll when there is no model, and says so", async () => {
    // The fake recorder fails every listen with NO_LOCAL_MODEL.
    const { prompter, island, changes } = make({
      teleprompterMode: "voice",
      teleprompterSpeed: 300,
    });
    prompter.sync(true);
    await settle();

    expect(changes.at(-1)).toBe("unavailable");
    await vi.advanceTimersByTimeAsync(450);
    expect(island.sent.at(-1)?.position).toBe(2);
  });
});

describe("moving by hand", () => {
  it("steps by sentence, goes to the top, and lands on a word", () => {
    const { prompter, island, keys } = make({ teleprompterMode: "manual" });
    prompter.sync(true);

    keys.bound!.onStep(1);
    expect(island.sent.at(-1)?.position).toBe(3);
    keys.bound!.onStep(1);
    expect(island.sent.at(-1)?.position).toBe(8);
    keys.bound!.onTop();
    expect(island.sent.at(-1)?.position).toBe(0);
    prompter.jump({ to: 5 });
    expect(island.sent.at(-1)?.position).toBe(5);
  });

  it("goes back to the top when a take ends", () => {
    const { prompter, island } = make({ teleprompterMode: "manual" });
    prompter.jump({ to: 5 });
    prompter.recordingStopped();
    expect(island.sent.at(-1)?.position).toBe(0);
  });
});

describe("the script", () => {
  it("keeps the reader's place when edited, clamped to what is left", () => {
    const { prompter, island } = make({ teleprompterMode: "manual" });
    prompter.jump({ to: 5 });

    prompter.setScript(SCRIPT + "\nAnd one more line.");
    expect(island.sent.at(-1)?.position).toBe(5);

    prompter.setScript("Two words.");
    expect(island.sent.at(-1)?.position).toBe(2);
  });

  it("is remembered on disk", () => {
    const file = join(SCRATCH, "remembered.json");
    new ScriptStore(file).set("Hello there.");
    expect(new ScriptStore(file).get()).toBe("Hello there.");
    expect(new ScriptStore(join(SCRATCH, "missing.json")).get()).toBe("");
  });
});
