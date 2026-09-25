/**
 * The look laid over the finished frame, as the preview draws it.
 *
 * A second shader pair rather than another mode in `webgl.ts`'s, and for three
 * reasons worth writing down before anyone merges them:
 *
 * - The exporter's matching uniform block is 272 bytes with a hand-derived
 *   offset table and a test asserting every one of them. Adding five `vec4`s to
 *   it means re-deriving all of them for a block no per-item draw reads.
 * - That shader already carries a 48-tap defocus loop. Folding a CRT into it
 *   makes every fragment of every quad branch on a look it is not part of.
 * - A full-screen pass has no rect, no shape and no source crop. It would sit
 *   in a switch whose every other arm is a thing in the plan.
 *
 * `crates/prequel-render/src/filters.metal` is the mirror, function for
 * function. Both sides have to agree to the pixel: this is shading, not
 * geometry, so the plan cannot carry the answer and each rasteriser works it
 * out itself.
 *
 * ## Lengths
 *
 * Everything here works in **normalised frame coordinates** — `uv`, 0 to 1
 * across the picture — and every length is a fraction of the frame's shorter
 * edge. The preview rasterises at the size of the canvas on screen and the
 * export at the output resolution, so a pitch in pixels would be three times as
 * dense in the file as it was here. See `PlanFilter.scale`.
 */

/** Which arm of `look` this is. The same order as `FilterKind::index` in
    `crates/prequel-render/src/plan.rs`, and pinned by a test on each side. */
export const FILTER_LOOKS = {
  aberration: 0,
  grade: 1,
  // 2 was `pixelate`, whose two-colour arm this is and whose block arm was
  // dropped. Reused rather than left as a hole: a plan carries a look's *name*,
  // so nothing outside this file and its mirror ever sees the number.
  dither: 2,
  halftone: 3,
  lcd: 4,
  fisheye: 5,
  crt: 6,
  vhs: 7,
  film: 8,
  bloom: 9,
  "window-light": 10,
  // 11 was `ascii`, which was drawn, looked at and dropped before it
  // shipped. Left unused rather than closed up: the numbers below it are
  // written out in three other places, and renumbering them buys nothing a
  // plan can see — a plan carries a look's *name*.
  "lost-signal": 12,
  pico8: 13,
  gameboy: 14,
  c64: 15,
  riso: 16,
  dream: 17,
} as const;

/**
 * Source nanoseconds to the seconds a shader animates on, wrapped.
 *
 * A half-hour recording is 1.8e12 nanoseconds. As an `f32` — which is all a
 * uniform is — that holds about a millisecond, so a rolling bar would quantise
 * to something coarser than a frame well before the end of a long take. Wrapped
 * at a hundred seconds it holds about a microsecond, forever.
 *
 * A hundred, and a whole number of them, so every periodic function in here has
 * a period that divides it and the wrap is invisible.
 *
 * Mirrors `filter_time` in `crates/prequel-render/src/compositor.rs`. Both
 * sides must wrap identically or a scrubbed preview and an exported frame at
 * the same moment show different noise.
 */
export const FILTER_TIME_WRAP_NS = 100_000_000_000;

export function filterTime(at: number, animated: boolean): number {
  // A still look passes zero rather than being branched around in the shader:
  // one code path, and the "off" state is a value rather than a mode.
  if (!animated) return 0;
  // Floored first, because `MediaTime` is a `u64` on the other side and `%` on
  // a negative comes back negative here where it could not there. Source time
  // is never negative today; this is what keeps the two expressions the same
  // expression rather than the same expression on the inputs that happen to
  // arrive.
  return (Math.max(at, 0) % FILTER_TIME_WRAP_NS) / 1e9;
}

/** Exported for `webgl.test.ts`, which is the only thing in the build that
    looks at this GLSL at all — nothing compiles it until the GPU does. */
export const FILTER_SHADER_SOURCE = () => ({ vertex: FILTER_VERTEX, fragment: FILTER_FRAGMENT });

/**
 * A full-screen triangle strip, with no buffer.
 *
 * The same trick the item shader uses — the corner comes from `gl_VertexID` —
 * but over the whole frame rather than a rectangle from the uniforms, because
 * this pass has no rectangle. No y-flip either: the scene texture was rendered
 * into a framebuffer with the same bottom-up convention as the one it is being
 * drawn to, so flipping here would turn the picture upside down.
 */
const FILTER_VERTEX = `#version 300 es
out vec2 v_uv;

void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  v_uv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FILTER_FRAGMENT = `#version 300 es
precision highp float;

// The composited frame, premultiplied.
uniform sampler2D u_scene;
// Which look. See \`FILTER_LOOKS\`.
uniform int u_look;
// Which way of wearing it.
uniform int u_variant;
uniform float u_strength;
// A fraction of the frame's shorter edge — never a pixel count. See the note
// at the top of this file.
uniform float u_scale;
uniform float u_angle;
uniform vec3 u_tint;
// Seconds, already wrapped. 0 when the look is not animated.
uniform float u_time;
// The output frame in pixels. Only ever used to turn \`uv\` into a square
// coordinate — an aspect, not a resolution, so this pass draws the same look
// into a preview canvas and into a 4K file.
uniform vec2 u_frame;

const float TAU = 6.2831853;

in vec2 v_uv;
out vec4 fragColor;

/**
 * \`uv\` with the aspect taken out, measured from the middle.
 *
 * Every look that has a direction or a distance needs this. Working in raw
 * \`uv\` makes a round vignette an oval and a 45-degree blind a 30-degree one
 * the moment the frame stops being square.
 *
 * Mirrors \`centred\` in \`crates/prequel-render/src/filters.metal\`.
 */
vec2 centred(vec2 uv) {
  vec2 from = uv - 0.5;
  // Against the shorter edge, so the fraction a length is measured in is the
  // same one every setting in the editor is measured in.
  float shorter = min(u_frame.x, u_frame.y);
  return from * u_frame / shorter;
}

/** The way back, for the looks that move where they sample from. */
vec2 uvOf(vec2 p) {
  float shorter = min(u_frame.x, u_frame.y);
  return p * shorter / u_frame + 0.5;
}

