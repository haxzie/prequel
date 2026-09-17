/**
 * The panels a selected text takes the inspector over with.
 *
 * Three tabs, split the way a zoom's are: what it says and how it is set
 * (the frequent controls), how it moves, and where it sits. Every control
 * funnels through the two callbacks so the reducer is the only thing that
 * writes a text.
 *
 * In a file of its own rather than in `Inspector.tsx`, which is already the
 * longest file in the editor. Nothing here reads the clip machinery — a text
 * has no overrides, no defaults and no apply-to-all — so there is nothing
 * for it to share with the panels there.
 */
import { useEffect, useRef, useState } from "react";

import type { Size } from "../../../shared/layout";
import type { TextAlign, TextField, TextRole, TextSlice, TextStyle } from "../../../shared/project";
import { TEXT_MOTIONS, type TextMotionId } from "../../../shared/text-motion";
import { TEXT_TEMPLATES } from "../../../shared/text-templates";
import { cn } from "../lib/cn";
import { CameraMap } from "./controls/CameraMap";
import { Field, Section } from "./controls/Field";
import { FontPicker } from "./controls/FontPicker";
import { ColorField, CONTROL_H, Dropdown, Segmented, Slider, ToggleField } from "./controls/inputs";
import {
  BlurIcon,
  BorderIcon,
  ClockIcon,
  DropIcon,
  FadeIcon,
  FromLeftIcon,
  FromRightIcon,
  NoMotionIcon,
  PopIcon,
  RiseIcon,
  TypewriterIcon,
  WordsIcon,
  CornerRadiusIcon,
  FontIcon,
  LinesIcon,
  BackdropIcon,
  MoveIcon,
  OffsetIcon,
  PaddingIcon,
  PlaceIcon,
  ShadowIcon,
  ShadowOffsetIcon,
  SizeIcon,
  TextIcon,
  TypingIcon,
  WideIcon,
} from "./icons";
import type { Fonts } from "./useFonts";

export type TextTabId = "style" | "text" | "position";

/**
 * Style first: a freshly added text is a template and a motion before it is
 * words, and the tab that picks those is the one to land on.
 */
export const TEXT_TABS: { id: TextTabId; label: string; Icon: () => React.ReactElement }[] = [
  { id: "style", label: "Style", Icon: BackdropIcon },
  { id: "text", label: "Text", Icon: TextIcon },
  { id: "position", label: "Position", Icon: MoveIcon },
];

const ROLE_LABEL: Record<TextRole, string> = {
  overline: "Overline",
  heading: "Heading",
  subheading: "Subheading",
  body: "Body",
};

/** The weights offered where the family says nothing, which is every macOS face. */
const ALL_WEIGHTS = [300, 400, 500, 600, 700, 800, 900];

/** Everything about a text but its identity, its span and its fields. */
export type TextPatch = Partial<Omit<TextSlice, "id" | "source" | "fields">>;

export interface TextPanelProps {
  text: TextSlice;
  frame: Size;
  fonts: Fonts;
  onChange: (patch: TextPatch) => void;
  onField: (index: number, patch: { text?: string; style?: Partial<TextStyle> }) => void;
  onTemplate: (templateId: string) => void;
  /** A new run of typing is starting, so it is its own undo step. */
  onBeginEdit: () => void;
}

/**
 * What the text says, field by field, and how each field is set.
 *
 * One field at a time, picked from a row at the top: a lower third's name
 * and its title are set differently, and every control below answers for
 * the one that is picked. The row is not shown for a text with one field.
 */
