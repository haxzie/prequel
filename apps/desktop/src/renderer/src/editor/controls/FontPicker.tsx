import { useEffect, useMemo, useRef } from "react";

import { cn } from "../../lib/cn";
import { ChevronRightIcon, FontIcon } from "../icons";
import { hostedFamily, type Fonts } from "../useFonts";
import { available, CAPTION_FONTS, captionFont, leadFamily, PROBE } from "./fonts";
import { PushedView, usePushed } from "./PushedView";
import { CONTROL_H } from "./inputs";

/**
 * The face captions and texts are set in, each row set in the face it offers.
 *
 * A name alone would not do: Avenir and Futura are both geometric sans and the
 * words tell you nothing, so the row *is* the sample. The same argument the
 * caption style and cursor pickers make.
 *
 * Faces the engine cannot resolve are left out rather than shown and quietly
 * drawn in something else. Canvas gives no error for a missing family — see
 * `available` — so the check is a measurement, done once here rather than per
 * row per render.
 *
 * Hosted families are the exception to that check: they are not there until
 * they are fetched, and the measurement would drop every one. They are listed
 * from the catalogue instead, grouped as it groups them, and each row loads
 * its regular weight when the list opens so the sample is the face rather
 * than the fallback.
 */
export function FontPicker({
  value,
  disabled,
  fonts,
  onPreview,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  /** The hosted catalogue and its loader. Absent for captions, which offer
      the shipped faces alone. */
  fonts?: Fonts;
  /**
   * The face under the pointer, or null for none.
   *
   * The row shows the letterforms; this shows them at the size, colour and
   * weight they will be, over the picture they will be over — which is the
   * question actually being asked of a font list in a video editor. Never a
   * commit: see `FontPreview`.
   */
  onPreview?: (id: string | null) => void;
  onChange: (id: string) => void;
}) {
  const { open, toggle, close } = usePushed("Font");

  const shipped = useMemo(() => {
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

  /** Every group the list shows: the shipped faces first, then the catalogue's. */
  const groups = useMemo(() => {
    const out: {
      id: string;
      label: string;
      fonts: { id: string; label: string; stack: string }[];
    }[] = [{ id: "system", label: "On this Mac", fonts: shipped }];
    const catalogue = fonts?.catalogue;
    if (!catalogue) return out;

    const order = [...catalogue.categories.map((category) => category.id)];
    for (const family of catalogue.families) {
      if (!order.includes(family.category)) order.push(family.category);
    }
    for (const id of order) {
      const families = catalogue.families.filter((family) => family.category === id);
      if (families.length === 0) continue;
      out.push({
        id,
        label: catalogue.categories.find((category) => category.id === id)?.label ?? id,
        fonts: families.map((family) => ({
          id: family.id,
          label: family.label,
          stack: fonts.stack(family.id),
        })),
      });
    }
    return out;
  }, [shipped, fonts]);

  // The samples, when the list opens. Every hosted family's regular weight is
  // asked for at once rather than as rows scroll into view: the list is a few
  // dozen faces, each file is a few hundred kilobytes, and a row that changes
  // face as you look at it is worse than a list that takes a moment to fill.
  useEffect(() => {
    if (!open || !fonts?.catalogue) return;
    for (const family of fonts.catalogue.families) {
      void fonts.ready({ font: family.id, weight: 400, italic: false });
    }
  }, [open, fonts]);

  /**
   * Dropping the preview when the list goes away.
   *
   * A row's `onPointerLeave` covers the pointer moving off it, but not the two
   * ways the list stops existing under a pointer that never moved: the click
   * that chooses a face closes the view, and the back arrow closes it from the
   * header. Either would leave the hovered face standing in for a project
   * setting with nothing on screen to say it was doing so.
   *
   * Through a ref so the cleanup is not torn down and re-run every time the
   * callback's identity changes — it is an inline closure at both call sites,
   * so that is every render, and re-running this would clear a preview the
   * pointer is still sitting on.
   */
  const preview = useRef(onPreview);
  preview.current = onPreview;
  useEffect(() => () => preview.current?.(null), [open]);

  const chosen =
    groups.flatMap((group) => group.fonts).find((font) => font.id === value) ?? captionFont(value);

  return (
    // Takes the panel over rather than opening inside it — see `PushedView`.
    // This list is the longest of the three and was the worst offender: every
    // face the catalogue carries, pushing the whole of the text panel below it
    // off the bottom of the window while it was open.
    <div className={cn("flex flex-col", disabled && "pointer-events-none opacity-40")}>
      <button
        type="button"
        aria-expanded={open}
        className={cn(
          "flex items-center justify-between gap-2 rounded-full bg-white/5 px-2.5 text-left",
          CONTROL_H,
          open && "bg-white/12",
        )}
        onClick={toggle}
      >
        {/* The closed control is a sample too — the point of the list is that
            you can see a face before choosing it, and that is worth as much for
            the one already chosen. */}
        <span className="truncate text-[13px] text-white" style={{ fontFamily: chosen.stack }}>
          {chosen.label}
        </span>
        <span className="flex-none text-editor-muted [&_svg]:size-3" aria-hidden>
          <ChevronRightIcon />
        </span>
      </button>

      <PushedView open={open && !disabled}>
        <div className="flex flex-col gap-0.5" role="radiogroup">
          {groups.map((group) => (
            <div key={group.id} className="flex flex-col gap-0.5">
              {/* A heading only where there is more than one group to tell
                  apart; captions have never needed one. */}
              {groups.length > 1 && (
                <div className="px-2.5 pt-2 pb-1 text-[10px] font-medium tracking-wide text-editor-muted uppercase">
                  {group.label}
                </div>
              )}
              {group.fonts.map((font) => (
                <button
                  key={font.id}
                  type="button"
                  role="radio"
                  aria-checked={font.id === value}
                  className={cn(
                    "flex items-center gap-2 rounded-full px-2.5 text-left text-[13px] transition-colors",
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
                  // Pointer rather than mouse events, so a face previews under
                  // a trackpad hover and a pen alike. Cleared on leave rather
                  // than on the next row's enter: the rows have a gap between
                  // them, and a pointer resting in it would otherwise hold the
                  // last row's face on the picture indefinitely.
                  onPointerEnter={() => onPreview?.(font.id)}
                  onPointerLeave={() => onPreview?.(null)}
                  onClick={() => {
                    onChange(font.id);
                    close();
                  }}
                >
                  {/* The same glyph down every row, as in the sound lists.
                      Outside the `fontFamily` the label carries — an SVG
                      ignores it, but the gap and the truncation have to be
                      the row's rather than the sample's, or a long family
                      name squeezes the glyph instead of ellipsing itself. */}
                  <span
                    className="flex-none text-editor-muted opacity-70 [&_svg]:size-3.5"
                    aria-hidden
                  >
                    <FontIcon />
                  </span>
                  <span className="truncate">{font.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </PushedView>
    </div>
  );
}

export { hostedFamily, PROBE };
