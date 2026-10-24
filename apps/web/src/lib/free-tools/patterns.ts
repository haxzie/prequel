/**
 * The drawn patterns, as SVG.
 *
 * A deliberate second implementation. `apps/desktop/src/shared/wallpapers.ts`
 * draws the same seven styles for the editor's background picker, and the rule
 * in the root `AGENTS.md` is that nothing here imports from there: giving the
 * app's background module a marketing consumer would be a second reason for it
 * to change, and the first one is a recording somebody is exporting. The two
 * are allowed to drift, and this one already has — it takes a cell count the
 * app does not offer, because a page whose whole job is making a wallpaper
 * wants that knob and the editor does not.
 *
 * Free of any DOM import, so a server-rendered page can read a label off the
 * same arrays the canvas rasterises from.
 *
 * Deterministic: the same spec and the same size give byte-identical output.
 * That is what lets the preview on the page and the file somebody downloads be
 * the same picture at two sizes, which is the whole trick here — every
 * distance below is a fraction of the frame's shorter edge, so a pattern drawn
 * for a phone is the same composition as one drawn for a 6K display rather
 * than a crop of it.
 */

export type PatternStyleId =
  "cutting-mat" | "graph" | "dot-grid" | "blueprint" | "isometric" | "hatch" | "terrain";

/** Which drawing, in what colours, at what pitch. */
export interface PatternSpec {
  style: PatternStyleId;
  palette: string;
  /** Fine cells across the frame's shorter edge. */
  cells: number;
}

/**
 * The colours one drawing is made of.
 *
 * Five flat colours and no ramp anywhere. A smooth ramp bands visibly once it
 * has been through a video encoder, and these are backgrounds people put
 * behind recordings; flat fills and hairlines survive H.264 intact.
 */
export interface PatternPalette {
  id: string;
  label: string;
  /** The flat fill behind everything. */
  surface: string;
  /** The fine grid, one line per small cell. */
  line: string;
  /** The heavy grid and the rulers, every fifth line. */
  rule: string;
  /** Numbers on the rulers and on the guides. */
  ink: string;
  /** Angle rays and arcs, and the parts that are not the grid. */
  accent: string;
}

export interface PatternStyle {
  id: PatternStyleId;
  label: string;
  /** What the pitch slider is called on this style's page, and how it reads. */
  knob: { label: string; read: (cells: number) => string };
}

/** How a grid style reads its pitch: the number of cells, which is literal. */
const CELLS_KNOB = {
  label: "Grid",
  read: (cells: number) => `${cells} cells`,
};

/**
 * The styles, in the order the index lists them.
 *
 * Terrain's slider is the same number doing a different job, so it is named
 * for what it does there. "38 cells" on a contour map is a measurement of
 * nothing anybody can see.
 */
export const PATTERN_STYLES: PatternStyle[] = [
  { id: "cutting-mat", label: "Cutting mat", knob: CELLS_KNOB },
  { id: "graph", label: "Graph paper", knob: CELLS_KNOB },
  { id: "dot-grid", label: "Dot grid", knob: CELLS_KNOB },
  { id: "blueprint", label: "Blueprint", knob: CELLS_KNOB },
  { id: "isometric", label: "Isometric grid", knob: CELLS_KNOB },
  { id: "hatch", label: "Hatch", knob: CELLS_KNOB },
  {
    id: "terrain",
    label: "Topographic",
    knob: { label: "Relief", read: (cells: number) => `${Math.round((cells / 38) * 100)}%` },
  },
];

/** The palette everything falls back to: the green mat everybody pictures. */
const OLIVE: PatternPalette = {
  id: "olive",
  label: "Olive",
  surface: "#15301f",
  line: "#35593d",
  rule: "#eff27a",
  ink: "#eff27a",
  accent: "#b6cd85",
};

