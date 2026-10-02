// The compositor's one shader pair.
//
// Every primitive the plan can contain is drawn by this: a filled rectangle, a
// blurred shadow, a clipped image, a stroked outline. The shape is a
// superellipse evaluated analytically, which is what lets a circle, a rounded
// rectangle and a squircle share one path — and what keeps the export agreeing
// with the canvas, which samples the same curve.

#include <metal_stdlib>
using namespace metal;

struct Uniforms {
    // Four tilted corners as (x, y, w, unused), or all zero when nothing is
    // tilted. First in the struct because `float4[4]` is 16-byte aligned and
    // 64 bytes long, so every field after it keeps the offset it had before.
    float4 quad[4];
    // The camera's free-form outline for this frame: centre in x and y, the
    // radius it starts from, and how far open it is — all in *output* pixels but
    // the last, which is 0 to 1.
    //
    // Output pixels, and measured from `screen` rather than from `local` unlike
    // every other shape here, because the quad this camera is drawn in is cut to
    // the frame before it reaches the shader — a centre in the quad's own pixels
    // would move by however much was cut off. A radius of 0 is every draw but
    // that camera, and is what makes `shape` the outline instead.
    float4 blob;
    // How the radius varies with the angle, as three harmonics:
    // (cos t, sin t, cos 2t, sin 2t) and then (cos 3t, sin 3t, unused, unused).
    // The third is what makes the shape lobed rather than merely oval; the
    // editor is what decides how much of it arrives here.
    //
    // Beside `quad` for the alignment reason `quad` is first: whole 16-byte rows,
    // so every field after them keeps the offset it had relative to them.
    float4 harmonics[2];
    // Destination rectangle in output pixels.
    float4 rect;
    // Region of the source texture to sample, normalised 0-1 as (x, y, w, h).
    // Without this the whole texture is stretched into the destination, which
    // squashes a 16:9 camera into a circle and ignores every crop.
    float4 src;
    // Depth of field: xy is what stays sharp in output pixels, z how far
    // around it, w the widest blur beyond. A w of 0 softens nothing.
    float4 focus;
    // Motion blur on the pointer: xy is the streak as a vector in this quad's
    // own uv, z how much of the quad on each side is padding the streak is
    // allowed to run into, w non-zero to enable it at all.
    //
    // Beside `focus` rather than appended, and deliberately: every `float4` in
    // this struct sits at a multiple of 16, and adding one after the `float2`s
    // would put the tail at an offset Rust and MSL disagree about — which
    // compiles, runs, and renders the wrong colour. See the note on `_align`
    // in `compositor.rs`.
    float4 smear;
    // The cursor's motion-blur box inside the larger shadow box, as x, y,
    // width, height in outer-quad uv.
    float4 cursor_box;
    // Cursor shadow drop x/y, blur radius and opacity, in outer-quad units.
    float4 cursor_shadow;
    // The lens: its middle in xy and its radius in z, all in output pixels, and
    // how present it is in w. A radius of 0 is every draw but a loupe.
    //
    // The last of the `float4`s rather than in the tail, and deliberately: every
    // one of them sits at a multiple of 16, so adding these two here leaves
    // nothing above them moved and shifts the `float2`s and the scalars below by
    // one whole pair of rows. Appending them after the `u32`s would put the tail
    // at an offset Rust and MSL disagree about, which compiles, runs, and
    // renders the wrong colour.
    float4 loupe;
    // What sort of glass it is: the magnification in x, how deep the surface is
    // in y, how far it splits colour in z and how much it reflects in w.
    float4 glass;
    // The region of the frame this pass is drawing into, as x, y, width, height
    // in frame pixels. The whole frame for every pass but the lens's own, which
    // draws the composition again over a small box around the glass — see
    // `render_glass` in `compositor.rs`.
    float4 view;
    // The camera's colour look, already resolved from the catalogue:
    // temperature, tint, contrast and saturation; then vibrance, lift and the
    // shadow tone; then the highlight tone and whether to grade at all. Only
    // the camera ever sets it.
    float4 grade_a;
    float4 grade_b;
    float4 grade_c;
    // One texel of the sampled image, so a blur is measured in its own pixels.
    float2 texel;
    // Superellipse: x = radius, y = exponent.
    float2 shape;
    // Frame size in pixels, for converting to clip space.
    float2 frame;

    float4 colorA;
    float4 colorB;
    // Gradient direction, already resolved from an angle.
    float2 gradient;

    // 0 fill, 1 gradient, 2 image, 3 shadow, 4 stroke, 5 loupe.
    uint mode;
    // Stroke width, or shadow blur radius, in pixels.
    float weight;
    // Non-zero mirrors the sampled image horizontally.
    uint mirror;
    // How hard the frame darkens towards its edges, 0 to 1. 0 darkens nothing.
    // In place of the tail padding this struct already carried, so every other
    // field keeps the offset it had.
    float vignette;
    // A flat blur across the whole quad, in the sampled image's own texels.
    // Unlike `focus` it does not vary across the quad — a caption word arriving
    // out of focus is uniformly soft. In the last of the tail padding, so no
    // field above it moves.
    float soften;
    // Two colours to choose between by what is behind the quad, and whether to
    // do it at all. Only an adaptive caption sets `adapt`.
    float adapt;
    // How opaque a still image is drawn, 0 to 1. Everything else passes 1.
    float alpha;
    // Non-zero to multiply the picture by the person mask at texture 2. In
    // the tail `alpha` opened, so nothing above it moves.
    uint matte;
    // Padding to the next 16, which is where MSL ends this block. The two slots
    // the outline briefly used are back to being padding; Rust will not add them
    // itself, so both sides write them out.
    float2 _tail;
};

struct Vertex {
    float4 position [[position]];
    float2 local;
    float2 uv;
    // Where this point is in the output frame, so the fragment can measure its
    // distance from what is in focus.
    float2 screen;
};

