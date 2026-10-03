/**
 * The preview's compositor, in WebGL.
 *
 * A deliberate mirror of `crates/prequel-render/src/shaders.metal`: the same
 * uniforms, the same modes, the same superellipse distance function, one quad
 * per primitive. Written that way so the two agree by construction rather than
 * by inspection — the plan already guarantees they draw the same *geometry*,
 * and this is what makes them draw the same *pixels*.
 *
 * It replaces a Canvas 2D compositor that could not express what the exporter
 * could. Two things it could not do:
 *
 * - A perspective transform. `setTransform` takes six numbers; parallel lines
 *   stay parallel by definition, and a tilt needs a homography.
 * - A blur that varies across the frame. `filter: blur()` is uniform per draw.
 *
 * Both are natural here, which is the point of the change. The immediate gain
 * is smaller and worth stating: the 2D compositor blurred shadows with a real
 * Gaussian while the exporter softens a distance field, so the preview and the
 * export have never quite agreed about shadows. Now they do.
 */
import {
  blobAt,
  movedBlob,
  captionAt,
  overlayAt,
  cropToFrame,
  cursorAt,
  loupeAt,
  rectAt,
  LOUPE_BLEED,
  LOUPE_SCRIM,
  LOUPE_SCRIM_REACH,
  LOUPE_REACH,
  SHADOW_SPREAD,
  type BlobKey,
  type BlobShape,
  type Paint,
  type PlanItem,
  type Rect,
  type RectKey,
  type RenderPlan,
  type LoupeKey,
  type Shape,
  type Size,
} from "../../../shared/layout";
import type { CameraGrade } from "../../../shared/camera-looks";
import { FILTERS, variantIndex } from "../../../shared/filters";
import { FILTER_LOOKS, FILTER_SHADER_SOURCE, filterTime } from "./filters";

/** Images the plan names by path — backgrounds, and the pointer. */
export type Images = Map<string, CanvasImageSource>;

/** The live video elements a plan draws from. */
export interface Sources {
  /**
   * The screen, which is a `<video>` for a recording and an `<img>` for a
   * screenshot — see `Manifest.still`.
   *
   * Widened to any drawable rather than branched on, because the compositor has
   * nothing to say about the difference: a texture upload takes either, and the
   * one thing that does differ is whether the pixels change between frames,
   * which `drawItem` reads off the element itself. The camera stays a `<video>`
   * because its matte is one and the two are kept on one clock.
   */
  screen: CanvasImageSource | null;
  camera: HTMLVideoElement | null;
  /**
   * The camera's person matte, when the recording has one and it is ready.
   * Sampled only where the plan asks for it — a matte the plan does not name
   * is a file, not a decision.
   */
  cameraMatte: HTMLVideoElement | null;
}

export interface Backing {
  width: number;
  height: number;
}

/**
 * How many textures the compositor keeps before it starts dropping the least
 * recently drawn — see `retire`.
 *
 * Comfortably above what any one frame needs: the screen, the camera, the
 * backdrop, a background picture, a pointer shape and however many caption cues
 * are on screen at once. `useCaptionImages` keeps twelve bitmaps, so the cap
 * only ever bites on the textures whose images that hook has already let go.
 */
const TEXTURE_CAP = 24;

/**
 * How long a new wallpaper takes to arrive, in milliseconds.
 *
 * Short. This is a change the user asked for by clicking a swatch, so the job
 * is to take the hard edge off it rather than to put on a transition — long
 * enough that nothing snaps, short enough that trying five wallpapers in a row
 * is still five answers and not a slideshow.
 */
const BACKGROUND_FADE_MS = 220;

const MODE_FILL = 0;
const MODE_GRADIENT = 1;
const MODE_IMAGE = 2;
const MODE_SHADOW = 3;
const MODE_STROKE = 4;
const MODE_LOUPE = 5;

/**
 * The two shader sources, exported for `webgl.test.ts` and nothing else.
 *
 * A shader is compiled at runtime, in the renderer, on a GPU — so nothing in
 * the build can tell you it is wrong. When one fails, `compile` logs it once
 * and the compositor draws nothing at all, which shows up as an entirely blank
 * preview and an export of plain background. Typechecking, the unit tests,
 * Prettier and the Rust suite all pass while that is happening, which is how a
 * reserved word shipped once already.
 */
export const SHADER_SOURCE = () => ({ vertex: VERTEX, fragment: FRAGMENT });

/**
 * The camera's colour grading, as source both the compositor and the Effects
 * list compile.
 *
 * Its own constant because the swatches in that list have to be graded by the
 * *same* arithmetic as the picture. A swatch drawn with a CSS filter, or with
 * an feColorMatrix approximating the same idea, would be a picture of a look
 * that is not the look — and a reader choosing from six of them has no way to
 * tell. So the list compiles this text into a shader of its own and draws a
 * reference image through it.
 *
 * Interpolated into FRAGMENT below rather than duplicated. Two copies of a
 * grade is the same mistake as two copies of a geometry.
 */
export const GRADE_GLSL = `/**
 * A hue angle in turns, as a colour to add.
 *
 * Not a full HSV conversion: these are offsets added to a picture, so what is
 * wanted is a direction in colour, and three cosines a third of a turn apart
 * give one for almost nothing. Centred on zero, so adding it shifts the hue
 * without also lifting the brightness the way a positive-only ramp would.
 */
vec3 hueColour(float turns) {
  float a = turns * 6.2831853;
  return vec3(cos(a), cos(a - 2.0943951), cos(a + 2.0943951)) * 0.3333333;
}

// Where skin sits, as red-minus-green over green-minus-blue. Measured off the
// faces in the sample recordings rather than taken from a paper: what matters
// is where a webcam puts skin, not where skin is.
const vec2 SKIN = vec2(0.19, 0.08);

float maxOf(vec3 v) { return max(v.r, max(v.g, v.b)); }
float minOf(vec3 v) { return min(v.r, min(v.g, v.b)); }

/**
 * The camera's colour look.
 *
 * One function for every look there is, driven by three vectors the plan carries —
 * see camera-looks.ts, which is the only place a look is defined. Neither shader
 * holds a catalogue, so neither can drift out of step with the other, and retuning
 * a look changes no shader at all. That is the whole difference between this and
 * the whole-frame filters, which are an arm of a switch in each.
 *
 * The order is the order a colourist works in: correct the white balance, set the
 * black point, shape the contrast, then touch the colour. Saturating before
 * balancing bakes the cast in.
 *
 * Taking the vectors as arguments rather than reading the uniforms, so the two
 * bodies are the same text in both languages and webgl.test.ts can say so.
 *
 * No backticks in here: this whole shader is a template literal, and one would
 * end it — which is a syntax error in the TypeScript, not in the shader.
 *
 * Mirrored verbatim in crates/prequel-render/src/shaders.metal.
 */
vec3 graded(vec3 rgb, vec4 a, vec4 b, vec4 c) {
  float temperature = a.x;
  float tint = a.y;
  float contrast = a.z;
  float saturation = a.w;
  float vibrance = b.x;
  float lift = b.y;

  // White balance first, because it is the only one of these correcting
  // something rather than styling it. A crude but well-behaved approximation:
  // red against blue for temperature, green against the other two for tint. A
  // real chromatic adaptation needs the source white point, which a webcam
  // does not tell us.
  rgb *= vec3(1.0 + 0.32 * temperature, 1.0 - 0.14 * tint, 1.0 - 0.32 * temperature);
  rgb = max(rgb, vec3(0.0));

  // The blacks lifted towards mid, without moving the whites. Compressing the
  // range from below rather than adding a constant: adding one raises the whole
  // picture and washes the highlights out with it.
  rgb = rgb * (1.0 - lift) + lift * 0.18;

  // An S-curve about mid grey. smoothstep rather than a power or a multiply: a
  // multiply clips the highlights the moment contrast goes up, and this is flat
  // at both ends so nothing stops abruptly. Negative contrast pulls towards the
  // pivot instead, which is a different operation and has to be.
  vec3 softer = vec3(0.4) + (rgb - vec3(0.4)) * 0.72;
  rgb = contrast >= 0.0 ? mix(rgb, smoothstep(vec3(0.0), vec3(1.0), rgb), contrast)
                        : mix(rgb, softer, -contrast);

  float grey = dot(rgb, vec3(0.2126, 0.7152, 0.0722));

  // Vibrance, and the reason it earns a lever of its own: it weights by how
  // grey a pixel already is, so a dull background comes up and a face that is
  // already colourful does not — and then weights again by distance from skin,
  // because a face is the thing a saturation control ruins first.
  float away = length(vec2(rgb.r - rgb.g, rgb.g - rgb.b) - SKIN);
  float flesh = 1.0 - smoothstep(0.08, 0.3, away);
  float dull = 1.0 - clamp(maxOf(rgb) - minOf(rgb), 0.0, 1.0);
  rgb = mix(vec3(grey), rgb, 1.0 + vibrance * dull * (1.0 - 0.75 * flesh));

  // And the flat one, which moves the face as much as anything else. Small
  // numbers only, in every look in the catalogue.
  rgb = mix(vec3(grey), rgb, 1.0 + saturation);

  // Split toning: shadows and highlights pulled towards opposing hues, which is
  // most of what reads as film. Weighted by luma so the two never fight over
  // the midtones, which is where a face lives.
  float dark = 1.0 - smoothstep(0.0, 0.5, grey);
  float light = smoothstep(0.5, 1.0, grey);
  rgb += hueColour(b.z) * (b.w * dark);
  rgb += hueColour(c.x) * (c.y * light);

  return clamp(rgb, vec3(0.0), vec3(1.0));
}
`;

const VERTEX = `#version 300 es
precision highp float;

uniform vec4 u_rect;
uniform vec2 u_frame;
// The region of the frame this pass is drawing into, as x, y, width, height in
// frame pixels. The whole frame for every pass but the lens's own, which draws
// the composition again over a small box around the glass — see renderGlass.
uniform vec4 u_view;
// Twelve numbers as four (x, y, w) corners, or w = 0 for "not tilted".
uniform vec3 u_quad[4];

out vec2 v_local;
out vec2 v_uv;
out vec2 v_screen;

void main() {
  // Four corners from the vertex id, no buffer: the rectangle is a uniform.
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));

  vec3 placed = u_quad[gl_VertexID];
  // The tilted corner if there is one, otherwise the plain rectangle.
  vec2 pixel = placed.z > 0.0 ? placed.xy : u_rect.xy + corner * u_rect.zw;
  float w = placed.z > 0.0 ? placed.z : 1.0;

  // Pixels to clip space, with y flipped: clip space is bottom-up and every
  // rectangle in the plan is top-down.
  //
  // Against the pass's own region rather than the frame, which is what lets the
  // lens draw the same plan into a small box at its own magnification. Every
  // other pass passes the whole frame, so this is the identity it always was.
  vec2 clip = ((pixel - u_view.xy) / u_view.zw) * 2.0 - 1.0;

  // Scaled by w, with w in the fourth component: the hardware divides by it
  // per fragment, which is what makes the texture and the shape follow the
  // perspective instead of being smeared across two flat triangles.
  gl_Position = vec4(clip.x * w, -clip.y * w, 0.0, w);
  v_local = corner * u_rect.zw;
  v_uv = corner;
  // Where this corner is in the output frame, so the fragment can measure its
  // distance from what is in focus.
  v_screen = pixel;
}`;