export const PATTERN_PALETTES: PatternPalette[] = [
  OLIVE,
  {
    id: "slate",
    label: "Slate",
    surface: "#1a1d21",
    line: "#282d33",
    rule: "#8fa3b8",
    ink: "#b9c7d6",
    accent: "#64788c",
  },
  {
    id: "blueprint",
    label: "Blueprint",
    surface: "#0d2a52",
    line: "#1b407a",
    rule: "#9dc2ff",
    ink: "#cfe0ff",
    accent: "#6f9fe8",
  },
  {
    id: "carbon",
    label: "Carbon",
    surface: "#101112",
    line: "#1e2022",
    rule: "#3f4349",
    ink: "#8b9196",
    accent: "#5c6166",
  },
  {
    id: "paper",
    label: "Paper",
    surface: "#f4f1e8",
    line: "#ddd7c7",
    rule: "#b9ac8c",
    ink: "#8a7c5e",
    accent: "#ad9a6d",
  },
  {
    id: "rose",
    label: "Rose",
    surface: "#2a1420",
    line: "#45233a",
    rule: "#ff9ec4",
    ink: "#ffc8de",
    accent: "#d1739f",
  },
  {
    id: "sand",
    label: "Sand",
    surface: "#2a2114",
    line: "#443722",
    rule: "#f0c46a",
    ink: "#f6dca2",
    accent: "#c09a4e",
  },
  {
    id: "mint",
    label: "Mint",
    surface: "#0f2a28",
    line: "#1c433f",
    rule: "#7fe3d2",
    ink: "#aef0e4",
    accent: "#4fb8a6",
  },
];

/** What puts roughly a cutting mat's seven labelled bands across the frame. */
export const DEFAULT_CELLS = 38;

/** The range the slider covers, either side of the default. */
export const CELL_RANGE = { min: 14, max: 72 };

export type SizePreset = {
  id: string;
  label: string;
  width: number;
  height: number;
};

/**
 * The sizes offered, biggest first inside each shape.
 *
 * Wallpaper sizes rather than video ones: 6K is the Pro Display, 5K the iMac
 * and the Studio Display, 3024 by 1964 the 14 inch MacBook Pro's own panel.
 * Nothing here is expensive to draw, so the list is as big as the displays
 * people have.
 */
export const SIZE_PRESETS: SizePreset[] = [
  { id: "6k", label: "6K display", width: 6016, height: 3384 },
  { id: "5k", label: "5K display", width: 5120, height: 2880 },
  { id: "4k", label: "4K display", width: 3840, height: 2160 },
  { id: "mbp14", label: "MacBook Pro 14", width: 3024, height: 1964 },
  { id: "mbp16", label: "MacBook Pro 16", width: 3456, height: 2234 },
  { id: "1440p", label: "1440p", width: 2560, height: 1440 },
  { id: "1080p", label: "1080p", width: 1920, height: 1080 },
  { id: "ipad", label: "iPad", width: 2732, height: 2048 },
  { id: "square", label: "Square", width: 2048, height: 2048 },
  { id: "phone", label: "Phone", width: 1290, height: 2796 },
  { id: "story", label: "Story 9:16", width: 1080, height: 1920 },
];

export interface Size {
  width: number;
  height: number;
}

/** Every fifth line is the heavy one, and the one that carries a number. */
const BAND = 5;

export function patternPalette(id: string): PatternPalette {
  return PATTERN_PALETTES.find((palette) => palette.id === id) ?? OLIVE;
}

export function patternStyle(id: string): PatternStyle {
  return PATTERN_STYLES.find((style) => style.id === id) ?? PATTERN_STYLES[0]!;
}

/** The whole drawing, as an SVG document. */
export function patternSvg(spec: PatternSpec, size: Size): string {
  const palette = patternPalette(spec.palette);

  const width = Math.max(2, Math.round(size.width));
  const height = Math.max(2, Math.round(size.height));
  const unit = Math.min(width, height);
  const cells = Math.min(CELL_RANGE.max, Math.max(CELL_RANGE.min, Math.round(spec.cells)));
  const cell = unit / cells;

  const body = draw(spec.style, { width, height, unit, cell, cells, palette });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`,
    ` viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="${palette.surface}"/>`,
    body,
    `</svg>`,
  ].join("");
}

interface Ground {
  width: number;
  height: number;
  unit: number;
  cell: number;
  cells: number;
  palette: PatternPalette;
}

function draw(style: PatternStyleId, ground: Ground): string {
  switch (style) {
    case "graph":
      return graph(ground);
    case "dot-grid":
      return dots(ground);
    case "blueprint":
      return blueprint(ground);
    case "isometric":
      return isometric(ground);
    case "hatch":
      return hatch(ground);
    case "terrain":
      return terrain(ground);
    case "cutting-mat":
      return mat(ground);
  }
}

/** Two decimals is a tenth of a pixel at 4K, and keeps the document small. */
function n(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

function path(d: string, stroke: string, width: number, extra = ""): string {
  return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${n(width)}"${extra}/>`;
}

