/**
 * The looks a text starts from.
 *
 * A template is a whole text — its fields, where it sits, how it moves — and
 * nothing more: once dropped on the timeline the text is its own, and editing
 * the template later changes nothing already placed. The id is kept only so
 * the gallery can show which one it was.
 */
import {
  DEFAULT_TEXT_STYLE,
  type Ns,
  type TextAlign,
  type TextField,
  type TextSlice,
  type TextStyle,
} from "./project.js";
import type { TextMotionId } from "./text-motion.js";

export interface TextTemplate {
  id: string;
  label: string;
  /**
   * Offered on a screenshot rather than on a recording.
   *
   * The two sets do not overlap, and that is the point. Half the looks below
   * are animations — a line typed out a key at a time, words arriving one by
   * one — which is a statement about a span, and a still has one moment. The
   * rest are built for footage: a lower third sits where a speaker's name goes,
   * a callout points at something moving. What a screenshot wants instead is
   * the set a phone offers over a photo, which is the block underneath.
   *
   * Absent reads as false, so every template written before stills existed is
   * a recording's — which is what they all were.
   */
  still?: boolean;
  fields: TextField[];
  x: number;
  y: number;
  width: number;
  align: TextAlign;
  gap: number;
  enter: TextMotionId;
  exit: TextMotionId;
  enterMs: number;
  exitMs: number;
}

const style = (patch: Partial<TextStyle>): TextStyle => ({ ...DEFAULT_TEXT_STYLE, ...patch });

/** Text and colour that read on most footage; every template starts here. */
const SHADOW = { shadowColor: "rgba(0, 0, 0, 0.45)", shadowBlur: 0.12, shadowDy: 0.04 };

/**
 * What every screenshot look carries, whatever else it does.
 *
 * No entrance and no exit, and it is not a simplification: a still is drawn at
 * one moment, and that moment is the first of the text's span — so a look that
 * arrived would be drawn on the frame *before* it has arrived, which is a text
 * that is in the file and invisible on screen. The same reason the Animate tab
 * is not offered on one. See the note on the `addTextNear` action.
 */
const STILL_MOTION = {
  enter: "none" as TextMotionId,
  exit: "none" as TextMotionId,
  enterMs: 0,
  exitMs: 0,
};

/**
 * Where a screenshot's text lands, and how wide it may run.
 *
 * The middle, as every one of these does: a still has no speaker to sit under
 * and no action to keep clear of, and the text is dragged where it is wanted
 * the moment it appears. Shared so the five differ in their *look* and in
 * nothing else — which is what makes the grid a row of faces rather than a row
 * of arrangements.
 */
const STILL_PLACE = { x: 0.5, y: 0.5, width: 0.8, gap: 0.02 };

