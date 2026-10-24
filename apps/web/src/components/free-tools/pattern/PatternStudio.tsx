"use client";

/**
 * The pattern generator: one style, eight palettes, any size, PNG or SVG.
 *
 * Which style is fixed by the page, because each of the seven is a thing
 * people search for by name and a page that has to be reconfigured before it
 * shows what it is called is a page that ranks for nothing. The style picker
 * at the bottom of the rail is navigation, so it is seven links rather than
 * seven buttons.
 *
 * The drawing is `lib/free-tools/patterns.ts` and nothing is drawn here. The
 * preview is the same function at the size of the box it is shown in, which is
 * the point of a pattern measured in fractions of the shorter edge: what is on
 * screen is the composition of the file, not a crop of it.
 *
 * The preview is an `<img>` on an SVG data URL rather than a canvas. The
 * browser rasterises it, at whatever the display's pixel ratio is, with no
 * frame loop and no state to keep in step. The canvas appears once, for the
 * PNG, and is thrown away in the same function.
 */

import { Download, Grid2x2, Ruler, Scaling } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CELL_RANGE,
  DEFAULT_CELLS,
  PATTERN_PALETTES,
  PATTERN_STYLES,
  SIZE_PRESETS,
  patternStyle,
  patternSvg,
  type PatternStyleId,
} from "@/lib/free-tools/patterns";

import { DownloadDialog } from "../DownloadDialog";
import { Group, Panel, Picker, Slider } from "../controls";

/** Where each style's page lives, so the rail can link between them. */
const PAGES: Record<PatternStyleId, string> = {
  "cutting-mat": "cutting-mat-background",
  graph: "graph-paper-generator",
  "dot-grid": "dot-grid-generator",
  blueprint: "blueprint-background-generator",
  isometric: "isometric-grid-generator",
  hatch: "hatch-pattern-generator",
  terrain: "topographic-map-generator",
};

const BUTTON =
  "flex h-[30px] items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-colors " +
  "disabled:opacity-40 [&_svg]:size-[15px]";

/**
 * What a canvas is allowed to be, in pixels of area.
 *
 * Safari on iOS and iPadOS caps a canvas at about 16.7 million pixels and
 * hands back a blank one past it, with nothing thrown. A 6K wallpaper is 20
 * million, so without this the button on an iPad saves a transparent PNG and
 * reports success. The SVG has no such ceiling, which is what the message
 * says.
 */
const CANVAS_CEILING = 16_000_000;

