/**
 * Hex ↔ HSV, for the colour picker.
 *
 * Here rather than in the component for the reason `perspective.ts` is: it is
 * arithmetic with edge cases worth pinning, and none of it needs React to run.
 *
 * HSV rather than HSL because the picker is a saturation/value square under a
 * hue strip, which is the shape every colour picker has settled on — the square
 * is literally S across and V up, so any other space would be converted twice.
 */

/** Hue in degrees, saturation and value as fractions. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** `#rrggbb`, lower case. Anything unreadable comes back as black. */
export function hexToHsv(hex: string): Hsv {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return { h: 0, s: 0, v: 0 };

  const int = Number.parseInt(match[1]!, 16);
  const r = ((int >> 16) & 0xff) / 255;
  const g = ((int >> 8) & 0xff) / 255;
  const b = (int & 0xff) / 255;

  const max = Math.max(r, g, b);
  const chroma = max - Math.min(r, g, b);

  // Undefined at zero chroma, and every formula answers 0° for it. Grey has no
  // hue to report, so the caller has to hold the one it was showing — see
  // `ColorPicker`.
  let h = 0;
  if (chroma > 0) {
    if (max === r) h = ((g - b) / chroma) % 6;
    else if (max === g) h = (b - r) / chroma + 2;
    else h = (r - g) / chroma + 4;
    h = (h * 60 + 360) % 360;
  }

  return { h, s: max === 0 ? 0 : chroma / max, v: max };
}

/** The inverse, clamped so an out-of-range input cannot produce a bad string. */
export function hsvToHex({ h, s, v }: Hsv): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 1);
  const val = clamp(v, 0, 1);

  const chroma = val * sat;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const min = val - chroma;

  const [r, g, b] =
    hue < 60
      ? [chroma, second, 0]
      : hue < 120
        ? [second, chroma, 0]
        : hue < 180
          ? [0, chroma, second]
          : hue < 240
            ? [0, second, chroma]
            : hue < 300
              ? [second, 0, chroma]
              : [chroma, 0, second];

  const byte = (channel: number) =>
    Math.round((channel + min) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${byte(r!)}${byte(g!)}${byte(b!)}`;
}