export const TEXT_TEMPLATES: TextTemplate[] = [
  {
    id: "title",
    label: "Title",
    fields: [{ role: "heading", text: "Your title here", style: style({ size: 0.09, ...SHADOW }) }],
    x: 0.5,
    y: 0.5,
    width: 0.8,
    align: "center",
    gap: 0.02,
    enter: "rise",
    exit: "fade",
    enterMs: 500,
    exitMs: 400,
  },
  {
    id: "title-subtitle",
    label: "Title & subtitle",
    fields: [
      { role: "heading", text: "Your title here", style: style({ size: 0.09, ...SHADOW }) },
      {
        role: "subheading",
        text: "A line underneath it",
        style: style({ size: 0.04, weight: 500, color: "rgba(255, 255, 255, 0.85)", ...SHADOW }),
      },
    ],
    x: 0.5,
    y: 0.5,
    width: 0.8,
    align: "center",
    gap: 0.02,
    enter: "rise",
    exit: "fade",
    enterMs: 500,
    exitMs: 400,
  },
  {
    id: "lower-third",
    label: "Lower third",
    fields: [
      {
        role: "heading",
        text: "Name Surname",
        style: style({
          size: 0.05,
          plateColor: "rgba(0, 0, 0, 0.7)",
          plateRadius: 0.2,
          platePadX: 0.7,
          platePadY: 0.35,
        }),
      },
      {
        role: "subheading",
        text: "What they do",
        style: style({
          size: 0.03,
          weight: 500,
          plateColor: "rgba(255, 255, 255, 0.92)",
          color: "#111111",
          plateRadius: 0.2,
          platePadX: 0.8,
          platePadY: 0.4,
        }),
      },
    ],
    x: 0.2,
    y: 0.85,
    width: 0.5,
    align: "left",
    gap: 0.008,
    enter: "fromLeft",
    exit: "fromLeft",
    enterMs: 450,
    exitMs: 350,
  },
  {
    id: "callout",
    label: "Callout",
    fields: [
      {
        role: "heading",
        text: "Look here",
        style: style({
          size: 0.045,
          weight: 600,
          color: "#111111",
          plateColor: "#ffffff",
          plateRadius: 2,
          platePadX: 0.9,
          platePadY: 0.45,
          ...SHADOW,
        }),
      },
    ],
    x: 0.5,
    y: 0.2,
    width: 0.6,
    align: "center",
    gap: 0.02,
    enter: "pop",
    exit: "pop",
    enterMs: 350,
    exitMs: 250,
  },
  {
    id: "section",
    label: "Section",
    fields: [
      {
        role: "overline",
        text: "01",
        style: style({ size: 0.03, weight: 500, caps: true, tracking: 0.2, ...SHADOW }),
      },
      { role: "heading", text: "Section name", style: style({ size: 0.08, ...SHADOW }) },
    ],
    x: 0.5,
    y: 0.5,
    width: 0.8,
    align: "center",
    gap: 0.015,
    enter: "blur",
    exit: "blur",
    enterMs: 600,
    exitMs: 400,
  },
  {
    id: "quote",
    label: "Quote",
    fields: [
      {
        role: "body",
        text: "“A line worth keeping.”",
        style: style({ font: "georgia", weight: 400, italic: true, size: 0.055, ...SHADOW }),
      },
      {
        role: "subheading",
        text: "— Who said it",
        style: style({ size: 0.03, weight: 500, color: "rgba(255, 255, 255, 0.8)", ...SHADOW }),
      },
    ],
    x: 0.5,
    y: 0.5,
    width: 0.7,
    align: "center",
    gap: 0.025,
    enter: "fade",
    exit: "fade",
    enterMs: 700,
    exitMs: 500,
  },
  {
    id: "typewriter",
    label: "Typewriter",
    fields: [
      {
        role: "heading",
        text: "Typed out, one key at a time",
        style: style({ font: "menlo", weight: 400, size: 0.045, ...SHADOW }),
      },
    ],
    x: 0.5,
    y: 0.5,
    width: 0.8,
    align: "left",
    gap: 0.02,
    enter: "typewriter",
    exit: "fade",
    enterMs: 1200,
    exitMs: 300,
  },
  {
    id: "kinetic",
    label: "Word by word",
    fields: [
      {
        role: "heading",
        text: "Every word makes an entrance",
        style: style({ size: 0.08, weight: 800, ...SHADOW }),
      },
    ],
    x: 0.5,
    y: 0.5,
    width: 0.8,
    align: "center",
    gap: 0.02,
    enter: "words",
    exit: "fade",
    enterMs: 900,
    exitMs: 400,
  },
];

/**
 * The looks a screenshot's text can wear.
 *
 * The set a phone's story composer offers, because that is the set people
 * already know: a word typed over a picture is a gesture with thirty years of
 * convention behind it, and five named faces anybody can recognise is worth
 * more here than a font picker and eleven sliders. Those are still in the Text
 * tab for anyone who wants them.
 *
 * Each is a face, a weight and one decision about how it survives whatever is
 * behind it — a shadow, a glow, or a block. Nothing else: a look that also
 * moved the text or changed its width would be a template, and these are
 * looks.
 */