const FRAGMENT = `#version 300 es
precision highp float;

uniform vec4 u_rect;
uniform vec4 u_src;
uniform vec2 u_shape;
uniform vec4 u_colorA;
uniform vec4 u_colorB;
uniform vec2 u_gradient;
uniform int u_mode;
uniform float u_weight;
uniform int u_mirror;
// Depth of field: xy is what stays sharp in output pixels, z how far around it
// stays sharp, w the widest blur beyond. w of 0 means nothing is softened.
uniform vec4 u_focus;
// Motion blur on the pointer: xy is the streak as a vector in this quad's own
// uv, z how much of the quad on each side is padding the streak may run into,
// w non-zero to enable it at all.
uniform vec4 u_smear;
// The cursor's motion-blur box inside the larger shadow box, as x, y, width,
// height in outer-quad uv.
uniform vec4 u_cursorBox;
// Cursor shadow drop x/y, blur radius and opacity, in outer-quad units.
uniform vec4 u_cursorShadow;
// A flat blur across the whole quad, in the sampled image's own texels. Unlike
// \`u_focus\` it does not vary with where the pixel is — a caption word arriving
// out of focus is uniformly soft, and it is the only thing that uses this. 0
// softens nothing.
uniform float u_soften;
// How opaque a still image is drawn, 0 to 1. Everything else passes 1.
uniform float u_alpha;
// How hard the frame darkens towards its edges, 0 to 1. 0 darkens nothing.
uniform float u_vignette;
// The output frame, declared here as well as in the vertex stage: a uniform
// belongs to the program, not to one shader, so both stages that name it have to
// declare it. Without this the fragment shader fails to compile — and since the
// compositor logs that once and then draws nothing, the symptom is an entirely
// blank preview rather than a missing vignette.
uniform vec2 u_frame;
uniform vec2 u_texel;
uniform sampler2D u_image;
// A copy of what has already been drawn under this quad, and the two colours to
// choose between by how light it is. u_tint.w of 0 leaves the bitmap's own
// colour alone, which is every draw but an adaptive caption.
uniform sampler2D u_backdrop;
uniform vec4 u_onDark;
uniform vec4 u_onLight;
uniform float u_adapt;
// The camera's person mask, luma being alpha, and whether to apply it. Only a
// camera drawn as a cutout sets \`u_useMatte\`; every other draw leaves the
// sampler pointing wherever it was and never reads it.
uniform sampler2D u_matte;
uniform int u_useMatte;
// The camera's free-form outline for this frame: centre in xy, the radius it
// starts from in z, and how far open it is in w. Output pixels but the last.
//
// Measured against v_screen rather than v_local unlike every other shape here,
// because the quad a camera of this shape is drawn in is cut to the frame before
// it is drawn — a centre in the quad's own pixels would move by however much was
// cut off. A radius of 0 is every draw but that camera.
uniform vec4 u_blob;
// How the radius varies with the angle, as three harmonics: (cos t, sin t,
// cos 2t, sin 2t) and then (cos 3t, sin 3t, unused, unused). The third is what
// makes the shape lobed rather than merely oval; the editor is what decides how
// much of it arrives here.
uniform vec4 u_harmonics[2];
// The lens: its middle in xy and its radius in z, all in output pixels, and how
// present it is in w. A radius of 0 is every draw but a loupe.
uniform vec4 u_loupe;
// The camera's colour look, already resolved from the catalogue: temperature,
// tint, contrast and saturation; then vibrance, lift and the shadow tone; then
// the highlight tone and whether to grade at all. Only the camera ever sets it.
uniform vec4 u_gradeA;
uniform vec4 u_gradeB;
uniform vec4 u_gradeC;
// What sort of glass it is: the magnification in x, how deep the surface is in
// y, how far it splits colour in z and how much it reflects in w.
uniform vec4 u_glass;
// How far the picture inside the glass smears, as a vector in output pixels.
// Zero wherever the lens is still, which is most of the time it is on screen.
uniform vec4 u_motion;

in vec2 v_local;
in vec2 v_uv;
in vec2 v_screen;
out vec4 fragColor;

${GRADE_GLSL}

/**
 * The picture, enlarged without rounding its edges off.
 *
 * Texel snapping, and one tap. The sample is nudged so that the blend between
 * two source texels happens across one *output* pixel instead of across the
 * whole texel — so an edge in the recording arrives as an edge with one pixel of
 * antialiasing on it, however far the picture is being magnified, rather than as
 * a ramp as wide as the magnification. The hardware's own bilinear unit does the
 * blend; all this does is decide where to ask for it.
 *
 * Measured against the alternatives on a hard edge magnified 2x, as the biggest
 * step between neighbouring output pixels — which is what reads as sharpness:
 * plain bilinear 115, a nine-tap Catmull-Rom 132, this 216. The source's own
 * unmagnified edge is 216, so this is not an approximation of the right answer,
 * it is the right answer, and it is cheaper than either.
 *
 * It suits what Prequel magnifies. A screen recording is text, rules and
 * flat-filled panels on a pixel grid; a cubic kernel rings on exactly those, and
 * a linear one turns a one-pixel rule into a three-pixel smudge.
 */
vec4 sampleEnlarged(vec2 uv) {
  vec2 pos = uv / max(u_texel, vec2(1e-9));
  // One output pixel, measured in source texels. Never wider than a texel, or
  // the blend would be the plain linear one it is replacing.
  vec2 wide = clamp(fwidth(pos), vec2(1e-4), vec2(1.0));
  vec2 base = floor(pos - 0.5) + 0.5;
  // Flat at both texel centres, crossing over the width of one output pixel.
  vec2 snapped = clamp((pos - base - 0.5) / wide + 0.5, 0.0, 1.0);
  return texture(u_image, (base + snapped) * u_texel);
}

/**
 * How many source texels one output pixel covers.
 *
 * Off the screen-space derivatives rather than off the uniforms, which is what
 * makes it right in every pass: the lens draws the same plan into a target at
 * its own magnification, and a quad can be tilted, so the ratio of the
 * destination rectangle to the source crop is not the rate anything is actually
 * sampled at. This is the same quantity the hardware picks a mip level with.
 *
 * Below 1 the picture is being enlarged.
 */
float texelsPerPixel(vec2 uv) {
  vec2 rate = fwidth(uv) / max(u_texel, vec2(1e-9));
  return max(max(rate.x, rate.y), 1e-6);
}

/**
 * The picture, softened by how far this pixel is from what is in focus.
 *
 * One pass with a per-pixel radius rather than the usual two with a fixed one:
 * a separable blur has a single kernel for the whole frame, and progressive
 * means the kernel changes everywhere. Sixteen taps on a spiral — enough that
 * the falloff reads as defocus rather than as rings, and cheap enough to do at
 * export resolution.
 */
vec4 sampleFocused(vec2 uv) {
  float away = max(distance(v_screen, u_focus.xy) - u_focus.z, 0.0);

  // smoothstep, and over half again the sharp radius.
  //
  // This was a square of the ramp over u_focus.z, and both halves of that
  // showed. A square leaves rest smoothly and *arrives* at full blur with its
  // steepest slope, so where the ramp saturated the rate of change fell to
  // nothing in one step — a slope discontinuity, which the eye reads as a ring
  // at a fixed distance from the subject rather than as defocus. smoothstep is
  // flat at both ends, so there is no edge to find at either.
  //
  // The wider ramp is the other half. Tying the transition to exactly the sharp
  // radius made it as tight as the sharp area itself, so a small blurSafe — the
  // setting that ought to give a *shallower* depth of field — instead gave a
  // hard-edged hole. Half again is enough to read as a lens.
  //
  // Whichever asks for more. The two never apply to the same draw today — the
  // depth of field is on the picture, the soften is on a caption — and taking
  // the larger keeps one tap loop rather than two that could disagree about
  // what a radius means.
  float radius = max(u_focus.w * smoothstep(0.0, max(u_focus.z * 1.5, 1.0), away), u_soften);

  // Enlarging: a cubic kernel recovers the edge a linear one rounds off. The
  // source runs out long before the lens does — an Automatic frame exports at
  // the recording's own size, so a 2x zoom of any kind has nothing left to read
  // and everything to do with how it interpolates.
  if (radius <= 0.5) {
    return texelsPerPixel(uv) < 0.95 ? sampleEnlarged(uv) : texture(u_image, uv);
  }

  // The tap count follows the radius rather than being fixed at sixteen.
  //
  // These are point samples on a spiral, not a kernel — sixteen of them are
  // dense enough to read as a blur across a caption's few pixels, and spread
  // across a background's fifty they leave gaps between them. The eye reads
  // those gaps as grain, which is exactly what a soft backdrop must not have.
  //
  // Capped, because the background fill covers every pixel of the frame and
  // this loop runs for all of them. \`span\` is the square root of the count, so
  // the outermost tap still lands on the edge of the disc whatever the count
  // is — it was hard-coded as 4 for sixteen taps.
  int taps = int(clamp(radius, 16.0, 48.0));
  float span = sqrt(float(taps));

  vec4 total = vec4(0.0);
  for (int tap = 0; tap < taps; tap++) {
    float turn = float(tap) * 2.399963;
    float reach = sqrt(float(tap) + 0.5) / span;
    vec2 offset = vec2(cos(turn), sin(turn)) * reach * radius * u_texel;
    total += texture(u_image, uv + offset);
  }
  return total / float(taps);
}

/**
 * The colour these words should be, given what is behind them.
 *
 * Sixteen taps on a fixed grid rather than a mipmap: a mipmap's filtering is
 * the driver's business and this has to come out the same here and in the
 * exporter, or a caption is dark in the preview and light in the file. Every
 * fragment of the quad computes the same average, which is the point — a line
 * split between two colours would read as a mistake rather than as contrast.
 *
 * Mixed across a band rather than switched at a threshold, for the same
 * reason: on a backdrop near the middle the two rasterisers can measure very
 * slightly differently, and a mix turns that into an imperceptible difference
 * of colour instead of a flip.
 *
 * Mirrors chosen() in shaders.metal.
 */
vec3 chosen() {
  float luma = 0.0;
  for (int tap = 0; tap < 16; tap++) {
    vec2 at = (vec2(float(tap % 4), float(tap / 4)) + 0.5) / 4.0;
    vec3 behind = texture(u_backdrop, at).rgb;
    luma += dot(behind, vec3(0.2126, 0.7152, 0.0722));
  }

  return mix(u_onDark.rgb, u_onLight.rgb, smoothstep(0.42, 0.62, luma / 16.0));
}

// Distance to the camera's free-form outline, in output pixels. Negative inside,
// positive outside. Verbatim from the Metal shader.
//
// A radius that varies with the angle: a circle, plus three harmonics that lean
// it, oval it and lobe it. The series matters, not just the idea — two
// rasterisers evaluating it differently is a preview and an export whose
// outlines disagree.
//
// Not a true signed distance: off the curve it is out by however fast the radius
// is turning. That only scales the one pixel of feathering at the edge, and the
// editor keeps the harmonics well under a fifth of it so it stays gentle.
float blobDistance(vec2 p) {
  vec2 d = p - u_blob.xy;
  // The picture is mirrored by flipping its uv, which leaves the outline facing
  // the way the camera did and the person facing the other. Reflecting the point
  // we measure from is the same reflection, one line earlier.
  if (u_mirror != 0) {
    d.x = -d.x;
  }

  float t = atan(d.y, d.x);
  vec4 low = u_harmonics[0];
  vec4 high = u_harmonics[1];
  float bend = low.x * cos(t) + low.y * sin(t)
             + low.z * cos(2.0 * t) + low.w * sin(2.0 * t)
             + high.x * cos(3.0 * t) + high.y * sin(3.0 * t);

  // Never inside out, whatever the harmonics say. The editor scales them well
  // inside this, and a plan from anywhere else does not get to fold the curve
  // through its centre.
  float radius = u_blob.z * max(1.0 + bend, 0.1) * u_blob.w;
  return length(d) - radius;
}

// Signed distance to a superellipse-cornered rectangle. Negative inside,
// positive outside, in pixels. Verbatim from the Metal shader.
float shapeDistance(vec2 p, vec2 halfSize, float radius, float n) {
  radius = min(radius, min(halfSize.x, halfSize.y));
  if (radius <= 0.0) {
    vec2 d = abs(p) - halfSize;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }

  vec2 corner = abs(p) - (halfSize - radius);
  if (corner.x <= 0.0 || corner.y <= 0.0) {
    vec2 d = abs(p) - halfSize;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }

  vec2 q = corner / radius;
  float value = pow(q.x, n) + pow(q.y, n);
  return (pow(value, 1.0 / n) - 1.0) * radius;
}

/**
 * The pointer, smeared along the direction it is travelling.
 *
 * The streak arrives finished, in this quad's uv, because the editor computed it
 * once - see CursorPoint.smearX in shared/layout.ts. Nothing here knows a
 * speed, a direction or a frame rate, which is the only reason this and the
 * export cannot disagree about it.
 *
 * No backticks anywhere in here: this whole shader is a JS template literal, and
 * one would end the string. That is why every other comment in it names its
 * symbols bare.
 *
 * The quad arrives grown by u_smear.z on each side so the streak has somewhere
 * to be drawn; without that it would stop dead at the sprite's own edge, which
 * reads as the pointer being clipped rather than as motion. inner maps back off
 * that padding, and a tap landing outside the sprite contributes nothing rather
 * than the clamped edge texel — which would drag the arrow's tip into a stripe
 * running the length of the streak.
 *
 * Nine taps, not the sixteen sampleFocused uses: those cover a disc and these
 * cover a line, so the same density needs far fewer. Plain samples rather than
 * focused ones — the pointer sits on the focal plane, and 9 x 16 taps to
 * defocus something already sharp is not worth the frame time.
 *
 * Mirrors sample_smeared in crates/prequel-render/src/shaders.metal.
 */
vec4 sampleSmeared(vec2 uv) {
  float pad = u_smear.z;
  float span = max(1.0 - 2.0 * pad, 0.0001);

  vec4 total = vec4(0.0);
  for (int tap = 0; tap < 9; tap++) {
    // Centred on the position: half the streak trails the pointer and half
    // leads it. Trailing only would sit the sprite at the end of its own smear
    // and read as the pointer lagging behind the cursor.
    float along = float(tap) / 8.0 - 0.5;
    vec2 inner = (uv + u_smear.xy * along - pad) / span;
    if (any(lessThan(inner, vec2(0.0))) || any(greaterThan(inner, vec2(1.0)))) continue;
    total += texture(u_image, u_src.xy + inner * u_src.zw);
  }
  return total / 9.0;
}

/** Alpha of the pointer silhouette, softened in source uv space. */
float cursorShadowAlpha(vec2 uv) {
  // The cursor quad is larger than the source sprite. Clamp-to-edge is useful
  // for crops, but outside this silhouette it turns the edge texel into a
  // solid rectangle — exactly the static-pointer artefact the moving smear
  // path hid by rejecting its own outside taps.
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
  float radius = u_cursorShadow.z / max(u_cursorBox.z, 0.0001);
  if (radius <= 0.0) return texture(u_image, u_src.xy + uv * u_src.zw).a;

  float total = 0.0;
  for (int tap = 0; tap < 9; tap++) {
    float turn = float(tap) * 2.399963;
    float reach = sqrt(float(tap) + 0.5) / 3.0;
    vec2 sampleUv = uv + vec2(cos(turn), sin(turn)) * reach * radius;
    if (any(lessThan(sampleUv, vec2(0.0))) || any(greaterThan(sampleUv, vec2(1.0)))) continue;
    total += texture(u_image, u_src.xy + sampleUv * u_src.zw).a;
  }
  return total / 9.0;
}

// Both compositors blend premultiplied source-over, so every return folds its
// alpha into the RGB. Verbatim from premultiplied in
// crates/prequel-render/src/shaders.metal.
//
// Doing it in the shader rather than asking for a SRC_ALPHA blend is what lets
// both sides run one blend mode each. With SRC_ALPHA the alpha lands twice and
// every translucent thing draws at its own opacity squared — a pill set to 60%
// arrives at 36%, and antialiased glyph edges erode.
vec4 premultiplied(vec3 rgb, float alpha) {
  return vec4(rgb * alpha, alpha);
}

/**
 * How much this pixel keeps, given how far it is from the middle of the frame.
 *
 * Measured against the *frame*, not the picture: a zoom pushes the picture past
 * the frame's edges, and a vignette that followed the picture would drift off
 * screen exactly when it was doing the most work. Normalised so a corner reads 1
 * whatever the aspect ratio, or a 9:16 export would be darker than a 16:9 one at
 * the same setting.
 *
 * Mirrored verbatim by the same function in shaders.metal. No backticks in here:
 * this whole shader is a template literal, and one would end it.
 */
float vignette(vec2 screen) {
  if (u_vignette <= 0.0) return 1.0;

  vec2 fromCentre = screen / u_frame - 0.5;
  float away = length(fromCentre) / 0.7071068;
  // Starting well inside the corner, so the middle of the frame is untouched and
  // the falloff has room to read as shading rather than as a hard edge.
  return 1.0 - u_vignette * smoothstep(0.35, 1.0, away);
}

// ── The loupe ───────────────────────────────────────────────────────────────
//
// A glass lens lying on the finished frame. Every one of these is mirrored
// verbatim in shaders.metal: this is shading rather than geometry, so the plan
// cannot carry the answer and each rasteriser works it out itself — which only
// agrees if the arithmetic is the same arithmetic.

// How far past the glass the quad reaches, as a fraction of the radius, so the
// shadow has somewhere to fall off. Interpolated from shared/layout.ts, which
// is what grows the quad in the first place — one number rather than two that
// could drift.
const float LOUPE_BLEED = ${LOUPE_BLEED.toFixed(2)};
const float LOUPE_SCRIM_REACH = ${LOUPE_SCRIM_REACH.toFixed(2)};
const float LOUPE_SCRIM = ${LOUPE_SCRIM.toFixed(2)};

// How far around the glass the lens's own render reaches, in radii. Interpolated
// from shared/layout.ts, which is where the reason lives — one number, not two
// that could drift. Two decimal places, not one: at one, 1.75 came through here
// as 1.8 and the two shaders sampled different regions of the same render.
const float LOUPE_REACH = ${LOUPE_REACH.toFixed(2)};

// The refractive index of the glass. Crown glass, which is what a loupe is
// actually ground from.
const float LOUPE_IOR = 1.52;

// How far either side of that the red and the blue ends sit at full dispersion.
// Far more than crown glass really splits: a lens a few hundred pixels across
// splits by well under one of them, so a physical figure here would be a control
// that does nothing at any setting.
const float LOUPE_SPREAD = 0.2;

// How far the refracted ray walks back towards the middle at the rim, in radii.
//
// This is the stretch, and it is the whole character of a thick glass edge. Across
// the rolled edge the sample is pulled inwards, so a thin ring of the picture just
// inside the glass is smeared across the entire band — the edge *expands* what is
// near it rather than merely bending it, and in the last of the band it folds, the
// way the lip of a glass paperweight folds what is under it.
//
// It is also what makes the fringing spectral rather than a hairline. The three
// channels are separated by how much their bend differs, and across a band this
// steep that difference is tens of pixels.
const float LOUPE_STRETCH = 0.42;

// How many moments of the shutter a moving lens is sampled at. Five: the taps
// cover a line rather than a disc, so far fewer are needed than a defocus — the
// pointer's own streak uses nine over a sprite a tenth of this size.
const int LOUPE_SMEAR_TAPS = 5;

// Where the key light is, for the highlight on the glass. Up and to the left,
// which is where every shadow in this composition already says it is.
//
// Written out already normalised rather than through normalize(): a const
// initialiser has to be a constant expression, and a built-in call is not one.
const vec3 LOUPE_LIGHT = vec3(-0.4508, -0.6211, 0.6411);

// How far over the glass has turned at its rim, as the sine of the slope.
// Just short of standing on end: at exactly vertical the refracted ray runs
// flat and the sample it asks for is nowhere, and the last pixel of the lens
// comes back as whatever the sampler clamped to.
const float LOUPE_ROLL = 0.995;

// How much of the radius is the rolled edge, at each end of the curvature
// control. The bottom is a lens that is flat almost to its rim; the top turns
// over through half of itself, which is a ball rather than a magnifier.
const float LOUPE_EDGE_FLAT = 0.08;
const float LOUPE_EDGE_FULL = 0.55;

/**
 * The composition at a point in the frame, as the lens sees it.
 *
 * u_backdrop holds the lens's own render: the plan drawn a second time over a
 * box LOUPE_REACH radii around the glass, at the magnification. So this is not
 * a copy of the finished frame — the picture in it comes off the recording at
 * the recording's own resolution, which is the only way a magnified lens can be
 * sharp. Enlarging output pixels can only ever blur what is already there.
 *
 * The box is the glass's own, so nothing extra has to be carried to find it.
 *
 * u_src is how each rasteriser states its buffer's orientation: this one renders
 * into a framebuffer that runs bottom-up, so it passes (0, 1, 1, -1); the
 * exporter's texture is top-down, so it passes (0, 0, 1, 1). One number rather
 * than a flip written into the shader, which is exactly the kind of thing only
 * one of the two would ever get right.
 */
vec3 behind(vec2 screen) {
  float span = 2.0 * LOUPE_REACH * u_loupe.z;
  vec2 at = (screen - (u_loupe.xy - LOUPE_REACH * u_loupe.z)) / span;
  return texture(u_backdrop, u_src.xy + at * u_src.zw).rgb;
}

/**
 * The surface normal of the lens at a point on it, in lens radii.
 *
 * An aspheric, not a sphere cap, and the difference is the whole look. A cap
 * shallow enough to magnify cleanly is very nearly flat everywhere, so both the
 * squeeze and the glint off its surface collapse into the last one per cent of
 * the radius and there is nothing to see. This is the shape a magnifier
 * actually is: flat across the working area, then rolled over through the outer
 * edge until it stands almost on end where it meets its mount.
 *
 * roll is the sine of the surface's slope, so the vector below is already unit
 * length. LOUPE_ROLL stops just short of vertical: at the rim the glass is
 * grazing, which is what squeezes the picture out to meet the screen and what
 * puts a Fresnel edge on it with nothing drawn there.
 */
vec3 lensNormal(vec2 offset, float edge) {
  float r = length(offset);
  float roll = smoothstep(1.0 - edge, 1.0, r) * LOUPE_ROLL;
  // Straight out from the middle, which is the way a surface of revolution
  // leans. Nothing at the very centre, where there is no direction and no
  // slope either.
  vec2 away = r > 1e-4 ? offset / r : vec2(0.0);
  return vec3(away * roll, sqrt(max(1.0 - roll * roll, 1e-6)));
}

/** How far the refracted ray walks off the axis per unit of depth. */
float lensBend(vec3 normal, float ior) {
  // Looking straight down, refracted at the surface on the way in.
  vec3 through = refract(vec3(0.0, 0.0, -1.0), normal, 1.0 / ior);
  return length(through.xy) / max(-through.z, 1e-4);
}

/**
 * How far from the middle of the lens to sample, as a fraction of how far this
 * pixel is from it.
 *
 * 1 / magnify through the flat middle, so the picture there is enlarged by
 * exactly what was asked for. Across the rolled edge the refracted ray leaves
 * the axis faster and faster, and the fraction is walked back up to 1 — so the
 * last of the glass shows the frame at its own size and the magnified image
 * *meets* the screen it is lying on. Without that the lens ends on a seam, and
 * the whole thing reads as a circle pasted on the frame rather than as glass.
 *
 * Measured against the rim's own bend rather than against a fixed number, which
 * is what makes that arrival exact at every curvature: Snell decides how the
 * squeeze is distributed across the edge, and this decides where it ends.
 *
 * ior is a parameter so each of the three channels can be given its own. That is
 * all dispersion is, and it is the whole of the aberration control.
 */
float lensReach(vec2 offset, float edge, float magnify, float ior) {
  float r = length(offset);
  float bend = lensBend(lensNormal(offset, edge), ior);
  // The rim measured at the glass's *own* index, not at this channel's, and
  // that is the whole of the fringing.
  //
  // Normalising each channel against its own rim divided the dispersion back
  // out again: both the bend and the rim scale with the index, so the ratio came
  // out very nearly the same for all three and the control did nothing at any
  // setting. Against one reference the three channels land apart — and they land
  // apart *by how much the bend differs*, which is nothing in the flat middle
  // and most at the rim. Which is where fringing belongs.
  float rim = lensBend(lensNormal(vec2(1.0, 0.0), edge), LOUPE_IOR);
  // smoothstep rather than the ratio itself, so the mapping is flat at both ends
  // and there is no distance from the middle at which the squeeze visibly starts
  // — the same reason sampleFocused ramps the way it does.
  // The walk, in radii, and exactly zero across the flat middle — the bend is
  // zero there, so the middle magnifies by what was asked for and nothing else.
  // Divided by the magnification so a strong lens folds no harder than a weak
  // one: the band is a fraction of the picture, not a fixed number of pixels.
  float walk = (LOUPE_STRETCH / magnify) * smoothstep(0.0, 1.0, bend / max(rim, 1e-4));
  // Back to a multiplier on the offset. Never past the middle of the glass,
  // which is where a fold would start turning itself inside out.
  return max(1.0 / magnify - walk / max(r, 1e-3), 0.02);
}

/**
 * One sample through the glass, at one moment of the shutter.
 *
 * along runs from -0.5 to 0.5 across the streak, so the smear is centred on
 * where the lens is rather than trailing behind it — the same arrangement the
 * pointer's smear uses, and for the same reason: trailing alone reads as the
 * glass lagging the hand.
 *
 * No backticks in here: this whole shader is a template literal, and one would
 * end it.
 */
vec3 lensTap(vec2 centre, vec2 offset, float edge, float magnify, float ior,
             float radius, vec2 smear, float along) {
  float reach = lensReach(offset, edge, magnify, ior);
  // Where this pixel's content has travelled to, which is not where the glass
  // has. Move the lens by d and the point it samples moves by d * (1 - reach):
  // the middle of a 2x glass drifts with the picture under it and smears half
  // as much as the rim, which is what parallax through a lens actually looks
  // like.
  return behind(centre + offset * reach * radius + smear * ((1.0 - reach) * along));
}

void main() {
  // The lens, first, because nothing else in here applies to it: its quad is a
  // square grown around the glass for the shadow, and the shape that matters is
  // the circle inside it rather than the rectangle the quad covers.
  if (u_mode == 5) {
    float radius = max(u_loupe.z, 1.0);
    // In lens radii, so every number below is read against the glass itself.
    vec2 offset = (v_screen - u_loupe.xy) / radius;
    float r = length(offset);

    // The shadow the glass casts, drawn in the bleed the quad was grown by. The
    // same logistic falloff the rectangle shadows use — a blurred edge decays
    // rather than stopping — dropped by a fraction of the radius so the lens
    // stands off the picture instead of sitting in it.
    float sigma = LOUPE_BLEED * 0.42;
    float under = length(offset - vec2(0.0, LOUPE_BLEED * 0.3)) - 1.0;
    float shadow = 0.16 * u_loupe.w / (1.0 + exp(1.702 * under / sigma));
    float scrim = LOUPE_SCRIM * u_loupe.w * (1.0 - smoothstep(1.0, LOUPE_SCRIM_REACH, r));
    float shade = shadow + scrim * (1.0 - shadow);

    // One pixel of feathering at the rim, in pixels, like every other edge here.
    float cover = 1.0 - smoothstep(-0.5, 0.5, (r - 1.0) * radius);
    if (cover <= 0.0) {
      // Only the shadow out here. Premultiplied black, so it darkens whatever
      // the frame already put down.
      fragColor = premultiplied(vec3(0.0), shade);
      return;
    }

    // Flat almost to the rim at one end, half of it turned over at the other.
    float edge = mix(LOUPE_EDGE_FLAT, LOUPE_EDGE_FULL, clamp(u_glass.y, 0.0, 1.0));
    vec3 normal = lensNormal(offset, edge);
    float magnify = max(u_glass.x, 1.0);
    float split = clamp(u_glass.z, 0.0, 1.0) * LOUPE_SPREAD;

    // The streak, and how many moments of the shutter to take. One below a
    // pixel: a smear that short is not visible, and the taps cost the same
    // whether the lens is moving or not. Mirrors the pointer's own threshold.
    vec2 smear = u_motion.xy;
    int moments = length(smear) >= 1.0 ? LOUPE_SMEAR_TAPS : 1;

    vec3 lit = vec3(0.0);
    for (int tap = 0; tap < moments; tap++) {
      float along = moments > 1 ? float(tap) / float(moments - 1) - 0.5 : 0.0;
      if (split <= 0.0) {
        lit += lensTap(u_loupe.xy, offset, edge, magnify, LOUPE_IOR, radius, smear, along);
      } else {
        // Three taps rather than one blurred one: a fringe is each channel
        // landing somewhere slightly different, not all of them being soft.
        lit += vec3(
          lensTap(u_loupe.xy, offset, edge, magnify, LOUPE_IOR - split, radius, smear, along).r,
          lensTap(u_loupe.xy, offset, edge, magnify, LOUPE_IOR, radius, smear, along).g,
          lensTap(u_loupe.xy, offset, edge, magnify, LOUPE_IOR + split, radius, smear, along).b
        );
      }
    }
    lit /= float(moments);

    float shine = clamp(u_glass.w, 0.0, 1.0);

    // What the glass reflects. Schlick's approximation: barely reflective looked
    // at straight on, a mirror at the rim where the surface has turned away.
    float fresnel = 0.04 + 0.96 * pow(1.0 - normal.z, 5.0);
    // Straight out from the middle and a little past the rim, which is where a
    // convex surface of revolution sends what it reflects — and near the rim is
    // the only place the Fresnel term lets any of it through.
    //
    // A bounded step rather than following the reflected ray to where it lands.
    // Near grazing that ray runs almost flat, so the true landing point is very
    // far away; under a clamped sampler far away is the corner of the frame, and
    // that drew as a black cap over the top of every lens.
    vec2 outward = offset / max(r, 1e-3);
    vec3 around = behind(u_loupe.xy + outward * radius * (1.1 + 0.3 * edge));

    // And the room the glass is standing in, which is the half of the reflection
    // the frame cannot supply.
    //
    // The surroundings alone are not enough to read as glass: a lens over a dark
    // panel reflects a dark panel and comes out as a hole cut in the picture.
    // Real glass on a dark desk still carries a bright edge, and that light is
    // the room rather than the desk. So this is a plain studio gradient — bright
    // where the surface turns up to the ceiling, dim where it turns down to the
    // table — and it is what the rim is made of now that nothing is drawn there.
    vec3 room = mix(vec3(0.04), vec3(0.92), smoothstep(-0.5, 0.75, -normal.y));
    lit = mix(lit, mix(around, room, 0.55), fresnel * shine);

    // The highlight, and a broad sheen under it. One light: the tight term is the
    // reflection of the source itself and the wide one is the glass being lit at
    // all, and without the second the first reads as a sticker.
    float facing = max(dot(normal, LOUPE_LIGHT), 0.0);
    lit += shine * (pow(facing, 40.0) * 0.7 + pow(facing, 4.0) * 0.08);

    // The glass over its own shadow, both premultiplied: what is left of the
    // shadow is the part the glass does not cover. Presence rides on the
    // coverage, so an arriving lens is see-through rather than popping in.
    float shown = cover * u_loupe.w;
    fragColor = vec4(lit * shown, shown + (1.0 - shown) * shade);
    return;
  }

  vec2 halfSize = u_rect.zw * 0.5;
  vec2 p = v_local - halfSize;
  // The outline, when the camera has one, otherwise the rounded rectangle every
  // other primitive is. In output pixels either way, which is what lets the one
  // pixel of feathering further down mean the same thing.
  //
  // Switched on the outline's own radius, which is above zero only for that
  // camera. A moment with nobody in front of it has a presence of zero instead,
  // which makes the radius zero here and draws nothing — where falling back to
  // the rounded rectangle would draw the whole uncropped camera picture flashed
  // across the frame.
  float d = u_blob.z > 0.0 ? blobDistance(v_screen)
                           : shapeDistance(p, halfSize, u_shape.x, u_shape.y);

  // Shadows are the same shape, softened — so the blur follows the silhouette
  // rather than the bounding box.
  if (u_mode == 3) {
    float sigma = max(u_weight, 0.0001);
    // The rectangle arrived grown by SHADOW_SPREAD sigmas so the falloff has
    // somewhere to be drawn; take it back off to find the shape casting it.
    vec2 caster = max(halfSize - ${SHADOW_SPREAD.toFixed(1)} * sigma, vec2(0.0));
    float away = shapeDistance(v_local - halfSize, caster, u_shape.x, u_shape.y);
    // A blurred edge is a Gaussian's integral — half opacity on the edge,
    // decaying without ever quite stopping. \`smoothstep\` reaches zero at a
    // fixed distance and leaves a rim where the shadow ends, which is what made
    // this read as a slab of paint. This is the logistic approximation to that
    // integral: within half a percent of it everywhere, and one \`exp\`.
    fragColor = premultiplied(u_colorA.rgb, u_colorA.a / (1.0 + exp(1.702 * away / sigma)));
    return;
  }

  if (u_mode == 4) {
    // A stroke lies inside the silhouette, between the edge and the same shape
    // inset by its width. Verbatim from shaders.metal, where the note on what
    // straddling the edge did to the corners lives.
    float width = max(u_weight, 0.5);
    float outer = 1.0 - smoothstep(-0.5, 0.5, d);
    float inner = 1.0 - smoothstep(-0.5, 0.5, d + width);
    fragColor = premultiplied(u_colorA.rgb, u_colorA.a * (outer - inner));
    return;
  }

  // One pixel of feathering at the edge, or a circle has visibly stepped edges.
  float coverage = 1.0 - smoothstep(-0.5, 0.5, d);
  if (coverage <= 0.0) discard;

  if (u_mode == 2) {
    vec2 uv = v_uv;
    if (u_mirror != 0) uv.x = 1.0 - uv.x;
    // A moving pointer, which maps its own uv: the quad it is drawn in is
    // larger than the sprite, so the shared mapping below would stretch it.
    vec4 sampled;
    vec2 cursorUv = (uv - u_cursorBox.xy) / u_cursorBox.zw;
    if (u_smear.w != 0.0) {
      sampled = sampleSmeared(cursorUv);
    } else {
      // The shadow grows the quad beyond the pointer. Do not let the sampler's
      // clamp-to-edge turn that padding into a copy of the PNG's outer pixel —
      // a static pointer then becomes a black rectangle while a moving one,
      // whose smear path already rejects outside samples, looks fine.
      bool insideCursor =
        all(greaterThanEqual(cursorUv, vec2(0.0))) &&
        all(lessThanEqual(cursorUv, vec2(1.0)));
      if (!insideCursor) {
        sampled = vec4(0.0);
      } else {
        // Mirroring first, so it flips the crop rather than moving it.
        uv = u_src.xy + cursorUv * u_src.zw;
        sampled = sampleFocused(uv);
        // The mask is a separate, smaller stream sampled at the *same* uv as
        // the picture, so mirror and crop reach it for free and its size need
        // not match. Multiplied through every channel: the picture is
        // premultiplied, and colour has to scale with alpha or the edge of the
        // person glows. Mirrors the Metal side in shaders.metal.
        if (u_useMatte != 0) sampled *= texture(u_matte, uv).r;
        // The camera's look, on the camera alone. After the matte so a cutout
        // is graded only where somebody is, and before everything below so the
        // vignette and the caption's backdrop both see the graded picture
        // rather than the raw one. Premultiplied, so the colour is divided out
        // and folded back in or a translucent edge would grade twice.
        if (u_gradeC.z > 0.0 && sampled.a > 0.0) {
          sampled = vec4(graded(sampled.rgb / sampled.a, u_gradeA, u_gradeB, u_gradeC) * sampled.a,
                         sampled.a);
        }
      }
    }
    if (u_cursorShadow.w > 0.0) {
      vec2 shadowUv = cursorUv - u_cursorShadow.xy / u_cursorBox.zw;
      float shadowAlpha = cursorShadowAlpha(shadowUv);
      sampled.a += shadowAlpha * u_cursorShadow.w * (1.0 - sampled.a);
    }
    // Recoloured against what is behind, for a look whose words stand on the
    // footage with nothing under them. The bitmap is white where it is opaque,
    // so the colour is a multiply — and premultiplied, so it multiplies the
    // coverage the glyph already carries.
    if (u_adapt > 0.0) sampled = vec4(chosen() * sampled.a, sampled.a);
    // sampled arrives premultiplied — the upload asks Chromium for it, so it
    // matches what image.rs hands Metal — so only coverage is folded in here.
    // Running it through premultiplied as well would multiply the texture's own
    // alpha twice.
    // \`u_alpha\` rides along with coverage: premultiplied colour has to be
    // scaled with its own alpha, or a fading picture turns bright before it
    // disappears.
    float shown = coverage * u_alpha;
    fragColor = vec4(sampled.rgb * vignette(v_screen) * shown, sampled.a * shown);
    return;
  }

  if (u_mode == 1) {
    // Projected onto the gradient's axis, so the stops are measured the way
    // CSS measures them.
    float t = clamp(dot(v_uv - 0.5, u_gradient) + 0.5, 0.0, 1.0);
    vec4 color = mix(u_colorA, u_colorB, t);
    fragColor = premultiplied(color.rgb, color.a * coverage);
    return;
  }

  fragColor = premultiplied(u_colorA.rgb, u_colorA.a * coverage);
}`;