/**
 * The grid, placed so it holds whole cells and is centred in the frame.
 *
 * Whole cells matter: a grid laid from the frame's edge ends in a sliver of a
 * cell on the far side, which is the one part of a ruled surface the eye goes
 * straight to. The leftover is split between the two margins instead.
 */
function place(
  ground: Ground,
  pad: number,
): { x: number; y: number; cols: number; rows: number; w: number; h: number } {
  const cols = Math.max(1, Math.floor((ground.width - 2 * pad) / ground.cell));
  const rows = Math.max(1, Math.floor((ground.height - 2 * pad) / ground.cell));
  const w = cols * ground.cell;
  const h = rows * ground.cell;
  return { x: (ground.width - w) / 2, y: (ground.height - h) / 2, cols, rows, w, h };
}

type Box = ReturnType<typeof place>;

/** The fine and the heavy lines of a rectangular grid, as two paths. */
function rules(ground: Ground, box: Box, widths: { fine: number; heavy: number }): string {
  const fine: string[] = [];
  const heavy: string[] = [];

  for (let i = 0; i <= box.cols; i += 1) {
    const x = box.x + i * ground.cell;
    (i % BAND === 0 ? heavy : fine).push(`M${n(x)} ${n(box.y)}V${n(box.y + box.h)}`);
  }
  // Counted from the bottom, because the rulers and the angle fan both put
  // zero in the bottom-left corner. Banding from the top instead leaves the
  // heavy lines landing between the numbers whenever the row count is not a
  // multiple of five: a mat whose grid and whose ruler disagree.
  for (let j = 0; j <= box.rows; j += 1) {
    const y = box.y + j * ground.cell;
    const band = (box.rows - j) % BAND === 0;
    (band ? heavy : fine).push(`M${n(box.x)} ${n(y)}H${n(box.x + box.w)}`);
  }

  return (
    path(fine.join(""), ground.palette.line, widths.fine) +
    path(heavy.join(""), ground.palette.rule, widths.heavy)
  );
}

/**
 * The face the numbers are set in.
 *
 * An SVG rasterised through an `<img>` can only use faces already on the
 * machine, whatever the page has loaded, so this is a stack of system ones.
 */
const FACE = "ui-monospace, 'SF Mono', Menlo, monospace";

const RAYS = [15, 30, 45, 60, 75];
/** The arcs, in cells. The first is also where the angle labels are written. */
const ARC = 10;
const ARCS = [ARC, ARC * 2, ARC * 3];

/**
 * The self-healing cutting mat: a ruled grid, numbered rulers on all four
 * edges, and the angle fan in the corner.
 *
 * The fan is what makes it a mat, and it is also the part that cannot survive
 * being scaled: an arc drawn at 10 units and then stretched to a wider frame
 * is an ellipse, and the 45 degree ray stops being 45 degrees. Drawing it at
 * the frame's own size is the reason this module emits SVG at all.
 */