const STILL_TEMPLATES: TextTemplate[] = [
  {
    id: "classic",
    label: "Classic",
    still: true,
    // The default, and the one that has to work on anything. A heavy grotesque
    // with a soft drop — the same answer a caption uses, for the same reason:
    // white on white is the failure every text over a picture risks, and a
    // shadow costs nothing when there is nothing to fall on.
    fields: [
      {
        role: "heading",
        text: "Your text here",
        style: style({ size: 0.07, weight: 700, ...SHADOW }),
      },
    ],
    align: "center",
    ...STILL_PLACE,
    ...STILL_MOTION,
  },
  {
    id: "modern",
    label: "Modern",
    still: true,
    // Light, spaced and in capitals. The letterform does the work rather than
    // the weight, which is what makes it read as a label on the picture rather
    // than as a headline over it.
    fields: [
      {
        role: "heading",
        text: "Your text here",
        style: style({
          font: "futura",
          size: 0.05,
          weight: 500,
          caps: true,
          tracking: 0.14,
          ...SHADOW,
        }),
      },
    ],
    align: "center",
    ...STILL_PLACE,
    ...STILL_MOTION,
  },
  {
    id: "neon",
    label: "Neon",
    still: true,
    // A tube, not a letter with a shadow under it. The glow is the text's own
    // colour at a wide blur and no offset — a drop shadow is light falling off
    // something opaque, and this is the thing itself emitting.
    fields: [
      {
        role: "heading",
        text: "Your text here",
        style: style({
          font: "avenir",
          size: 0.065,
          weight: 600,
          color: "#8be9ff",
          shadowColor: "#2bb6ff",
          shadowBlur: 0.5,
          shadowDy: 0,
        }),
      },
    ],
    align: "center",
    ...STILL_PLACE,
    ...STILL_MOTION,
  },
  {
    id: "typed",
    label: "Typewriter",
    still: true,
    // The face alone. The *animation* of that name belongs to a recording —
    // see `STILL_MOTION` — and what is left is the thing people actually reach
    // for it for: a monospace that reads as a note left on the picture.
    fields: [
      {
        role: "heading",
        text: "Your text here",
        style: style({ font: "menlo", size: 0.042, weight: 400, ...SHADOW }),
      },
    ],
    align: "left",
    ...STILL_PLACE,
    ...STILL_MOTION,
  },
  {
    id: "strong",
    label: "Strong",
    still: true,
    // Dark on a solid block, which is the one look here that does not depend
    // on what is behind it at all. For a screenshot busy enough that a shadow
    // is not enough — a dense table, a wall of code.
    fields: [
      {
        role: "heading",
        text: "Your text here",
        style: style({
          size: 0.055,
          weight: 900,
          caps: true,
          tracking: 0.01,
          color: "#121316",
          plateColor: "#ffffff",
          plateRadius: 0.14,
          platePadX: 0.3,
          platePadY: 0.16,
          shadowColor: "rgba(0, 0, 0, 0.35)",
          shadowBlur: 0.2,
          shadowDy: 0.05,
        }),
      },
    ],
    align: "center",
    ...STILL_PLACE,
    ...STILL_MOTION,
  },
];

TEXT_TEMPLATES.push(...STILL_TEMPLATES);

/** The looks offered in one editor or the other, never both. */
export function textTemplatesFor(still: boolean): TextTemplate[] {
  return TEXT_TEMPLATES.filter((template) => (template.still ?? false) === still);
}

export const DEFAULT_TEXT_TEMPLATE = TEXT_TEMPLATES[0]!;

/** What a screenshot's text is made from when nobody has said otherwise. */
export const DEFAULT_STILL_TEMPLATE = STILL_TEMPLATES[0]!;

export function textTemplate(id: string): TextTemplate {
  return TEXT_TEMPLATES.find((template) => template.id === id) ?? DEFAULT_TEXT_TEMPLATE;
}

/** A fresh text made from a template, over a span. Fields are copied, not
    shared, so editing one text never edits the template or another text. */
export function textFromTemplate(
  template: TextTemplate,
  id: string,
  /** Where it is pinned on the recording, and how long it shows for in the
      finished video — see `TextSlice`. */
  place: { at: Ns; length: Ns },
): TextSlice {
  return {
    id,
    at: place.at,
    length: place.length,
    templateId: template.id,
    fields: template.fields.map((field) => ({ ...field, style: { ...field.style } })),
    x: template.x,
    y: template.y,
    width: template.width,
    align: template.align,
    gap: template.gap,
    enter: template.enter,
    exit: template.exit,
    enterMs: template.enterMs,
    exitMs: template.exitMs,
  };
}

/**
 * The same text in another template's clothes.
 *
 * Everything but the words changes: a field keeps its text where the new
 * template has a field of the same role, in order, so switching from a title
 * to a section does not throw the title away. Position is kept too — the
 * text was put where it is on purpose.
 */
export function retemplated(text: TextSlice, template: TextTemplate): TextSlice {
  const spare = [...text.fields];
  const fields = template.fields.map((field) => {
    const index = spare.findIndex((candidate) => candidate.role === field.role);
    const kept = index >= 0 ? spare.splice(index, 1)[0] : undefined;
    return { ...field, style: { ...field.style }, text: kept?.text ?? field.text };
  });

  return {
    ...text,
    templateId: template.id,
    fields,
    width: template.width,
    align: template.align,
    gap: template.gap,
    enter: template.enter,
    exit: template.exit,
    enterMs: template.enterMs,
    exitMs: template.exitMs,
  };
}
