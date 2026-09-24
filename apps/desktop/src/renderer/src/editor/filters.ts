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
  pixelate: 2,
  halftone: 3,
  lcd: 4,
  fisheye: 5,
  crt: 6,
  vhs: 7,
  film: 8,
  bloom: 9,
  "window-light": 10,
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
  float c = cos(u_angle);
  float s = sin(u_angle);
  vec2 turned = vec2(from.x * c - from.y * s, from.x * s + from.y * c);

  // At full strength the corner of a 16:9 frame splits by about two per cent of
  // its width — forty pixels at 1080p, and fourteen at the default strength. A
  // plain split rather than a subtle one, because somebody reaching for this is
  // reaching for the look.
  vec2 offset = turned * away * u_strength * 0.04;

  // Aspect taken back out. \`offset\` is in the square space \`centred\` works
  // in, and sampling needs it back in uv.
  float shorter = min(u_frame.x, u_frame.y);
  offset = offset * shorter / u_frame;

  vec4 green = texture(u_scene, uv);
  float r = texture(u_scene, uv + offset).r;
  float b = texture(u_scene, uv - offset).b;
  return vec4(r, green.g, b, green.a);
}

void main() {
  vec4 colour;

  if (u_look == 0) {
    colour = aberration(v_uv);
  } else {
    // A look this build has no shader for draws the frame it was given. The
    // same answer \`FilterKind::Unknown\` gives on the other side, and the same
    // reasoning: a picture unchanged is a far better failure than a blank one.
    colour = texture(u_scene, v_uv);
  }

  fragColor = colour;
}
`;
