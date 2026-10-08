/**
 * The fixed sets the tools offer: frames, frame rates and grounds.
 *
 * Values only, no browser APIs, so a server-rendered page can read a label off
 * the same array the canvas draws from.
 */
import type { Frame } from "./layout";

export type FramePreset = {
  id: string;
  label: string;
  /** Null means "whatever the capture is", resolved once the stream arrives. */
  frame: Frame | null;
};

/**
 * Five frames, and 4K is deliberately not among them.
 *
 * Everything here is composited in a 2D canvas and encoded by `MediaRecorder` on
 * the main thread, so the frame is a budget rather than a preference: 3840 by
 * 2160 at 60 drops frames on a laptop that is also the thing being recorded.
 * The desktop app is where a 4K export comes from, and it says so on the page.
 */
export const FRAME_PRESETS: FramePreset[] = [
  { id: "source", label: "Match source", frame: null },
  { id: "1080p", label: "Landscape 1080p", frame: { width: 1920, height: 1080 } },
  { id: "vertical", label: "Vertical 9:16", frame: { width: 1080, height: 1920 } },
  { id: "square", label: "Square 1:1", frame: { width: 1080, height: 1080 } },
  { id: "portrait", label: "Portrait 4:5", frame: { width: 1080, height: 1350 } },
];

export type Background = {
  id: string;
  label: string;
  /** Angle in degrees, read clockwise from the top. */
  angle: number;
  /** Offset and colour, in the order they are painted. */
  stops: [number, string][];
};

/**
 * The brand gradient, named because it is also the fallback.
 *
 * `BACKGROUNDS[0]` would be the same object and is typed as possibly
 * undefined, which would make the one function that has to always return a
 * background return one that might not be there.
 */
const SUNRISE: Background = {
  id: "sunrise",
  label: "Sunrise",
  angle: 115,
  stops: [
    [0, "#e14b15"],
    [1, "#ac1860"],
  ],
};

/**
 * Seven grounds for a screenshot, from the app icon's own palette.
 *
 * Hard-coded hexes and not the CSS tokens: these are painted into a canvas with
 * `createLinearGradient`, which takes colour strings and cannot resolve a custom
 * property. Reading them off the element with `getComputedStyle` would work and
 * would also tie the pixels in an exported image to whatever theme the page
 * happens to be in.
 *
 * `none` is first in the reader's mind and last in the list: a screenshot with
 * no ground is the thing they already have.
 */
export const BACKGROUNDS: Background[] = [
  SUNRISE,
  {
    id: "dusk",
    label: "Dusk",
    angle: 140,
    stops: [
      [0, "#3e1848"],
      [0.55, "#731a46"],
      [1, "#1b1026"],
    ],
  },
  {
    id: "iris",
    label: "Iris",
    angle: 120,
    stops: [
      [0, "#4e84f9"],
      [1, "#c000f0"],
    ],
  },
  {
    id: "slate",
    label: "Slate",
    angle: 160,
    stops: [
      [0, "#2b3038"],
      [1, "#0b0d11"],
    ],
  },
  {
    id: "paper",
    label: "Paper",
    angle: 160,
    stops: [
      [0, "#ffffff"],
      [1, "#e3e3e3"],
    ],
  },
  {
    id: "ink",
    label: "Ink",
    angle: 0,
    stops: [
      [0, "#0b0d11"],
      [1, "#0b0d11"],
    ],
  },
];

export function findBackground(id: string): Background {
  return BACKGROUNDS.find((background) => background.id === id) ?? SUNRISE;
}

/**
 * Two frame rates.
 *
 * 30 is the default on purpose. The browser draws every frame of the
 * composition itself, so 60 doubles the work on the machine that is already
 * running whatever is being demonstrated, and a screen recording of a cursor
 * and some text is not a thing 30 fails.
 */
export const FRAME_RATES = [30, 60] as const;
