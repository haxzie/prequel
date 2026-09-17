/**
 * A horizontal bar chart for an article, drawn as SVG.
 *
 * Drawn rather than pasted as a PNG for the reason the editor figures are:
 * the numbers live in the MDX beside the prose that quotes them, so a
 * re-measured figure is one edit, and the chart picks up the site's ink and
 * line colours through `currentColor` and the theme variables, so it reads
 * the same on both surfaces without a second export.
 *
 * One axis, one unit, bars anchored at zero and labelled at their ends. A
 * second series, when there is one, is a second colour from the site's own
 * palette (the playhead blue and the sun orange, checked for colour-vision
 * separation before use) and is also named in the row label, so identity is
 * never carried by colour alone. Every figure that uses this is followed by
 * the same numbers as a table, which is the version a screen reader and a
 * copy-paste get.
 *
 * `role="img"` with a full sentence as its label, and the internals hidden:
 * read one node at a time, a bar is noise; the sentence is the finding.
 */
export interface Bar {
  label: string;
  value: number;
  /** Which colour, for a chart with two series. Absent means the first. */
  series?: 0 | 1;
  /** Drawn in the muted ink, for a reference row that is not the finding. */
  muted?: boolean;
}

const SERIES = ["var(--color-accent)", "var(--color-brand-from)"];

export function BarChart({
  bars,
  unit,
  caption,
  max,
  format = (v) => String(v),
}: {
  bars: Bar[];
  /** Written once at the axis, not on every bar. */
  unit: string;
  /** The sentence a reader who cannot see the chart gets. */
  caption: string;
  /** The axis end, when the natural maximum would crowd the labels. */
  max?: number;
  format?: (value: number) => string;
}) {
  const labelWidth = 220;
  const valueWidth = 72;
  const width = 640;
  const rowHeight = 30;
  const barHeight = 16;
  const top = 8;
  const height = top + bars.length * rowHeight + 28;
  const plotWidth = width - labelWidth - valueWidth - 16;
  const scaleMax = max ?? Math.max(...bars.map((bar) => bar.value));

  return (
    <figure className="my-7">
      <svg
        role="img"
        aria-label={caption}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full text-fg"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        <g aria-hidden>
          {bars.map((bar, i) => {
            const y = top + i * rowHeight;
            const w = Math.max(2, (bar.value / scaleMax) * plotWidth);
            const fill = bar.muted ? "var(--color-muted)" : SERIES[bar.series ?? 0];
            return (
              <g key={bar.label} transform={`translate(0 ${y})`}>
                <text
                  x={labelWidth - 12}
                  y={barHeight / 2}
                  textAnchor="end"
                  dominantBaseline="central"
                  fontSize="13"
                  fill="var(--color-muted)"
                >
                  {bar.label}
                </text>
                {/* 3px rounded end, anchored at the baseline on the left; the
                    2px gap between rows is the row height less the bar. */}
                <rect
                  x={labelWidth}
                  y={0}
                  width={w}
                  height={barHeight}
                  rx={3}
                  fill={fill}
                  opacity={bar.muted ? 0.55 : 1}
                >
                  <title>{`${bar.label}: ${format(bar.value)} ${unit}`}</title>
                </rect>
                <text
                  x={labelWidth + w + 8}
                  y={barHeight / 2}
                  dominantBaseline="central"
                  fontSize="13"
                  fontFamily="var(--font-mono)"
                  fill="currentColor"
                >
                  {format(bar.value)}
                </text>
              </g>
            );
          })}
          {/* The baseline and the unit, once. No grid: with the value at the
              end of every bar a grid adds lines and no information. */}
          <line
            x1={labelWidth}
            x2={labelWidth}
            y1={top - 4}
            y2={top + bars.length * rowHeight - (rowHeight - barHeight) + 4}
            stroke="var(--color-line)"
            strokeWidth="1"
          />
          <text
            x={labelWidth}
            y={height - 6}
            fontSize="11"
            fontFamily="var(--font-mono)"
            fill="var(--color-muted)"
            letterSpacing="0.08em"
          >
            {unit.toUpperCase()}
          </text>
        </g>
      </svg>
      <figcaption className="mt-2 text-sm leading-relaxed text-muted">{caption}</figcaption>
    </figure>
  );
}