vec2 spun(vec2 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

/** The look's own size, never below a hair — a pitch of zero divides by it. */
float pitch() {
  return max(u_scale, 0.001);
}

/** Half the frame's diagonal, in the square space \`centred\` works in. */
vec2 corner() {
  return centred(vec2(1.0));
}

/**
 * The scene, at full resolution.
 *
 * The level is stated rather than left to the hardware, and that is not
 * belt-and-braces. The scene carries a mip chain for the glow, and a sampler
 * left to pick its own level picks it from the derivative of the coordinate —
 * which for the looks that *snap* their coordinate to a cell spikes at every
 * cell boundary. Pixelate and the dot-matrix panel would come back with a soft
 * band around each block, from a level nothing asked for.
 *
 * Only \`bloomed\` names a level other than this one.
 */
vec3 grab(vec2 uv) {
  return textureLod(u_scene, clamp(uv, 0.0, 1.0), 0.0).rgb;
}

/**
 * A number from a position, stable and cheap.
 *
 * Every look that needs noise hashes a position rather than reading a texture
 * or carrying a seed, which is what makes a scrubbed preview and an exported
 * frame at the same moment show the same grain. Nothing here is random.
 *
 * Mirrors \`hash21\` in \`crates/prequel-render/src/filters.metal\` — and it has
 * to, to the bit: the two rasterisers agreeing about *where* the noise is means
 * nothing if they disagree about what it is.
 */
float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

/** Smooth noise, for the one gobo that is not a ruled pattern. */
float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  // Smoothstepped rather than linear, or the cell edges show as a lattice —
  // which on a leaf gobo reads as graph paper.
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/** A value wrapped into 0-8, positive whatever the sign going in. See \`wrap4\`. */
float wrap8(float v) {
  return v - 8.0 * floor(v * 0.125);
}

/** A value wrapped into 0-4, positive whatever the sign going in. */
float wrap4(float v) {
  // Written as a subtraction rather than through \`mod\`: GLSL's \`mod\` is
  // already positive and Metal's \`fmod\` keeps the sign, so calling the
  // language's own operator would make the two sides disagree on every
  // negative coordinate — which is half the frame.
  return v - 4.0 * floor(v * 0.25);
}

/**
 * How much of a ruled pattern survives at the rate it is being sampled.
 *
 * \`cells\` is a coordinate in pattern units, so \`fwidth\` of it is how many
 * cells fall inside one screen pixel. Above about one the pattern is finer than
 * the raster can show, and point-sampling it does not give a faint mask — it
 * gives moire, and a mask that averages a third of the light per channel turns
 * the whole frame dark and noisy instead.
 *
 * This is the one place the preview and the export legitimately differ. The
 * preview rasterises at the size of the canvas on screen, so a triad that
 * resolves in a 4K file cannot resolve in a 700-pixel preview; fading it out
 * there means the preview loses a grille it could never have drawn rather than
 * inventing a pattern that is not in the file. The *look* still matches — what
 * differs is antialiasing, which is the same thing that differs about the
 * preview being lower resolution at all.
 *
 * Mirrors \`resolved\` in \`crates/prequel-render/src/filters.metal\`.
 */
float resolved(float cells) {
  return 1.0 - smoothstep(0.35, 0.90, fwidth(cells));
}

/**
 * The picture with its colours pulled apart towards the edges.
 *
 * Three samples on the one texture, the red and blue displaced along the
 * direction away from the middle and the green left where it is. That is what a
 * lens actually does — the middle of the visible spectrum focuses where it
 * should and the ends land short and long of it — and it is why the effect
 * vanishes at the centre of the frame rather than being uniform across it.
 *
 * \`u_angle\` turns that direction. At zero the colours run straight out from
 * the middle, which is the lens; at a quarter turn they run around it, which is
 * the swirl a badly assembled one gives; in between is a spiral. A rotation
 * rather than a blend between two modes, so the control is continuous — a
 * setting that jumped the moment it left zero would read as a bug.
 *
 * Alpha comes from the green tap alone. The scene is opaque everywhere the
 * composition covers, and averaging three alphas would feather the frame's own
 * edge into transparency.
 *
 * Mirrors \`aberration\` in \`crates/prequel-render/src/filters.metal\`.
 */
vec4 aberration(vec2 uv) {
  vec2 from = centred(uv);
  // Squared, so the split is nothing across the middle of the picture and grows
  // quickly at the corners. Linear reads as a printing misregistration — the
  // whole image doubled — rather than as glass.
  float away = dot(from, from);

  // Turned by the angle, which keeps the magnitude whatever it is set to.
  vec2 turned = spun(from, u_angle);

  // At full strength the corner of a 16:9 frame splits by about two per cent of
  // its width — forty pixels at 1080p, and fourteen at the default strength. A
  // plain split rather than a subtle one, because somebody reaching for this is
  // reaching for the look.
  vec2 offset = turned * away * u_strength * 0.04;

  // Aspect taken back out. \`offset\` is in the square space \`centred\` works
  // in, and sampling needs it back in uv.
  float shorter = min(u_frame.x, u_frame.y);
  offset = offset * shorter / u_frame;

  vec4 green = textureLod(u_scene, uv, 0.0);
  float r = grab(uv + offset).r;
  float b = grab(uv - offset).b;
  return vec4(r, green.g, b, green.a);
}

/**
 * A grade, mixed against the picture it came from.
 *
 * Channel multipliers rather than a lookup table: a LUT would be an asset to
 * ship, a second thing to keep the two rasterisers agreeing about, and six
 * files to load before the first frame draws. These are the same six grades
 * anybody reaches for and they are three numbers each.
 *
 * Mirrors \`graded\` in \`crates/prequel-render/src/filters.metal\`.
 */
vec3 graded(vec3 c) {
  float l = luma(c);
  vec3 g = c;
  if (u_variant == 0) {
    g = c * vec3(1.12, 1.02, 0.88);
  } else if (u_variant == 1) {
    g = c * vec3(0.88, 1.00, 1.14);
  } else if (u_variant == 2) {
    // Lifted blacks and rolled highlights, which is what "faded" is — a print
    // that has been in the sun, not a picture with less contrast.
    g = vec3(0.16) + c * 0.74;
  } else if (u_variant == 3) {
    g = vec3(l);
  } else if (u_variant == 4) {
    g = vec3(l) * vec3(1.22, 1.00, 0.76);
  } else {
    // Teal into the shadows, orange into the highlights, split on luma. The
    // grade every trailer has worn since about 2005.
    g = mix(c * vec3(0.82, 1.02, 1.18), c * vec3(1.20, 1.02, 0.80), smoothstep(0.25, 0.75, l));
  }
  return mix(c, g, u_strength);
}

/** One cell of the 4x4 ordered dither, 0 to 1. */
float bayer(vec2 cell) {
  // The classical matrix, which is the one everybody's eye has been trained on
  // by thirty years of two-colour screens.
  float m[16] = float[16](
    0.0, 8.0, 2.0, 10.0,
    12.0, 4.0, 14.0, 6.0,
    3.0, 11.0, 1.0, 9.0,
    15.0, 7.0, 13.0, 5.0);
  int x = int(wrap4(cell.x));
  int y = int(wrap4(cell.y));
  return (m[x + y * 4] + 0.5) * 0.0625;
}

/**
 * One cell of the 8x8 ordered dither, 0 to 1.
 *
 * The 4x4 above is sixteen levels, which is plenty to break up a ramp that is
 * on its way to two colours. Snapping to sixteen *colours* needs finer: with
 * the coarse matrix the bias itself shows as a visible weave laid over the
 * picture, because the thing it is dithering between is no longer black and
 * white but two neighbouring greens.
 *
 * Mirrors \`bayer8\` in \`crates/prequel-render/src/filters.metal\`.
 */
float bayer8(vec2 cell) {
  float m[64] = float[64](
    0.0, 32.0, 8.0, 40.0, 2.0, 34.0, 10.0, 42.0,
    48.0, 16.0, 56.0, 24.0, 50.0, 18.0, 58.0, 26.0,
    12.0, 44.0, 4.0, 36.0, 14.0, 46.0, 6.0, 38.0,
    60.0, 28.0, 52.0, 20.0, 62.0, 30.0, 54.0, 22.0,
    3.0, 35.0, 11.0, 43.0, 1.0, 33.0, 9.0, 41.0,
    51.0, 19.0, 59.0, 27.0, 49.0, 17.0, 57.0, 25.0,
    15.0, 47.0, 7.0, 39.0, 13.0, 45.0, 5.0, 37.0,
    63.0, 31.0, 55.0, 23.0, 61.0, 29.0, 53.0, 21.0);
  int x = int(wrap8(cell.x));
  int y = int(wrap8(cell.y));
  return (m[x + y * 8] + 0.5) * 0.015625;
}

/**
 * Every palette the pixelate look can snap to, end to end.
 *
 * One array with a span per palette rather than four arrays, because GLSL has
 * no way to hand a function a different one — a four-arm switch each of whose
 * arms carries its own copy of the search loop is four copies of the loop.
 *
 * At file scope rather than inside the function that reads it, which is where
 * \`bayer\`'s matrix sits. Forty-one vec3s declared per fragment is forty-one
 * initialisers the compiler has to prove it can hoist, and the small matrix is
 * where that is obviously free.
 *
 * Mirrors \`PALETTE\` in \`crates/prequel-render/src/filters.metal\`, entry for
 * entry — the two rasterisers agreeing about which colours exist is the whole
 * of whether an export matches its preview here.
 */
const vec3 PALETTE[41] = vec3[41](
  // Pico-8, 0 to 15.
  vec3(0.0000, 0.0000, 0.0000), vec3(0.1137, 0.1686, 0.3255),
  vec3(0.4941, 0.1451, 0.3255), vec3(0.0000, 0.5294, 0.3176),
  vec3(0.6706, 0.3216, 0.2118), vec3(0.3725, 0.3412, 0.3098),
  vec3(0.7608, 0.7647, 0.7804), vec3(1.0000, 0.9451, 0.9098),
  vec3(1.0000, 0.0000, 0.3020), vec3(1.0000, 0.6392, 0.0000),
  vec3(1.0000, 0.9255, 0.1529), vec3(0.0000, 0.8941, 0.2118),
  vec3(0.1608, 0.6784, 1.0000), vec3(0.5137, 0.4627, 0.6118),
  vec3(1.0000, 0.4667, 0.6588), vec3(1.0000, 0.8000, 0.6667),
  // Game Boy, 16 to 19. The four greens of the original panel, not the Pocket's
  // greys — the greens are what anybody picturing one is picturing.
  vec3(0.0588, 0.2196, 0.0588), vec3(0.1882, 0.3843, 0.1882),
  vec3(0.5451, 0.6745, 0.0588), vec3(0.6078, 0.7373, 0.0588),
  // C64, 20 to 35.
  vec3(0.0000, 0.0000, 0.0000), vec3(1.0000, 1.0000, 1.0000),
  vec3(0.5333, 0.0000, 0.0000), vec3(0.6667, 1.0000, 0.9333),
  vec3(0.8000, 0.2667, 0.8000), vec3(0.0000, 0.8000, 0.3333),
  vec3(0.0000, 0.0000, 0.6667), vec3(0.9333, 0.9333, 0.4667),
  vec3(0.8667, 0.5333, 0.3333), vec3(0.4000, 0.2667, 0.0000),
  vec3(1.0000, 0.4667, 0.4667), vec3(0.2000, 0.2000, 0.2000),
  vec3(0.4667, 0.4667, 0.4667), vec3(0.6667, 1.0000, 0.4000),
  vec3(0.0000, 0.5333, 1.0000), vec3(0.7333, 0.7333, 0.7333),
  // Risograph, 36 to 40. Four inks and the paper they sit on.
  vec3(0.1647, 0.1647, 0.1647), vec3(1.0000, 0.2824, 0.3451),
  vec3(1.0000, 0.8235, 0.2471), vec3(0.1059, 0.6039, 0.6667),
  vec3(0.9647, 0.9569, 0.9020));

/**
 * The nearest colour a machine like that could actually have shown.
 *
 * The ordered matrix biases the colour *before* it is snapped rather than
 * choosing between two levels after. That is what keeps a gradient: two
 * neighbouring cells land either side of the boundary between two entries and
 * the eye mixes them back. Snapping first and dithering after gives banding
 * with a pattern in it.
 *
 * Nearest by squared distance in plain RGB, which is not how anybody sees
 * colour and is what every machine in this list did. A perceptual metric picks
 * better colours and picks the wrong ones: the banding and the odd hue jumps
 * *are* the look.
 *
 * Mirrors \`nearest\` in \`crates/prequel-render/src/filters.metal\`.
 */
vec3 nearest(vec3 c, vec2 index, int palette) {
  // The spans of \`PALETTE\`. Taken as an argument rather than read off
  // \`u_variant\`, because the four palettes are four *looks* — each has its own
  // arm of the switch and none of them has a variant to read.
  int start = 0;
  int count = 16;
  if (palette == 1) {
    start = 16;
    count = 4;
  } else if (palette == 2) {
    start = 20;
    count = 16;
  } else if (palette == 3) {
    start = 36;
    count = 5;
  }

  vec3 biased = clamp(c + (bayer8(index) - 0.5) * 0.28, 0.0, 1.0);

  vec3 best = PALETTE[start];
  float near = 16.0;
  // A constant bound with a break, because GLSL wants the trip count where it
  // can see it and the longest palette here is sixteen.
  for (int i = 0; i < 16; i++) {
    if (i >= count) {
      break;
    }
    vec3 entry = PALETTE[start + i];
    vec3 apart = biased - entry;
    float away = dot(apart, apart);
    if (away < near) {
      near = away;
      best = entry;
    }
  }
  return best;
}

/**
 * Which block of the coarse grid this is, and what colour it found there.
 *
 * The colour is taken from the *centre* of each block rather than averaged over
 * it. An average is the honest downsample and it is the wrong look: it softens
 * every block against its neighbour, and what makes this read as pixel art is
 * that each block is one flat colour lifted from somewhere real.
 *
 * Mirrors \`blocked\` in \`crates/prequel-render/src/filters.metal\`.
 */
vec3 blocked(vec2 uv, out vec2 index) {
  float cell = pitch();
  index = floor(centred(uv) / cell);
  return grab(uvOf((index + 0.5) * cell));
}

/**
 * The picture in two colours.
 *
 * Mirrors \`dithered\` in \`crates/prequel-render/src/filters.metal\`.
 */
vec3 dithered(vec2 uv) {
  vec2 index;
  vec3 c = blocked(uv, index);
  // Not quite black and not quite white: a two-colour picture drawn at the
  // extremes reads as a fault rather than as a screen.
  float on = luma(c) > bayer(index) ? 1.0 : 0.0;
  return mix(vec3(0.05), vec3(0.95), on);
}

/**
 * The picture in the colours one old machine had.
 *
 * Mirrors \`snapped\` in \`crates/prequel-render/src/filters.metal\`.
 */
vec3 snapped(vec2 uv, int palette) {
  vec2 index;
  return nearest(blocked(uv, index), index, palette);
}

/** How much ink a dot of this coverage puts down, on a screen ruled that way. */
float inked(vec2 p, float ink, float screen) {
  vec2 r = spun(p, screen) / pitch();
  vec2 f = fract(r) - 0.5;
  // The square root, because a dot's *area* is what reads as tone and area goes
  // with the square of the radius. Linear here makes the midtones far too light.
  float radius = sqrt(clamp(ink, 0.0, 1.0)) * 0.70;
  // Softened by a fixed amount in cell units, so a dot has an edge rather than
  // a staircase whatever the pitch is.
  return smoothstep(radius + 0.04, radius - 0.04, length(f));
}

/**
 * The picture as print.
 *
 * Mirrors \`halftoned\` in \`crates/prequel-render/src/filters.metal\`.
 */
vec3 halftoned(vec2 uv) {
  vec2 p = centred(uv);
  vec3 c = grab(uv);
  // Not pure white. Paper is not, and a halftone on pure white reads as a
  // graphic rather than as something printed.
  vec3 paper = vec3(0.96, 0.95, 0.93);
  vec3 printed;

  if (u_variant == 0) {
    printed = mix(paper, u_tint, inked(p, 1.0 - luma(c), u_angle));
  } else if (u_variant == 1) {
    // Two screens a sixth of a turn apart, which is where a duotone's second
    // colour goes: any closer and the two grids beat against each other.
    vec3 other = vec3(1.0) - u_tint;
    float first = inked(p, 1.0 - luma(c), u_angle);
    float second = inked(p, 1.0 - luma(c * vec3(0.6, 0.8, 1.0)), u_angle + 0.5236);
    printed = mix(mix(paper, u_tint, first), other, second * 0.5);
  } else {
    // Four screens on the classical angles — 15, 75, 0 and 45 degrees — which
    // are chosen so no two grids line up and the rosette stays fine.
    float k = 1.0 - max(max(c.r, c.g), c.b);
    float lit = max(1.0 - k, 0.001);
    float dc = inked(p, (1.0 - c.r - k) / lit, u_angle + 0.2618);
    float dm = inked(p, (1.0 - c.g - k) / lit, u_angle + 1.3090);
    float dy = inked(p, (1.0 - c.b - k) / lit, u_angle);
    float dk = inked(p, k, u_angle + 0.7854);
    // Multiplied, because ink is subtractive: two inks on one spot make a third
    // colour rather than a brighter one.
    vec3 ink = vec3(1.0);
    ink *= mix(vec3(1.0), vec3(0.00, 0.68, 0.94), dc);
    ink *= mix(vec3(1.0), vec3(0.93, 0.00, 0.55), dm);
    ink *= mix(vec3(1.0), vec3(1.00, 0.94, 0.00), dy);
    ink *= mix(vec3(1.0), vec3(0.08), dk);
    printed = ink * paper;
  }

  return mix(c, printed, u_strength);
}

/**
 * The picture as a panel, close up.
 *
 * The lifted black is the point. A CRT's black is the tube switched off and an
 * LCD's is the backlight leaking through a shut shutter — so the thing that
 * tells the two apart at a glance is that an LCD never quite reaches black.
 *
 * Mirrors \`panelled\` in \`crates/prequel-render/src/filters.metal\`.
 */
vec3 panelled(vec2 uv) {
  float cell = pitch();
  vec2 cells = centred(uv) / cell;
  vec2 inside = fract(cells);

  if (u_variant == 2) {
    // A dot matrix genuinely *is* a low-resolution display, so this one
    // quantises: the colour comes from the middle of the cell, and the whole
    // point of the look is that there is nothing in between. The calculator,
    // the pager, the handheld console.
    vec3 c = grab(uvOf((floor(cells) + 0.5) * cell));
    float on = smoothstep(0.42, 0.32, length(inside - 0.5));
    vec3 lit = mix(u_tint * 0.06, u_tint * luma(c) * 1.15, on);
    return mix(c, lit + u_tint * 0.05, u_strength);
  }

  // Sampled where the pixel is, not from the middle of its cell.
  //
  // Snapping to the cell centre is what a panel's own pixels do, and it is the
  // wrong thing to copy: a cell is several output pixels across, so snapping
  // downsamples the recording by that factor and every line of text in it
  // stops being readable — which is exactly what a screen recording is made
  // of. The stripes and the row gap are a texture laid *over* the picture, not
  // a resampling of it. The CRT samples continuously for the same reason.
  vec3 c = grab(uv);

  // Three stripes across the cell, one channel each.
  vec3 mask = vec3(0.28);
  float third = floor(inside.x * 3.0);
  if (third < 0.5) {
    mask.r = 1.0;
  } else if (third < 1.5) {
    mask.g = 1.0;
  } else {
    mask.b = 1.0;
  }
  if (u_variant == 1) {
    mask = mask.bgr;
  }

  // A dark row between the cells, which is what a panel's grid actually is.
  float gap = smoothstep(0.0, 0.10, inside.y) * smoothstep(1.0, 0.90, inside.y);
  // Both faded where the grid is finer than the raster — see \`resolved\`.
  mask = mix(vec3(1.0), mask, resolved(cells.x * 3.0));
  gap = mix(1.0, gap, resolved(cells.y));

  // Scaled back up, because only one channel in three is fully lit and the
  // frame would otherwise come out more than a stop down.
  //
  // The floor above is high for the same reason the gain here is modest: a
  // mask that drives the two unlit channels near zero has to be amplified hard
  // to get the light back, and in the shadows that amplification turns a dark
  // grey into saturated red-green-blue speckle. A real panel's dark pixels are
  // dark, not noisy.
  vec3 lit = c * mask * 1.9 * gap;
  return mix(c, lit + u_tint * 0.05, u_strength);
}

/**
 * The picture through a wide lens.
 *
 * The corner is mapped to the corner, so the frame stays full whichever way it
 * bends. Without that a barrel pulls the picture off its own edges and leaves a
 * clamped smear around the outside, which reads as a broken filter rather than
 * as a lens.
 *
 * Mirrors \`bulged\` in \`crates/prequel-render/src/filters.metal\`.
 */
vec3 bulged(vec2 uv) {
  vec2 p = centred(uv);
  float r2 = dot(p, p);
  float k = u_strength * 0.9;
  if (u_variant == 1) {
    k = -k;
  }
  vec2 edge = corner();
  float fit = 1.0 + k * dot(edge, edge);
  vec2 warped = p * (1.0 + k * r2) / max(fit, 0.05) * (1.0 - u_scale);

  vec2 at = uvOf(warped);

  // How far out this pixel is: 0 in the middle, 1 at the corner.
  float away = sqrt(r2) / max(length(edge), 0.001);

  /**
   * Field curvature — a wide lens does not hold focus out to the rim.
   *
   * It is the thing that separates a fish eye from a picture that has merely
   * been bent: the geometry alone comes out uncannily crisp at the edges, where
   * real glass of this shape cannot focus the corner and the centre on one
   * plane at once.
   *
   * Read off the mip chain rather than tapped, for the reason the glow is: a
   * handful of point samples spread wide enough to soften leaves gaps between
   * them and the eye reads those as grain.
   *
   * Three levels at full bulge and the ramp starting early, so the softness
   * builds across most of the frame. A shade over one level, which this was,
   * is a blur you have to be told about.
   */
  float lod = smoothstep(0.15, 1.0, away) * u_strength * 3.0;

  /**
   * Lateral colour, which comes with the same glass that bends the picture.
   *
   * Real wide glass does not bring the three ends of the spectrum to the same
   * radius, so the fringe grows outwards from a middle that has none — the
   * square of the distance, the same falloff the aberration look uses, rather
   * than a flat split that would read as a misregistered print.
   *
   * On the sampled position rather than on the warp coefficient. Bending each
   * channel by its own \`k\` is closer to what the glass does, but the fit that
   * keeps the corner in the corner is computed from \`k\` too, so the corner
   * comes out a fixed point and the fringe dies exactly where it should be
   * widest.
   */
  float shorter = min(u_frame.x, u_frame.y);
  vec2 along = warped / max(length(warped), 0.0001);
  vec2 split = along * away * away * u_strength * 0.012 * shorter / u_frame;

  vec3 c;
  c.r = textureLod(u_scene, clamp(at + split, 0.0, 1.0), lod).r;
  c.g = textureLod(u_scene, clamp(at, 0.0, 1.0), lod).g;
  c.b = textureLod(u_scene, clamp(at - split, 0.0, 1.0), lod).b;

  if (u_variant == 2) {
    // A peephole: heavy fall-off towards the rim and a highlight off to one
    // side, which is what says "glass" rather than "the picture is bent".
    c *= 1.0 - 0.75 * smoothstep(0.35, 1.0, away);
    c += vec3(0.22) * smoothstep(0.30, 0.0, length(p - edge * 0.42));
  }
  return c;
}

/**
 * The picture on a tube.
 *
 * Five things at once, and every one of them is needed: the glass curves, the
 * aperture mask splits each triad into its three phosphors, the scanlines
 * modulate down the screen, the highlights bloom *through* the mask, and the
 * corners fall off. Leave out the bloom and it reads as a grid laid over a
 * video rather than as a picture made of light.
 *
 * Mirrors \`tubed\` in \`crates/prequel-render/src/filters.metal\`.
 */
vec3 tubed(vec2 uv) {
  vec2 p = centred(uv);
  float r2 = dot(p, p);
  vec2 bent = p * (1.0 + 0.18 * r2 * u_strength);
  vec2 at = uvOf(bent);
  // Past the edge of the tube there is no picture — not a clamped stripe of the
  // nearest pixel, which is what a sampler would otherwise give.
  if (at.x < 0.0 || at.y < 0.0 || at.x > 1.0 || at.y > 1.0) {
    return vec3(0.0);
  }
  vec3 c = grab(at);

  vec2 r = spun(bent, u_angle) / pitch();
  float across = fract(r.x);
  float down = fract(r.y);

  if (u_variant == 1) {
    // A shadow mask staggers every other row by half a triad, which is what
    // turns stripes into the offset dots the name is about.
    across = fract(r.x + 0.5 * floor(wrap4(r.y) * 0.5));
  }

  vec3 mask = vec3(0.30);
  float triad = floor(across * 3.0);
  if (triad < 0.5) {
    mask.r = 1.0;
  } else if (triad < 1.5) {
    mask.g = 1.0;
  } else {
    mask.b = 1.0;
  }

  if (u_variant == 2) {
    // A slot mask: the same triad, broken into slots down the screen.
    float slot = smoothstep(0.0, 0.18, down) * smoothstep(1.0, 0.82, down);
    mask = mix(vec3(0.30), mask, slot);
  }

  // Faded out where the triad is finer than the raster. Without this the mask
  // is point-sampled at about a pixel per phosphor and the frame comes back
  // dark and speckled rather than masked.
  mask = mix(vec3(1.0), mask, resolved(r.x * 3.0));
  float scan = mix(1.0, 0.62 + 0.38 * cos(down * TAU), resolved(r.y));
  vec3 lit = c * mask * 2.1 * scan;
  // What is bright gets through the mask, which is the whole difference between
  // a tube and a screen door.
  lit += c * smoothstep(0.55, 1.0, luma(c)) * 0.55;
  lit *= u_tint;
  lit *= 1.0 - 0.45 * smoothstep(0.55, 1.0, length(p) / max(length(corner()), 0.001));

  // The refresh, when it moves. Slow, and barely there: a bar that announces
  // itself is a bar nobody can watch for a minute.
  if (u_time > 0.0) {
    lit *= 1.0 + 0.16 * smoothstep(0.10, 0.0, fract(at.y - u_time * 0.35));
  }

  return mix(c, lit, u_strength);
}

/**
 * The picture off tape.
 *
 * The chroma is sampled to the right of the luma, which is the actual composite
 * artefact — colour and brightness travel at different bandwidths and the
 * colour arrives late. Everything else here is mechanical: the line wanders,
 * the head switch tears the bottom of the field, and the tape hisses.
 *
 * Mirrors \`taped\` in \`crates/prequel-render/src/filters.metal\`.
 */
vec3 taped(vec2 uv) {
  float cell = pitch();
  float line = floor(centred(uv).y / cell);
  // A tick rather than the clock itself, so a whole line's worth of wobble
  // holds for a frame instead of crawling within it.
  float tick = floor(u_time * 24.0);
  float wander = (hash21(vec2(line, tick)) - 0.5) * 0.012 * u_strength;

  // The head switch: the last few lines of the field arrive from somewhere else.
  wander += smoothstep(0.96, 1.0, uv.y) * 0.05 * u_strength;

  vec2 at = vec2(uv.x + wander, uv.y);
  vec3 a = grab(at);
  vec3 b = grab(vec2(at.x + 0.006 * u_strength, at.y));
  // Luma from where the pixel is, chroma from where the colour arrived.
  vec3 c = vec3(luma(a)) + (b - vec3(luma(b)));

  // Tape hiss, on a fixed grid so it is the same size at any resolution.
  c += (hash21(vec2(floor(at.x * 640.0), line + tick)) - 0.5) * 0.10 * u_strength;

  if (u_time > 0.0) {
    // The tracking band, drifting up the picture the way an untracked tape does.
    float hit = smoothstep(0.03, 0.0, fract(uv.y + u_time * 0.08));
    c = mix(c, c * 0.6 + vec3(0.18), hit * u_strength);
  }

  return mix(grab(uv), c, u_strength);
}

/**
 * The picture on stock.
 *
 * Halation is the one worth knowing: bright light scatters off the back of the
 * film base and exposes the emulsion a second time from behind, which is why a
 * window in a film frame glows warm and a video frame's window just clips.
 *
 * Mirrors \`filmed\` in \`crates/prequel-render/src/filters.metal\`.
 */
vec3 filmed(vec2 uv) {
  // Gate weave: the frame was never quite still in the gate.
  vec2 at = uv;
  if (u_time > 0.0) {
    float weave = u_variant == 2 ? 0.0016 : (u_variant == 0 ? 0.0008 : 0.0003);
    float tick = floor(u_time * 16.0);
    at += vec2(hash21(vec2(tick, 3.0)) - 0.5, hash21(vec2(tick, 7.0)) - 0.5) * weave * 2.0;
  }
  vec3 c = grab(at);

  // Halation, on the same golden-angle spiral the depth of field uses. One blur
  // idiom in the codebase rather than two that could disagree about a radius.
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float turn = float(i) * 2.399963;
    float reach = sqrt(float(i) + 0.5) / 2.83;
    vec2 off = vec2(cos(turn), sin(turn)) * reach * pitch() * 1.5;
    vec3 tap = grab(uvOf(centred(at) + off));
    glow += tap * smoothstep(0.62, 1.0, luma(tap));
  }
  c += glow * 0.125 * u_tint * 0.85 * u_strength;

  // Grain, sized in the frame's own units — so it is grain, and not a picture
  // of this build's output resolution.
  float g = max(pitch() * 0.35, 0.0006);
  float n = hash21(floor(centred(at) / g) + vec2(floor(u_time * 24.0)));
  float amount = u_variant == 1 ? 0.045 : (u_variant == 0 ? 0.085 : 0.14);
  c += (n - 0.5) * amount * u_strength;

  // A gentle S, and the shadows pulled off colour the way an emulsion pulls them.
  float l = luma(c);
  c = mix(c, c * c * (3.0 - c - c), 0.35 * u_strength);
  c = mix(c, vec3(l), smoothstep(0.35, 0.0, l) * 0.30 * u_strength);
  return c;
}