// A full-quad pass over the destination rectangle. Four vertices, no buffer:
// the rectangle is in the uniforms and the corner is the vertex id.
vertex Vertex composite_vertex(uint id [[vertex_id]],
                               constant Uniforms &u [[buffer(0)]]) {
    const float2 corners[4] = { float2(0, 0), float2(1, 0), float2(0, 1), float2(1, 1) };
    float2 corner = corners[id];

    // The tilted corner if there is one, otherwise the plain rectangle. A `w`
    // of zero is what says "not tilted", so an ordinary primitive sets nothing.
    float4 placed = u.quad[id];
    bool tilted = placed.z > 0.0;

    float2 pixel = tilted ? placed.xy : u.rect.xy + corner * u.rect.zw;
    float w = tilted ? placed.z : 1.0;

    // Pixels to clip space, with y flipped: Metal's clip space is
    // bottom-up and every rectangle in the plan is top-down.
    //
    // Against the pass's own region rather than the frame, which is what lets
    // the lens draw the same plan into a small box at its own magnification.
    // Every other pass passes the whole frame, so this is the identity it
    // always was.
    float2 clip = ((pixel - u.view.xy) / u.view.zw) * 2.0 - 1.0;

    Vertex out;
    // Scaled by w with w in the fourth component, so the hardware divides the
    // varyings by it per fragment. Without that the texture and the shape are
    // smeared flat across the quad's two triangles and crease along the
    // diagonal between them.
    out.position = float4(clip.x * w, -clip.y * w, 0.0, w);
    out.local = corner * u.rect.zw;
    out.uv = corner;
    out.screen = pixel;
    return out;
}

// Distance to the camera's free-form outline, in output pixels.
//
// Negative inside, positive outside, like `shape_distance`. A radius that varies
// with the angle: a circle, plus two harmonics that lean it
// and oval it. Verbatim in `webgl.ts` — the series matters, not just the idea,
// because two rasterisers evaluating it differently is a preview and an export
// whose outlines disagree.
//
// Not a true signed distance: off the curve it is out by however fast the radius
// is turning. That only ever scales the one pixel of feathering at the edge, and
// the editor keeps the harmonics well under a fifth of it so that stays gentle.
static float blob_distance(float2 p, constant Uniforms &u) {
    float2 d = p - u.blob.xy;
    // The picture is mirrored by flipping its uv, which leaves the outline
    // facing the way the camera did and the person facing the other. Reflecting
    // the point we measure from is the same reflection, one line earlier.
    if (u.mirror != 0) {
        d.x = -d.x;
    }

    float t = atan2(d.y, d.x);
    float4 low = u.harmonics[0];
    float4 high = u.harmonics[1];
    float bend = low.x * cos(t) + low.y * sin(t)
               + low.z * cos(2.0 * t) + low.w * sin(2.0 * t)
               + high.x * cos(3.0 * t) + high.y * sin(3.0 * t);

    // Never inside out, whatever the harmonics say. The editor scales them well
    // inside this, and a plan from anywhere else does not get to fold the curve
    // through its own centre.
    float radius = u.blob.z * max(1.0 + bend, 0.1) * u.blob.w;
    return length(d) - radius;
}

// Signed distance to a superellipse-cornered rectangle.// Signed distance to a superellipse-cornered rectangle.
//
// Negative inside, positive outside, in pixels. `n == 2` is an ellipse — a
// circle once the radius reaches half the shorter edge — and `n == 4` is the
// squircle macOS draws.
static float shape_distance(float2 p, float2 half_size, float radius, float n) {
    radius = min(radius, min(half_size.x, half_size.y));
    if (radius <= 0.0) {
        float2 d = abs(p) - half_size;
        return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
    }

    // Distance from the corner arc's centre, in the straight-edge frame.
    float2 corner = abs(p) - (half_size - radius);
    if (corner.x <= 0.0 || corner.y <= 0.0) {
        float2 d = abs(p) - half_size;
        return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
    }

    // |x|^n + |y|^n = r^n, rearranged into an approximate distance. Exact
    // distance to a superellipse has no closed form; this is the standard
    // gradient-normalised approximation and is well under a pixel at these
    // radii.
    float2 q = corner / radius;
    float value = pow(q.x, n) + pow(q.y, n);
    float f = pow(value, 1.0 / n) - 1.0;
    return f * radius;
}

/// How much this pixel keeps, given how far it is from the middle of the frame.
///
/// Measured against the frame, not the picture: a zoom pushes the picture past
/// the frame's edges, and a vignette that followed the picture would drift off
/// screen exactly when it was doing the most work. Normalised so a corner reads
/// 1 whatever the aspect ratio, or a 9:16 export would be darker than a 16:9 one
/// at the same setting.
///
/// Verbatim from `vignette` in `apps/desktop/src/renderer/src/editor/webgl.ts`.
/// Both sides have to agree to the pixel: this is shading, not geometry, so the
/// plan cannot carry the answer and each rasteriser works it out itself.
static float vignette(constant Uniforms &u, float2 screen) {
    if (u.vignette <= 0.0) {
        return 1.0;
    }

    float2 fromCentre = screen / u.frame - 0.5;
    float away = length(fromCentre) / 0.7071068;
    // Starting well inside the corner, so the middle of the frame is untouched
    // and the falloff has room to read as shading rather than as a hard edge.
    return 1.0 - u.vignette * smoothstep(0.35, 1.0, away);
}

// ── The loupe ───────────────────────────────────────────────────────────────
//
// A glass lens lying on the finished frame. Every one of these is mirrored
// verbatim in `apps/desktop/src/renderer/src/editor/webgl.ts`: this is shading
// rather than geometry, so the plan cannot carry the answer and each rasteriser
// works it out itself — which only agrees if the arithmetic is the same
// arithmetic. `webgl.test.ts` compares the two bodies.