/** Uniform locations, looked up once — `getUniformLocation` is not free. */
interface Program {
  program: WebGLProgram;
  rect: WebGLUniformLocation | null;
  src: WebGLUniformLocation | null;
  shape: WebGLUniformLocation | null;
  frame: WebGLUniformLocation | null;
  colorA: WebGLUniformLocation | null;
  colorB: WebGLUniformLocation | null;
  gradient: WebGLUniformLocation | null;
  mode: WebGLUniformLocation | null;
  weight: WebGLUniformLocation | null;
  mirror: WebGLUniformLocation | null;
  quad: WebGLUniformLocation | null;
  focus: WebGLUniformLocation | null;
  smear: WebGLUniformLocation | null;
  cursorBox: WebGLUniformLocation | null;
  cursorShadow: WebGLUniformLocation | null;
  soften: WebGLUniformLocation | null;
  backdrop: WebGLUniformLocation | null;
  onDark: WebGLUniformLocation | null;
  onLight: WebGLUniformLocation | null;
  adapt: WebGLUniformLocation | null;
  vignette: WebGLUniformLocation | null;
  texel: WebGLUniformLocation | null;
  alpha: WebGLUniformLocation | null;
  matte: WebGLUniformLocation | null;
  blob: WebGLUniformLocation | null;
  harmonics: WebGLUniformLocation | null;
  useMatte: WebGLUniformLocation | null;
  loupe: WebGLUniformLocation | null;
  glass: WebGLUniformLocation | null;
  view: WebGLUniformLocation | null;
  motion: WebGLUniformLocation | null;
  gradeA: WebGLUniformLocation | null;
  gradeB: WebGLUniformLocation | null;
  gradeC: WebGLUniformLocation | null;
}