function mat(ground: Ground): string {
  const { cell, palette } = ground;
  const box = place(ground, cell * 2.6);
  const fine = Math.max(0.75, ground.unit * 0.0009);
  const heavy = Math.max(1, ground.unit * 0.0013);

  const parts: string[] = [rules(ground, box, { fine, heavy })];

  // ── the rulers ───────────────────────────────────────────────────────────
  const gap = cell * 0.3;
  const minorTick = cell * 0.32;
  const majorTick = cell * 0.78;
  const size = cell * 0.62;
  const ticks: string[] = [];
  const labels: string[] = [];

  const text = (x: number, y: number, value: number, anchor: string, baseline: string): string =>
    `<text x="${n(x)}" y="${n(y)}" fill="${palette.ink}" font-family="${FACE}"` +
    ` font-size="${n(size)}" text-anchor="${anchor}" dominant-baseline="${baseline}">${value}</text>`;

  for (let i = 0; i <= box.cols; i += 1) {
    const x = box.x + i * cell;
    const long = i % BAND === 0;
    const length = long ? majorTick : minorTick;
    ticks.push(`M${n(x)} ${n(box.y - gap)}v${n(-length)}`);
    ticks.push(`M${n(x)} ${n(box.y + box.h + gap)}v${n(length)}`);
    if (!long) continue;
    labels.push(text(x, box.y - gap - majorTick - size * 0.5, i, "middle", "auto"));
    labels.push(text(x, box.y + box.h + gap + majorTick + size * 0.5, i, "middle", "hanging"));
  }

  for (let j = 0; j <= box.rows; j += 1) {
    const y = box.y + j * cell;
    // Zero sits in the corner the angle fan comes out of, and both rulers have
    // to agree with the grid about where that is. See `rules`.
    const value = box.rows - j;
    const long = value % BAND === 0;
    const length = long ? majorTick : minorTick;
    ticks.push(`M${n(box.x - gap)} ${n(y)}h${n(-length)}`);
    ticks.push(`M${n(box.x + box.w + gap)} ${n(y)}h${n(length)}`);
    if (!long) continue;
    labels.push(text(box.x - gap - majorTick - size * 0.5, y, value, "end", "middle"));
    labels.push(text(box.x + box.w + gap + majorTick + size * 0.5, y, value, "start", "middle"));
  }

  parts.push(path(ticks.join(""), palette.rule, heavy));
  parts.push(labels.join(""));

  // ── the angle fan ────────────────────────────────────────────────────────
  //
  // Clipped to the grid rather than shortened to fit. A ray that stopped early
  // in a narrow frame would read as a measurement rather than as a guide, and
  // the arcs have to stay circular whatever room they are given.
  const ox = box.x;
  const oy = box.y + box.h;
  const reach = Math.hypot(box.w, box.h);
  const fan: string[] = [];

  for (const degrees of RAYS) {
    const radians = (degrees * Math.PI) / 180;
    fan.push(
      path(
        `M${n(ox)} ${n(oy)}L${n(ox + Math.cos(radians) * reach)} ${n(
          oy - Math.sin(radians) * reach,
        )}`,
        palette.accent,
        fine,
        ` stroke-dasharray="${n(cell * 0.34)} ${n(cell * 0.4)}"`,
      ),
    );
  }

  const arcs: string[] = [];
  const nicks: string[] = [];
  for (const radius of ARCS) {
    const r = radius * cell;
    arcs.push(`M${n(ox + r)} ${n(oy)}A${n(r)} ${n(r)} 0 0 0 ${n(ox)} ${n(oy - r)}`);
    for (let degrees = 5; degrees < 90; degrees += 5) {
      const radians = (degrees * Math.PI) / 180;
      const inner = r - cell * 0.16;
      const outer = r + cell * 0.16;
      nicks.push(
        `M${n(ox + Math.cos(radians) * inner)} ${n(oy - Math.sin(radians) * inner)}` +
          `L${n(ox + Math.cos(radians) * outer)} ${n(oy - Math.sin(radians) * outer)}`,
      );
    }
  }
  fan.push(path(arcs.join(""), palette.accent, heavy));
  fan.push(path(nicks.join(""), palette.accent, fine));

  for (const degrees of RAYS) {
    const radians = (degrees * Math.PI) / 180;
    const r = ARC * cell * 0.92;
    fan.push(
      `<text x="${n(ox + Math.cos(radians) * r)}" y="${n(oy - Math.sin(radians) * r)}"` +
        ` fill="${palette.ink}" font-family="${FACE}" font-size="${n(size)}"` +
        ` text-anchor="middle" dominant-baseline="middle">${degrees}°</text>`,
    );
  }

  // The id carries the cell count, because a page draws the preview and the
  // file from two `patternSvg` calls and both can be in the document at once
  // while a download renders. Two `clipPath id="mat"` elements in one tree is
  // the first one winning, which clips the big drawing to the small frame.
  const id = `mat-${Math.round(ground.cell * 100)}`;
  const clip = `<clipPath id="${id}"><rect x="${n(box.x)}" y="${n(box.y)}" width="${n(
    box.w,
  )}" height="${n(box.h)}"/></clipPath>`;

  parts.push(`<defs>${clip}</defs><g clip-path="url(#${id})">${fan.join("")}</g>`);

  return parts.join("");
}