/**
 * Highlights spreading into what is around them.
 *
 * Twenty-four taps on the golden-angle spiral, which is the same pattern and
 * the same reasoning as the depth of field's: point samples on a spiral read as
 * a blur where a ring of them reads as a ring.
 *
 * Mirrors \`bloomed\` in \`crates/prequel-render/src/filters.metal\`.
 */
vec3 bloomed(vec2 uv) {
  vec3 c = grab(uv);
  float radius = pitch() * 2.0;

  // Which level of the chain a tap comes from.
  //
  // A quarter of the radius, in texels of the scene. Each tap then already
  // averages a footprint that size, so sixteen of them across the disc overlap
  // instead of leaving holes — which is the whole difference between this and
  // the version that read as grain. \`sample_focused\` in the item shader
  // documents the same failure and answers it by adding taps; that works for a
  // defocus a few pixels wide and cannot work here, because a bloom is forty.
  float shorter = min(u_frame.x, u_frame.y);
  float level = clamp(log2(max(radius * shorter * 0.25, 1.0)), 0.0, 8.0);

  vec3 glow = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    float turn = float(i) * 2.399963;
    float reach = sqrt(float(i) + 0.5) / 4.05;
    vec2 off = vec2(cos(turn), sin(turn)) * reach * radius;
    vec3 tap = textureLod(u_scene, clamp(uvOf(centred(uv) + off), 0.0, 1.0), level).rgb;
    // A lower threshold than a photographic bloom would use, and deliberately.
    // A tap is an average of its footprint, so a line of white text two pixels
    // thick arrives as a mid grey rather than as white — threshold it where the
    // highlight actually is and text, which is most of what a screen recording
    // is made of, never glows at all.
    glow += tap * smoothstep(0.30, 0.85, luma(tap));
  }

  return c + glow * 0.0625 * u_tint * u_strength * 2.2;
}