export function TextContentPanel({ text, fonts, onField, onBeginEdit }: TextPanelProps) {
  const [index, setIndex] = useState(0);
  // A template with fewer fields than the one before leaves the pick past the
  // end; the first field is the one to land on.
  useEffect(() => {
    if (index >= text.fields.length) setIndex(0);
  }, [index, text.fields.length]);

  const field: TextField | undefined = text.fields[index];
  if (!field) return null;
  const { style } = field;
  const set = (patch: Partial<TextStyle>) => onField(index, { style: patch });

  const variants = fonts.variants(style.font);
  const weights = variants
    ? [...new Set(variants.map((variant) => variant.weight))].sort((a, b) => a - b)
    : ALL_WEIGHTS;
  const hasItalic = variants ? variants.some((variant) => variant.italic) : true;

  return (
    <>
      <Section>
        {text.fields.length > 1 && (
          <Segmented
            value={String(index)}
            options={text.fields.map((entry, nth) => ({
              value: String(nth),
              label: ROLE_LABEL[entry.role],
            }))}
            onChange={(value) => setIndex(Number(value))}
          />
        )}

        <Words
          value={field.text}
          onChange={(value) => onField(index, { text: value })}
          onBeginEdit={onBeginEdit}
        />
      </Section>

      <Section title="Type">
        <Field icon={<FontIcon />} label="Font">
          <FontPicker
            value={style.font}
            fonts={fonts}
            onChange={(font) => {
              // Landed on a weight the family has, or the engine fakes one
              // until the real bold arrives and the picture changes under
              // the hand that chose it.
              const offered = fonts.variants(font);
              const weight = offered
                ? nearest([...new Set(offered.map((variant) => variant.weight))], style.weight)
                : style.weight;
              set({ font, weight });
            }}
          />
        </Field>

        <Field icon={<TypingIcon />} label="Weight">
          {/* Each row set in its own weight, in the chosen face — the list
              is a sample, like the font list above it. */}
          <Dropdown
            value={String(nearest(weights, style.weight))}
            options={weights.map((weight) => ({
              value: String(weight),
              label: `${weightLabel(weight)} · ${String(weight)}`,
              style: { fontWeight: weight, fontFamily: fonts.stack(style.font) },
            }))}
            onChange={(value) => set({ weight: Number(value) })}
          />
        </Field>

        <ToggleField
          icon={<TextIcon />}
          label="Italic"
          value={style.italic}
          disabled={!hasItalic}
          title={hasItalic ? undefined : "This family has no italic"}
          onChange={(italic) => set({ italic })}
        />

        <ToggleField
          icon={<TextIcon />}
          label="Capitals"
          value={style.caps}
          onChange={(caps) => set({ caps })}
        />

        <Slider
          icon={<SizeIcon />}
          label="Size"
          value={style.size}
          min={0.01}
          max={0.3}
          step={0.001}
          format={(value) => `${(value * 100).toFixed(1)}%`}
          onChange={(size) => set({ size })}
        />

        <Slider
          icon={<OffsetIcon />}
          label="Tracking"
          value={style.tracking}
          min={-0.1}
          max={0.5}
          step={0.005}
          format={(value) => `${(value * 100).toFixed(0)}%`}
          onChange={(tracking) => set({ tracking })}
        />

        <Slider
          icon={<LinesIcon />}
          label="Line height"
          value={style.lineHeight}
          min={0.8}
          max={2.5}
          step={0.05}
          format={(value) => value.toFixed(2)}
          onChange={(lineHeight) => set({ lineHeight })}
        />

        <ColorField
          icon={<FontIcon />}
          label="Colour"
          value={style.color}
          onChange={(color) => set({ color })}
        />
      </Section>

      <Section title="Outline">
        <Slider
          icon={<BorderIcon />}
          label="Width"
          value={style.strokeWidth}
          min={0}
          max={0.2}
          step={0.005}
          format={(value) => (value === 0 ? "None" : `${(value * 100).toFixed(1)}%`)}
          onChange={(strokeWidth) => set({ strokeWidth })}
        />
        <ColorField
          icon={<BorderIcon />}
          label="Outline colour"
          disabled={style.strokeWidth === 0}
          value={style.strokeColor}
          onChange={(strokeColor) => set({ strokeColor })}
        />
      </Section>

      <Section title="Shadow">
        <Slider
          icon={<ShadowIcon />}
          label="Blur"
          value={style.shadowBlur}
          min={0}
          max={0.5}
          step={0.01}
          format={(value) => (value === 0 ? "None" : `${(value * 100).toFixed(0)}%`)}
          onChange={(shadowBlur) => set({ shadowBlur })}
        />
        <Slider
          icon={<ShadowOffsetIcon />}
          label="Drop"
          value={style.shadowDy}
          min={-0.3}
          max={0.3}
          step={0.01}
          disabled={style.shadowBlur === 0}
          format={(value) => `${(value * 100).toFixed(0)}%`}
          onChange={(shadowDy) => set({ shadowDy })}
        />
        <ColorField
          icon={<ShadowIcon />}
          label="Shadow colour"
          disabled={style.shadowBlur === 0}
          value={style.shadowColor}
          onChange={(shadowColor) => set({ shadowColor })}
        />
      </Section>

      <Section title="Plate">
        <ToggleField
          icon={<WideIcon />}
          label="Plate behind the text"
          value={style.plateColor !== null}
          // Back to a readable default rather than to whatever was there
          // before: the colour is cleared when the plate is switched off, so
          // there is nothing to put back.
          onChange={(on) => set({ plateColor: on ? "rgba(0, 0, 0, 0.7)" : null })}
        />
        <ColorField
          icon={<WideIcon />}
          label="Plate colour"
          disabled={style.plateColor === null}
          value={style.plateColor ?? "#000000"}
          onChange={(plateColor) => set({ plateColor })}
        />
        <Slider
          icon={<CornerRadiusIcon />}
          label="Corners"
          value={style.plateRadius}
          min={0}
          max={2}
          step={0.05}
          disabled={style.plateColor === null}
          format={(value) => `${(value * 100).toFixed(0)}%`}
          onChange={(plateRadius) => set({ plateRadius })}
        />
        <Slider
          icon={<PaddingIcon />}
          label="Padding"
          value={style.platePadX}
          min={0}
          max={2}
          step={0.05}
          disabled={style.plateColor === null}
          format={(value) => `${(value * 100).toFixed(0)}%`}
          // One slider for both: a plate's padding is one number to anyone
          // looking at it, and the vertical is kept at half the horizontal,
          // which is what every template ships with.
          onChange={(platePadX) => set({ platePadX, platePadY: platePadX / 2 })}
        />
      </Section>
    </>
  );
}

