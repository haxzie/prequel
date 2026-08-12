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
    // Destination rectangle in output pixels.
    float4 rect;
    // Region of the source texture to sample, normalised 0-1 as (x, y, w, h).
    // Without this the whole texture is stretched into the destination, which
    // squashes a 16:9 camera into a circle and ignores every crop.
    float4 src;
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
    float _pad;
};

struct Vertex {
    float4 position [[position]];
    float2 local;
    float2 uv;
};

// A full-quad pass over the destination rectangle. Four vertices, no buffer:
// the rectangle is in the uniforms and the corner is the vertex id.
vertex Vertex composite_vertex(uint id [[vertex_id]],
                               constant Uniforms &u [[buffer(0)]]) {
    const float2 corners[4] = { float2(0, 0), float2(1, 0), float2(0, 1), float2(1, 1) };
    float2 corner = corners[id];

    float2 pixel = u.rect.xy + corner * u.rect.zw;
    // Pixels to clip space, with y flipped: Metal's clip space is
    // bottom-up and every rectangle in the plan is top-down.
    float2 clip = (pixel / u.frame) * 2.0 - 1.0;

    Vertex out;
    out.position = float4(clip.x, -clip.y, 0.0, 1.0);
    out.local = corner * u.rect.zw;
    out.uv = corner;
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
    if (u.mode == 3) {
        float d = shape_distance(p, half_size, u.shape.x, u.shape.y);
        float softness = max(u.weight, 0.0001);
        float alpha = 1.0 - smoothstep(-softness, softness, d);
        return float4(u.colorA.rgb, u.colorA.a * alpha);
    }

    float d = shape_distance(p, half_size, u.shape.x, u.shape.y);

    if (u.mode == 4) {
        // A stroke is the band either side of the edge.
        float half_width = max(u.weight, 0.5) * 0.5;
        float band = 1.0 - smoothstep(half_width - 0.5, half_width + 0.5, abs(d));
        return float4(u.colorA.rgb, u.colorA.a * band);
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
        float4 sampled = image.sample(smp, uv);
        return float4(sampled.rgb, sampled.a * coverage);
    }

    if (u.mode == 1) {
        // Projected onto the gradient's axis, so the stop positions are
        // measured the same way CSS measures them.
        float t = saturate(dot(in.uv - 0.5, u.gradient) + 0.5);
        float4 color = mix(u.colorA, u.colorB, t);
        return float4(color.rgb, color.a * coverage);
    }

    return float4(u.colorA.rgb, u.colorA.a * coverage);
}
