/**
 * The face a font list puts on the picture while the pointer is on its row.
 *
 * What is asserted here is what makes the preview free: that nothing is copied
 * when nothing is hovered, that the substitution reaches every clip whose
 * captions would draw in the hovered face and no clip that would not, and that
 * a text's other fields and the other texts keep their identity — because
 * everything downstream re-rasterises on an identity miss, and a copy made
 * needlessly is a recording's worth of bitmaps written to disk.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_TEXT_LENGTH,
  DEFAULT_TEXT_STYLE,
  newProject,
  resolveSettings,
  type Project,
  type TextField,
  type TextSlice,
  type TextTrack,
} from "../../../shared/project";
import { withFontPreview } from "./fontPreview";

const S = 1_000_000_000;

function project(): Project {
  return newProject("2026-08-11T12-00-00", 10 * S);
}

function row(id: string, slices: TextSlice[]): TextTrack {
  return { id, slices };
}

function text(id: string, fields: number): TextSlice {
  return {
    id,
    at: 0,
    length: DEFAULT_TEXT_LENGTH,
    fields: Array.from({ length: fields }, (_, index): TextField => ({
      role: index === 0 ? "heading" : "subheading",
      text: `field ${String(index)}`,
      style: { ...DEFAULT_TEXT_STYLE },
    })),
    templateId: "plain",
    x: 0.5,
    y: 0.5,
    width: 0.6,
    align: "center",
    gap: 0.2,
    enter: "none",
    exit: "none",
    enterMs: 0,
    exitMs: 0,
  };
}

describe("withFontPreview", () => {
  it("hands back the project itself when nothing is hovered", () => {
    const before = project();
    expect(withFontPreview(before, null)).toBe(before);
  });

  it("sets the hovered face as the caption default", () => {
    const after = withFontPreview(project(), { what: "captions", font: "avenir" });
    expect(after.defaults.captions.captionFont).toBe("avenir");
  });

  it("leaves the project it was given alone", () => {
    const before = project();
    const font = before.defaults.captions.captionFont;
    withFontPreview(before, { what: "captions", font: "avenir" });
    expect(before.defaults.captions.captionFont).toBe(font);
  });

  it("follows a clip that sets its own caption font", () => {
    const before = project();
    const slice = before.tracks[0]!.slices[0]!;
    slice.overrides = { captions: { captionFont: "futura" } };

    const after = withFontPreview(before, { what: "captions", font: "avenir" });
    const settings = resolveSettings(after.defaults, after.tracks[0]!.slices[0]!.overrides);
    expect(settings.captions.captionFont).toBe("avenir");
  });

  it("does not give a clip a caption font it did not have", () => {
    // One look per distinct `captionLook`, and `useCaptions` rasterises every
    // cue in the recording per look — so an override added here would cost a
    // full set of bitmaps per clip for every row the pointer crosses.
    const before = project();
    before.tracks[0]!.slices[0]!.overrides = { captions: { captionSize: 0.1 } };

    const after = withFontPreview(before, { what: "captions", font: "avenir" });
    expect("captionFont" in (after.tracks[0]!.slices[0]!.overrides.captions ?? {})).toBe(false);
  });

  it("sets the hovered face and its weight on the one field hovered", () => {
    const before = { ...project(), texts: [row("r0", [text("t1", 2)])] };

    const after = withFontPreview(before, {
      what: "text",
      textId: "t1",
      field: 1,
      font: "lora",
      weight: 500,
    });
    const fields = after.texts[0]!.slices[0]!.fields;
    expect(fields[1]!.style.font).toBe("lora");
    expect(fields[1]!.style.weight).toBe(500);
    expect(fields[0]!.style.font).toBe(DEFAULT_TEXT_STYLE.font);
  });

  it("keeps every other text and row by identity", () => {
    const before = {
      ...project(),
      texts: [row("r0", [text("t1", 1)]), row("r1", [text("t2", 1)])],
    };
    const untouchedRow = before.texts[1];
    const untouchedText = before.texts[0]!.slices[0];

    const after = withFontPreview(before, {
      what: "text",
      textId: "t2",
      field: 0,
      font: "lora",
      weight: 400,
    });
    expect(after.texts[1]).not.toBe(untouchedRow);
    expect(after.texts[0]).toBe(before.texts[0]);
    expect(after.texts[0]!.slices[0]).toBe(untouchedText);
  });

  it("changes nothing when the hovered text is gone", () => {
    // A text deleted while its list was open. The preview is held beside the
    // project, so it can outlive what it points at by a frame.
    const before = project();
    const after = withFontPreview(before, {
      what: "text",
      textId: "missing",
      field: 0,
      font: "lora",
      weight: 400,
    });
    for (const [index, row] of after.texts.entries()) expect(row).toBe(before.texts[index]);
  });
});