// How far past the glass the quad reaches, as a fraction of the radius, so the
// shadow has somewhere to fall off. Mirrors `LOUPE_BLEED` in
// `apps/desktop/src/shared/layout.ts`, which is what grows the quad.
constant float LOUPE_BLEED = 0.22;

// How far around the glass the lens's own render reaches, in radii. Mirrors
// `LOUPE_REACH` in `apps/desktop/src/shared/layout.ts`, which the preview
// interpolates straight into its own shader.
constant float LOUPE_REACH = 1.75;

// The refractive index of the glass. Crown glass, which is what a loupe is
// actually ground from.
constant float LOUPE_IOR = 1.52;

// How far either side of that the red and the blue ends sit at full dispersion.
// Far more than crown glass really splits: a lens a few hundred pixels across
// splits by well under one of them, so a physical figure here would be a control
// that does nothing at any setting.
constant float LOUPE_SPREAD = 0.2;

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
constant float LOUPE_STRETCH = 0.42;

// Where the key light is, for the highlight on the glass. Up and to the left,
// which is where every shadow in this composition already says it is.
//
// Written out already normalised rather than through `normalize()`, so the two
// shaders carry the same three literals — GLSL will not take a built-in call in
// a `const` initialiser at all.
constant float3 LOUPE_LIGHT = float3(-0.4508, -0.6211, 0.6411);

// How far over the glass has turned at its rim, as the sine of the slope.
// Just short of standing on end: at exactly vertical the refracted ray runs
// flat and the sample it asks for is nowhere, and the last pixel of the lens
// comes back as whatever the sampler clamped to.
constant float LOUPE_ROLL = 0.995;

// How much of the radius is the rolled edge, at each end of the curvature
// control. The bottom is a lens that is flat almost to its rim; the top turns
// over through half of itself, which is a ball rather than a magnifier.
constant float LOUPE_EDGE_FLAT = 0.08;
constant float LOUPE_EDGE_FULL = 0.55;

// The composition at a point in the frame, as the lens sees it.
//
// `backdrop` holds the lens's own render: the plan drawn a second time over a
// box `LOUPE_REACH` radii around the glass, at the magnification. So this is not
// a copy of the finished frame — the picture in it comes off the recording at
// the recording's own resolution, which is the only way a magnified lens can be
// sharp. Enlarging output pixels can only ever blur what is already there.
//
// The box is the glass's own, so nothing extra has to be carried to find it.
//
// `src` is how each rasteriser states its buffer's orientation: this one renders
// into a texture that is top-down, so it passes (0, 0, 1, 1); the preview draws
// into a framebuffer that runs bottom-up and passes (0, 1, 1, -1). One number
// rather than a flip written into the shader, which is exactly the kind of thing
// only one of the two would ever get right.
static float3 behind(texture2d<float> backdrop, sampler smp, constant Uniforms &u,
                     float2 screen) {
    float span = 2.0 * LOUPE_REACH * u.loupe.z;
    float2 at = (screen - (u.loupe.xy - LOUPE_REACH * u.loupe.z)) / span;
    return backdrop.sample(smp, u.src.xy + at * u.src.zw).rgb;
}

// The surface normal of the lens at a point on it, in lens radii.
//
// An aspheric, not a sphere cap, and the difference is the whole look. A cap
// shallow enough to magnify cleanly is very nearly flat everywhere, so both the
// squeeze and the glint off its surface collapse into the last one per cent of
// the radius and there is nothing to see. This is the shape a magnifier actually
// is: flat across the working area, then rolled over through the outer edge until
// it stands almost on end where it meets its mount.
//
// `roll` is the sine of the surface's slope, so the vector below is already unit
// length. `LOUPE_ROLL` stops just short of vertical: at the rim the glass is
// grazing, which is what squeezes the picture out to meet the screen and what
// puts a Fresnel edge on it with nothing drawn there.
//
// Verbatim as `lensNormal` in `webgl.ts`.
static float3 lens_normal(float2 offset, float edge) {
    float r = length(offset);
    float roll = smoothstep(1.0 - edge, 1.0, r) * LOUPE_ROLL;
    // Straight out from the middle, which is the way a surface of revolution
    // leans. Nothing at the very centre, where there is no direction and no
    // slope either.
    float2 away = r > 1e-4 ? offset / r : float2(0.0);
    return float3(away * roll, sqrt(max(1.0 - roll * roll, 1e-6)));
}

// How far the refracted ray walks off the axis per unit of depth.
static float lens_bend(float3 normal, float ior) {
    // Looking straight down, refracted at the surface on the way in.
    float3 through = refract(float3(0.0, 0.0, -1.0), normal, 1.0 / ior);
    return length(through.xy) / max(-through.z, 1e-4);
}

