import { useMemo, useState } from "react";

import { cn } from "../../lib/cn";
import { ChevronDownIcon } from "../icons";
import { available, CAPTION_FONTS, captionFont, leadFamily, PROBE } from "./fonts";
import { CONTROL_H } from "./inputs";

/**
 * The face captions are set in, each row set in the face it offers.
 *
 * A name alone would not do: Avenir and Futura are both geometric sans and the
 * words tell you nothing, so the row *is* the sample. The same argument the
 * caption style and cursor pickers make.
 *
 * Faces the engine cannot resolve are left out rather than shown and quietly
 * drawn in something else. Canvas gives no error for a missing family — see
 * `available` — so the check is a measurement, done once here rather than per
 * row per render.
 */
export function FontPicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const fonts = useMemo(() => {
    // One scratch context for the whole test. Creating a canvas per family is
    // the sort of thing that only shows up as a stutter when the list grows.
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return CAPTION_FONTS;

    const measure = (font: string) => {
      ctx.font = font;
      return ctx.measureText(PROBE).width;
    };

    return CAPTION_FONTS.filter((font) => available(leadFamily(font.stack), measure));
  }, []);

  const chosen = fonts.find((font) => font.id === value) ?? captionFont(value);

  return (
    // Opens in the flow rather than over it, for the reason the colour picker
    // does: the panel is `overflow-hidden` around a scrolling column, so a menu
    // floating out of it would be clipped at the panel's edge unless it were
    // portalled to the body and then kept in place against scroll and resize.
    <div className={cn("flex flex-col", disabled && "pointer-events-none opacity-40")}>
      <button
        type="button"
        aria-expanded={open}
        className={cn(
          "flex items-center justify-between gap-2 rounded-md bg-white/5 px-2.5 text-left",
          CONTROL_H,
        )}
        onClick={() => setOpen((was) => !was)}
      >
        {/* The closed control is a sample too — the point of the list is that
            you can see a face before choosing it, and that is worth as much for
            the one already chosen. */}
        <span className="truncate text-[13px] text-white" style={{ fontFamily: chosen.stack }}>
          {chosen.label}
        </span>
        <span
          className={cn(
            "flex-none text-editor-muted transition-transform [&_svg]:size-3",
            open && "rotate-180",
          )}
          aria-hidden
        >
          <ChevronDownIcon />
        </span>
      </button>

      {open && (
        <div className="mt-1 flex flex-col gap-0.5" role="radiogroup">
          {fonts.map((font) => (
            <button
              key={font.id}
              type="button"
              role="radio"
              aria-checked={font.id === value}
              className={cn(
                "flex items-center rounded-md px-2.5 text-left text-[13px] transition-colors",
                CONTROL_H,
                font.id === value
                  ? "bg-white/12 text-editor-fg"
                  : "text-editor-muted hover:bg-white/6 hover:text-editor-fg",
              )}
              // The row's whole point. `fontFamily` rather than a class,
              // because the family is data — a utility per face would be a
              // Tailwind class generated for every entry in a list that is
              // meant to be edited.
              style={{ fontFamily: font.stack }}
              onClick={() => {
                onChange(font.id);
                setOpen(false);
              }}
            >
              {font.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