/** How lit this point is, through whichever thing the light is coming past. */
float gobo(vec2 p) {
  vec2 r = spun(p, u_angle) / pitch();

  if (u_variant == 0) {
    // Blinds. Half a cycle per cell, so a slat and its gap share one pitch.
    float band = fract(r.y * 0.5);
    return smoothstep(0.18, 0.46, band) * smoothstep(0.92, 0.62, band);
  }
  if (u_variant == 1) {
    // A window: two crossed bars, the uprights at twice the spacing of the
    // rails, which is how a sash is actually built.
    float across = fract(r.x * 0.25);
    float down = fract(r.y * 0.5);
    float upright = smoothstep(0.06, 0.24, across) * smoothstep(0.96, 0.78, across);
    float rail = smoothstep(0.06, 0.24, down) * smoothstep(0.96, 0.78, down);
    return upright * rail;
  }
  if (u_variant == 2) {
    // A curtain: two waves whose frequencies do not divide each other, so the
    // folds never visibly repeat across the frame.
    return clamp(0.5 + 0.30 * sin(r.x * 1.7) + 0.20 * sin(r.x * 0.61 + 1.3), 0.0, 1.0);
  }
  // Leaves: noise at two scales, thresholded — which is dappled light, and is
  // the only one of the four that is not a ruled pattern.
  float n = valueNoise(r * 0.5) * 0.65 + valueNoise(r * 1.3) * 0.35;
  return smoothstep(0.34, 0.66, n);
}