// How far from the middle of the lens to sample, as a fraction of how far this
// pixel is from it.
//
// 1 / magnify through the flat middle, so the picture there is enlarged by
// exactly what was asked for. Across the rolled edge the refracted ray leaves the
// axis faster and faster, and the fraction is walked back up to 1 — so the last
// of the glass shows the frame at its own size and the magnified image *meets*
// the screen it is lying on. Without that the lens ends on a seam, and the whole
// thing reads as a circle pasted on the frame rather than as glass.
//
// Measured against the rim's own bend rather than against a fixed number, which
// is what makes that arrival exact at every curvature: Snell decides how the
// squeeze is distributed across the edge, and this decides where it ends.
//
// `ior` is a parameter so each of the three channels can be given its own. That
// is all dispersion is, and it is the whole of the aberration control.
//
// Verbatim as `lensReach` in `webgl.ts`.
static float lens_reach(float2 offset, float edge, float magnify, float ior) {
    float r = length(offset);
    float bend = lens_bend(lens_normal(offset, edge), ior);
    // The rim measured at the glass's *own* index, not at this channel's, and
    // that is the whole of the fringing.
    //
    // Normalising each channel against its own rim divided the dispersion back
    // out again: both the bend and the rim scale with the index, so the ratio
    // came out very nearly the same for all three and the control did nothing at
    // any setting. Against one reference the three channels land apart — and
    // they land apart *by how much the bend differs*, which is nothing in the
    // flat middle and most at the rim. Which is where fringing belongs.
    float rim = lens_bend(lens_normal(float2(1.0, 0.0), edge), LOUPE_IOR);
    // `smoothstep` rather than the ratio itself, so the mapping is flat at both
    // ends and there is no distance from the middle at which the squeeze visibly
    // starts — the same reason `sample_focused` ramps the way it does.
    // The walk, in radii, and exactly zero across the flat middle — the bend is
    // zero there, so the middle magnifies by what was asked for and nothing
    // else. Divided by the magnification so a strong lens folds no harder than
    // a weak one: the band is a fraction of the picture, not a pixel count.
    float walk = (LOUPE_STRETCH / magnify) * smoothstep(0.0, 1.0, bend / max(rim, 1e-4));
    // Back to a multiplier on the offset. Never past the middle of the glass,
    // which is where a fold would start turning itself inside out.
    return max(1.0 / magnify - walk / max(r, 1e-3), 0.02);
}

// The colour these words should be, given what is behind them.
//
// Sixteen taps on a fixed grid rather than a mipmap: a mipmap's filtering is
// the driver's business and this has to come out the same here and in the
// preview, or a caption is dark on screen and light in the file. Every fragment
// of the quad computes the same average, which is the point — a line split
// between two colours would read as a mistake rather than as contrast.
//
// Mixed across a band rather than switched at a threshold, for the same reason:
// on a backdrop near the middle the two rasterisers can measure very slightly
// differently, and a mix turns that into an imperceptible difference of colour
// instead of a flip.
//
// Mirrors `chosen` in `apps/desktop/src/renderer/src/editor/webgl.ts`.
static float3 chosen(texture2d<float> backdrop, sampler smp, constant Uniforms &u) {
    float luma = 0.0;
    for (int tap = 0; tap < 16; tap++) {
        float2 at = (float2(float(tap % 4), float(tap / 4)) + 0.5) / 4.0;
        float3 behind = backdrop.sample(smp, at).rgb;
        luma += dot(behind, float3(0.2126, 0.7152, 0.0722));
    }

    return mix(u.colorA.rgb, u.colorB.rgb, smoothstep(0.42, 0.62, luma / 16.0));
}

// A hue angle in turns, as a colour to add.
//
// Not a full HSV conversion: these are offsets added to a picture, so what is
// wanted is a direction in colour, and three cosines a third of a turn apart
// give one for almost nothing. Centred on zero, so adding it shifts the hue
// without also lifting the brightness the way a positive-only ramp would.
//
// Verbatim as `hueColour` in `webgl.ts`.
static float3 hue_colour(float turns) {
    float a = turns * 6.2831853;
    return float3(cos(a), cos(a - 2.0943951), cos(a + 2.0943951)) * 0.3333333;
}

// Where skin sits, as red-minus-green over green-minus-blue. Measured off the
// faces in the sample recordings rather than taken from a paper: what matters
// is where a webcam puts skin, not where skin is.
constant float2 SKIN = float2(0.19, 0.08);

static float max_of(float3 v) { return max(v.r, max(v.g, v.b)); }
static float min_of(float3 v) { return min(v.r, min(v.g, v.b)); }

// The camera's colour look.
//
// One function for every look there is, driven by three vectors the plan carries —
// see `camera-looks.ts`, which is the only place a look is defined. Neither shader
// holds a catalogue, so neither can drift out of step with the other, and retuning
// a look changes no shader at all. That is the whole difference between this and
// the whole-frame filters, which are an arm of a switch in each.
//
// The order is the order a colourist works in: correct the white balance, set the
// black point, shape the contrast, then touch the colour. Saturating before
// balancing bakes the cast in.
//
// Taking the vectors as arguments rather than reading the uniforms, so the two
// bodies are the same text in both languages and `webgl.test.ts` can say so.
//
// Mirrored verbatim in `apps/desktop/src/renderer/src/editor/webgl.ts`.
static float3 graded(float3 rgb, float4 a, float4 b, float4 c) {
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
    rgb *= float3(1.0 + 0.32 * temperature, 1.0 - 0.14 * tint, 1.0 - 0.32 * temperature);
    rgb = max(rgb, float3(0.0));

    // The blacks lifted towards mid, without moving the whites. Compressing the
    // range from below rather than adding a constant: adding one raises the whole
    // picture and washes the highlights out with it.
    rgb = rgb * (1.0 - lift) + lift * 0.18;

    // An S-curve about mid grey. smoothstep rather than a power or a multiply: a
    // multiply clips the highlights the moment contrast goes up, and this is flat
    // at both ends so nothing stops abruptly. Negative contrast pulls towards the
    // pivot instead, which is a different operation and has to be.
    float3 softer = float3(0.4) + (rgb - float3(0.4)) * 0.72;
    rgb = contrast >= 0.0 ? mix(rgb, smoothstep(float3(0.0), float3(1.0), rgb), contrast)
                          : mix(rgb, softer, -contrast);

    float grey = dot(rgb, float3(0.2126, 0.7152, 0.0722));

    // Vibrance, and the reason it earns a lever of its own: it weights by how
    // grey a pixel already is, so a dull background comes up and a face that is
    // already colourful does not — and then weights again by distance from skin,
    // because a face is the thing a saturation control ruins first.
    float away = length(float2(rgb.r - rgb.g, rgb.g - rgb.b) - SKIN);
    float flesh = 1.0 - smoothstep(0.08, 0.3, away);
    float dull = 1.0 - clamp(max_of(rgb) - min_of(rgb), 0.0, 1.0);
    rgb = mix(float3(grey), rgb, 1.0 + vibrance * dull * (1.0 - 0.75 * flesh));

    // And the flat one, which moves the face as much as anything else. Small
    // numbers only, in every look in the catalogue.
    rgb = mix(float3(grey), rgb, 1.0 + saturation);

    // Split toning: shadows and highlights pulled towards opposing hues, which is
    // most of what reads as film. Weighted by luma so the two never fight over
    // the midtones, which is where a face lives.
    float dark = 1.0 - smoothstep(0.0, 0.5, grey);
    float light = smoothstep(0.5, 1.0, grey);
    rgb += hue_colour(b.z) * (b.w * dark);
    rgb += hue_colour(c.x) * (c.y * light);

    return clamp(rgb, float3(0.0), float3(1.0));
}

