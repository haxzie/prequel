/**
 * The colours of the background, for the glow the composition sits in.
 *
 * The preview is a picture on a dark board, and the board knows nothing about
 * what is on it. A wash of the composition's own colours behind it is what ties
 * the two together — the same trick a television's backlight plays, and for the
 * same reason: the edge of the picture stops being where the room begins.
 *
 * Everything here runs **once per background**, never per frame. The glow is
 * three radial gradients in CSS and the compositor does not know it exists; the
 * only work is picking the colours, and that happens when the background
 * changes and at no other time. The editor's own rules are explicit about what
 * a per-frame layout read costs, and this would be a per-frame *decode*.
 *
 * Split so the choosing can be tested without a DOM: `dominant` takes pixels
 * and `sample` is the only part that needs a canvas.
 */
import type { Background } from "../../../shared/project";

/**
 * How many colours the glow is built from.
 *
 * Three. Two cannot describe a picture with a light and a dark half and a
 * subject between them, and four start to average back out into the grey they
 * were picked to avoid — by the fourth the pickings are whatever the first
 * three left, which on most wallpapers is mud.
 */
export const AMBIENT_COLOURS = 3;

/**
 * The size the background is sampled at.
 *
 * Tiny on purpose. This is a colour question, not a detail one: the browser's
 * own downscale does the averaging, 240 pixels is enough to find three regions
 * on any photograph, and it keeps the whole thing to a single `drawImage` of a
 * picture that is already decoded and in memory.
 */
const SAMPLE_WIDTH = 20;
const SAMPLE_HEIGHT = 12;

/**
 * How coarse the buckets are, in bits dropped per channel.
 *
 * Three, so each channel lands in one of 32 steps. Finer and a gradient's
 * every band is its own bucket and nothing ever wins; coarser and two colours
 * a person would call different share one.
 */
const BUCKET_BITS = 3;

/**
 * How far apart two picked colours have to be, as a squared RGB distance.
 *
 * Without this the top three buckets of a blue photograph are three blues, and
 * the glow is one colour drawn three times. Squared, so there is no square root
 * in the loop.
 */
const APART = 60 * 60 * 3;

/** Below this the pixel is near-black, and a glow of it is no glow at all. */
const TOO_DARK = 28;
/** Above this it is near-white, which washes to grey as soon as it is blurred. */
const TOO_PALE = 242;

/**
 * How colourful a bucket has to be before it may light the board at all.
 *
 * A floor rather than a weighting, because the two answer different questions.
 * Weighting decides which of several colours wins; this decides whether what
 * won is a colour at all. Without it a photograph of a grey building lights the
 * board in grey — which is not a mistake anyone can see, just a glow that makes
 * the board look dirty.
 */
const MIN_SATURATION = 0.12;

/**
 * A picture that can say whether it has finished loading.
 *
 * Duck-typed rather than `instanceof HTMLImageElement`, which is not a thing
 * that exists outside a browser — and this module is unit-tested in Node,
 * where that check throws a `ReferenceError` on the way past rather than
 * answering false. The two fields are the whole of what `sample` needs.
 */
interface Loaded {
  complete: boolean;
  naturalWidth: number;
}