/**
 * Light falling on the picture through something.
 *
 * The lit side warms and lifts; the shadowed side darkens *and cools*. That
 * split is the whole thing. A real shadow is not merely a darker copy — it is
 * lit by the sky rather than by the sun, so it is bluer — and a gobo that only
 * multiplies brightness reads as a grey overlay every time.
 *
 * Mirrors \`windowed\` in \`crates/prequel-render/src/filters.metal\`.
 */
vec3 windowed(vec2 uv) {
  vec3 c = grab(uv);
  float lit = gobo(centred(uv));
  vec3 sun = c * mix(vec3(1.0), u_tint * 1.35, 0.85);
  vec3 shade = c * vec3(0.82, 0.86, 1.00) * 0.55;
  return mix(c, mix(shade, sun, lit), u_strength);
}

/**
 * A picture that arrived badly.
 *
 * Five things, and it is the combination rather than any one of them: the frame
 * bends a little, the rim loses focus, the channels come apart as it does, the
 * highlights bloom, and the whole thing takes a colour it should not have.
 *
 * Deliberately not the CRT. That look is a tube — a mask, a grille, phosphors
 * you can count — and this one is the *signal*, which is why there is no mask
 * here and why the curve is a third of the tube's. Two looks that both say
 * "broadcast" have to differ by what they are actually about.
 *
 * Mirrors \`lost\` in \`crates/prequel-render/src/filters.metal\`.
 */