// The picture, enlarged without rounding its edges off.
//
// Texel snapping, and one tap. The sample is nudged so that the blend between
// two source texels happens across one *output* pixel instead of across the
// whole texel — so an edge in the recording arrives as an edge with one pixel of
// antialiasing on it, however far the picture is being magnified, rather than as
// a ramp as wide as the magnification. The hardware's own bilinear unit does the
// blend; all this does is decide where to ask for it.
//
// Measured against the alternatives on a hard edge magnified 2x, as the biggest
// step between neighbouring output pixels — which is what reads as sharpness:
// plain bilinear 115, a nine-tap Catmull-Rom 132, this 216. The source's own
// unmagnified edge is 216, so this is not an approximation of the right answer,
// it is the right answer, and it is cheaper than either. Pinned by
// `magnifying_a_picture_keeps_its_edges` in `renders_the_right_pixels.rs`.
//
// It suits what Prequel magnifies. A screen recording is text, rules and
// flat-filled panels on a pixel grid; a cubic kernel rings on exactly those, and
// a linear one turns a one-pixel rule into a three-pixel smudge.
//
// Verbatim as `sampleEnlarged` in `webgl.ts`.
static float4 sample_enlarged(texture2d<float> image, sampler smp, constant Uniforms &u,
                              float2 uv) {
    float2 pos = uv / max(u.texel, float2(1e-9));
    // One output pixel, measured in source texels. Never wider than a texel, or
    // the blend would be the plain linear one it is replacing.
    float2 wide = clamp(fwidth(pos), float2(1e-4), float2(1.0));
    float2 base = floor(pos - 0.5) + 0.5;
    // Flat at both texel centres, crossing over the width of one output pixel.
    float2 snapped = clamp((pos - base - 0.5) / wide + 0.5, 0.0, 1.0);
    return image.sample(smp, (base + snapped) * u.texel);
}

// How many source texels one output pixel covers.
//
// Off the screen-space derivatives rather than off the uniforms, which is what
// makes it right in every pass: the lens draws the same plan into a target at
// its own magnification, and a quad can be tilted, so the ratio of the
// destination rectangle to the source crop is not the rate anything is actually
// sampled at. This is the same quantity the hardware picks a mip level with.
//
// Below 1 the picture is being enlarged.
//
// Verbatim as `texelsPerPixel` in `webgl.ts`.
static float texels_per_pixel(constant Uniforms &u, float2 uv) {
    float2 rate = fwidth(uv) / max(u.texel, float2(1e-9));
    return max(max(rate.x, rate.y), 1e-6);
}

// The picture, softened by how far this pixel is from what is in focus.
//
// One pass with a per-pixel radius rather than the usual two with a fixed one:
// a separable blur has a single kernel for the whole frame, and progressive
// means the kernel changes everywhere. Sixteen taps on a spiral — enough that
// the falloff reads as defocus rather than as rings.
//
// Mirrors `sampleFocused` in `apps/desktop/src/renderer/src/editor/webgl.ts`.
static float4 sample_focused(texture2d<float> image, sampler smp, constant Uniforms &u,
                             float2 uv, float2 screen) {
    float away = max(distance(screen, u.focus.xy) - u.focus.z, 0.0);

    // `smoothstep`, and over half again the sharp radius.
    //
    // This was `t * t` over `u.focus.z`, and both halves of that showed. A
    // square leaves rest smoothly and *arrives* at full blur with its steepest
    // slope, so where the ramp saturated the rate of change fell to nothing in
    // one step — a slope discontinuity, which the eye reads as a ring at a fixed
    // distance from the subject rather than as defocus. `smoothstep` is flat at
    // both ends, so there is no edge to find at either.
    //
    // The wider ramp is the other half. Tying the transition to exactly the
    // sharp radius made it as tight as the sharp area itself, so a small
    // `blurSafe` — the setting that ought to give a *shallower* depth of field —
    // instead gave a hard-edged hole. Half again is enough to read as a lens.
    // Whichever asks for more. The two never apply to the same draw today —
    // the depth of field is on the picture, the soften is on a caption — and
    // taking the larger keeps one tap loop rather than two that could disagree
    // about what a radius means.
    float radius = max(u.focus.w * smoothstep(0.0, max(u.focus.z * 1.5, 1.0), away), u.soften);

    // Enlarging: a cubic kernel recovers the edge a linear one rounds off. The
    // source runs out long before the lens does — an Automatic frame exports at
    // the recording's own size, so a 2x zoom of any kind has nothing left to
    // read and everything to do with how it interpolates.
    if (radius <= 0.5) {
        return texels_per_pixel(u, uv) < 0.95 ? sample_enlarged(image, smp, u, uv)
                                              : image.sample(smp, uv);
    }

    // The tap count follows the radius rather than being fixed at sixteen.
    //
    // These are point samples on a spiral, not a kernel — sixteen of them are
    // dense enough to read as a blur across a caption's few pixels, and spread
    // across a background's fifty they leave gaps between them. The eye reads
    // those gaps as grain, which is exactly what a soft backdrop must not have.
    //
    // Capped, because the background fill covers every pixel of the frame and
    // this loop runs for all of them. `span` is the square root of the count so
    // the outermost tap still lands on the edge of the disc whatever the count
    // is — it was hard-coded as 4 for sixteen taps.
    int taps = int(clamp(radius, 16.0, 48.0));
    float span = sqrt(float(taps));

    float4 total = float4(0.0);
    for (int tap = 0; tap < taps; tap++) {
        float turn = float(tap) * 2.399963;
        float reach = sqrt(float(tap) + 0.5) / span;
        float2 offset = float2(cos(turn), sin(turn)) * reach * radius * u.texel;
        total += image.sample(smp, uv + offset);
    }
    return total / float(taps);
}