export function PatternStudio({ style }: { style: PatternStyleId }) {
  const [palette, setPalette] = useState(PATTERN_PALETTES[0]!.id);
  const [sizeId, setSizeId] = useState("4k");
  const [cells, setCells] = useState(DEFAULT_CELLS);
  // Raised by a download and by nothing else. The file is already saving when
  // it opens; see the note in `DownloadDialog`.
  const [pitching, setPitching] = useState(false);
  const [error, setError] = useState("");

  const boxRef = useRef<HTMLDivElement | null>(null);
  /** The box the preview is fitted into, in CSS pixels. */
  const [box, setBox] = useState({ width: 0, height: 0 });

  const size = SIZE_PRESETS.find((preset) => preset.id === sizeId) ?? SIZE_PRESETS[0]!;
  const spec = useMemo(() => ({ style, palette, cells }), [style, palette, cells]);
  const entry = patternStyle(style);

  // Measured rather than assumed. The stage is a flex child inside a grid, so
  // its height comes from the rail beside it and is not knowable from the
  // aspect ratio alone.
  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([record]) => {
      const rect = record?.contentRect;
      if (rect) setBox({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** The preview, fitted into the box and drawn at the display's own pixels. */
  const preview = useMemo(() => {
    if (box.width < 2 || box.height < 2) return null;

    const scale = Math.min(box.width / size.width, box.height / size.height);
    const width = Math.max(2, Math.floor(size.width * scale));
    const height = Math.max(2, Math.floor(size.height * scale));
    // Capped at 2. A 3x phone drawing a terrain preview is marching squares
    // over nine times the cells for a difference nobody can see at that size.
    const ratio = Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);

    const svg = patternSvg(spec, { width: width * ratio, height: height * ratio });
    return { width, height, url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` };
  }, [box, size, spec]);

  const stem = `prequel-${style}-${palette}-${size.width}x${size.height}`;

  const save = useCallback((blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    setPitching(true);
  }, []);

  const svgText = useCallback(() => patternSvg(spec, size), [spec, size]);

  const downloadSvg = () => {
    setError("");
    save(new Blob([svgText()], { type: "image/svg+xml" }), `${stem}.svg`);
  };

  const [rendering, setRendering] = useState(false);

  const downloadPng = async () => {
    setError("");

    if (size.width * size.height > CANVAS_CEILING) {
      setError(
        "This browser cannot paint a PNG that big. Download the SVG, or pick a smaller size.",
      );
      return;
    }

    setRendering(true);
    const url = URL.createObjectURL(new Blob([svgText()], { type: "image/svg+xml" }));

    try {
      const image = new Image();
      // A blob URL rather than a data URL. Safari truncates a very long data
      // URL on an `<img>`, and a 6K terrain drawing is a few megabytes of path
      // data: the image loads a partial document and the contours stop
      // halfway down the file.
      image.src = url;
      await image.decode();

      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no context");
      ctx.drawImage(image, 0, 0, size.width, size.height);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("no blob");
      save(blob, `${stem}.png`);
    } catch {
      setError(
        "Your browser would not paint the PNG. The SVG is the same picture and always works.",
      );
    } finally {
      URL.revokeObjectURL(url);
      setRendering(false);
    }
  };

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <div className="flex min-h-0 flex-col gap-4">
          <div className="editor-theme squircle dot-grid relative flex min-h-[32rem] flex-1 flex-col overflow-hidden rounded-3xl bg-editor-bg ring-1 ring-black/20">
            {/* This box is what gets measured, and its size comes from the
                stage rather than from the picture in it. A container that sized
                itself to the preview would feed the preview its own size back
                and settle wherever the first frame happened to land. */}
            <div
              ref={boxRef}
              className="absolute inset-3 bottom-20 flex items-center justify-center sm:inset-5 sm:bottom-20"
            >
              {preview ? (
                <img
                  src={preview.url}
                  alt={`${entry.label} pattern, ${size.width} by ${size.height}`}
                  width={preview.width}
                  height={preview.height}
                  className="rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.35)]"
                />
              ) : null}
            </div>

            {/* The lane the recorders and the screenshot editor put their dock
                in, so the three pages read as one tool. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
              <div className="dock-theme pointer-events-auto flex max-w-full items-center gap-1.5 rounded-[10px] bg-dock-bg p-1.5 text-dock-fg shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
                <span className="px-2 text-[12px] tabular-nums text-dock-fg/70">
                  {size.width} × {size.height}
                </span>
                <span className="h-[18px] w-px flex-none self-center bg-dock-line" />
                <button
                  type="button"
                  onClick={downloadPng}
                  disabled={rendering}
                  className={`${BUTTON} bg-white text-black hover:bg-white/90`}
                >
                  <Download aria-hidden />
                  {rendering ? "Drawing" : "PNG"}
                </button>
                <button
                  type="button"
                  onClick={downloadSvg}
                  className={`${BUTTON} text-dock-fg hover:bg-dock-hover`}
                >
                  SVG
                </button>
              </div>
            </div>
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-negative/30 bg-negative/5 px-4 py-3 text-sm text-pretty text-fg"
            >
              {error}
            </p>
          ) : null}
        </div>

        <Panel>
          <Group label="Colour">
            {/* The real drawing at tile size, in each palette, rather than a
                row of flat chips. A chip answers "which green", and the
                question people actually have is what the lines do against it:
                Paper is the one palette here where the grid is darker than the
                ground, and a chip of cream says nothing about that. */}
            <div className="grid grid-cols-4 gap-1.5">
              {PATTERN_PALETTES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-label={option.label}
                  title={option.label}
                  aria-pressed={option.id === palette}
                  onClick={() => setPalette(option.id)}
                  className={`aspect-video overflow-hidden rounded-lg bg-cover bg-center transition-transform hover:z-10 hover:scale-110 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-selected focus-visible:outline-offset-1 ${
                    option.id === palette ? "border-2 border-selected" : "border border-white/10"
                  }`}
                  style={{
                    backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(
                      patternSvg({ style, palette: option.id, cells }, { width: 240, height: 150 }),
                    )}")`,
                  }}
                />
              ))}
            </div>
          </Group>

          <Group label="Size">
            <Picker
              icon={<Scaling />}
              label="Output size"
              value={sizeId}
              options={SIZE_PRESETS.map((preset) => ({
                value: preset.id,
                label: `${preset.label} · ${preset.width} × ${preset.height}`,
              }))}
              onChange={setSizeId}
            />
            <Slider
              icon={style === "terrain" ? <Ruler /> : <Grid2x2 />}
              label={entry.knob.label}
              read={entry.knob.read(cells)}
              value={cells}
              min={CELL_RANGE.min}
              max={CELL_RANGE.max}
              step={1}
              onChange={setCells}
            />
            <p className="px-1 text-[11px] leading-snug text-editor-muted">
              Every line is a fraction of the short edge, so the pattern looks the same at 1080p and
              at 6K.
            </p>
          </Group>

          <Group label="Other patterns">
            <div className="flex flex-col">
              {PATTERN_STYLES.filter((option) => option.id !== style).map((option) => (
                <Link
                  key={option.id}
                  href={`/free-tools/${PAGES[option.id]}`}
                  className="flex h-7 items-center rounded-full px-2.5 text-[11px] text-editor-muted transition-colors hover:bg-white/5 hover:text-editor-fg"
                >
                  {option.label}
                </Link>
              ))}
            </div>
          </Group>
        </Panel>
      </div>

      <DownloadDialog open={pitching} onClose={() => setPitching(false)} />
    </>
  );
}
