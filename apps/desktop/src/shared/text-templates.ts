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

export const DEFAULT_TEXT_TEMPLATE = TEXT_TEMPLATES[0]!;

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