/** The full-screen pass that lays a look over the finished frame. */
interface FilterProgram {
  program: WebGLProgram;
  scene: WebGLUniformLocation | null;
  look: WebGLUniformLocation | null;
  variant: WebGLUniformLocation | null;
  strength: WebGLUniformLocation | null;
  scale: WebGLUniformLocation | null;
  angle: WebGLUniformLocation | null;
  tint: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
  frame: WebGLUniformLocation | null;
}

/** The items are drawn in here first when a look will run over them. */
interface Scene {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

export class WebGlCompositor {
  private gl: WebGL2RenderingContext | null = null;
  private program: Program | null = null;
  /** A copy of the frame under the caption being drawn. See `grabBackdrop`. */
  private backdrop: WebGLTexture | null = null;
  /** The lens's own render of the composition. See `renderGlass`. */
  private glass: Scene | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  /**
   * Built on the first filtered frame, and kept even when the look is taken
   * off: a program is cheap to hold and compiling one mid-drag would stutter.
   * `null` means it would not compile, which has already been logged.
   */
  private filterProgram: FilterProgram | null = null;
  private filterFailed = false;
  /**
   * The background being faded out, and when the fade ends.
   *
   * A new wallpaper arrived as a hard cut: one frame of the old picture, the
   * next of the new one, in the middle of a window that is otherwise still.
   * The picker is a grid of swatches somebody tries four or five of in a row,
   * and five hard cuts is a flicker.
   *
   * Held here rather than in the plan on purpose. A fade is not a property of
   * the composition — the exporter must never draw one, and it does not share
   * this file — and it is not a property of the edit either, so it has no
   * business in `buildRenderPlan`. It is this canvas remembering what it drew
   * last, which is the one thing a plan cannot carry.
   */
  private fading: { from: Paint; until: number } | null = null;
  /** What is on screen now, so a change can be noticed. Null before the first. */
  private painted: { paint: Paint; key: string } | null = null;
  /** Allocated on the first filtered frame. A recording with no look never
      pays for it. */
  private scene: Scene | null = null;

  /** One texture per source, reused: a new one per frame would thrash. */
  private readonly textures = new Map<string, WebGLTexture>();
  /**
   * The frame each texture was last drawn on, and the frame counter it is
   * measured against. Only used to decide what to evict — see `retire`.
   */
  private readonly touched = new Map<string, number>();
  private frame = 0;
  /** Which images have been uploaded, so a still one is not re-sent. */
  private readonly uploaded = new WeakSet<CanvasImageSource>();
  /** Sources that would not upload, so the log says so once rather than at
      sixty times a second. */
  private readonly refused = new Set<string>();