/**
 * The words of one field.
 *
 * A textarea, so a title can carry a typed line break. Edits go out on
 * every keystroke — the preview redraws after the settle — and the run of
 * them is one undo step until the typing pauses, the way the transcript's
 * corrections are.
 */
function Words({
  value,
  onChange,
  onBeginEdit,
}: {
  value: string;
  onChange: (value: string) => void;
  onBeginEdit: () => void;
}) {
  const pause = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (pause.current !== null) window.clearTimeout(pause.current);
    },
    [],
  );

  return (
    <textarea
      value={value}
      rows={3}
      spellCheck
      className={cn(
        "w-full resize-none rounded-md bg-white/5 px-2.5 py-2 text-[13px] leading-snug text-editor-fg outline-none",
        "placeholder:text-editor-muted focus:bg-white/10",
      )}
      placeholder="Type something"
      onChange={(event) => {
        onChange(event.target.value);
        // A pause in the typing ends the undo step, so the next run is its
        // own. The same second the captions editor gives.
        if (pause.current !== null) window.clearTimeout(pause.current);
        pause.current = window.setTimeout(() => {
          pause.current = null;
          onBeginEdit();
        }, 1000);
      }}
    />
  );
}

/**
 * Which template the text wears, and how it arrives and leaves.
 *
 * The gallery and the motions on one tab: picking a template is mostly
 * picking a motion and a look together, and it is the first thing anyone
 * changes on a freshly added text.
 */
export function TextStylePanel({ text, onChange, onTemplate }: TextPanelProps) {
  const motions = TEXT_MOTIONS.map((motion) => ({ value: motion.id, label: motion.label }));

  return (
    <>
      <Section title="Template">
        <div className="grid grid-cols-2 gap-2">
          {TEXT_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              aria-pressed={template.id === text.templateId}
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors",
                template.id === text.templateId
                  ? "border-selected bg-white/10"
                  : "border-editor-line bg-white/3 hover:bg-white/6",
              )}
              onClick={() => onTemplate(template.id)}
            >
              {/* A picture of the look drawn in CSS rather than a rendered
                  frame: the fields' own size, weight and colour, at a scale
                  that fits a card. */}
              <span className="flex h-12 w-full flex-col items-center justify-center gap-0.5 overflow-hidden rounded bg-black/40 px-1">
                {template.fields.slice(0, 2).map((field, index) => (
                  <span
                    key={index}
                    className="max-w-full truncate leading-none"
                    style={{
                      fontSize: `${String(Math.max(7, Math.min(16, field.style.size * 160)))}px`,
                      fontWeight: field.style.weight,
                      fontStyle: field.style.italic ? "italic" : "normal",
                      color: field.style.color,
                      textTransform: field.style.caps ? "uppercase" : "none",
                      letterSpacing: `${String(field.style.tracking)}em`,
                      background: field.style.plateColor ?? "transparent",
                      borderRadius: field.style.plateColor ? "3px" : 0,
                      padding: field.style.plateColor ? "1px 4px" : 0,
                    }}
                  >
                    {field.text}
                  </span>
                ))}
              </span>
              <span className="text-[11px] text-editor-fg">{template.label}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Enter" id="enter">
        <MotionPicker
          value={text.enter}
          options={motions}
          onChange={(enter) => onChange({ enter })}
        />
        <Slider
          icon={<ClockIcon />}
          label="Duration"
          value={text.enterMs}
          min={0}
          max={3000}
          step={50}
          disabled={text.enter === "none"}
          format={(value) => `${(value / 1000).toFixed(2)}s`}
          onChange={(enterMs) => onChange({ enterMs })}
        />
      </Section>

      <Section title="Exit">
        <MotionPicker value={text.exit} options={motions} onChange={(exit) => onChange({ exit })} />
        <Slider
          icon={<ClockIcon />}
          label="Duration"
          value={text.exitMs}
          min={0}
          max={3000}
          step={50}
          disabled={text.exit === "none"}
          format={(value) => `${(value / 1000).toFixed(2)}s`}
          onChange={(exitMs) => onChange({ exitMs })}
        />
      </Section>
    </>
  );
}

