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
    // Destination rectangle in output pixels.
    float4 rect;
    // Region of the source texture to sample, normalised 0-1 as (x, y, w, h).
    // Without this the whole texture is stretched into the destination, which
    // squashes a 16:9 camera into a circle and ignores every crop.
    float4 src;
    // Depth of field: xy is what stays sharp in output pixels, z how far
    // around it, w the widest blur beyond. A w of 0 softens nothing.
    float4 focus;
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

    // 0 fill, 1 gradient, 2 image, 3 shadow, 4 stroke.
    uint mode;
    // Stroke width, or shadow blur radius, in pixels.
    float weight;
    // Non-zero mirrors the sampled image horizontally.
    uint mirror;
    // How hard the frame darkens towards its edges, 0 to 1. 0 darkens nothing.
    // In place of the tail padding this struct already carried, so every other
    // field keeps the offset it had.
    float vignette;
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
    float2 clip = (pixel / u.frame) * 2.0 - 1.0;

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

// Signed distance to a superellipse-cornered rectangle.
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
    float radius = u.focus.w * smoothstep(0.0, max(u.focus.z * 1.5, 1.0), away);

    if (u.focus.w <= 0.0 || radius <= 0.5) {
        return image.sample(smp, uv);
    }

    float4 total = float4(0.0);
    for (int tap = 0; tap < 16; tap++) {
        float turn = float(tap) * 2.399963;
        float reach = sqrt(float(tap) + 0.5) / 4.0;
        float2 offset = float2(cos(turn), sin(turn)) * reach * radius * u.texel;
        total += image.sample(smp, uv + offset);
    }
    return total / 16.0;
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
                                   texture2d<float> image [[texture(0)]]) {
    // Declared here rather than bound: clamped so a sample a hair outside the
    // crop cannot wrap to the far edge of the frame, which shows as a seam.
    constexpr sampler smp(filter::linear, address::clamp_to_edge);

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

    float d = shape_distance(p, half_size, u.shape.x, u.shape.y);

    if (u.mode == 4) {
        // A stroke is the band either side of the edge.
        float half_width = max(u.weight, 0.5) * 0.5;
        float band = 1.0 - smoothstep(half_width - 0.5, half_width + 0.5, abs(d));
        return premultiplied(u.colorA.rgb, u.colorA.a * band);
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
        // Mapped into the source rect, so a crop is honoured rather than the
        // whole texture being stretched across the destination. Mirroring is
        // applied first, so it flips the crop rather than moving it.
        uv = u.src.xy + uv * u.src.zw;
        float4 sampled = sample_focused(image, smp, u, uv, in.screen);
        // `sampled` is already premultiplied — `image.rs` decodes through
        // `KCG_IMAGE_ALPHA_PREMULTIPLIED_FIRST` and a camera frame is opaque —
        // so only `coverage` is folded in here. Running it through
        // `premultiplied` as well would multiply the texture's own alpha twice.
        return float4(sampled.rgb * vignette(u, in.screen) * coverage, sampled.a * coverage);
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