vec3 lost(vec2 uv) {
  vec2 p = centred(uv);
  float r2 = dot(p, p);
  vec2 bent = p * (1.0 + 0.07 * r2 * u_strength);
  vec2 at = uvOf(bent);
  // Past the edge there is no picture — not a clamped stripe of the nearest
  // pixel, which is what a sampler would otherwise give.
  if (at.x < 0.0 || at.y < 0.0 || at.x > 1.0 || at.y > 1.0) {
    return vec3(0.0);
  }

  // How far out this pixel is: 0 in the middle, 1 at the corner.
  float away = sqrt(r2) / max(length(corner()), 0.001);

  // Soft towards the rim, read off the mip chain rather than off a ring of
  // taps — which is what \`blurs\` is set for. A handful of point samples spread
  // wide enough to soften leaves gaps between them and the eye reads those as
  // grain, the same failure \`bulged\` documents.
  float lod = smoothstep(0.20, 1.0, away) * u_strength * 2.6;

  float shorter = min(u_frame.x, u_frame.y);
  vec2 along = bent / max(length(bent), 0.0001);
  vec2 split = along * away * u_strength * 0.012 * shorter / u_frame;

  vec3 c;
  c.r = textureLod(u_scene, clamp(at + split, 0.0, 1.0), lod).r;
  c.g = textureLod(u_scene, clamp(at, 0.0, 1.0), lod).g;
  c.b = textureLod(u_scene, clamp(at - split, 0.0, 1.0), lod).b;

  // The glow. Eight taps on the golden-angle spiral off a level of the chain
  // wide enough that they overlap — \`bloomed\` is the same idea at sixteen,
  // which is the budget of a look that does nothing else.
  float radius = pitch() * 8.0;
  float level = clamp(log2(max(radius * shorter * 0.25, 1.0)), 0.0, 8.0);
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float turn = float(i) * 2.399963;
    float reach = sqrt(float(i) + 0.5) / 2.83;
    vec2 off = vec2(cos(turn), sin(turn)) * reach * radius;
    vec3 tap = textureLod(u_scene, clamp(uvOf(bent + off), 0.0, 1.0), level).rgb;
    glow += tap * smoothstep(0.30, 0.85, luma(tap));
  }
  c += glow * 0.125 * u_tint * u_strength * 0.9;

  // The line structure, faded out where it is finer than the raster.
  float lines = bent.y / pitch();
  c *= mix(1.0, 0.58 + 0.42 * cos(lines * TAU), resolved(lines) * u_strength);

  // The cast, pulled towards a tinted grey rather than multiplied by the tint.
  // A multiply leaves the shadows neutral, and the whole point is that the
  // colour is wrong everywhere rather than only where the picture was bright.
  c = mix(c, mix(c, vec3(luma(c)) * u_tint, 0.75), u_strength * 0.55);

  // The corners going, which is where a weak signal loses it first.
  c *= 1.0 - 0.5 * u_strength * smoothstep(0.35, 1.05, away);

  if (u_time > 0.0) {
    // A band walking up the picture, and the level breathing under it. Slow:
    // this is a signal drifting, not a fault repeating.
    float band = fract(at.y + u_time * 0.11);
    float hit = clamp(smoothstep(0.06, 0.0, band) + smoothstep(0.94, 1.0, band), 0.0, 1.0);
    c = mix(c, c * 1.35 + vec3(0.05), hit * 0.5 * u_strength);
    c *= 1.0 + 0.03 * sin(u_time * 2.1);
  }

  return mix(grab(uv), c, u_strength);
}