/** Graph paper: the grid alone, full bleed, with no rulers to read it against. */
function graph(ground: Ground): string {
  const box = place(ground, 0);
  return rules(ground, box, {
    fine: Math.max(0.75, ground.unit * 0.0007),
    heavy: Math.max(1, ground.unit * 0.0012),
  });
}

/** A dot at every crossing, heavier on the band lines. */
function dots(ground: Ground): string {
  const box = place(ground, 0);
  const fine: string[] = [];
  const heavy: string[] = [];

  for (let i = 0; i <= box.cols; i += 1) {
    for (let j = 0; j <= box.rows; j += 1) {
      const x = box.x + i * ground.cell;
      const y = box.y + j * ground.cell;
      const band = i % BAND === 0 && j % BAND === 0;
      // Drawn as zero-length strokes with round caps rather than as circles.
      // Two paths carry the whole field; a thousand `<circle>` elements is a
      // document the rasteriser spends real time on at 6K.
      (band ? heavy : fine).push(`M${n(x)} ${n(y)}h0`);
    }
  }

  const round = ` stroke-linecap="round"`;
  return (
    path(fine.join(""), ground.palette.line, ground.cell * 0.12, round) +
    path(heavy.join(""), ground.palette.rule, ground.cell * 0.26, round)
  );
}

/** Drafting paper: band lines only, a cross at each crossing, and a margin. */
function blueprint(ground: Ground): string {
  const { cell, palette } = ground;
  const box = place(ground, cell * 1.6);
  const fine = Math.max(0.75, ground.unit * 0.0008);
  const heavy = Math.max(1, ground.unit * 0.0014);

  const lines: string[] = [];
  const crosses: string[] = [];
  const arm = cell * 0.38;

  for (let i = 0; i <= box.cols; i += BAND) {
    const x = box.x + i * cell;
    lines.push(`M${n(x)} ${n(box.y)}V${n(box.y + box.h)}`);
  }
  for (let j = 0; j <= box.rows; j += BAND) {
    const y = box.y + j * cell;
    lines.push(`M${n(box.x)} ${n(y)}H${n(box.x + box.w)}`);
    for (let i = 0; i <= box.cols; i += BAND) {
      const x = box.x + i * cell;
      crosses.push(`M${n(x - arm)} ${n(y)}h${n(arm * 2)}M${n(x)} ${n(y - arm)}v${n(arm * 2)}`);
    }
  }

  const frame =
    `<rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}"` +
    ` fill="none" stroke="${palette.rule}" stroke-width="${n(heavy)}"/>` +
    `<rect x="${n(box.x + cell * 0.5)}" y="${n(box.y + cell * 0.5)}" width="${n(
      box.w - cell,
    )}" height="${n(box.h - cell)}" fill="none" stroke="${palette.rule}" stroke-width="${n(
      fine,
    )}"/>`;

  return (
    path(lines.join(""), palette.line, fine) + path(crosses.join(""), palette.rule, fine) + frame
  );
}

/**
 * Lines in one direction, running corner to corner.
 *
 * `step` is the horizontal distance between intercepts; the perpendicular
 * spacing people actually see is that times the sine of the angle, which is
 * why the caller passes a pitch and this divides rather than multiplying.
 */
function slanted(ground: Ground, degrees: number, pitch: number): string[] {
  const radians = (degrees * Math.PI) / 180;
  const step = pitch / Math.sin(radians);
  const run = ground.height / Math.tan(radians);
  const from = Math.min(0, -run) - step;
  const to = Math.max(ground.width, ground.width - run) + step;

  const lines: string[] = [];
  for (let c = Math.ceil(from / step) * step; c <= to; c += step) {
    lines.push(`M${n(c)} ${n(ground.height)}L${n(c + run)} 0`);
  }
  return lines;
}