  /**
   * Draws a plan.
   *
   * `at` is source time, for the items that move. The canvas is sized by the
   * caller; everything here works in output pixels and is scaled by the
   * viewport, exactly as the exporter's own frame does.
   */
  draw(
    canvas: HTMLCanvasElement,
    plan: RenderPlan,
    sources: Sources,
    images: Images,
    backing: Backing,
    at = 0,
  ): void {
    if (backing.width <= 0 || backing.height <= 0 || plan.frame.width <= 0) return;

    const gl = this.context(canvas);
    if (!gl || !this.program) return;

    // A look reads the whole composition, and a fragment shader cannot sample
    // the framebuffer it is drawing into. So with a look on, the items go into
    // a texture of their own and the look reads that.
    //
    // Only with a look on. An unfiltered preview draws straight to the canvas
    // exactly as it always has, allocating nothing and costing nothing — which
    // matters, because most clips wear no look and this runs sixty times a
    // second.
    const filter = plan.filter ? this.filterFor(gl) : null;
    const scene = filter ? this.sceneFor(gl, backing) : null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene?.framebuffer ?? null);

    gl.viewport(0, 0, backing.width, backing.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.program.frame, plan.frame.width, plan.frame.height);
    // The identity, which every pass but the lens's own uses. Set per frame
    // rather than per item: it belongs to the pass, not to what is in it.
    gl.uniform4f(this.program.view, 0, 0, plan.frame.width, plan.frame.height);

    for (let index = 0; index < plan.items.length; index += 1) {
      const item = plan.items[index]!;

      // The lens is drawn here rather than in `drawItem`, because it is the one
      // item that needs the items *before* it: they are what goes inside the
      // glass, and they have to be drawn again at its magnification first.
      if (item.kind === "loupe") {
        const glass = loupeAt(item.keys, at);
        // Away, or not yet arrived — most of a recording, even one with a lens
        // in it. Nothing drawn, and no second pass paid for either.
        if (!glass) continue;
        const ready = this.renderGlass(
          gl,
          glass,
          plan.items.slice(0, index),
          sources,
          images,
          at,
          plan.frame,
          backing,
        );
        if (ready) this.drawLoupe(gl, glass);
        continue;
      }

      this.drawItem(gl, item, sources, images, at, plan.frame);
    }

    gl.bindVertexArray(null);

    if (plan.filter && filter && scene) {
      // Off the framebuffer *first*, and this is not tidiness.
      //
      // `generateMipmap` on a texture still attached to the bound framebuffer
      // is a rendering feedback loop — undefined by the specification, and in
      // practice a frame that intermittently comes back empty. It showed as the
      // picture vanishing for a moment whenever anything made the preview
      // redraw in earnest.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // Only the looks that read a level other than zero. The rest would pay
      // for a chain nothing samples, on every frame — and the glow and the fish
      // eye are the two that do, which `blurs` in the catalogue says. The
      // filter follows it: a mipmap filter on a texture with no chain is
      // *incomplete* and samples as black, where plain `LINEAR` on a look that
      // asks for a level it has not got simply gives it level zero — sharp
      // rather than blank, which is the failure to have.
      const blurs = FILTERS[plan.filter.id].blurs;
      gl.bindTexture(gl.TEXTURE_2D, scene.texture);
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        blurs ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
      );
      if (blurs) gl.generateMipmap(gl.TEXTURE_2D);

      this.drawFilter(gl, filter, scene, plan.filter, plan.frame, at);

      // Unbound before the next frame's items go into it. Left bound, the scene
      // texture is on unit 0 *and* attached to the framebuffer being drawn
      // into — the same feedback hazard as above, once per frame.
      gl.bindTexture(gl.TEXTURE_2D, null);
    }

