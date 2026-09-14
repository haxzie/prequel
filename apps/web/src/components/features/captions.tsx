import type { CSSProperties } from "react";
import { Laptop } from "lucide-react";

import {
  CLIP_H,
  Clip,
  ColorField,
  Filmstrip,
  Group,
  Segmented,
  Slider,
  Strip,
} from "@/components/editor-controls";
import { Chip, Frame, Screen, Slab } from "@/components/features/frame";
import { LinesIcon, OpacityIcon, SizeIcon } from "@/components/landing/editor-icons";
import { CAPTIONS_SCREEN } from "@/components/landing/stage";

/**
 * The pictures on the Captions cards.
 */

/** The six, by the id `CAPTION_STYLES` stores. */
type Look = "subtitle" | "blur" | "highlight" | "pop" | "outline" | "band";

/** The default `captionAccent`, which is what the spoken word is lit in. */
const ACCENT = "#ffd60a";

const WORDS = ["Then", "press", "share", "and", "send", "it"];

/**
 * One line of captions, in one of the six looks.
 *
 * The figures are `shared/captions.ts`'s, not numbers picked to look right
 * here: a 300 weight for the blurring look, 800 and capitals for Pop, a stroke
 * for Outline, a full-width plate at no radius for Band. A picture claiming
 * these are the looks has to show the looks.
 *
 * `spoken` is which word is being said. Only the two lit looks colour it; the
 * blurring look softens the word after it, which is the word arriving.
 */
function CaptionLine({
  look,
  spoken = 2,
  className = "",
}: {
  look: Look;
  spoken?: number;
  className?: string;
}) {
  const plate = look === "subtitle" || look === "highlight" || look === "band";
  const lit = look === "highlight" || look === "pop";

  return (
    <p
      className={[
        "flex items-baseline gap-[0.35em] leading-none text-white",
        look === "band" ? "w-full justify-center px-3 py-1.5" : "rounded-md px-2.5 py-1.5",
        plate ? "bg-[rgb(8_10_14/0.55)]" : "",
        look === "band" ? "rounded-none" : "",
        look === "blur" ? "text-[12px] font-light tracking-normal" : "",
        look === "subtitle" || look === "highlight" ? "text-[11px] font-medium tracking-tight" : "",
        look === "band" ? "text-[11px] font-medium tracking-wide" : "",
        look === "pop"
          ? "text-[13px] font-extrabold tracking-tight uppercase drop-shadow-[0_1px_2px_rgb(0_0_0_/_0.5)]"
          : "",
        look === "outline" ? "text-[12px] font-extrabold" : "",
        className,
      ].join(" ")}
      style={
        look === "outline"
          ? ({ WebkitTextStroke: "0.6px #000", paintOrder: "stroke fill" } as CSSProperties)
          : undefined
      }
    >
      {WORDS.map((word, i) => (
        <span
          key={word}
          className={[
            "inline-block",
            look === "blur" && i === spoken + 1 ? "blur-[1.5px] opacity-70" : "",
            look === "blur" && i > spoken + 1 ? "opacity-0" : "",
            lit && i === spoken ? "scale-110" : "",
          ].join(" ")}
          style={lit && i === spoken ? { color: ACCENT } : undefined}
        >
          {word}
        </span>
      ))}
    </p>
  );
}

/**
 * A caption on the recording, and where the words came from.
 *
 * The chip is the card's one claim that is not visible in the picture: the
 * transcript was made on the Mac the recording was made on. A laptop glyph
 * and three words, because the caption itself looks the same either way.
 */
export function OnDevice() {
  return (
    <Frame stage="peony">
      <Screen className="-top-6 -right-8 -bottom-8 left-8 lg:left-24" src={CAPTIONS_SCREEN}>
        <div className="absolute inset-x-0 bottom-11 flex justify-center px-4">
          <CaptionLine look="subtitle" />
        </div>
      </Screen>
      <Chip className="top-4 left-4">
        <Laptop />
        Transcribed on your Mac
      </Chip>
    </Frame>
  );
}

/**
 * The six looks, one above the other, each with its name beside it.
 *
 * A tall card, because six lines of caption at a legible size need the
 * height. On the wallpaper rather than on a recording, so the looks are
 * compared against one ground rather than against six different bits of
 * screenshot.
 */