/** A triangular grid: uprights and two families at thirty degrees. */
function isometric(ground: Ground): string {
  const pitch = ground.cell * 2.4;
  const lines: string[] = [...slanted(ground, 30, pitch), ...slanted(ground, 150, pitch)];

  const step = pitch / Math.sin((30 * Math.PI) / 180);
  for (let x = 0; x <= ground.width + step; x += step) {
    lines.push(`M${n(x)} 0V${n(ground.height)}`);
  }

  return path(lines.join(""), ground.palette.line, Math.max(0.75, ground.unit * 0.0008));
}

/** Hairlines at forty-five degrees, with every fifth one picked out. */
function hatch(ground: Ground): string {
  const all = slanted(ground, 45, ground.cell * 0.8);
  const fine = all.filter((_, index) => index % BAND !== 0);
  const heavy = all.filter((_, index) => index % BAND === 0);

  return (
    path(fine.join(""), ground.palette.line, Math.max(0.75, ground.unit * 0.0007)) +
    path(heavy.join(""), ground.palette.rule, Math.max(1, ground.unit * 0.0012))
  );
}

/**
 * A contour map: a landscape nobody surveyed, traced as lines.
 *
 * The one style here that is not a ruled grid, and it is drawn the way the
 * grids are, as stroked paths worked out in JavaScript. An earlier pair of
 * noise styles leaned on SVG's `feTurbulence` instead, which looked right in a
 * swatch and fell apart at frame size: the filter's lattice is measured in
 * user units, so a field large enough to read as a background meant zooming a
 * thousand-fold into a single cell, and what came out was eight-bit
 * interpolation. Blocky rectangles and staircase edges, in the file rather
 * than in the preview. Tracing the field directly has no precision to run out
 * of, and the lines land on whole pixels at whatever size the frame is.
 *
 * Height is sampled on a grid and the lines are the crossings of that grid at
 * each level: marching squares. Every fifth line is heavy, the way an index
 * contour is on a real map, which is what stops the field reading as noise.
 */
function terrain(ground: Ground): string {
  const { unit, width, height, palette } = ground;

  // The sample grid is in output pixels and the field is in frame units, so
  // the two are independent: the grid decides how smooth a line is and the
  // field decides how big the hills are. Tying them together, one noise cell
  // per sample, is how a contour map becomes a sheet of static.
  const step = unit / samples(unit);
  const cols = Math.ceil(width / step);
  const rows = Math.ceil(height / step);

  // The slider is the pitch of a grid everywhere else, and there is no grid
  // here, so it moves the one thing that corresponds: how much landscape the
  // frame holds. More cells is smaller hills and more lines.
  const relief = RELIEF * (ground.cells / DEFAULT_CELLS);

  const at = (i: number, j: number): number =>
    fbm((i * step * relief) / unit, (j * step * relief) / unit);

  const field: number[] = new Array<number>((cols + 1) * (rows + 1));
  let low = Infinity;
  let high = -Infinity;

  for (let j = 0; j <= rows; j += 1) {
    for (let i = 0; i <= cols; i += 1) {
      const value = at(i, j);
      field[j * (cols + 1) + i] = value;
      if (value < low) low = value;
      if (value > high) high = value;
    }
  }

  // Levels spread across the range this frame actually holds, rather than
  // across the range the field could theoretically take. Fixed thresholds
  // give a portrait frame, which sees less of the landscape, half as many
  // lines as a landscape one, for no reason the eye can account for.
  const minor: string[] = [];
  const index: string[] = [];

  for (let level = 1; level < LEVELS; level += 1) {
    const cutAt = low + ((high - low) * level) / LEVELS;
    const d = trace(field, cols, rows, step, cutAt);
    if (d) (level % 5 === 0 ? index : minor).push(d);
  }

  const ends = ` stroke-linecap="round" stroke-linejoin="round"`;

  return (
    path(minor.join(""), palette.line, Math.max(0.75, unit * 0.001), ends) +
    path(index.join(""), palette.rule, Math.max(1, unit * 0.0018), ends)
  );
}