function drawable(image: CanvasImageSource | undefined): image is CanvasImageSource & Loaded {
  return (
    image !== undefined &&
    typeof (image as Partial<Loaded>).complete === "boolean" &&
    typeof (image as Partial<Loaded>).naturalWidth === "number"
  );
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * The colours to light the board with, most important first.
 *
 * Empty when there is nothing to take them from — an image still loading, or a
 * background the project names but this build cannot read. The caller draws no
 * glow at all rather than a grey one.
 */
export function ambientColours(
  background: Background,
  /** The editor's loaded pictures, by the path the project stores. */
  images: ReadonlyMap<string, CanvasImageSource>,
): Rgb[] {
  if (background.kind === "solid") {
    const colour = parseHex(background.color);
    return colour ? [colour] : [];
  }

  if (background.kind === "gradient") {
    // Both stops, in the order the ramp runs. Nothing is sampled: the two
    // colours *are* the background, and reading them off a rasterised copy
    // would be a worse answer to a question already answered exactly.
    return [parseHex(background.from), parseHex(background.to)].filter(
      (colour): colour is Rgb => colour !== null,
    );
  }

  // Narrowed rather than cast. The compositor's map is of `CanvasImageSource`,
  // which is anything drawable — a caption bitmap in there is a canvas — and
  // only an `<img>` can be asked whether it has finished loading.
  const image = images.get(background.path);
  const pixels = drawable(image) ? sample(image) : null;
  return pixels ? dominant(pixels, AMBIENT_COLOURS) : [];
}

/**
 * The background drawn small, as RGBA bytes, or null.
 *
 * Null rather than throwing on a picture that will not draw. A composition
 * without a glow behind it is the way this looked yesterday; an exception here
 * would be thrown from a render and take the preview with it.
 *
 * The image arrives already decoded — `useImages` in `Editor.tsx` loaded it for
 * the compositor — and already `crossOrigin="anonymous"`, which is what keeps
 * `getImageData` from throwing a `SecurityError` on a canvas tainted by
 * `prequel-media:`.
 */
function sample(image: CanvasImageSource & Loaded): Uint8ClampedArray | null {
  if (!image.complete || image.naturalWidth === 0) return null;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_WIDTH;
    canvas.height = SAMPLE_HEIGHT;

    const context = canvas.getContext("2d", { willReadFrequently: false });
    if (!context) return null;

    context.drawImage(image, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    return context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
  } catch (cause) {
    console.warn("[ambience] could not read the background's colours:", cause);
    return null;
  }
}

/**
 * The most telling colours in a block of RGBA pixels.
 *
 * Counted into coarse buckets and then weighted by saturation rather than taken
 * on count alone, which is the whole difference between this and an average.
 * Most wallpapers are mostly sky, or mostly a dark vignette, and the colour
 * that covers the most pixels is very often the one nobody would name if asked
 * what colour the picture is. Weighting by saturation picks the colour the
 * picture is *about*; the near-black and near-white cuts drop the regions that
 * turn to grey the moment they are blurred.
 *
 * Exported for the test, which is where the interesting cases are: a picture
 * with one obvious colour, one with two, and one that is entirely grey and must
 * come back empty rather than muddy.
 */
export function dominant(pixels: Uint8ClampedArray, want: number): Rgb[] {
  const totals = new Map<number, { r: number; g: number; b: number; n: number; score: number }>();

  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index]!;
    const g = pixels[index + 1]!;
    const b = pixels[index + 2]!;
    // Transparent pixels have no colour to contribute; a background with an
    // alpha channel would otherwise vote black for every empty corner.
    if (pixels[index + 3]! < 128) continue;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < TOO_DARK || min > TOO_PALE) continue;

    // Saturation against the channel that is brightest, not against 255. A
    // deep navy is as *coloured* as a pale sky blue even though its channels
    // are half the distance apart, and measuring against 255 would call it
    // grey and drop it — which is most of what a night wallpaper is made of.
    const saturation = (max - min) / max;
    if (saturation < MIN_SATURATION) continue;

    const key = ((r >> BUCKET_BITS) << 16) | ((g >> BUCKET_BITS) << 8) | (b >> BUCKET_BITS);

    // Saturation outright, not `1 + saturation`. The base made this an
    // approximate pixel count with a thumb on the scale, and a thumb is not
    // enough: four-fifths of a wallpaper being flat sky beats a vivid fifth
    // four times over, so the glow came out the colour of the part nobody
    // would name. Without the base, colourless regions contribute nothing and
    // what wins is the colour the picture is *about*.
    const weight = saturation;

    const bucket = totals.get(key) ?? { r: 0, g: 0, b: 0, n: 0, score: 0 };
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.n += 1;
    bucket.score += weight;
    totals.set(key, bucket);
  }

  const ranked = [...totals.values()]
    .sort((a, b) => b.score - a.score)
    // Averaged back out within the bucket, so the colour that comes out is one
    // that was actually in the picture rather than the corner of the box the
    // bucket covers.
    .map((bucket) => ({
      r: Math.round(bucket.r / bucket.n),
      g: Math.round(bucket.g / bucket.n),
      b: Math.round(bucket.b / bucket.n),
    }));

  const picked: Rgb[] = [];
  for (const colour of ranked) {
    if (picked.length === want) break;
    if (picked.every((taken) => distance(taken, colour) >= APART)) picked.push(colour);
  }

  return picked;
}