    this.retire(gl);
    this.frame += 1;
  }

  /**
   * Lays the look over everything that was just drawn.
   *
   * Blending is **off**. The scene texture is already composited and
   * premultiplied, and this pass replaces the canvas rather than drawing onto
   * it; source-over here would blend the frame with itself at every translucent
   * pixel. Put back afterwards, because every other draw in this class expects
   * it on and a `draw()` that left it off would break the *next* frame rather
   * than this one.
   */
  private drawFilter(
    gl: WebGL2RenderingContext,
    program: FilterProgram,
    scene: Scene,
    filter: NonNullable<RenderPlan["filter"]>,
    frame: Size,
    at: number,
  ): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.BLEND);

    gl.useProgram(program.program);
    gl.bindVertexArray(this.vao);

    // Unit 0, which is where every other draw leaves the active texture — see
    // the note in `grabBackdrop` about unit 1 staying bound to the backdrop.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.texture);
    gl.uniform1i(program.scene, 0);

    gl.uniform1i(program.look, FILTER_LOOKS[filter.id]);
    // Resolved against the look's own list by `buildRenderPlan`, so the number
    // here is an index into the shader's switch and never a name.
    gl.uniform1i(program.variant, variantIndex(filter.id, filter.variant));
    gl.uniform1f(program.strength, filter.strength);
    gl.uniform1f(program.scale, filter.scale);
    gl.uniform1f(program.angle, filter.angle);
    const [r, g, b] = rgba(filter.tint);
    gl.uniform3f(program.tint, r, g, b);
    gl.uniform1f(program.time, filterTime(at, filter.animated));
    gl.uniform2f(program.frame, frame.width, frame.height);

    drawQuad(gl);

    gl.bindVertexArray(null);
    gl.enable(gl.BLEND);
  }

  /** The filter program, compiled once. Null once it has failed, so a broken
      shader logs once rather than sixty times a second. */
  private filterFor(gl: WebGL2RenderingContext): FilterProgram | null {
    if (this.filterProgram) return this.filterProgram;
    if (this.filterFailed) return null;

    this.filterProgram = compileFilter(gl);
    // Set whether or not it worked: a second attempt would compile the same
    // source against the same driver and fail the same way.
    this.filterFailed = this.filterProgram === null;
    return this.filterProgram;
  }

  /**
   * The texture the items are drawn into when a look will run over them.
   *
   * Sized to the backing store rather than to the plan's frame. The look is
   * expensive per pixel and the preview is a fraction of the output's size, so
   * this is the difference between a bloom costing two million pixels and
   * costing eight. Everything in `filters.ts` works in normalised coordinates
   * for exactly this reason — see the note at the top of that file.
   */
  private sceneFor(gl: WebGL2RenderingContext, backing: Backing): Scene | null {
    const fit = this.scene?.width === backing.width && this.scene?.height === backing.height;
    if (this.scene && fit) return this.scene;

    if (this.scene) {
      gl.deleteTexture(this.scene.texture);
      gl.deleteFramebuffer(this.scene.framebuffer);
      this.scene = null;
    }

    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) return null;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      backing.width,
      backing.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    // Linear, and clamped: a tap a hair outside the frame must not wrap to the
    // far edge, which shows as a stripe of the opposite corner along the
    // border. The exporter's sampler is declared the same way.
    //
    // The minification filter is set per frame in `draw`, by whether the look
    // showing reads the mip chain. Left at a mipmap filter here, a frame that
    // generated no chain would sample an incomplete texture and come back
    // black.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    if (!complete) {
      console.error("[editor] the filter's framebuffer is incomplete; drawing without a look");
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
      return null;
    }

    this.scene = { texture, framebuffer, width: backing.width, height: backing.height };
    return this.scene;
  }

  /**
   * Drops textures nothing has drawn for a while.
   *
   * The caller's image cache already evicts — `useCaptionImages` keeps twelve
   * bitmaps — but that only frees the `HTMLImageElement`. The texture uploaded
   * from it lived in `textures` until the compositor itself was disposed, which
   * for the editor means until the window closes. A half-hour recording with
   * captions is hundreds of cue bitmaps at export resolution, so the cache that
   * was there to stop thrashing became the thing holding the memory.
   *
   * Keyed on the frame each texture was last asked for rather than on what the
   * plan contains: the screen and camera are drawn every frame and never age
   * out, and a caption stops being asked for as soon as its cue ends.
   */
  private retire(gl: WebGL2RenderingContext): void {
    if (this.textures.size <= TEXTURE_CAP) return;

    for (const [key, last] of this.touched) {
      if (this.textures.size <= TEXTURE_CAP) break;
      // Never the ones drawn this frame, however far over the cap we are. More
      // on screen at once than the cap holds is not a reason to thrash.
      if (last === this.frame) continue;
      const texture = this.textures.get(key);
      if (texture) gl.deleteTexture(texture);
      this.textures.delete(key);
      this.touched.delete(key);
    }
  }

  /** Releases everything the GPU is holding. */
  dispose(): void {
    const gl = this.gl;
    if (!gl) return;

    for (const texture of this.textures.values()) gl.deleteTexture(texture);
    this.textures.clear();
    // Neither lives in `textures` — both are copies of the canvas rather than
    // uploads keyed by a path — so neither is freed by the loop above.
    if (this.backdrop) gl.deleteTexture(this.backdrop);
    if (this.glass) {
      gl.deleteTexture(this.glass.texture);
      gl.deleteFramebuffer(this.glass.framebuffer);
    }
    this.backdrop = null;
    this.glass = null;
    this.touched.clear();
    if (this.program) gl.deleteProgram(this.program.program);
    if (this.filterProgram) gl.deleteProgram(this.filterProgram.program);
    if (this.scene) {
      gl.deleteTexture(this.scene.texture);
      gl.deleteFramebuffer(this.scene.framebuffer);
    }
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.program = null;
    this.filterProgram = null;
    // Cleared with the program: `context()` rebuilds after a stray dispose, and
    // a compositor that had once failed to compile would otherwise never try
    // again on a context that might now succeed.
    this.filterFailed = false;
    this.scene = null;
    this.vao = null;
  }

  private context(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
    // A context that has been disposed keeps its `gl` — `getContext` hands back
    // the same object for the life of the canvas — but loses its program.
    // Rebuilding here rather than only on first call is what stops a stray
    // `dispose()` leaving this permanently unable to draw.
    if (this.gl) {
      this.program ??= compile(this.gl);
      this.vao ??= this.gl.createVertexArray();
      return this.gl;
    }

    // Deliberately plain. `desynchronized` puts the canvas on its own
    // low-latency surface, which is finicky about being composited inside a
    // transformed container, and `premultipliedAlpha: false` is a rarely
    // travelled path in Chromium's compositor. Neither is worth a preview that
    // might not appear; the shader premultiplies instead, which is the ordinary
    // way to do this and blends identically.
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: false });
    if (!gl) {
      console.error("[editor] no WebGL2 context; the preview cannot draw");
      return null;
    }

    gl.enable(gl.BLEND);
    // Source-over on premultiplied colour, matching the exporter's pipeline
    // state exactly. `SRC_ALPHA` would multiply a second time — see the note on
    // `premultiplied` below.
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.program = compile(gl);
    // Said once, at the level the log actually keeps, so "is the preview even
    // drawing" is answerable from a packaged build.
    console.warn(`[editor] WebGL2 ready (${gl.getParameter(gl.VERSION) as string})`);
    // A vertex array is required in WebGL2 even with no attributes: the corner
    // comes from `gl_VertexID`, but a draw with no VAO bound is an error.
    this.vao = gl.createVertexArray();
    this.gl = gl;
    return gl;
  }

  private drawItem(
    gl: WebGL2RenderingContext,
    item: PlanItem,
    sources: Sources,
    images: Images,
    at: number,
    /** The output frame, which only the picture needs — to be cut to it. */
    frame: Size,
  ): void {
    const p = this.program;
    if (!p) return;

    switch (item.kind) {
      case "fill": {
        this.fill(gl, item.paint, item.rect, images);
        break;
      }

      case "shadow": {
        const { rect, shape, quad } = moving(item, at);
        // Dropped by its own `dy`, so the shadow falls rather than sitting
        // exactly behind what casts it. Applied to the corners when the
        // picture is tilted, or the shadow would stay flat under a leaning
        // frame and give the whole thing away.
        set(gl, p, {
          rect: { ...rect, y: rect.y + item.dy },
          shape,
          quad: quad?.map((value, index) => (index % 3 === 1 ? value + item.dy : value)),
          mode: MODE_SHADOW,
          colorA: item.color,
          weight: item.blur / 2,
        });
        drawQuad(gl);
        break;
      }

      case "image": {
        const source = sources[item.source];
        // Nothing to draw is a normal state: the camera has no frame before it
        // opened, and holding its first one would misrepresent the take.
        if (!source) break;

        // The mask goes up first, on its own unit, so the picture's upload
        // below leaves unit 0 — the one every draw samples — bound to the
        // picture. Only the camera has one, and only when the plan asks.
        const matte = item.matte === true && item.source === "camera" ? sources.cameraMatte : null;
        const masked = matte !== null && this.upload(gl, "camera_matte", matte, true, 2) !== null;

        // `live` says the pixels may have changed since the last frame, which
        // for a video they have and for a still they have not. Asked of the
        // element rather than passed down: a 6K screenshot re-uploaded sixty
        // times a second is a slider drag that stutters for no reason at all.
        const texture = this.upload(gl, item.source, source, source instanceof HTMLVideoElement);
        if (!texture) break;

        const moment = moving(item, at);
        const { shape, quad, focus, vignette } = moment;
        // Cut to the frame — a radius outside it, so a zoom that scales the
        // picture past an edge rounds its corners where they actually are,
        // off screen, rather than on the frame's own corners.
        // The same arithmetic the exporter runs — see `cropToFrame`.
        const cut = cropToFrame(
          moment.rect,
          item.srcRect,
          frame,
          Boolean(moment.quad),
          shape.radius,
          item.mirror,
        );
        const rect = cut.rect;
        // Through `sizeOf` rather than `videoWidth`, because the screen is an
        // `<img>` for a screenshot — see `Sources.screen`.
        const grain = sizeOf(source);
        const src = normalised(cut.src, grain.width, grain.height);

        set(gl, p, {
          rect,
          shape,
          quad,
          focus,
          vignette,
          // In the source's own texels, so a blur of a given strength looks the
          // same whatever resolution the recording happens to be.
          texel: [1 / Math.max(grain.width, 1), 1 / Math.max(grain.height, 1)],
          mode: MODE_IMAGE,
          src,
          mirror: item.mirror,
          matte: masked,
          // The camera's look. Absent on the screen, which is lit by a display
          // rather than by the room and wants none of it.
          ...(item.grade ? { grade: item.grade } : {}),
          // Resolved here rather than held in the plan, exactly as the pointer's
          // position is: the plan is built once per clip and this changes every
          // frame. Then carried by whatever the rectangle is doing, so a zoom
          // that shrinks the camera out of its own way takes the shape with it.
          // Both are mirrored in Rust and pinned by the golden-pixel test.
          ...(item.blobs
            ? { blob: outlineNow(item.blobs, at, item.dstRect, moment.rect) ?? undefined }
            : {}),
        });
        drawQuad(gl);
        break;
      }

      case "stroke": {
        const { rect, shape, quad } = moving(item, at);
        set(gl, p, {
          rect,
          shape,
          quad,
          mode: MODE_STROKE,
          colorA: item.color,
          weight: item.width,
        });
        drawQuad(gl);
        break;
      }

      case "watermark": {
        const image = images.get(item.path);
        // Not loaded yet, or missing. Nothing drawn, for the reason a missing
        // background draws no rectangle: a placeholder where a logo should be
        // looks like a fault, and no logo looks like no logo.
        if (!image) break;
        if (!this.upload(gl, item.path, image, false)) break;

        set(gl, p, {
          rect: item.dstRect,
          // Square, and the whole picture. A logo carries its own shape in its
          // alpha, so rounding the quad would cut the corners off one drawn to
          // the edges of its file — and cropping would trim a wide mark to fit
          // a box nobody asked it to fill.
          shape: { radius: 0, exponent: 2 },
          src: [0, 0, 1, 1],
          mode: MODE_IMAGE,
          alpha: item.opacity,
        });
        drawQuad(gl);
        break;
      }

      case "cursor": {
        const image = images.get(item.path);
        const point = image ? cursorAt(item.points, at) : null;
        // No image, or the pointer had left the recorded area. Both draw
        // nothing rather than something wrong.
        if (!image || !point) break;

        const texture = this.upload(gl, item.path, image, false);
        if (!texture) break;

        // Sized by where it sits on the picture, so a tilted frame's pointer
        // grows towards the near edge with everything else on it.
        const size = item.size * point.scale;

        // The streak needs room, so the quad is grown around the sprite and the
        // shader maps back off the padding. Half the streak each side, because
        // it is drawn centred on the position. Mirrors the same three lines in
        // `compositor.rs`.
        const streak = Math.hypot(point.smearX, point.smearY);
        const pad = streak * 0.5;
        const shadowPad = item.shadow ? item.shadow.blur * 1.5 + Math.abs(item.shadow.dy) : 0;
        const motionGrown = size + pad * 2;
        const grown = motionGrown + shadowPad * 2;

        set(gl, p, {
          // Still the drawn box even when the corners below replace it as the
          // pointer's position: the fragment shader measures its one-pixel edge
          // feather against `rect`'s size, so shrinking this to the sprite's
          // pre-projection size would put the antialiasing band in the wrong
          // place. `layout.ts` builds the corners from exactly this box,
          // divided back onto the picture's surface.
          rect: {
            x: point.x - item.hotspot.x * size - pad - shadowPad,
            y: point.y - item.hotspot.y * size - pad - shadowPad,
            width: grown,
            height: grown,
          },
          shape: { radius: 0, exponent: 2 },
          mode: MODE_IMAGE,
          // The sprite's own corners on a tilted picture, so it lies on the
          // screen rather than standing upright in front of it. Absent wherever
          // nothing is tilted, and `set` falls back to `FLAT` — the same line
          // `moving` uses for every other item.
          ...(point.quad ? { quad: point.quad } : {}),
          cursorBox: {
            x: shadowPad / grown,
            y: shadowPad / grown,
            width: motionGrown / grown,
            height: motionGrown / grown,
          },
          cursorShadow: item.shadow
            ? {
                x: 0,
                y: item.shadow.dy / grown,
                blur: item.shadow.blur / grown,
                opacity: item.shadow.opacity,
              }
            : undefined,
          // Off below a pixel: a streak that short is not visible, and the taps
          // cost the same whether they move or not.
          ...(streak >= 1
            ? { smear: { x: point.smearX / grown, y: point.smearY / grown, pad: pad / grown } }
            : {}),
        });
        drawQuad(gl);
        break;
      }

      case "overlay": {
        const image = images.get(item.path);
        const draw = image ? overlayAt(item, at) : null;
        // No bitmap, off screen at this moment, or fully see-through — which
        // every unit of a text still to arrive is. All draw nothing, and the
        // exporter skips the same three.
        if (!image || !draw || draw.opacity <= 0) break;

        const texture = this.upload(gl, item.path, image, false);
        if (!texture) break;

        const size = sizeOf(image);

        set(gl, p, {
          rect: draw.dst,
          shape: { radius: 0, exponent: 2 },
          mode: MODE_IMAGE,
          src: normalised(item.src, size.width, size.height),
          alpha: draw.opacity,
          // Both, or neither does anything — see the caption below.
          ...(draw.blur > 0
            ? {
                soften: draw.blur,
                texel: [1 / Math.max(size.width, 1), 1 / Math.max(size.height, 1)] as [
                  number,
                  number,
                ],
              }
            : {}),
        });
        drawQuad(gl);
        break;
      }

      case "caption": {
        const image = images.get(item.path);
        const draw = image ? captionAt(item, at) : null;
        // No bitmap, or off screen at this moment — which the lit layer also is
        // between two words. Both draw nothing rather than something wrong.
        if (!image || !draw) break;

        const texture = this.upload(gl, item.path, image, false);
        if (!texture) break;

        const size = sizeOf(image);

        // What is already on the frame under this caption, so the shader can
        // colour the words against it. Taken from the whole cue's box rather
        // than the word's own crop — the words of a line have to agree, and
        // `dstRect` is the same box on every one of its items, so this copies
        // once per line rather than once per word.
        if (item.tint) this.grabBackdrop(gl, item.dstRect, frame);

        set(gl, p, {
          rect: draw.dst,
          shape: { radius: 0, exponent: 2 },
          mode: MODE_IMAGE,
          // Normalised against the bitmap's real size rather than the plan's,
          // the way the exporter normalises against its texture's.
          src: normalised(draw.src, size.width, size.height),
          // Both, or neither does anything: the radius is in the bitmap's own
          // texels and the shader has no other way to know how big one is.
          ...(draw.blur > 0
            ? {
                soften: draw.blur,
                texel: [1 / Math.max(size.width, 1), 1 / Math.max(size.height, 1)] as [
                  number,
                  number,
                ],
              }
            : {}),
          ...(item.tint ? { tint: item.tint } : {}),
        });
        drawQuad(gl);
        break;
      }
    }
  }

  /**
   * The glass itself, over the magnified render that is already on unit 1.
   *
   * Its own method rather than a `drawItem` case, for the reason the call site
   * gives: this is the one item whose contents are a pass of their own.
   */
  private drawLoupe(gl: WebGL2RenderingContext, glass: LoupeKey): void {
    const p = this.program;
    if (!p) return;

    // The quad is the glass grown for its scrim, which reaches further than the
    // shadow's bleed. Mirrors the same three lines in `compositor.rs`.
    const reach = glass.radius * LOUPE_SCRIM_REACH;
    set(gl, p, {
      rect: { x: glass.x - reach, y: glass.y - reach, width: reach * 2, height: reach * 2 },
      // Square and un-rounded: the circle is the lens's own, measured from its
      // centre, and a rounded quad would cut the shadow's corners off.
      shape: { radius: 0, exponent: 2 },
      mode: MODE_LOUPE,
      // How this buffer is oriented, which is the one thing about the lens's
      // render the two rasterisers do not share. See `behind` in the shader.
      src: [0, 1, 1, -1],
      loupe: glass,
    });
    drawQuad(gl);
  }

  /**
   * Draws the composition again, over a small box around the glass, at the
   * lens's own magnification.
   *
   * This is the whole reason a loupe can be sharp. Sampling the finished frame
   * — which is what this used to do — hands the lens output pixels, and
   * enlarging those can only blur what is already there. A 3024-wide recording
   * drawn into a 1920 frame has about 1.7 source pixels behind every output
   * one, and all of that detail is sitting in the file unread. Drawing the plan
   * a second time at the magnification is what reaches it: the screen is
   * sampled at the rate the lens actually needs, and the pointer is rasterised
   * at its magnified size rather than enlarged.
   *
   * Only the items *under* the lens, which is the same slice of the list the
   * frame copy used to capture — so what appears inside the glass is unchanged,
   * only its resolution is.
   *
   * Bound to unit 1, where `u_backdrop` points. The caption's grab binds its own
   * texture to the same unit later in the frame; only one of the two is ever
   * read by a given draw.
   *
   * Mirrors `render_glass` in `crates/prequel-render/src/compositor.rs`.
   */
  private renderGlass(
    gl: WebGL2RenderingContext,
    glass: LoupeKey,
    under: readonly PlanItem[],
    sources: Sources,
    images: Images,
    at: number,
    frame: Size,
    backing: Backing,
  ): boolean {
    const p = this.program;
    if (!p) return false;

    const span = 2 * LOUPE_REACH * glass.radius;
    if (span <= 0) return false;

    // How many device pixels the frame itself is drawn at. The preview's canvas
    // is its backing store, which is larger than the plan's frame by the display
    // scale — so the lens has to be drawn at that density too, or it would be
    // the one thing on screen rendered below the resolution it is shown at.
    const density = backing.width / Math.max(frame.width, 1);
    // What the glass needs to be sharp: its own span, magnified, at that
    // density. Capped so the lens never costs more pixels than the frame it sits
    // on — a very large glass at a very high magnification then gets less
    // supersampling rather than a target nothing can afford.
    const want = span * glass.magnify * density;
    // Twice the frame's own pixel count, not one. A lens at the default size and
    // 2x needs about 1.1 frames' worth, so a cap of one frame clipped exactly the
    // ordinary case — the texture came out at the frame's own scale and the lens
    // was back to enlarging output pixels. Two leaves the common settings
    // untouched and still bounds a huge glass at a huge magnification.
    const cap = Math.sqrt(2 * backing.width * backing.height);
    const size = Math.max(1, Math.round(Math.min(want, cap)));

    const target = this.glassFor(gl, size);
    if (!target) return false;

    // Off unit 1 before it becomes the target. Last frame's draw left this very
    // texture bound there, and sampling a texture that is attached to the
    // framebuffer being drawn into is a rendering feedback loop — undefined by
    // the specification, and in Chromium a pass that comes back empty. It showed
    // as the lens rendering as a solid black disc from the second frame on.
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, size, size);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // The box the pass covers, in frame pixels. `behind` in the shader takes the
    // same box off the glass's own centre and radius, so nothing has to be
    // carried between the two.
    const origin = {
      x: glass.x - LOUPE_REACH * glass.radius,
      y: glass.y - LOUPE_REACH * glass.radius,
    };
    gl.uniform4f(p.view, origin.x, origin.y, span, span);

    for (const item of under) {
      // A lens inside a lens would be a pass inside a pass. There is only ever
      // one in a plan, and it is not in this slice — this is what keeps that
      // from being load-bearing.
      if (item.kind === "loupe") continue;
      this.drawItem(gl, item, sources, images, at, frame);
    }

    // Back to whatever the frame is being drawn into, and back to the identity
    // view. Left set, every item after the lens would be placed into the lens's
    // box — which is the whole rest of the frame drawn inside a circle.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene?.framebuffer ?? null);
    gl.viewport(0, 0, backing.width, backing.height);
    gl.uniform4f(p.view, 0, 0, frame.width, frame.height);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.uniform1i(p.backdrop, 1);
    gl.activeTexture(gl.TEXTURE0);
    return true;
  }

  /** The lens's render target, reallocated only when its size changes. */
  private glassFor(gl: WebGL2RenderingContext, size: number): Scene | null {
    if (this.glass && this.glass.width === size && this.glass.height === size) return this.glass;

    if (this.glass) {
      gl.deleteTexture(this.glass.texture);
      gl.deleteFramebuffer(this.glass.framebuffer);
      this.glass = null;
    }

    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) return null;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // Clamped, or a tap at the edge of the box wraps to the opposite side and
    // draws as a stripe of the wrong picture around the rim.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    if (!complete) {
      console.error("[editor] the lens's framebuffer is incomplete; drawing without a loupe");
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
      return null;
    }

    this.glass = { texture, framebuffer, width: size, height: size };
    return this.glass;
  }

  /**
   * Copies what has been drawn under a rectangle into the backdrop texture.
   *
   * The frame is drawn back to front and captions are last, so by the time one
   * is reached the colour buffer already holds everything behind it. WebGL
   * cannot sample the buffer it is drawing into, hence the copy.
   *
   * The copy is the size of the box on screen, which at preview scale is a few
   * hundred pixels — the shader averages sixteen taps across it and never
   * looks at a single texel, so nothing is lost by it being small.
   */
  private grabBackdrop(gl: WebGL2RenderingContext, rect: Rect, frame: Size): void {
    const p = this.program;
    if (!p) return;

    // Reads from whatever is bound as the read framebuffer, which with a look
    // on is the scene texture's rather than the canvas. That is what makes this
    // keep working: with a filter, nothing has been drawn to the canvas yet,
    // and a caption would otherwise colour itself against an empty frame — so
    // the words would pick the wrong colour, but only on filtered clips. The
    // flip below is unchanged either way, both buffers being bottom-up.

    const scale = gl.drawingBufferWidth / Math.max(frame.width, 1);
    // Clamped into the buffer: `copyTexImage2D` reads undefined pixels outside
    // it, and a caption sitting on the frame's edge would sample them.
    const x = Math.max(0, Math.round(rect.x * scale));
    const width = Math.min(gl.drawingBufferWidth - x, Math.max(1, Math.round(rect.width * scale)));
    const height = Math.min(gl.drawingBufferHeight, Math.max(1, Math.round(rect.height * scale)));
    // Flipped: the plan measures from the top, the colour buffer from the
    // bottom. Reading the wrong band is the whole failure here — the words
    // would be coloured against a stripe of the frame they are nowhere near.
    const y = Math.max(
      0,
      Math.min(
        gl.drawingBufferHeight - height,
        Math.round(gl.drawingBufferHeight - (rect.y + rect.height) * scale),
      ),
    );

    if (width <= 0 || height <= 0) return;

    this.backdrop ??= gl.createTexture();
    if (!this.backdrop) return;

    // Unit 1, and left bound: unit 0 is the image every draw samples, and the
    // sampler uniform below is set once for the life of the program.
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.backdrop);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, x, y, width, height, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(p.backdrop, 1);
    gl.activeTexture(gl.TEXTURE0);
  }

  /**
   * The background, crossfaded when the *picture* behind it changes.
   *
   * Over the top rather than blended in a shader: the canvas already composites
   * premultiplied, so the outgoing background drawn at full strength and the
   * incoming one drawn over it at the fade's own alpha is exactly a crossfade,
   * and it needs no uniform the pictures do not already use.
   *
   * Keyed on the picture and not on the whole paint, which is the difference
   * between this helping and this being infuriating. A colour picker and a blur
   * slider are dragged, so their values change on every frame of a gesture —
   * fading those would restart the fade sixty times a second and leave the
   * control lagging the hand. A wallpaper is *chosen*, once, and that is the
   * change worth softening.
   *
   * `performance.now()` rather than the frame's own timestamp, and this is the
   * exception the renderer's rule allows for: that rule is about sampling media
   * on the same clock the picture is painted on, and this is not media. It is a
   * fixed-length piece of interface feedback that has nothing to do with where
   * the playhead is — on the media clock it would stall with playback.
   */
  private fill(gl: WebGL2RenderingContext, paint: Paint, rect: Rect, images: Images): void {
    const key = paint.kind === "image" ? `image:${paint.path}` : paint.kind;
    const now = performance.now();

    if (this.painted && this.painted.key !== key) {
      // The picture that was on screen goes on being drawn underneath for the
      // length of the fade. Captured by value: `painted` is about to be the new
      // one, and the old `Paint` object is all this needs to keep drawing it.
      this.fading = { from: this.painted.paint, until: now + BACKGROUND_FADE_MS };
    }
    this.painted = { paint, key };

    const fade = this.fading;
    if (!fade || now >= fade.until) {
      this.fading = null;
      this.paint(gl, paint, rect, images);
      return;
    }

    const left = (fade.until - now) / BACKGROUND_FADE_MS;
    this.paint(gl, fade.from, rect, images);
    // Eased, so the new picture arrives rather than ramping in linearly — a
    // linear crossfade reads as a dissolve, which is a transition, where this
    // should read as the swatch simply having taken effect.
    this.paint(gl, paint, rect, images, 1 - left * left);
  }

  /** A background fill: flat, a gradient, or an image scaled to cover. */
  private paint(
    gl: WebGL2RenderingContext,
    paint: Paint,
    rect: Rect,
    images: Images,
    /** How far in the fade this one is. 1 — fully drawn — in the ordinary case. */
    alpha = 1,
  ): void {
    const p = this.program;
    if (!p) return;

    const square: Shape = { radius: 0, exponent: 2 };

    switch (paint.kind) {
      case "solid":
        set(gl, p, { rect, shape: square, mode: MODE_FILL, colorA: paint.color, alpha });
        drawQuad(gl);
        return;

      case "gradient": {
        // Measured clockwise from straight up, matching CSS.
        const radians = ((paint.angle - 90) * Math.PI) / 180;
        set(gl, p, {
          rect,
          shape: square,
          mode: MODE_GRADIENT,
          colorA: paint.from,
          colorB: paint.to,
          gradient: [Math.cos(radians), Math.sin(radians)],
          alpha,
        });
        drawQuad(gl);
        return;
      }

      case "image": {
        const image = images.get(paint.path);
        // Not loaded yet, or missing. A flat neutral rather than a transparent
        // hole that shows the editor's own chrome through the frame.
        if (!image) {
          set(gl, p, { rect, shape: square, mode: MODE_FILL, colorA: "#1c1e22", alpha });
          drawQuad(gl);
          return;
        }

        const texture = this.upload(gl, paint.path, image, false);
        if (!texture) return;

        const size = sizeOf(image);
        const src = cover(rect, size);

        set(gl, p, {
          rect,
          shape: square,
          mode: MODE_IMAGE,
          src,
          // Without this the blur does nothing at all: `u_texel` defaults to
          // zero, every tap offset multiplies out to zero, and all sixteen taps
          // land on the same point. The captions carry the same note.
          texel: [1 / Math.max(size.width, 1), 1 / Math.max(size.height, 1)],
          // The same 16-tap loop the captions use — see `u_soften` — and, like
          // it, measured in the *sampled image's* texels rather than in output
          // pixels. A wallpaper is drawn well under its own resolution, so the
          // setting's radius has to be converted or a 20-pixel blur reaches
          // barely a pixel of a 3200-wide picture.
          soften: paint.blur * sourcePerOutput(src, rect, size),
          alpha,
        });
        drawQuad(gl);
        return;
      }
    }
  }

  /**
   * Uploads an image or a video frame, reusing its texture.
   *
   * `live` re-uploads every call, which is what a playing video needs; a still
   * image is sent once and then only referenced. Both clamp to the edge, or a
   * sample a hair outside the crop wraps to the far side and shows as a seam.
   */
  private upload(
    gl: WebGL2RenderingContext,
    key: string,
    image: CanvasImageSource,
    live: boolean,
    // Unit 0 for the picture every draw samples; the camera's matte takes 2,
    // beside the backdrop on 1, so binding it does not unbind the picture.
    unit = 0,
  ): WebGLTexture | null {
    // Deleted before it is set so the key moves to the end: `Map.set` on a key
    // that is already there keeps its original position, which would make the
    // iteration in `retire` oldest-created rather than least-recently-used.
    this.touched.delete(key);
    this.touched.set(key, this.frame);

    let texture = this.textures.get(key) ?? null;
    const fresh = texture === null;

    if (!texture) {
      texture = gl.createTexture();
      if (!texture) return null;
      this.textures.set(key, texture);
    }

    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    if (fresh) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    // `fresh` as well as the `uploaded` check, and it is load-bearing: that set
    // records that an *image* has had its pixels sent, which was the same thing
    // as "its texture holds them" only while textures were never let go. Now
    // that `retire` drops them, a still image whose texture was evicted comes
    // back here with a new, empty texture and an image the set has already
    // seen — so the upload was skipped and the picture drew as nothing.
    if (live || fresh || !this.uploaded.has(image)) {
      const size = sizeOf(image);
      if (size.width <= 0 || size.height <= 0) return null;

      // Premultiplied on the way in, because that is what `image.rs` gives the
      // exporter: it decodes through `KCG_IMAGE_ALPHA_PREMULTIPLIED_FIRST`.
      // The default here is the opposite, and asking Chromium to *un*-
      // premultiply a canvas — which is premultiplied by definition — is a
      // lossy round-trip that bands on faint edges. Sampling different texels
      // from the same PNG is exactly the preview/export divergence the plan
      // architecture exists to prevent.
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      try {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          image as TexImageSource,
        );
      } catch (cause) {
        // One unusable image must not take the frame with it. `texImage2D`
        // throws on cross-origin data rather than failing quietly, and this
        // runs inside the render loop — an uncaught throw here stops
        // everything else in the plan from being drawn, which reads as a
        // preview that does not work at all rather than a background that did
        // not load.
        if (!this.refused.has(key)) {
          this.refused.add(key);
          console.error(`[editor] could not upload ${key}:`, cause);
        }
        return null;
      }
      if (!live) this.uploaded.add(image);
    }

    // Left on unit 0, which the rest of this file assumes is the active one.
    if (unit !== 0) gl.activeTexture(gl.TEXTURE0);
    return texture;
  }
}

