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

constant float TAU = 6.2831853;

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

/// The way back, for the looks that move where they sample from.
static float2 uv_of(constant FilterUniforms &u, float2 p) {
    float shorter = min(u.frame.x, u.frame.y);
    return p * shorter / u.frame + 0.5;
}

static float2 spun(float2 p, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return float2(p.x * c - p.y * s, p.x * s + p.y * c);
}

static float luma(float3 c) {
    return dot(c, float3(0.2126, 0.7152, 0.0722));
}

/// The look's own size, never below a hair — a pitch of zero divides by it.
static float pitch(constant FilterUniforms &u) {
    return max(u.scale, 0.001);
}

/// Half the frame's diagonal, in the square space `centred` works in.
static float2 corner(constant FilterUniforms &u) {
    return centred(u, float2(1.0));
}

/// The scene, at full resolution.
///
/// The level is stated rather than left to the hardware, and that is not
/// belt-and-braces. The scene carries a mip chain for the glow, and a sampler
/// left to pick its own level picks it from the derivative of the coordinate —
/// which for the looks that *snap* their coordinate to a cell spikes at every
/// cell boundary. Pixelate and the dot-matrix panel would come back with a soft
/// band around each block, from a level nothing asked for.
///
/// Only `bloomed` names a level other than this one.
static float3 grab(texture2d<float> scene, sampler smp, float2 uv) {
    return scene.sample(smp, clamp(uv, 0.0, 1.0), level(0.0)).rgb;
}

/// A number from a position, stable and cheap.
///
/// Every look that needs noise hashes a position rather than reading a texture
/// or carrying a seed, which is what makes a scrubbed preview and an exported
/// frame at the same moment show the same grain. Nothing here is random.
///
/// Mirrors `hash21` in `apps/desktop/src/renderer/src/editor/filters.ts` — and
/// it has to, to the bit: the two rasterisers agreeing about *where* the noise
/// is means nothing if they disagree about what it is.
static float hash21(float2 p) {
    float3 q = fract(float3(p.x, p.y, p.x) * float3(0.1031, 0.1030, 0.0973));
    q += dot(q, float3(q.y, q.z, q.x) + 33.33);
    return fract((q.x + q.y) * q.z);
}

