// The look laid over the finished frame, as the exporter draws it.
//
// Its own shader pair rather than another mode in `shaders.metal`. That file's
// `Uniforms` is 272 bytes with a hand-derived offset table and a test asserting
// every offset in it; adding five `float4`s means re-deriving all of them for a
// block no per-item draw reads. Its fragment function also already carries a
// 48-tap defocus loop, and folding a CRT into it makes every fragment of every
// quad branch on a look it is not part of.
//
// `apps/desktop/src/renderer/src/editor/filters.ts` is the mirror, function for
// function. Both sides have to agree to the pixel: this is shading, not
// geometry, so the plan cannot carry the answer and each rasteriser works it
// out itself.
//
// ## Lengths
//
// Everything here works in normalised frame coordinates — `uv`, 0 to 1 across
// the picture — and every length is a fraction of the frame's shorter edge. The
// preview rasterises at the size of the canvas on screen and this side at the
// output resolution, so a pitch in pixels would be three times as dense in the
// file as it was on screen. See `PlanFilter::scale`.

#include <metal_stdlib>
using namespace metal;

struct FilterUniforms {
    // Leads, and is 16 bytes, so every scalar after it keeps the offset it has
    // whatever is added later. The same discipline `Uniforms` in
    // `shaders.metal` follows, and for the same reason: a mismatch here does
    // not fail to compile, it renders the wrong colour.
    float4 tint;
    // The output frame in pixels. Only ever used to take the aspect out of
    // `uv` — an aspect, not a resolution.
    float2 frame;
    float strength;
    // A fraction of the frame's shorter edge, never a pixel count.
    float scale;
    // Radians.
    float angle;
    // Seconds, already wrapped by `filter_time`. 0 when the look is not
    // animated.
    float time;
    // Which look. The same numbering as `FilterKind::index` in `plan.rs`.
    uint look;
    // Which way of wearing it.
    uint variant;
};

struct FilterVertex {
    float4 position [[position]];
    float2 uv;
};

// A full-screen triangle strip, with no buffer.
//
// The same trick the item shader uses — the corner comes from the vertex id —
// but over the whole frame rather than a rectangle from the uniforms, because
// this pass has no rectangle.
//
// The y flip is here and not in the GLSL: Metal's clip space is bottom-up and
// the texture this samples was rendered top-down by the very same convention
// `composite_vertex` flips for. Without it the export comes out upside down
// while the preview, which has no flip to undo, does not.
vertex FilterVertex filter_vertex(uint id [[vertex_id]]) {
    const float2 corners[4] = { float2(0, 0), float2(1, 0), float2(0, 1), float2(1, 1) };
    float2 corner = corners[id];

    FilterVertex out;
    out.position = float4(corner.x * 2.0 - 1.0, 1.0 - corner.y * 2.0, 0.0, 1.0);
    out.uv = corner;
    return out;
}

/// `uv` with the aspect taken out, measured from the middle.
///
/// Every look that has a direction or a distance needs this. Working in raw
/// `uv` makes a round vignette an oval and a 45-degree blind a 30-degree one
/// the moment the frame stops being square.
///
/// Mirrors `centred` in `apps/desktop/src/renderer/src/editor/filters.ts`.
static float2 centred(constant FilterUniforms &u, float2 uv) {
    float2 from = uv - 0.5;
    // Against the shorter edge, so the fraction a length is measured in is the
    // same one every setting in the editor is measured in.
    float shorter = min(u.frame.x, u.frame.y);
    return from * u.frame / shorter;
}

/// The picture with its colours pulled apart towards the edges.
///
/// Three samples on the one texture, the red and blue displaced along the
/// direction away from the middle and the green left where it is. That is what
/// a lens actually does — the middle of the visible spectrum focuses where it
/// should and the ends land short and long of it — and it is why the effect
/// vanishes at the centre of the frame rather than being uniform across it.
///
/// `angle` turns that direction. At zero the colours run straight out from the
/// middle, which is the lens; at a quarter turn they run around it, which is
/// the swirl a badly assembled one gives; in between is a spiral. A rotation
/// rather than a blend between two modes, so the control is continuous — a
/// setting that jumped the moment it left zero would read as a bug.
///
/// Alpha comes from the green tap alone. The scene is opaque everywhere the
/// composition covers, and averaging three alphas would feather the frame's own
/// edge into transparency.
///
/// Mirrors `aberration` in `apps/desktop/src/renderer/src/editor/filters.ts`.
static float4 aberration(texture2d<float> scene, sampler smp,
                         constant FilterUniforms &u, float2 uv) {
    float2 from = centred(u, uv);
    // Squared, so the split is nothing across the middle of the picture and
    // grows quickly at the corners. Linear reads as a printing
    // misregistration — the whole image doubled — rather than as glass.
    float away = dot(from, from);

    // Turned by the angle, which keeps the magnitude whatever it is set to.
    float c = cos(u.angle);
    float s = sin(u.angle);
    float2 turned = float2(from.x * c - from.y * s, from.x * s + from.y * c);

    // At full strength the corner of a 16:9 frame splits by about two per cent
    // of its width — forty pixels at 1080p, and fourteen at the default
    // strength. A plain split rather than a subtle one, because somebody
    // reaching for this is reaching for the look.
    float2 offset = turned * away * u.strength * 0.04;

    // Aspect taken back out. `offset` is in the square space `centred` works
    // in, and sampling needs it back in uv.
    float shorter = min(u.frame.x, u.frame.y);
    offset = offset * shorter / u.frame;

    float4 green = scene.sample(smp, uv);
    float r = scene.sample(smp, uv + offset).r;
    float b = scene.sample(smp, uv - offset).b;
    return float4(r, green.g, b, green.a);
}

fragment float4 filter_fragment(FilterVertex in [[stage_in]],
                                constant FilterUniforms &u [[buffer(0)]],
                                texture2d<float> scene [[texture(0)]]) {
    // Clamped, like the item shader's: a tap a hair outside the frame must not
    // wrap to the far edge, which shows as a stripe of the opposite corner
    // along the border.
    constexpr sampler smp(filter::linear, address::clamp_to_edge);

    if (u.look == 0) {
        return aberration(scene, smp, u, in.uv);
    }

    // A look this build has no shader for draws the frame it was given. The
    // same answer `FilterKind::Unknown` gives on the way in, and the same
    // reasoning: a picture unchanged is a far better failure than a blank one.
    return scene.sample(smp, in.uv);
}