/** The item's rectangle and shape at a moment, honouring a zoom's motion. */
function moving(
  item: Extract<PlanItem, { motion?: RectKey[] }>,
  at: number,
): {
  rect: Rect;
  shape: Shape;
  quad?: number[];
  focus?: RectKey["focus"];
  vignette?: number;
} {
  const rect = "rect" in item ? item.rect : item.dstRect;
  if (!item.motion) return { rect, shape: item.shape };

  const key = rectAt(item.motion, at, rect, item.shape.radius);
  return {
    rect: { x: key.x, y: key.y, width: key.width, height: key.height },
    shape: { radius: key.radius, exponent: item.shape.exponent },
    ...(key.quad ? { quad: key.quad } : {}),
    ...(key.focus ? { focus: key.focus } : {}),
    ...(key.vignette ? { vignette: key.vignette } : {}),
  };
}

/** Four zeroed corners: `w` of 0 means "no tilt", read by the vertex shader. */
const FLAT = new Float32Array(12);

/**
 * Scratch for the outline's harmonics, filled and handed to the driver.
 *
 * One buffer for the life of the compositor rather than one per draw. Every
 * primitive of every frame passes through `set`, so a fresh typed array here is
 * a few hundred allocations a second thrown away immediately — which is the sort
 * of thing that shows as the preview hitching rather than as anything being
 * slow. Two slots spare: the shader takes two `vec4`s and the third harmonic
 * only fills half the second.
 */
const HARMONICS = new Float32Array(8);

interface Draw {
  rect: Rect;
  shape: Shape;
  mode: number;
  quad?: number[];
  src?: [number, number, number, number];
  colorA?: string;
  colorB?: string;
  gradient?: [number, number];
  weight?: number;
  mirror?: boolean;
  focus?: { x: number; y: number; safe: number; strength: number };
  /** The pointer's streak, in the quad's own uv, with the padding it may run
      into. Only the cursor ever sets it. */
  smear?: { x: number; y: number; pad: number };
  /** The cursor's motion-blur box inside its larger shadow box. */
  cursorBox?: { x: number; y: number; width: number; height: number };
  /** Cursor shadow drop x/y, blur radius and opacity in outer-quad units. */
  cursorShadow?: { x: number; y: number; blur: number; opacity: number };
  /** How hard the frame darkens towards its edges, 0 to 1. */
  vignette?: number;
  /** One texel of the sampled image, so a blur is measured in its own pixels. */
  texel?: [number, number];
  /** How opaque a still image is drawn, 0 to 1. Left out means opaque. */
  alpha?: number;
  /** A flat blur across the quad, in the sampled image's texels. */
  soften?: number;
  /** Two colours to choose between by what has already been drawn under it. */
  tint?: { onDark: string; onLight: string };
  /** Multiply by the person mask on texture unit 2. Only the camera sets it. */
  matte?: boolean;
  /**
   * The camera's outline this frame, in output pixels, already interpolated.
   *
   * Left out for every draw but a camera whose shape follows the person. A
   * `presence` of 0 is not the same thing: it is that camera with nobody in
   * front of it, which draws nothing.
   */
  blob?: BlobShape;
  /**
   * The lens this frame, in output pixels, already interpolated.
   *
   * Left out for every draw but a loupe, which is what leaves the radius at zero
   * and the glass out of the way.
   */
  loupe?: LoupeKey;
  /** The camera's colour look, already resolved. Only the camera sets it. */
  grade?: CameraGrade;
}

/** The outline this frame, moved by whatever the picture's rectangle is doing. */
function outlineNow(keys: BlobKey[], at: number, rest: Rect, now: Rect): BlobShape | null {
  const blob = blobAt(keys, at);
  return blob && movedBlob(blob, rest, now);
}