/**
 * How bright the brightest channel of a lamp is turned up to.
 *
 * A backlight emits; it does not reproduce. The colours that come out of a
 * photograph are mostly dark — the first pick off the default wallpaper is
 * `rgb(22 4 60)`, which is a perfectly accurate description of the picture and,
 * at half opacity over a near-black board, indistinguishable from no glow at
 * all. That is what this exists for, and it is the difference between the
 * effect working and the effect being invisible with every value correct.
 */
const TARGET = 210;

/**
 * The same colour, turned up until it is light rather than paint.
 *
 * The hue is the part worth keeping, so the channels are scaled together and
 * the ratios between them survive. Never downwards: a background that is
 * already bright is already the right brightness, and pulling it towards a
 * target would dim a pale wash for the sake of a number.
 */
function lift(colour: Rgb): Rgb {
  const max = Math.max(colour.r, colour.g, colour.b);
  if (max === 0 || max >= TARGET) return colour;

  const scale = TARGET / max;
  return {
    r: Math.min(255, Math.round(colour.r * scale)),
    g: Math.min(255, Math.round(colour.g * scale)),
    b: Math.min(255, Math.round(colour.b * scale)),
  };
}

function distance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

/**
 * `#rgb` and `#rrggbb`, which is every form a project stores.
 *
 * Null for anything else rather than a guess: a hand-edited `project.json` is
 * the only way something else gets here, and a mis-parsed colour would be a
 * wash of the wrong one with nothing on screen to say why.
 */
export function parseHex(value: string): Rgb | null {
  const hex = value.trim().replace(/^#/, "");

  if (hex.length === 3) {
    const [r, g, b] = [...hex].map((digit) => parseInt(digit + digit, 16));
    return Number.isNaN(r! + g! + b!) ? null : { r: r!, g: g!, b: b! };
  }

  if (hex.length === 6) {
    const value = parseInt(hex, 16);
    if (Number.isNaN(value)) return null;
    return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
  }

  return null;
}

/**
 * The glow, as a CSS `background` value, or null when there is nothing to draw.
 *
 * Three overlapping radial gradients rather than one blurred copy of the
 * picture. A blurred copy is the obvious implementation and it is wrong here:
 * it costs a second decode of a 4K image, it has to be redrawn whenever the
 * composition moves, and what it produces behind a padded composition is a
 * slightly smaller version of the same picture — which reads as a rendering
 * mistake rather than as light.
 *
 * The positions are fixed rather than taken from where each colour was found.
 * Where a colour sits in the source says nothing about where it should sit on
 * the board, the composition covers the middle of it anyway, and a wash whose
 * shape changed with every background would be the one thing in this window
 * that moves for no reason.
 *
 * `alpha` is the strongest the first colour reaches; the rest fall away behind
 * it. Full strength by default, and turned down where it is drawn rather than
 * here — `Preview` sets it on the stack of washes, not on each one.
 *
 * That is not a tidying. Two of these are on screen at once while a background
 * is being changed, and two translucent copies stacked are brighter than one:
 * the glow bloomed for the length of the fade and dropped back the moment the
 * old layer was dropped. Opaque layers inside a stack that carries the opacity
 * cover one another instead of adding up, which is what a crossfade is.
 */
export function ambientGradient(colours: Rgb[], alpha = 1): string | null {
  if (colours.length === 0) return null;

  const lit = colours.map(lift);

  // Repeated to three when there are fewer — a solid background has one colour
  // and a gradient two, and a single lamp in the top left corner would light
  // the board unevenly for no reason the user could name.
  const [first, second, third] = [0, 1, 2].map((index) => lit[index % lit.length]!) as [
    Rgb,
    Rgb,
    Rgb,
  ];

  const lamp = (colour: Rgb, at: string, strength: number) =>
    `radial-gradient(60% 60% at ${at}, rgb(${String(colour.r)} ${String(colour.g)} ${String(colour.b)} / ${strength.toFixed(2)}), transparent 72%)`;

  return [
    lamp(first, "22% 18%", alpha),
    lamp(second, "80% 26%", alpha * 0.85),
    lamp(third, "50% 88%", alpha * 0.7),
  ].join(", ");
}