/**
 * The picture through a misted lens.
 *
 * A blurred copy of the whole frame laid back over the sharp one and
 * *screened*, with the blacks lifted afterwards. That combination is the look —
 * it is what a diffusion filter in front of a lens does, and what a darkroom
 * print does when the same negative is exposed a second time out of focus.
 *
 * Deliberately not the glow. That look spreads *highlights* into what is around
 * them and leaves the rest of the picture exactly as it was, so a frame wearing
 * it is still a sharp frame. This one softens all of it and regrades what comes
 * back, and the sharp picture underneath is what stops the result being a blur.
 *
 * Mirrors \`dreamt\` in \`crates/prequel-render/src/filters.metal\`.
 */
vec3 dreamt(vec2 uv) {
  vec3 sharp = grab(uv);

  // A slow swell, when it moves. Nine seconds to the cycle and a fifth of the
  // radius: the softness should breathe at about the rate somebody watching
  // stops noticing they are watching, not at the rate of anything on screen.
  float swell = u_time > 0.0 ? 1.0 + 0.2 * sin(u_time * 0.7) : 1.0;
  float radius = pitch() * 4.0 * swell;

  // Which level of the chain a tap comes from — a quarter of the radius in
  // texels, so each tap already averages a footprint that size and twelve of
  // them overlap instead of leaving holes. The same arithmetic \`bloomed\` does,
  // and the same failure it avoids: gaps between wide taps read as grain.
  float shorter = min(u_frame.x, u_frame.y);
  float level = clamp(log2(max(radius * shorter * 0.25, 1.0)), 0.0, 8.0);

  // Two sums off one ring of taps: all of it, and only what was already bright.
  // The kinds differ by which of the two they lay back over the picture, so
  // gathering both costs nothing over gathering either.
  vec3 wide = vec3(0.0);
  vec3 bright = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float turn = float(i) * 2.399963;
    float reach = sqrt(float(i) + 0.5) / 3.54;
    vec2 off = vec2(cos(turn), sin(turn)) * reach * radius;
    vec3 tap = textureLod(u_scene, clamp(uvOf(centred(uv) + off), 0.0, 1.0), level).rgb;
    wide += tap;
    bright += tap * smoothstep(0.30, 0.85, luma(tap));
  }
  wide *= 0.0833333;
  bright *= 0.0833333;

  vec3 veil = wide;
  if (u_variant == 1) {
    // The halo: only what was bright bleeds, and it bleeds harder. A darkroom
    // print rather than a misted lens.
    veil = bright * 2.1;
  } else if (u_variant == 2) {
    // Clear through the middle and gone at the rim, which is what a dream with
    // one thing in it looks like.
    vec2 p = centred(uv);
    veil = wide * smoothstep(0.15, 0.95, length(p) / max(length(corner()), 0.001));
  }

  // Screened rather than added. Adding clips, and a window that was already
  // white goes to a flat patch with no edge left in it — the frame loses
  // exactly the highlight the effect was reaching for. Screen rolls off.
  vec3 c = 1.0 - (1.0 - sharp) * (1.0 - clamp(veil, 0.0, 1.0) * 0.82);

  // Warmed where it is bright, towards whatever the colour is set to. Only the
  // highlights, because that is where light that has been scattered ends up.
  c = mix(c, c * u_tint, smoothstep(0.30, 1.0, luma(c)) * 0.55);

  // Off saturation a little, then the blacks lifted *and cooled*. Haze is light
  // scattered into the shadows from everywhere in the room and the sky is the
  // brightest thing in most rooms, so what fills a shadow is blue — the same
  // reasoning \`windowed\` shades on, and the reason a flat grey lift reads as a
  // washed-out picture rather than as air.
  c = mix(c, vec3(luma(c)), 0.16);
  c += vec3(0.020, 0.026, 0.044);

  return mix(sharp, c, u_strength);
}