function set(gl: WebGL2RenderingContext, p: Program, draw: Draw): void {
  gl.uniform4f(p.rect, draw.rect.x, draw.rect.y, draw.rect.width, draw.rect.height);
  gl.uniform2f(p.shape, draw.shape.radius, draw.shape.exponent);
  gl.uniform1i(p.mode, draw.mode);
  gl.uniform1f(p.weight, draw.weight ?? 0);
  gl.uniform1i(p.mirror, draw.mirror ? 1 : 0);
  // The sampler is pointed at its unit every draw rather than once at link:
  // it costs one integer, and it cannot then be forgotten by a later change
  // to how the program is built.
  gl.uniform1i(p.matte, 2);
  gl.uniform1i(p.useMatte, draw.matte ? 1 : 0);

  const src = draw.src ?? [0, 0, 1, 1];
  gl.uniform4f(p.src, src[0], src[1], src[2], src[3]);

  const a = rgba(draw.colorA ?? "#00000000");
  gl.uniform4f(p.colorA, a[0], a[1], a[2], a[3]);
  const b = rgba(draw.colorB ?? "#00000000");
  gl.uniform4f(p.colorB, b[0], b[1], b[2], b[3]);

  const gradient = draw.gradient ?? [0, 1];
  gl.uniform2f(p.gradient, gradient[0], gradient[1]);

  gl.uniform3fv(p.quad, draw.quad && draw.quad.length === 12 ? draw.quad : FLAT);

  const focus = draw.focus;
  gl.uniform4f(p.focus, focus?.x ?? 0, focus?.y ?? 0, focus?.safe ?? 1, focus?.strength ?? 0);
  const smear = draw.smear;
  gl.uniform4f(p.smear, smear?.x ?? 0, smear?.y ?? 0, smear?.pad ?? 0, smear ? 1 : 0);
  const cursorBox = draw.cursorBox;
  gl.uniform4f(
    p.cursorBox,
    cursorBox?.x ?? 0,
    cursorBox?.y ?? 0,
    cursorBox?.width ?? 1,
    cursorBox?.height ?? 1,
  );
  const cursorShadow = draw.cursorShadow;
  gl.uniform4f(
    p.cursorShadow,
    cursorShadow?.x ?? 0,
    cursorShadow?.y ?? 0,
    cursorShadow?.blur ?? 0,
    cursorShadow?.opacity ?? 0,
  );
  gl.uniform2f(p.texel, draw.texel?.[0] ?? 0, draw.texel?.[1] ?? 0);
  // Opaque unless asked otherwise, so every draw that predates the watermark
  // keeps drawing exactly as it did.
  gl.uniform1f(p.alpha, draw.alpha ?? 1);
  gl.uniform1f(p.soften, draw.soften ?? 0);

  const onDark = rgba(draw.tint?.onDark ?? "#00000000");
  gl.uniform4f(p.onDark, onDark[0], onDark[1], onDark[2], onDark[3]);
  const onLight = rgba(draw.tint?.onLight ?? "#00000000");
  gl.uniform4f(p.onLight, onLight[0], onLight[1], onLight[2], onLight[3]);
  gl.uniform1f(p.adapt, draw.tint ? 1 : 0);
  gl.uniform1f(p.vignette, draw.vignette ?? 0);

  // Written every draw rather than only for the camera, because a uniform holds
  // its value until it is changed — leaving the last camera's outline set would
  // clip whatever was drawn next into the shape of somebody's shoulders.
  const blob = draw.blob;
  gl.uniform4f(p.blob, blob?.x ?? 0, blob?.y ?? 0, blob?.radius ?? 0, blob?.presence ?? 0);
  const h = blob?.h;
  for (let k = 0; k < 6; k++) {
    HARMONICS[k] = h?.[k] ?? 0;
  }
  gl.uniform4fv(p.harmonics, HARMONICS);

  // Written every draw for the reason the outline is: a uniform holds its value
  // until it is changed, and a radius left over from the last lens would send
  // the next primitive down the loupe's branch.
  const loupe = draw.loupe;
  gl.uniform4f(p.loupe, loupe?.x ?? 0, loupe?.y ?? 0, loupe?.radius ?? 0, loupe?.presence ?? 0);
  // Written every draw for the reason the outline and the lens are: a uniform
  // holds its value until it is changed, and a look left over from the camera
  // would grade whatever was drawn next.
  const grade = draw.grade;
  gl.uniform4f(
    p.gradeA,
    grade?.temperature ?? 0,
    grade?.tint ?? 0,
    grade?.contrast ?? 0,
    grade?.saturation ?? 0,
  );
  gl.uniform4f(
    p.gradeB,
    grade?.vibrance ?? 0,
    grade?.lift ?? 0,
    grade?.shadowHue ?? 0,
    grade?.shadowAmount ?? 0,
  );
  // The third slot is the switch: the shader reads it rather than testing ten
  // levers for zero.
  gl.uniform4f(p.gradeC, grade?.highlightHue ?? 0, grade?.highlightAmount ?? 0, grade ? 1 : 0, 0);

  gl.uniform4f(p.motion, loupe?.smearX ?? 0, loupe?.smearY ?? 0, 0, 0);
  gl.uniform4f(
    p.glass,
    loupe?.magnify ?? 1,
    loupe?.curvature ?? 0,
    loupe?.aberration ?? 0,
    loupe?.reflection ?? 0,
  );
}

function drawQuad(gl: WebGL2RenderingContext): void {
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/** A source rectangle in pixels, as the 0-1 the shader samples with. */
function normalised(rect: Rect, width: number, height: number): [number, number, number, number] {
  if (width <= 0 || height <= 0) return [0, 0, 1, 1];
  return [rect.x / width, rect.y / height, rect.width / width, rect.height / height];
}

/**
 * How many of the sampled image's own pixels one output pixel covers.
 *
 * What turns a blur measured against the frame into one the sampler can use.
 * A wallpaper is drawn well under its own resolution — 3200 pixels of picture
 * across 1920 of frame — so a radius handed straight to `u_soften` would reach
 * a fraction of what the setting asked for.
 *
 * The crop is normalised, so its width times the texture's is the number of
 * source pixels actually spanning `rect`.
 */
function sourcePerOutput(
  src: [number, number, number, number],
  rect: Rect,
  size: { width: number; height: number },
): number {
  if (rect.width <= 0) return 0;
  return (src[2] * size.width) / rect.width;
}

/**
 * The part of an image a `cover` fill shows.
 *
 * The largest centred region with the destination's shape. Mirrors `cover` in
 * the exporter's compositor: a background is the one thing on screen with no
 * edge of its own to give a difference away.
 */
function cover(
  rect: Rect,
  size: { width: number; height: number },
): [number, number, number, number] {
  if (size.width <= 0 || size.height <= 0 || rect.width <= 0 || rect.height <= 0) {
    return [0, 0, 1, 1];
  }

  const scale = Math.max(rect.width / size.width, rect.height / size.height);
  const visibleWidth = Math.min(rect.width / scale, size.width);
  const visibleHeight = Math.min(rect.height / scale, size.height);

  return [
    (size.width - visibleWidth) / 2 / size.width,
    (size.height - visibleHeight) / 2 / size.height,
    visibleWidth / size.width,
    visibleHeight / size.height,
  ];
}

function sizeOf(image: CanvasImageSource): { width: number; height: number } {
  if (image instanceof HTMLImageElement) {
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  if (image instanceof HTMLVideoElement) {
    return { width: image.videoWidth, height: image.videoHeight };
  }
  const sized = image as { width: number; height: number };
  return { width: sized.width, height: sized.height };
}

type Rgba = readonly [number, number, number, number];

/**
 * Parsed colours, by the string the plan carries.
 *
 * `set` asks for four colours on every draw of every frame, and a plan holds a
 * handful of distinct ones — parsing each with a regex sixty times a second is
 * garbage for nothing. Bounded, because dragging through a colour picker is a
 * new string per frame and nothing else would ever let those go.
 */
const COLOURS = new Map<string, Rgba>();
const COLOURS_MAX = 256;

/** A plan colour as four floats, parsed once per distinct string. */
function rgba(color: string): Rgba {
  let parsed = COLOURS.get(color);
  if (!parsed) {
    if (COLOURS.size >= COLOURS_MAX) COLOURS.clear();
    parsed = parseColour(color);
    COLOURS.set(color, parsed);
  }
  return parsed;
}

/**
 * A plan colour as four floats.
 *
 * Both forms the plan can carry, because it is written by a browser: `#rrggbb`
 * for anything the user picked, `rgba()` where an opacity was folded in.
 */
function parseColour(color: string): Rgba {
  const parsed = /rgba?\(([^)]+)\)/.exec(color);
  if (parsed) {
    const parts = parsed[1]!.split(",").map((part) => Number(part.trim()));
    return [(parts[0] ?? 0) / 255, (parts[1] ?? 0) / 255, (parts[2] ?? 0) / 255, parts[3] ?? 1];
  }

  const hex = color.replace("#", "");
  const value = parseInt(hex.slice(0, 6), 16);
  const alpha = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;

  return [
    ((value >> 16) & 0xff) / 255,
    ((value >> 8) & 0xff) / 255,
    (value & 0xff) / 255,
    Number.isNaN(alpha) ? 1 : alpha,
  ];
}

function compile(gl: WebGL2RenderingContext): Program | null {
  const build = (kind: number, source: string) => {
    const shader = gl.createShader(kind);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      // Logged rather than thrown: a preview that cannot compile its shader is
      // a broken editor, and the log is the only place that would say why.
      console.error("[editor] shader failed to compile:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const vertex = build(gl.VERTEX_SHADER, VERTEX);
  const fragment = build(gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vertex || !fragment) return null;

  const program = gl.createProgram();
  if (!program) return null;

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("[editor] shader failed to link:", gl.getProgramInfoLog(program));
    return null;
  }

  const at = (name: string) => gl.getUniformLocation(program, name);
  return {
    program,
    rect: at("u_rect"),
    src: at("u_src"),
    shape: at("u_shape"),
    frame: at("u_frame"),
    colorA: at("u_colorA"),
    colorB: at("u_colorB"),
    gradient: at("u_gradient"),
    mode: at("u_mode"),
    weight: at("u_weight"),
    mirror: at("u_mirror"),
    quad: at("u_quad"),
    focus: at("u_focus"),
    smear: at("u_smear"),
    cursorBox: at("u_cursorBox"),
    cursorShadow: at("u_cursorShadow"),
    soften: at("u_soften"),
    backdrop: at("u_backdrop"),
    onDark: at("u_onDark"),
    onLight: at("u_onLight"),
    adapt: at("u_adapt"),
    vignette: at("u_vignette"),
    texel: at("u_texel"),
    alpha: at("u_alpha"),
    matte: at("u_matte"),
    useMatte: at("u_useMatte"),
    blob: at("u_blob"),
    harmonics: at("u_harmonics"),
    loupe: at("u_loupe"),
    glass: at("u_glass"),
    view: at("u_view"),
    motion: at("u_motion"),
    gradeA: at("u_gradeA"),
    gradeB: at("u_gradeB"),
    gradeC: at("u_gradeC"),
  };
}

/**
 * Builds the full-screen pass that lays a look over the frame.
 *
 * Its own function rather than a second branch in `compile`: the two programs
 * share no uniform and no shader, and the only thing folding them together
 * would save is the eight lines that compile a shader — at the cost of one
 * function whose return type is a union of two unrelated shapes.
 *
 * Null on failure, logged once by the caller. A look that will not compile
 * costs the look; the preview keeps drawing.
 */
function compileFilter(gl: WebGL2RenderingContext): FilterProgram | null {
  const { vertex: vertexSource, fragment: fragmentSource } = FILTER_SHADER_SOURCE();

  const build = (kind: number, source: string) => {
    const shader = gl.createShader(kind);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("[editor] the filter shader failed to compile:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const vertex = build(gl.VERTEX_SHADER, vertexSource);
  const fragment = build(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) return null;

  const program = gl.createProgram();
  if (!program) return null;

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("[editor] the filter shader failed to link:", gl.getProgramInfoLog(program));
    return null;
  }

  const at = (name: string) => gl.getUniformLocation(program, name);
  return {
    program,
    scene: at("u_scene"),
    look: at("u_look"),
    // Null until a look has more than one way to be worn: a uniform nothing
    // reads is optimised out of the linked program, and setting a null location
    // is a no-op rather than an error.
    variant: at("u_variant"),
    strength: at("u_strength"),
    scale: at("u_scale"),
    angle: at("u_angle"),
    tint: at("u_tint"),
    time: at("u_time"),
    frame: at("u_frame"),
  };
}

/**
 * The `src` each element was last seen holding a decoded frame for.
 *
 * Keyed by `currentSrc` as well as by the element, because the elements are
 * reused across sessions — they are rendered with `key={track.kind}`, so opening
 * a second recording swaps `src` on the same `<video>`. A flag carried over from
 * the previous take would hold a frame from the wrong recording.
 */
const decoded = new WeakMap<HTMLVideoElement, string>();

/**
 * Whether a video element has a frame worth drawing.
 *
 * Not simply `readyState >= 2`. Assigning `currentTime` — which `syncElement`
 * does at a cut and at every scrub — drops `readyState` to 1 for the two or
 * three frames the decoder needs to produce the new picture. Answering "no" for
 * those frames takes the whole layer out of the plan, and since the background is
 * a separate item, the preview flashes the background on its own.
 *
 * The last frame is still on the GPU: Chromium leaves a texture's contents alone
 * when `texImage2D` is handed a video that has nothing new, so drawing the layer
 * anyway holds the previous frame rather than showing black. That is what a video
 * player does across a seek, and what the loop in `useEditorPlayback` already
 * assumed happened.
 *
 * Only while `seeking`, and only once a frame has actually been decoded for this
 * `src`: before the first one there is nothing to hold, and an incomplete texture
 * samples as black.
 */
export function isReady(element: HTMLVideoElement | null): boolean {
  if (element === null || element.videoWidth === 0) return false;

  if (element.readyState >= 2) {
    decoded.set(element, element.currentSrc);
    return true;
  }

  return element.seeking && decoded.get(element) === element.currentSrc;
}
