import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES } from "../shared/contract.js";
import { Preferences } from "./preferences.js";

const SCRATCH = mkdtempSync(join(tmpdir(), "prequel-prefs-"));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

let counter = 0;
const freshFile = () => join(SCRATCH, `prefs-${counter++}.json`);

describe("Preferences", () => {
  it("starts from the defaults when no file exists", () => {
    expect(new Preferences(freshFile()).get()).toEqual(DEFAULT_PREFERENCES);
  });

  it("persists across instances, which is the whole point of preselection", () => {
    const file = freshFile();
    new Preferences(file).update({ mode: "area", cameraId: "cam-1", micId: "mic-9" });

    const reloaded = new Preferences(file).get();
    expect(reloaded.mode).toBe("area");
    expect(reloaded.cameraId).toBe("cam-1");
    expect(reloaded.micId).toBe("mic-9");
  });

  it("merges patches rather than replacing everything", () => {
    const prefs = new Preferences(freshFile());
    prefs.update({ mode: "window", cameraId: "cam-1" });
    prefs.update({ micId: "mic-2" });

    expect(prefs.get()).toMatchObject({ mode: "window", cameraId: "cam-1", micId: "mic-2" });
  });

  it("treats null as 'device off' rather than dropping the key", () => {
    const prefs = new Preferences(freshFile());
    prefs.update({ cameraId: "cam-1" });
    prefs.update({ cameraId: null });

    expect(prefs.get().cameraId).toBeNull();
  });

  it("falls back to defaults when the file is corrupt", () => {
    // Preferences outlive the code that wrote them; a bad file must not stop
    // the app from opening.
    const file = freshFile();
    writeFileSync(file, "{ not json");

    expect(new Preferences(file).get()).toEqual(DEFAULT_PREFERENCES);
  });

  it("rejects a mode that no longer exists", () => {
    const file = freshFile();
    writeFileSync(file, JSON.stringify({ mode: "hologram", cameraId: "cam-1" }));

    const prefs = new Preferences(file).get();
    expect(prefs.mode).toBe(DEFAULT_PREFERENCES.mode);
    // Valid neighbouring values must survive the coercion.
    expect(prefs.cameraId).toBe("cam-1");
  });

  it("ignores values of the wrong type", () => {
    const file = freshFile();
    writeFileSync(file, JSON.stringify({ cameraId: 42, micId: { id: "x" } }));

    const prefs = new Preferences(file).get();
    expect(prefs.cameraId).toBeNull();
    expect(prefs.micId).toBeNull();
  });

  it("stores the shortcut in one spelling, whatever was written", () => {
    // Two spellings of the same chord must not compare unequal, or rebinding
    // to the shortcut you already have reads as a conflict.
    const file = freshFile();
    writeFileSync(file, JSON.stringify({ toggleShortcut: "Command+Shift+R" }));

    expect(new Preferences(file).get().toggleShortcut).toBe("Shift+Cmd+R");
  });

  it("falls back when the stored shortcut is not a chord", () => {
    const file = freshFile();
    writeFileSync(file, JSON.stringify({ toggleShortcut: "Cmd+Shift" }));

    expect(new Preferences(file).get().toggleShortcut).toBe(DEFAULT_PREFERENCES.toggleShortcut);
  });

  it("clamps a countdown that would never end", () => {
    const file = freshFile();
    writeFileSync(file, JSON.stringify({ countdown: 9000 }));
    expect(new Preferences(file).get().countdown).toBe(10);

    const negative = freshFile();
    writeFileSync(negative, JSON.stringify({ countdown: -4 }));
    expect(new Preferences(negative).get().countdown).toBe(0);
  });

  it("rejects an afterRecording that no longer exists", () => {
    const file = freshFile();
    writeFileSync(file, JSON.stringify({ afterRecording: "email-it-to-mum" }));

    expect(new Preferences(file).get().afterRecording).toBe(DEFAULT_PREFERENCES.afterRecording);
  });

  it("keeps every new key across a write, rather than dropping it", () => {
    // `sanitise` is exhaustive by hand, so a key added to the type without a
    // line there saves fine and is gone on the next write. This is that check.
    const file = freshFile();
    const written = new Preferences(file);
    written.update({ countdown: 5, saveDirectory: "/tmp/takes", afterRecording: "finder" });
    written.update({ micId: "mic-2" });

    const reread = new Preferences(file).get();
    expect(reread.countdown).toBe(5);
    expect(reread.saveDirectory).toBe("/tmp/takes");
    expect(reread.afterRecording).toBe("finder");
  });
});