// The pointer, smeared along the direction it is travelling.
//
// The streak arrives finished, in this quad's uv, because the editor computed
// it once — see `CursorPoint.smearX` in `shared/layout.ts`. Nothing here knows
// a speed, a direction or a frame rate, which is the only reason the preview
// and the export cannot disagree about it.
//
// The quad arrives grown by `smear.z` on each side so the streak has somewhere
// to be drawn; without that it would stop dead at the sprite's own edge, which
// reads as the pointer being clipped rather than as motion. `inner` maps back
// off that padding, and a tap landing outside the sprite contributes nothing
// rather than the clamped edge texel — which would smear the arrow's tip into
// a stripe running the length of the streak.
//
// Nine taps, not the sixteen `sample_focused` uses: those cover a disc and
// these cover a line, so the same density needs far fewer. Plain samples
// rather than focused ones — the pointer sits on the focal plane, and 9 × 16
// taps to defocus something already sharp is not worth the frame time.
//
// Mirrors `sampleSmeared` in `apps/desktop/src/renderer/src/editor/webgl.ts`.
static float4 sample_smeared(texture2d<float> image, sampler smp, constant Uniforms &u,
                             float2 uv) {
    float pad = u.smear.z;
    float span = max(1.0 - 2.0 * pad, 0.0001);

    float4 total = float4(0.0);
    for (int tap = 0; tap < 9; tap++) {
        // Centred on the position: half the streak trails the pointer and half
        // leads it. Trailing only would sit the sprite at the end of its own
        // smear and read as the pointer lagging behind the cursor.
        float along = float(tap) / 8.0 - 0.5;
        float2 inner = (uv + u.smear.xy * along - pad) / span;
        if (any(inner < 0.0) || any(inner > 1.0)) {
            continue;
        }
        total += image.sample(smp, u.src.xy + inner * u.src.zw);
    }
    return total / 9.0;
}

/// Alpha of the pointer silhouette, softened in source uv space.
static float cursor_shadow_alpha(texture2d<float> image, sampler smp,
                                 constant Uniforms &u, float2 uv) {
    // The cursor quad is larger than the source sprite. Clamped sampling is
    // useful for crops, but outside this silhouette it turns the edge texel
    // into a solid rectangle — exactly the static-pointer artefact the moving
    // smear path hid by rejecting its own outside taps.
    if (any(uv < 0.0) || any(uv > 1.0)) {
        return 0.0;
    }
    float radius = u.cursor_shadow.z / max(u.cursor_box.z, 0.0001);
    if (radius <= 0.0) {
        return image.sample(smp, u.src.xy + uv * u.src.zw).a;
    }

    float total = 0.0;
    for (int tap = 0; tap < 9; tap++) {
        float turn = float(tap) * 2.399963;
        float reach = sqrt(float(tap) + 0.5) / 3.0;
        float2 offset = float2(cos(turn), sin(turn)) * reach * radius;
        float2 sample_uv = uv + offset;
        if (any(sample_uv < 0.0) || any(sample_uv > 1.0)) continue;
        total += image.sample(smp, u.src.xy + sample_uv * u.src.zw).a;
    }
    return total / 9.0;
}

// Source-over blending is configured for premultiplied colour, so every return
// carries its alpha folded into the RGB. Verbatim from `premultiplied` in
// `apps/desktop/src/renderer/src/editor/webgl.ts`.
//
// Doing it here rather than in the pipeline state is what lets both rasterisers
// run one blend mode each: the alternative is a `SrcAlpha` blend, which
// multiplies a second time and quietly renders every translucent thing at its
// own opacity squared.
static inline float4 premultiplied(float3 rgb, float alpha) {
    return float4(rgb * alpha, alpha);
}