void main() {
  vec4 colour;

  if (u_look == 0) {
    colour = aberration(v_uv);
  } else if (u_look == 1) {
    colour = vec4(graded(grab(v_uv)), 1.0);
  } else if (u_look == 2) {
    colour = vec4(dithered(v_uv), 1.0);
  } else if (u_look == 3) {
    colour = vec4(halftoned(v_uv), 1.0);
  } else if (u_look == 4) {
    colour = vec4(panelled(v_uv), 1.0);
  } else if (u_look == 5) {
    colour = vec4(bulged(v_uv), 1.0);
  } else if (u_look == 6) {
    colour = vec4(tubed(v_uv), 1.0);
  } else if (u_look == 7) {
    colour = vec4(taped(v_uv), 1.0);
  } else if (u_look == 8) {
    colour = vec4(filmed(v_uv), 1.0);
  } else if (u_look == 9) {
    colour = vec4(bloomed(v_uv), 1.0);
  } else if (u_look == 10) {
    colour = vec4(windowed(v_uv), 1.0);
  } else if (u_look == 12) {
    colour = vec4(lost(v_uv), 1.0);
  } else if (u_look == 13) {
    colour = vec4(snapped(v_uv, 0), 1.0);
  } else if (u_look == 14) {
    colour = vec4(snapped(v_uv, 1), 1.0);
  } else if (u_look == 15) {
    colour = vec4(snapped(v_uv, 2), 1.0);
  } else if (u_look == 16) {
    colour = vec4(snapped(v_uv, 3), 1.0);
  } else if (u_look == 17) {
    colour = vec4(dreamt(v_uv), 1.0);
  } else {
    // A look this build has no shader for draws the frame it was given. The
    // same answer \`FilterKind::Unknown\` gives on the other side, and the same
    // reasoning: a picture unchanged is a far better failure than a blank one.
    colour = textureLod(u_scene, v_uv, 0.0);
  }

  // Every look but the aberration returns opaque colour. The scene covers the
  // frame, so that is what it is — and taking alpha from the look would let a
  // grade quietly make the export transparent.
  fragColor = colour;
}
`;