export function SixLooks() {
  const looks: { look: Look; name: string }[] = [
    { look: "blur", name: "Blur in" },
    { look: "subtitle", name: "Subtitle" },
    { look: "highlight", name: "Highlight" },
    { look: "pop", name: "Pop" },
    { look: "outline", name: "Outline" },
    { look: "band", name: "Band" },
  ];

  return (
    <Frame stage="facet" fill>
      <div className="absolute inset-0 flex flex-col justify-center gap-3 px-5 py-4">
        {looks.map(({ look, name }) => (
          <div key={look} className="flex items-center gap-3">
            <span className="w-14 shrink-0 font-mono text-[10px] text-white/80">{name}</span>
            <div className="flex min-w-0 flex-1">
              <CaptionLine look={look} />
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/**
 * The lit word, and the swatch that decides its colour.
 *
 * The colour field reads the default accent, and the word on the line is lit
 * in the same hex, so the control and the picture are one fact.
 */
export function SpokenWord() {
  return (
    <Frame stage="sequoia">
      <Screen className="-right-8 -bottom-8 top-6 left-6" src={CAPTIONS_SCREEN}>
        <div className="absolute inset-x-0 bottom-12 flex justify-center px-3">
          <CaptionLine look="highlight" spoken={2} />
        </div>
      </Screen>
      <Slab className="top-3 right-3 w-40" inner="p-2">
        <ColorField icon={<OpacityIcon />} hex={ACCENT} />
      </Slab>
    </Frame>
  );
}

/**
 * A sentence struck out of the transcript, and the gap it left on the strip.
 *
 * The transcript is the app's caption editor: lines of what was heard, at the
 * panel's text size. The struck line is the one being deleted, and the clip
 * row under it is already in two pieces with that stretch gone.
 */
export function EditTranscript() {
  const lines = [
    { text: "Open the checkout and pick a plan.", cut: false },
    { text: "Sorry, let me start that again.", cut: true },
    { text: "The card form is on the next step.", cut: false },
  ];

  return (
    <Frame stage="peony">
      <Slab className="inset-x-4 top-4 -bottom-6">
        <div className="flex flex-col gap-1.5 px-4 pt-3 pb-2">
          {lines.map((line) => (
            <span
              key={line.text}
              className={`text-[11px] leading-snug ${
                line.cut
                  ? "text-editor-muted line-through decoration-editor-fg/60"
                  : "text-editor-fg"
              }`}
            >
              {line.text}
            </span>
          ))}
        </div>
        <Strip>
          <div className="flex gap-1.5" style={{ height: CLIP_H }}>
            <Clip width={0.42}>
              <Filmstrip src={CAPTIONS_SCREEN} cells={5} />
            </Clip>
            <Clip width={0.56} selected>
              <Filmstrip src={CAPTIONS_SCREEN} cells={6} />
            </Clip>
          </div>
        </Strip>
      </Slab>
    </Frame>
  );
}

/**
 * Where a caption sits, and how big.
 *
 * The three positions are the app's `captionPlace`, and the two sliders are
 * the size and the line count beside it. The caption on the screen is at the
 * position the control has picked.
 */
export function Placement() {
  return (
    <Frame stage="facet">
      <Screen className="-right-16 -bottom-8 top-6 left-6" src={CAPTIONS_SCREEN}>
        <div className="absolute inset-x-0 bottom-12 flex justify-center px-3">
          <CaptionLine look="subtitle" />
        </div>
      </Screen>
      <Slab className="top-3 right-3 w-44 lg:w-52">
        <Group>
          <Segmented options={["Top", "Middle", "Bottom"]} at={2} />
          <Slider icon={<SizeIcon />} label="Size" read="4.5%" value={0.45} />
          <Slider icon={<LinesIcon />} label="Lines" read="2" value={0.5} levels={3} />
        </Group>
      </Slab>
    </Frame>
  );
}

/**
 * The nine faces, each in itself.
 *
 * Every one is a font the Mac already has, so the browser on a Mac draws each
 * name in its own face and the card is the picker. Elsewhere they fall back,
 * which is the same thing the app's picker does on a machine missing one.
 */
const FACES = [
  { name: "System", stack: "system-ui, sans-serif" },
  { name: "Helvetica Neue", stack: '"Helvetica Neue", sans-serif' },
  { name: "Avenir Next", stack: '"Avenir Next", sans-serif' },
  { name: "Futura", stack: "Futura, sans-serif" },
  { name: "Optima", stack: "Optima, sans-serif" },
  { name: "Georgia", stack: "Georgia, serif" },
  { name: "Times", stack: '"Times New Roman", Times, serif' },
  { name: "Courier", stack: '"Courier New", Courier, monospace' },
  { name: "Menlo", stack: "Menlo, monospace" },
];

export function NineFaces() {
  return (
    <Frame stage="sequoia">
      <Slab className="inset-x-4 top-5 -bottom-6" inner="px-3 pt-3">
        <div className="grid grid-cols-3 gap-1 lg:grid-cols-9">
          {FACES.map((face, i) => (
            <span
              key={face.name}
              className={`flex flex-col items-center gap-1 rounded-md px-1 py-2 ${
                i === 2 ? "bg-selected/25 ring-1 ring-selected" : "bg-white/5"
              }`}
            >
              <span
                className="text-xl leading-none text-editor-fg"
                style={{ fontFamily: face.stack }}
              >
                Aa
              </span>
              <span className="max-w-full truncate text-[9px] text-editor-muted">{face.name}</span>
            </span>
          ))}
        </div>
      </Slab>
    </Frame>
  );
}