fragment float4 composite_fragment(Vertex in [[stage_in]],
                                   constant Uniforms &u [[buffer(0)]],
                                   texture2d<float> image [[texture(0)]],
                                   // A copy of what has already been drawn
                                   // under this quad. Only an adaptive caption
                                   // reads it; every other draw binds the same
                                   // texture as `image` and ignores it.
                                   texture2d<float> backdrop [[texture(1)]],
                                   // The camera's person mask, luma being
                                   // alpha. Only a camera drawn as a cutout
                                   // reads it; every other draw binds a
                                   // stand-in and ignores it.
                                   texture2d<float> matte [[texture(2)]]) {
    // Declared here rather than bound: clamped so a sample a hair outside the
    // crop cannot wrap to the far edge of the frame, which shows as a seam.
    constexpr sampler smp(filter::linear, address::clamp_to_edge);

    // The lens, first, because nothing else in here applies to it: its quad is a
    // square grown around the glass for the shadow, and the shape that matters is
    // the circle inside it rather than the rectangle the quad covers.
    //
    // Verbatim from the `u_mode == 5` branch in `webgl.ts`.
    if (u.mode == 5) {
        float radius = max(u.loupe.z, 1.0);
        // In lens radii, so every number below is read against the glass itself.
        float2 offset = (in.screen - u.loupe.xy) / radius;
        float r = length(offset);

        // The shadow the glass casts, drawn in the bleed the quad was grown by.
        // The same logistic falloff the rectangle shadows use — a blurred edge
        // decays rather than stopping — dropped by a fraction of the radius so
        // the lens stands off the picture instead of sitting in it.
        float sigma = LOUPE_BLEED * 0.42;
        float under = length(offset - float2(0.0, LOUPE_BLEED * 0.3)) - 1.0;
        float shade = 0.34 * u.loupe.w / (1.0 + exp(1.702 * under / sigma));

        // One pixel of feathering at the rim, in pixels, like every other edge.
        float cover = 1.0 - smoothstep(-0.5, 0.5, (r - 1.0) * radius);
        if (cover <= 0.0) {
            // Only the shadow out here. Premultiplied black, so it darkens
            // whatever the frame already put down.
            return premultiplied(float3(0.0), shade);
        }

        // Flat almost to the rim at one end, half of it turned over at the other.
        float edge = mix(LOUPE_EDGE_FLAT, LOUPE_EDGE_FULL, clamp(u.glass.y, 0.0, 1.0));
        float3 normal = lens_normal(offset, edge);
        float magnify = max(u.glass.x, 1.0);
        float split = clamp(u.glass.z, 0.0, 1.0) * LOUPE_SPREAD;

        float3 lit;
        if (split <= 0.0) {
            lit = behind(
                backdrop, smp, u,
                u.loupe.xy + offset * lens_reach(offset, edge, magnify, LOUPE_IOR) * radius);
        } else {
            // Three taps rather than one blurred one: a fringe is each channel
            // landing somewhere slightly different, not all of them being soft.
            lit = float3(
                behind(backdrop, smp, u,
                       u.loupe.xy
                           + offset * lens_reach(offset, edge, magnify, LOUPE_IOR - split)
                                 * radius).r,
                behind(backdrop, smp, u,
                       u.loupe.xy
                           + offset * lens_reach(offset, edge, magnify, LOUPE_IOR) * radius).g,
                behind(backdrop, smp, u,
                       u.loupe.xy
                           + offset * lens_reach(offset, edge, magnify, LOUPE_IOR + split)
                                 * radius).b);
        }

        float shine = clamp(u.glass.w, 0.0, 1.0);

        // What the glass reflects. Schlick's approximation: barely reflective
        // looked at straight on, a mirror at the rim where the surface has
        // turned away.
        float fresnel = 0.04 + 0.96 * pow(1.0 - normal.z, 5.0);
        // Straight out from the middle and a little past the rim, which is where
        // a convex surface of revolution sends what it reflects — and near the
        // rim is the only place the Fresnel term lets any of it through.
        //
        // A bounded step rather than following the reflected ray to where it
        // lands. Near grazing that ray runs almost flat, so the true landing
        // point is very far away; under a clamped sampler far away is the corner
        // of the frame, and that drew as a black cap over the top of every lens.
        float2 outward = offset / max(r, 1e-3);
        float3 around =
            behind(backdrop, smp, u, u.loupe.xy + outward * radius * (1.1 + 0.3 * edge));

        // And the room the glass is standing in, which is the half of the
        // reflection the frame cannot supply.
        //
        // The surroundings alone are not enough to read as glass: a lens over a
        // dark panel reflects a dark panel and comes out as a hole cut in the
        // picture. Real glass on a dark desk still carries a bright edge, and
        // that light is the room rather than the desk. So this is a plain studio
        // gradient — bright where the surface turns up to the ceiling, dim where
        // it turns down to the table — and it is what the rim is made of now that
        // nothing is drawn there.
        float3 room = mix(float3(0.04), float3(0.92), smoothstep(-0.5, 0.75, -normal.y));
        lit = mix(lit, mix(around, room, 0.55), fresnel * shine);

        // The highlight, and a broad sheen under it. One light: the tight term is
        // the reflection of the source itself and the wide one is the glass being
        // lit at all, and without the second the first reads as a sticker.
        float facing = max(dot(normal, LOUPE_LIGHT), 0.0);
        lit += shine * (pow(facing, 40.0) * 0.7 + pow(facing, 4.0) * 0.08);

        // The glass over its own shadow, both premultiplied: what is left of the
        // shadow is the part the glass does not cover. Presence rides on the
        // coverage, so an arriving lens is see-through rather than popping in.
        float shown = cover * u.loupe.w;
        return float4(lit * shown, shown + (1.0 - shown) * shade);
    }

    float2 half_size = u.rect.zw * 0.5;
    float2 p = in.local - half_size;

    // Shadows are drawn as the same shape, softened — so the blur follows the
    // silhouette rather than the bounding box.
    //
    // Verbatim from the `u_mode == 3` branch in `webgl.ts`, including the
    // constant: the rectangle arrives grown by this many sigmas (see
    // `SHADOW_SPREAD` in `shared/layout.ts`) so the falloff has somewhere to be
    // drawn, and both rasterisers take it back off to find the shape casting
    // it. Growing it in one place and not subtracting it in the other moves the
    // shadow out from under the picture.
    if (u.mode == 3) {
        float sigma = max(u.weight, 0.0001);
        float2 caster = max(half_size - 3.0 * sigma, float2(0.0));
        float away = shape_distance(p, caster, u.shape.x, u.shape.y);
        // The logistic approximation to a Gaussian's integral: half opacity on
        // the edge, decaying without ever quite stopping. `smoothstep` reached
        // zero at a fixed distance and left a rim where the shadow ended.
        return premultiplied(u.colorA.rgb, u.colorA.a / (1.0 + exp(1.702 * away / sigma)));
    }

    // The outline, when the camera has one, otherwise the rounded rectangle
    // every other primitive is. Measured in output pixels either way, which is
    // what lets the one pixel of feathering below mean the same thing.
    //
    // Switched on the outline's own radius, which is above zero only for that
    // camera. A moment with nobody in front of it has a `presence` of zero
    // instead, which makes the radius zero here and draws nothing — where
    // falling back to `shape` would draw the rounded rectangle underneath, and
    // for this shape that is the whole uncropped camera picture flashed across
    // the frame.
    float d = u.blob.z > 0.0 ? blob_distance(in.screen, u)
                             : shape_distance(p, half_size, u.shape.x, u.shape.y);

    if (u.mode == 4) {
        // A stroke lies *inside* the silhouette: the band between the edge and
        // the same shape inset by its width, which is `d + width` — an inward
        // offset of a rounded rect is a rounded rect of radius r - width.
        //
        // Centred on the edge, as this was, half the band falls outside the
        // rectangle the quad covers, and a fragment shader cannot paint outside
        // its own geometry. Along a straight edge that half was simply missing,
        // so a 10px border drew 5px; at a corner the square quad still covers
        // the area outside the curve, so there the whole band survived. The
        // border came out half width on the sides and full width round the
        // corners, which reads as corners of the wrong radius rather than as a
        // border of the wrong width. It also matches the canvas preview, which
        // insets its path and has always drawn the whole stroke inside.
        float width = max(u.weight, 0.5);
        float outer = 1.0 - smoothstep(-0.5, 0.5, d);
        float inner = 1.0 - smoothstep(-0.5, 0.5, d + width);
        return premultiplied(u.colorA.rgb, u.colorA.a * (outer - inner));
    }

    // One pixel of feathering at the edge. Without it a circle drawn at export
    // resolution has visibly stepped edges where the canvas preview does not.
    float coverage = 1.0 - smoothstep(-0.5, 0.5, d);
    if (coverage <= 0.0) {
        discard_fragment();
    }

    if (u.mode == 2) {
        float2 uv = in.uv;
        if (u.mirror != 0) {
            uv.x = 1.0 - uv.x;
        }
        // A moving pointer, which maps its own uv — the quad it is drawn in is
        // larger than the sprite, so the shared mapping below would stretch it.
        float4 sampled;
        float2 cursor_uv = (uv - u.cursor_box.xy) / u.cursor_box.zw;
        if (u.smear.w != 0.0) {
            sampled = sample_smeared(image, smp, u, cursor_uv);
        } else {
            // The shadow grows the quad beyond the pointer. Do not let the
            // sampler's clamp-to-edge turn that padding into a copy of the
            // PNG's outer pixel — a static pointer then becomes a black
            // rectangle while a moving one, whose smear path already rejects
            // outside samples, looks fine.
            bool inside_cursor = all(cursor_uv >= 0.0) && all(cursor_uv <= 1.0);
            if (!inside_cursor) {
                sampled = float4(0.0);
            } else {
                // Mapped into the source rect, so a crop is honoured rather
                // than the whole texture being stretched across the
                // destination. Mirroring is applied first, so it flips the
                // crop rather than moving it.
                uv = u.src.xy + cursor_uv * u.src.zw;
                sampled = sample_focused(image, smp, u, uv, in.screen);
                // The mask is a separate, smaller stream sampled at the same
                // uv as the picture, so mirror and crop reach it for free and
                // its size need not match. Multiplied through every channel:
                // the picture is premultiplied, and colour has to scale with
                // alpha or the edge of the person glows.
                if (u.matte != 0) {
                    sampled *= matte.sample(smp, uv).r;
                }
                // The camera's look, on the camera alone. After the matte so a
                // cutout is graded only where somebody is, and before
                // everything below so the vignette and the caption's backdrop
                // both see the graded picture rather than the raw one.
                // Premultiplied, so the colour is divided out and folded back
                // in or a translucent edge would grade twice.
                if (u.grade_c.z > 0.0 && sampled.a > 0.0) {
                    sampled = float4(
                        graded(sampled.rgb / sampled.a, u.grade_a, u.grade_b, u.grade_c)
                            * sampled.a,
                        sampled.a);
                }
            }
        }
        if (u.cursor_shadow.w > 0.0) {
            float2 shadow_uv = cursor_uv - u.cursor_shadow.xy / u.cursor_box.zw;
            float shadow_alpha = cursor_shadow_alpha(image, smp, u, shadow_uv);
            float under = shadow_alpha * u.cursor_shadow.w * (1.0 - sampled.a);
            sampled = float4(sampled.rgb, sampled.a + under);
        }
        // Recoloured against what is behind, for a look whose words stand on
        // the footage with nothing under them. The bitmap is white where it is
        // opaque, so the colour is a multiply — and premultiplied, so it
        // multiplies the coverage the glyph already carries.
        if (u.adapt > 0.0) {
            sampled = float4(chosen(backdrop, smp, u) * sampled.a, sampled.a);
        }
        // `sampled` is already premultiplied — `image.rs` decodes through
        // `KCG_IMAGE_ALPHA_PREMULTIPLIED_FIRST` and a camera frame is opaque —
        // so only `coverage` is folded in here. Running it through
        // `premultiplied` as well would multiply the texture's own alpha twice.
        //
        // `alpha` rides along with coverage for the same reason: premultiplied
        // colour has to be scaled with its own alpha or a fading picture turns
        // bright before it disappears.
        float shown = coverage * u.alpha;
        return float4(sampled.rgb * vignette(u, in.screen) * shown, sampled.a * shown);
    }

    if (u.mode == 1) {
        // Projected onto the gradient's axis, so the stop positions are
        // measured the same way CSS measures them.
        float t = saturate(dot(in.uv - 0.5, u.gradient) + 0.5);
        float4 color = mix(u.colorA, u.colorB, t);
        return premultiplied(color.rgb, color.a * coverage);
    }

    return premultiplied(u.colorA.rgb, u.colorA.a * coverage);
}