/// Smooth noise, for the one gobo that is not a ruled pattern.
static float value_noise(float2 p) {
    float2 cell = floor(p);
    float2 f = fract(p);
    // Smoothstepped rather than linear, or the cell edges show as a lattice —
    // which on a leaf gobo reads as graph paper.
    f = f * f * (3.0 - f - f);
    float a = hash21(cell);
    float b = hash21(cell + float2(1.0, 0.0));
    float c = hash21(cell + float2(0.0, 1.0));
    float d = hash21(cell + float2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/// A value wrapped into 0-4, positive whatever the sign going in.
static float wrap4(float v) {
    // Written as a subtraction rather than through `fmod`: GLSL's `mod` is
    // already positive and Metal's `fmod` keeps the sign, so calling the
    // language's own operator would make the two sides disagree on every
    // negative coordinate — which is half the frame.
    return v - 4.0 * floor(v * 0.25);
}

/// How much of a ruled pattern survives at the rate it is being sampled.
///
/// `cells` is a coordinate in pattern units, so `fwidth` of it is how many
/// cells fall inside one screen pixel. Above about one the pattern is finer
/// than the raster can show, and point-sampling it does not give a faint mask —
/// it gives moire, and a mask that averages a third of the light per channel
/// turns the whole frame dark and noisy instead.
///
/// This is the one place the preview and the export legitimately differ. The
/// preview rasterises at the size of the canvas on screen, so a triad that
/// resolves in a 4K file cannot resolve in a 700-pixel preview; fading it out
/// there means the preview loses a grille it could never have drawn rather than
/// inventing a pattern that is not in the file. The *look* still matches — what
/// differs is antialiasing, which is the same thing that differs about the
/// preview being lower resolution at all.
///
/// Mirrors `resolved` in `apps/desktop/src/renderer/src/editor/filters.ts`.
static float resolved(float cells) {
    return 1.0 - smoothstep(0.35, 0.90, fwidth(cells));
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
    float2 turned = spun(from, u.angle);

    // At full strength the corner of a 16:9 frame splits by about two per cent
    // of its width — forty pixels at 1080p, and fourteen at the default
    // strength. A plain split rather than a subtle one, because somebody
    // reaching for this is reaching for the look.
    float2 offset = turned * away * u.strength * 0.04;

    // Aspect taken back out. `offset` is in the square space `centred` works
    // in, and sampling needs it back in uv.
    float shorter = min(u.frame.x, u.frame.y);
    offset = offset * shorter / u.frame;

    float4 green = scene.sample(smp, uv, level(0.0));
    float r = grab(scene, smp, uv + offset).r;
    float b = grab(scene, smp, uv - offset).b;
    return float4(r, green.g, b, green.a);
}

/// A grade, mixed against the picture it came from.
///
/// Channel multipliers rather than a lookup table: a LUT would be an asset to
/// ship, a second thing to keep the two rasterisers agreeing about, and six
/// files to load before the first frame draws. These are the same six grades
/// anybody reaches for and they are three numbers each.
///
/// Mirrors `graded` in `apps/desktop/src/renderer/src/editor/filters.ts`.
static float3 graded(constant FilterUniforms &u, float3 c) {
    float l = luma(c);
    float3 g = c;
    if (u.variant == 0) {
        g = c * float3(1.12, 1.02, 0.88);
    } else if (u.variant == 1) {
        g = c * float3(0.88, 1.00, 1.14);
    } else if (u.variant == 2) {
        // Lifted blacks and rolled highlights, which is what "faded" is — a
        // print that has been in the sun, not a picture with less contrast.
        g = float3(0.16) + c * 0.74;
    } else if (u.variant == 3) {
        g = float3(l);
    } else if (u.variant == 4) {
        g = float3(l) * float3(1.22, 1.00, 0.76);
    } else {
        // Teal into the shadows, orange into the highlights, split on luma. The
        // grade every trailer has worn since about 2005.
        g = mix(c * float3(0.82, 1.02, 1.18), c * float3(1.20, 1.02, 0.80),
                smoothstep(0.25, 0.75, l));
    }
    return mix(c, g, u.strength);
}

/// One cell of the 4x4 ordered dither, 0 to 1.
static float bayer(float2 cell) {
    // The classical matrix, which is the one everybody's eye has been trained
    // on by thirty years of two-colour screens.
    const float m[16] = {
        0.0, 8.0, 2.0, 10.0,
        12.0, 4.0, 14.0, 6.0,
        3.0, 11.0, 1.0, 9.0,
        15.0, 7.0, 13.0, 5.0};
    int x = int(wrap4(cell.x));
    int y = int(wrap4(cell.y));
    return (m[x + y * 4] + 0.5) * 0.0625;
}

/// The picture on a coarse grid.
///
/// The colour is taken from the *centre* of each block rather than averaged
/// over it. An average is the honest downsample and it is the wrong look: it
/// softens every block against its neighbour, and what makes this read as pixel
/// art is that each block is one flat colour lifted from somewhere real.
///
/// Mirrors `pixelated` in `apps/desktop/src/renderer/src/editor/filters.ts`.
static float3 pixelated(texture2d<float> scene, sampler smp,
                        constant FilterUniforms &u, float2 uv) {
    float cell = pitch(u);
    float2 p = centred(u, uv);
    float2 index = floor(p / cell);
    float3 c = grab(scene, smp, uv_of(u, (index + 0.5) * cell));
    if (u.variant == 0) {
        return c;
    }
    // Dithered to two levels on the ordered matrix. Not quite black and not
    // quite white: a two-colour picture drawn at the extremes reads as a fault
    // rather than as a screen.
    float on = luma(c) > bayer(index) ? 1.0 : 0.0;
    return mix(float3(0.05), float3(0.95), on);
}

/// How much ink a dot of this coverage puts down, on a screen ruled that way.
static float inked(constant FilterUniforms &u, float2 p, float ink, float screen) {
    float2 r = spun(p, screen) / pitch(u);
    float2 f = fract(r) - 0.5;
    // The square root, because a dot's *area* is what reads as tone and area
    // goes with the square of the radius. Linear here makes the midtones far
    // too light.
    float radius = sqrt(clamp(ink, 0.0, 1.0)) * 0.70;
    // Softened by a fixed amount in cell units, so a dot has an edge rather
    // than a staircase whatever the pitch is.
    return smoothstep(radius + 0.04, radius - 0.04, length(f));
}

/// The picture as print.
///
/// Mirrors `halftoned` in `apps/desktop/src/renderer/src/editor/filters.ts`.
static float3 halftoned(texture2d<float> scene, sampler smp,
                        constant FilterUniforms &u, float2 uv) {
    float2 p = centred(u, uv);
    float3 c = grab(scene, smp, uv);
    // Not pure white. Paper is not, and a halftone on pure white reads as a
    // graphic rather than as something printed.
    float3 paper = float3(0.96, 0.95, 0.93);
    float3 printed;

    if (u.variant == 0) {
        printed = mix(paper, u.tint.rgb, inked(u, p, 1.0 - luma(c), u.angle));
    } else if (u.variant == 1) {
        // Two screens a sixth of a turn apart, which is where a duotone's
        // second colour goes: any closer and the two grids beat against each
        // other.
        float3 other = float3(1.0) - u.tint.rgb;
        float first = inked(u, p, 1.0 - luma(c), u.angle);
        float second = inked(u, p, 1.0 - luma(c * float3(0.6, 0.8, 1.0)), u.angle + 0.5236);
        printed = mix(mix(paper, u.tint.rgb, first), other, second * 0.5);
    } else {
        // Four screens on the classical angles — 15, 75, 0 and 45 degrees —
        // which are chosen so no two grids line up and the rosette stays fine.
        float k = 1.0 - max(max(c.r, c.g), c.b);
        float lit = max(1.0 - k, 0.001);
        float dc = inked(u, p, (1.0 - c.r - k) / lit, u.angle + 0.2618);
        float dm = inked(u, p, (1.0 - c.g - k) / lit, u.angle + 1.3090);
        float dy = inked(u, p, (1.0 - c.b - k) / lit, u.angle);
        float dk = inked(u, p, k, u.angle + 0.7854);
        // Multiplied, because ink is subtractive: two inks on one spot make a
        // third colour rather than a brighter one.
        float3 ink = float3(1.0);
        ink *= mix(float3(1.0), float3(0.00, 0.68, 0.94), dc);
        ink *= mix(float3(1.0), float3(0.93, 0.00, 0.55), dm);
        ink *= mix(float3(1.0), float3(1.00, 0.94, 0.00), dy);
        ink *= mix(float3(1.0), float3(0.08), dk);
        printed = ink * paper;
    }

    return mix(c, printed, u.strength);
}

/// The picture as a panel, close up.
///
/// The lifted black is the point. A CRT's black is the tube switched off and an
/// LCD's is the backlight leaking through a shut shutter — so the thing that
/// tells the two apart at a glance is that an LCD never quite reaches black.
///
/// Mirrors `panelled` in `apps/desktop/src/renderer/src/editor/filters.ts`.
static float3 panelled(texture2d<float> scene, sampler smp,
                       constant FilterUniforms &u, float2 uv) {
    float cell = pitch(u);
    float2 cells = centred(u, uv) / cell;
    float2 inside = fract(cells);

    if (u.variant == 2) {
        // A dot matrix genuinely *is* a low-resolution display, so this one
        // quantises: the colour comes from the middle of the cell, and the
        // whole point of the look is that there is nothing in between. The
        // calculator, the pager, the handheld console.
        float3 c = grab(scene, smp, uv_of(u, (floor(cells) + 0.5) * cell));
        float on = smoothstep(0.42, 0.32, length(inside - 0.5));
        float3 lit = mix(u.tint.rgb * 0.06, u.tint.rgb * luma(c) * 1.15, on);
        return mix(c, lit + u.tint.rgb * 0.05, u.strength);
    }

    // Sampled where the pixel is, not from the middle of its cell.
    //
    // Snapping to the cell centre is what a panel's own pixels do, and it is
    // the wrong thing to copy: a cell is several output pixels across, so
    // snapping downsamples the recording by that factor and every line of text
    // in it stops being readable — which is exactly what a screen recording is
    // made of. The stripes and the row gap are a texture laid *over* the
    // picture, not a resampling of it. The CRT samples continuously for the
    // same reason.
    float3 c = grab(scene, smp, uv);

    // Three stripes across the cell, one channel each.
    float3 mask = float3(0.28);
    float third = floor(inside.x * 3.0);
    if (third < 0.5) {
        mask.r = 1.0;
    } else if (third < 1.5) {
        mask.g = 1.0;
    } else {
        mask.b = 1.0;
    }
    if (u.variant == 1) {
        mask = mask.bgr;
    }

    // A dark row between the cells, which is what a panel's grid actually is.
    float gap = smoothstep(0.0, 0.10, inside.y) * smoothstep(1.0, 0.90, inside.y);
    // Both faded where the grid is finer than the raster — see `resolved`.
    mask = mix(float3(1.0), mask, resolved(cells.x * 3.0));
    gap = mix(1.0, gap, resolved(cells.y));

    // Scaled back up, because only one channel in three is fully lit and the
    // frame would otherwise come out more than a stop down.
    //
    // The floor above is high for the same reason the gain here is modest: a
    // mask that drives the two unlit channels near zero has to be amplified
    // hard to get the light back, and in the shadows that amplification turns
    // a dark grey into saturated red-green-blue speckle. A real panel's dark
    // pixels are dark, not noisy.
    float3 lit = c * mask * 1.9 * gap;
    return mix(c, lit + u.tint.rgb * 0.05, u.strength);
}

/// The picture through a wide lens.
///
/// The corner is mapped to the corner, so the frame stays full whichever way it
/// bends. Without that a barrel pulls the picture off its own edges and leaves
/// a clamped smear around the outside, which reads as a broken filter rather
/// than as a lens.
///
/// Mirrors `bulged` in `apps/desktop/src/renderer/src/editor/filters.ts`.
static float3 bulged(texture2d<float> scene, sampler smp,
                     constant FilterUniforms &u, float2 uv) {
    float2 p = centred(u, uv);
    float r2 = dot(p, p);
    float k = u.strength * 0.9;
    if (u.variant == 1) {
        k = -k;
    }
    float2 edge = corner(u);
    float fit = 1.0 + k * dot(edge, edge);
    float2 warped = p * (1.0 + k * r2) / max(fit, 0.05) * (1.0 - u.scale);
    float3 c = grab(scene, smp, uv_of(u, warped));

    if (u.variant == 2) {
        // A peephole: heavy fall-off towards the rim and a highlight off to one
        // side, which is what says "glass" rather than "the picture is bent".
        float away = sqrt(r2) / max(length(edge), 0.001);
        c *= 1.0 - 0.75 * smoothstep(0.35, 1.0, away);
        c += float3(0.22) * smoothstep(0.30, 0.0, length(p - edge * 0.42));
    }
    return c;
}

/// The picture on a tube.
///
/// Five things at once, and every one of them is needed: the glass curves, the
/// aperture mask splits each triad into its three phosphors, the scanlines
/// modulate down the screen, the highlights bloom *through* the mask, and the
/// corners fall off. Leave out the bloom and it reads as a grid laid over a
/// video rather than as a picture made of light.
///
/// Mirrors `tubed` in `apps/desktop/src/renderer/src/editor/filters.ts`.
static float3 tubed(texture2d<float> scene, sampler smp,
                    constant FilterUniforms &u, float2 uv) {
    float2 p = centred(u, uv);
    float r2 = dot(p, p);
    float2 bent = p * (1.0 + 0.18 * r2 * u.strength);
    float2 at = uv_of(u, bent);
    // Past the edge of the tube there is no picture — not a clamped stripe of
    // the nearest pixel, which is what a sampler would otherwise give.
    if (at.x < 0.0 || at.y < 0.0 || at.x > 1.0 || at.y > 1.0) {
        return float3(0.0);
    }
    float3 c = grab(scene, smp, at);

    float2 r = spun(bent, u.angle) / pitch(u);
    float across = fract(r.x);
    float down = fract(r.y);

    if (u.variant == 1) {
        // A shadow mask staggers every other row by half a triad, which is what
        // turns stripes into the offset dots the name is about.
        across = fract(r.x + 0.5 * floor(wrap4(r.y) * 0.5));
    }

    float3 mask = float3(0.30);
    float triad = floor(across * 3.0);
    if (triad < 0.5) {
        mask.r = 1.0;
    } else if (triad < 1.5) {
        mask.g = 1.0;
    } else {
        mask.b = 1.0;
    }

    if (u.variant == 2) {
        // A slot mask: the same triad, broken into slots down the screen.
        float slot = smoothstep(0.0, 0.18, down) * smoothstep(1.0, 0.82, down);
        mask = mix(float3(0.30), mask, slot);
    }

    // Faded out where the triad is finer than the raster. Without this the mask
    // is point-sampled at about a pixel per phosphor and the frame comes back
    // dark and speckled rather than masked.
    mask = mix(float3(1.0), mask, resolved(r.x * 3.0));
    float scan = mix(1.0, 0.62 + 0.38 * cos(down * TAU), resolved(r.y));
    float3 lit = c * mask * 2.1 * scan;
    // What is bright gets through the mask, which is the whole difference
    // between a tube and a screen door.
    lit += c * smoothstep(0.55, 1.0, luma(c)) * 0.55;
    lit *= u.tint.rgb;
    lit *= 1.0 - 0.45 * smoothstep(0.55, 1.0, length(p) / max(length(corner(u)), 0.001));

    // The refresh, when it moves. Slow, and barely there: a bar that announces
    // itself is a bar nobody can watch for a minute.
    if (u.time > 0.0) {
        lit *= 1.0 + 0.16 * smoothstep(0.10, 0.0, fract(at.y - u.time * 0.35));
    }

    return mix(c, lit, u.strength);
}

/// The picture off tape.
///
/// The chroma is sampled to the right of the luma, which is the actual
/// composite artefact — colour and brightness travel at different bandwidths
/// and the colour arrives late. Everything else here is mechanical: the line
/// wanders, the head switch tears the bottom of the field, and the tape hisses.
///
/// Mirrors `taped` in `apps/desktop/src/renderer/src/editor/filters.ts`.
static float3 taped(texture2d<float> scene, sampler smp,
                    constant FilterUniforms &u, float2 uv) {
    float cell = pitch(u);
    float line = floor(centred(u, uv).y / cell);
    // A tick rather than the clock itself, so a whole line's worth of wobble
    // holds for a frame instead of crawling within it.
    float tick = floor(u.time * 24.0);
    float wander = (hash21(float2(line, tick)) - 0.5) * 0.012 * u.strength;

    // The head switch: the last few lines of the field arrive from somewhere
    // else.
    wander += smoothstep(0.96, 1.0, uv.y) * 0.05 * u.strength;

    float2 at = float2(uv.x + wander, uv.y);
    float3 a = grab(scene, smp, at);
    float3 b = grab(scene, smp, float2(at.x + 0.006 * u.strength, at.y));
    // Luma from where the pixel is, chroma from where the colour arrived.
    float3 c = float3(luma(a)) + (b - float3(luma(b)));

    // Tape hiss, on a fixed grid so it is the same size at any resolution.
    c += (hash21(float2(floor(at.x * 640.0), line + tick)) - 0.5) * 0.10 * u.strength;

    if (u.time > 0.0) {
        // The tracking band, drifting up the picture the way an untracked tape
        // does.
        float hit = smoothstep(0.03, 0.0, fract(uv.y + u.time * 0.08));
        c = mix(c, c * 0.6 + float3(0.18), hit * u.strength);
    }

    return mix(grab(scene, smp, uv), c, u.strength);
}

/// The picture on stock.
///
/// Halation is the one worth knowing: bright light scatters off the back of the
/// film base and exposes the emulsion a second time from behind, which is why a
/// window in a film frame glows warm and a video frame's window just clips.
///
/// Mirrors `filmed` in `apps/desktop/src/renderer/src/editor/filters.ts`.
static float3 filmed(texture2d<float> scene, sampler smp,
                     constant FilterUniforms &u, float2 uv) {
    // Gate weave: the frame was never quite still in the gate.
    float2 at = uv;
    if (u.time > 0.0) {
        float weave = u.variant == 2 ? 0.0016 : (u.variant == 0 ? 0.0008 : 0.0003);
        float tick = floor(u.time * 16.0);
        at += float2(hash21(float2(tick, 3.0)) - 0.5, hash21(float2(tick, 7.0)) - 0.5)
            * weave * 2.0;
    }
    float3 c = grab(scene, smp, at);

    // Halation, on the same golden-angle spiral the depth of field uses. One
    // blur idiom in the codebase rather than two that could disagree about a
    // radius.
    float3 glow = float3(0.0);
    for (int i = 0; i < 8; i++) {
        float turn = float(i) * 2.399963;
        float reach = sqrt(float(i) + 0.5) / 2.83;
        float2 off = float2(cos(turn), sin(turn)) * reach * pitch(u) * 1.5;
        float3 tap = grab(scene, smp, uv_of(u, centred(u, at) + off));
        glow += tap * smoothstep(0.62, 1.0, luma(tap));
    }
    c += glow * 0.125 * u.tint.rgb * 0.85 * u.strength;

    // Grain, sized in the frame's own units — so it is grain, and not a picture
    // of this build's output resolution.
    float g = max(pitch(u) * 0.35, 0.0006);
    float n = hash21(floor(centred(u, at) / g) + float2(floor(u.time * 24.0)));
    float amount = u.variant == 1 ? 0.045 : (u.variant == 0 ? 0.085 : 0.14);
    c += (n - 0.5) * amount * u.strength;

    // A gentle S, and the shadows pulled off colour the way an emulsion pulls
    // them.
    float l = luma(c);
    c = mix(c, c * c * (3.0 - c - c), 0.35 * u.strength);
    c = mix(c, float3(l), smoothstep(0.35, 0.0, l) * 0.30 * u.strength);
    return c;
}

/// Highlights spreading into what is around them.
///
/// Twenty-four taps on the golden-angle spiral, which is the same pattern and
/// the same reasoning as the depth of field's: point samples on a spiral read
/// as a blur where a ring of them reads as a ring.
///
/// Mirrors `bloomed` in `apps/desktop/src/renderer/src/editor/filters.ts`.
static float3 bloomed(texture2d<float> scene, sampler smp,
                      constant FilterUniforms &u, float2 uv) {
    float3 c = grab(scene, smp, uv);
    float radius = pitch(u) * 2.0;

    // Which level of the chain a tap comes from.
    //
    // A quarter of the radius, in texels of the scene. Each tap then already
    // averages a footprint that size, so sixteen of them across the disc
    // overlap instead of leaving holes — which is the whole difference between
    // this and the version that read as grain. `sample_focused` in the item
    // shader documents the same failure and answers it by adding taps; that
    // works for a defocus a few pixels wide and cannot work here, because a
    // bloom is forty.
    float shorter = min(u.frame.x, u.frame.y);
    // Not named `level`: that is the name of the sampler qualifier two lines
    // below, and shadowing it stops the whole file compiling — which costs the
    // look rather than the export, and says so only in the log.
    float lod = clamp(log2(max(radius * shorter * 0.25, 1.0)), 0.0, 8.0);

    float3 glow = float3(0.0);
    for (int i = 0; i < 16; i++) {
        float turn = float(i) * 2.399963;
        float reach = sqrt(float(i) + 0.5) / 4.05;
        float2 off = float2(cos(turn), sin(turn)) * reach * radius;
        float2 at = clamp(uv_of(u, centred(u, uv) + off), 0.0, 1.0);
        float3 tap = scene.sample(smp, at, level(lod)).rgb;
        // A lower threshold than a photographic bloom would use, and
        // deliberately. A tap is an average of its footprint, so a line of
        // white text two pixels thick arrives as a mid grey rather than as
        // white — threshold it where the highlight actually is and text, which
        // is most of what a screen recording is made of, never glows at all.
        glow += tap * smoothstep(0.30, 0.85, luma(tap));
    }

    return c + glow * 0.0625 * u.tint.rgb * u.strength * 2.2;
}

/// How lit this point is, through whichever thing the light is coming past.
static float gobo(constant FilterUniforms &u, float2 p) {
    float2 r = spun(p, u.angle) / pitch(u);

    if (u.variant == 0) {
        // Blinds. Half a cycle per cell, so a slat and its gap share one pitch.
        float band = fract(r.y * 0.5);
        return smoothstep(0.18, 0.46, band) * smoothstep(0.92, 0.62, band);
    }
    if (u.variant == 1) {
        // A window: two crossed bars, the uprights at twice the spacing of the
        // rails, which is how a sash is actually built.
        float across = fract(r.x * 0.25);
        float down = fract(r.y * 0.5);
        float upright = smoothstep(0.06, 0.24, across) * smoothstep(0.96, 0.78, across);
        float rail = smoothstep(0.06, 0.24, down) * smoothstep(0.96, 0.78, down);
        return upright * rail;
    }
    if (u.variant == 2) {
        // A curtain: two waves whose frequencies do not divide each other, so
        // the folds never visibly repeat across the frame.
        return clamp(0.5 + 0.30 * sin(r.x * 1.7) + 0.20 * sin(r.x * 0.61 + 1.3), 0.0, 1.0);
    }
    // Leaves: noise at two scales, thresholded — which is dappled light, and is
    // the only one of the four that is not a ruled pattern.
    float n = value_noise(r * 0.5) * 0.65 + value_noise(r * 1.3) * 0.35;
    return smoothstep(0.34, 0.66, n);
}

/// Light falling on the picture through something.
///
/// The lit side warms and lifts; the shadowed side darkens *and cools*. That
/// split is the whole thing. A real shadow is not merely a darker copy — it is
/// lit by the sky rather than by the sun, so it is bluer — and a gobo that only
/// multiplies brightness reads as a grey overlay every time.
///
/// Mirrors `windowed` in `apps/desktop/src/renderer/src/editor/filters.ts`.
static float3 windowed(texture2d<float> scene, sampler smp,
                       constant FilterUniforms &u, float2 uv) {
    float3 c = grab(scene, smp, uv);
    float lit = gobo(u, centred(u, uv));
    float3 sun = c * mix(float3(1.0), u.tint.rgb * 1.35, 0.85);
    float3 shade = c * float3(0.82, 0.86, 1.00) * 0.55;
    return mix(c, mix(shade, sun, lit), u.strength);
}

fragment float4 filter_fragment(FilterVertex in [[stage_in]],
                                constant FilterUniforms &u [[buffer(0)]],
                                texture2d<float> scene [[texture(0)]]) {
    // Clamped, like the item shader's: a tap a hair outside the frame must not
    // wrap to the far edge, which shows as a stripe of the opposite corner
    // along the border.
    // `mip_filter` as well as the rest: the glow samples a level of the chain
    // rather than the top, and without it every such sample silently comes back
    // from level 0 — which is the ungapped blur turning back into the gapped
    // one, with nothing to say so.
    constexpr sampler smp(filter::linear, mip_filter::linear, address::clamp_to_edge);

    switch (u.look) {
        case 0: return aberration(scene, smp, u, in.uv);
        case 1: return float4(graded(u, grab(scene, smp, in.uv)), 1.0);
        case 2: return float4(pixelated(scene, smp, u, in.uv), 1.0);
        case 3: return float4(halftoned(scene, smp, u, in.uv), 1.0);
        case 4: return float4(panelled(scene, smp, u, in.uv), 1.0);
        case 5: return float4(bulged(scene, smp, u, in.uv), 1.0);
        case 6: return float4(tubed(scene, smp, u, in.uv), 1.0);
        case 7: return float4(taped(scene, smp, u, in.uv), 1.0);
        case 8: return float4(filmed(scene, smp, u, in.uv), 1.0);
        case 9: return float4(bloomed(scene, smp, u, in.uv), 1.0);
        case 10: return float4(windowed(scene, smp, u, in.uv), 1.0);
        default: break;
    }

    // A look this build has no shader for draws the frame it was given. The
    // same answer `FilterKind::Unknown` gives on the way in, and the same
    // reasoning: a picture unchanged is a far better failure than a blank one.
    return scene.sample(smp, in.uv, level(0.0));
}