/** The motions as a grid of buttons: ten is too many for a segmented row. */
/**
 * A glyph for each motion, so the grid reads at a glance. Kept beside the
 * picker rather than on the motion itself: the list of motions is shared
 * with the plan and knows nothing about SVG.
 */
const MOTION_ICONS: Record<TextMotionId, () => React.ReactElement> = {
  none: NoMotionIcon,
  fade: FadeIcon,
  rise: RiseIcon,
  drop: DropIcon,
  fromLeft: FromLeftIcon,
  fromRight: FromRightIcon,
  pop: PopIcon,
  blur: BlurIcon,
  typewriter: TypewriterIcon,
  words: WordsIcon,
};

function MotionPicker({
  value,
  options,
  onChange,
}: {
  value: TextMotionId;
  options: { value: TextMotionId; label: string }[];
  onChange: (value: TextMotionId) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1" role="radiogroup">
      {options.map((option) => {
        const Icon = MOTION_ICONS[option.value];
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 text-left text-xs transition-colors [&_svg]:size-3.5 [&_svg]:flex-none",
              CONTROL_H,
              option.value === value
                ? "bg-white/12 text-editor-fg"
                : "bg-white/5 text-editor-muted hover:bg-white/8 hover:text-editor-fg",
            )}
            onClick={() => onChange(option.value)}
          >
            <Icon />
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Where the block sits, how wide it may run, and how its lines align. */
export function TextPositionPanel({ text, frame, onChange }: TextPanelProps) {
  return (
    <Section>
      <Field icon={<PlaceIcon />} label="Place">
        <CameraMap
          frame={frame}
          shape="rounded"
          point
          size={text.width}
          aspect={frame.width / frame.height}
          radius="5px"
          x={text.x}
          y={text.y}
          onChange={(x, y) => onChange({ x, y })}
        />
      </Field>

      <Slider
        icon={<WideIcon />}
        label="Width"
        value={text.width}
        min={0.1}
        max={1}
        step={0.01}
        format={(value) => `${(value * 100).toFixed(0)}%`}
        onChange={(width) => onChange({ width })}
      />

      <Field icon={<LinesIcon />} label="Align">
        <Segmented<TextAlign>
          value={text.align}
          options={[
            { value: "left", label: "Left" },
            { value: "center", label: "Centre" },
            { value: "right", label: "Right" },
          ]}
          onChange={(align) => onChange({ align })}
        />
      </Field>

      {text.fields.length > 1 && (
        <Slider
          icon={<PaddingIcon />}
          label="Gap"
          value={text.gap}
          min={0}
          max={0.2}
          step={0.005}
          format={(value) => `${(value * 100).toFixed(1)}%`}
          onChange={(gap) => onChange({ gap })}
        />
      )}
    </Section>
  );
}

function nearest(weights: number[], want: number): number {
  return weights.reduce(
    (best, weight) => (Math.abs(weight - want) < Math.abs(best - want) ? weight : best),
    weights[0] ?? want,
  );
}

function weightLabel(weight: number): string {
  const names: Record<number, string> = {
    100: "Thin",
    200: "Light",
    300: "Light",
    400: "Regular",
    500: "Medium",
    600: "Semibold",
    700: "Bold",
    800: "Extra",
    900: "Black",
  };
  return names[weight] ?? String(weight);
}