/**
 * Samples across the frame's shorter edge: how smooth a line is, not how big
 * the landscape is.
 *
 * Scaled to the frame rather than fixed, and clamped at both ends. A contour
 * is a chain of straight hops one cell long, so a count that looks smooth in
 * a hundred-pixel preview leaves twenty-pixel facets on a tight bend at 4K,
 * and a count that is right for 4K is most of a second of marching squares
 * every time the slider moves.
 */
function samples(unit: number): number {
  return Math.min(170, Math.max(90, Math.round(unit / 14)));
}

/** Noise cells across the shorter edge at the default pitch. */
const RELIEF = 2.6;

/** How many contours the frame's full range is cut into. */
const LEVELS = 24;

/**
 * Where one height crosses the grid, as path data.
 *
 * Marching squares: each cell of four samples is read as a four-bit case
 * saying which corners are above the level, and the case says which edges the
 * line enters and leaves by. Where it crosses an edge is interpolated from the
 * two heights, which is what makes the line smooth rather than stepped.
 */
function trace(field: number[], cols: number, rows: number, step: number, level: number): string {
  const parts: string[] = [];
  const height = (i: number, j: number): number => field[j * (cols + 1) + i]!;

  /** Along an edge, where the level falls between two corners. */
  const cut = (a: number, b: number): number => {
    const span = b - a;
    return Math.abs(span) < 1e-9 ? 0.5 : (level - a) / span;
  };

  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const tl = height(i, j);
      const tr = height(i + 1, j);
      const br = height(i + 1, j + 1);
      const bl = height(i, j + 1);

      const code =
        (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
      if (code === 0 || code === 15) continue;

      const x = i * step;
      const y = j * step;

      const top = { x: x + cut(tl, tr) * step, y };
      const right = { x: x + step, y: y + cut(tr, br) * step };
      const bottom = { x: x + cut(bl, br) * step, y: y + step };
      const left = { x, y: y + cut(tl, bl) * step };

      const line = (a: { x: number; y: number }, b: { x: number; y: number }): void => {
        parts.push(`M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}`);
      };

      switch (code) {
        case 1:
        case 14:
          line(left, bottom);
          break;
        case 2:
        case 13:
          line(bottom, right);
          break;
        case 3:
        case 12:
          line(left, right);
          break;
        case 4:
        case 11:
          line(top, right);
          break;
        case 6:
        case 9:
          line(top, bottom);
          break;
        case 7:
        case 8:
          line(left, top);
          break;
        // The two ambiguous cells, where opposite corners are above and the
        // line could join either pair. Settled by the cell's own average: the
        // wrong choice joins two hills that do not touch, and shows up as a
        // contour with a kink in it rather than as anything obviously broken.
        case 5:
        case 10: {
          const middle = (tl + tr + br + bl) / 4;
          const split = code === 5 ? middle > level : middle <= level;
          if (split) {
            line(left, top);
            line(bottom, right);
          } else {
            line(left, bottom);
            line(top, right);
          }
          break;
        }
      }
    }
  }

  return parts.join("");
}

/**
 * Value noise, hashed rather than seeded.
 *
 * No table and no state: the same point gives the same height on any machine
 * and in any order, which is what lets a preview and a 6K file be the same
 * landscape seen from different distances.
 */
function fbm(x: number, y: number): number {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let span = 0;

  for (let octave = 0; octave < 4; octave += 1) {
    total += wave(x * frequency, y * frequency, octave) * amplitude;
    span += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return total / span;
}

function wave(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  // Smoothstep, so the field has no corners at the lattice points. A linear
  // blend puts a crease along every cell boundary, and a contour crossing it
  // comes out with a visible elbow.
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);

  const top = spot(ix, iy, seed) * (1 - u) + spot(ix + 1, iy, seed) * u;
  const bottom = spot(ix, iy + 1, seed) * (1 - u) + spot(ix + 1, iy + 1, seed) * u;
  return top * (1 - v) + bottom * v;
}

/** One lattice point's height, from its coordinates alone. */
function spot(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
