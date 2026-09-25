//! The drawing plan, as the editor sends it.
//!
//! A structural mirror of `apps/desktop/src/shared/layout.ts`, which owns the
//! geometry. Nothing here computes a position: every rectangle arrives already
//! resolved to absolute output pixels, because the editor's preview draws from
//! the same plan.
//!
//! That is the whole point. Two implementations of "where does the camera sit"
//! is how a preview and an export come to disagree, and the disagreement is
//! only ever noticed after the file has been written. What can still differ
//! between the two rasterisers is antialiasing and gradient interpolation — not
//! whether the camera is in the right corner.
//!
//! Pure serde, so it is testable without a GPU or a display.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// A rounded rectangle whose corners are a superellipse.
///
/// `exponent` 2 is an ellipse — a circle once the radius reaches half the
/// shorter edge — and 4 is the squircle macOS draws. One parameter, evaluated
/// analytically here and sampled into a path by the canvas, so the two cannot
/// drift into different shapes.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Shape {
    pub radius: f64,
    pub exponent: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanSource {
    Screen,
    Camera,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Paint {
    Solid {
        color: String,
    },
    Gradient {
        from: String,
        to: String,
        angle: f64,
    },
    /// Relative to the session directory — the image is copied in, so a
    /// recording stays self-contained.
    Image {
        path: String,
        /// Blur radius in output pixels, already resolved from the setting's
        /// fraction by `buildRenderPlan`.
        ///
        /// Defaulted, so a plan written before the background could be blurred
        /// still parses — and parses as sharp, which is what it drew.
        #[serde(default)]
        blur: f64,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PlanItem {
    Fill {
        rect: Rect,
        paint: Paint,
    },
    Shadow {
        rect: Rect,
        shape: Shape,
        blur: f64,
        dy: f64,
        color: String,
        #[serde(default)]
        motion: Vec<RectKey>,
    },
    Image {
        source: PlanSource,
        /// Region of the source to take, in source pixels.
        #[serde(rename = "srcRect")]
        src_rect: Rect,
        /// Overrides `dst_rect` and the shape's radius over time, for a zoom.
        /// Empty when nothing moves, which is every item but a zoomed screen.
        #[serde(default)]
        motion: Vec<RectKey>,
        /// Where it lands in the output frame, in output pixels.
        #[serde(rename = "dstRect")]
        dst_rect: Rect,
        shape: Shape,
        mirror: bool,
        /// Multiply the picture by the camera's person mask, when the
        /// recording has one. Defaulted, so a plan written before the mask
        /// existed still parses — and parses as un-masked, which is what it
        /// drew.
        #[serde(default)]
        matte: bool,
    },
    Stroke {
        rect: Rect,
        shape: Shape,
        width: f64,
        color: String,
        #[serde(default)]
        motion: Vec<RectKey>,
    },
    /// A still picture laid over the composition — a logo or a channel mark.
    ///
    /// Its own variant rather than a `Fill` or an `Image`: `Fill` covers its
    /// rect and crops to do it, and `Image` names one of the two video sources.
    /// This is a file, drawn once, at the size and opacity it was given.
    Watermark {
        /// Relative to the session directory — the picture is copied in, so a
        /// recording stays self-contained.
        path: String,
        #[serde(rename = "dstRect")]
        dst_rect: Rect,
        opacity: f64,
    },
    /// The pointer, composited from positions sampled during capture.
    ///
    /// The one item in a plan that moves, which is why it carries a track
    /// rather than a rectangle. Its positions are already in output pixels —
    /// the editor maps them, so nothing here knows about crops or fits — and
    /// all this side does is interpolate between two of them.
    Cursor {
        /// Relative to the session directory, like a background image.
        path: String,
        /// Drawn size in output pixels, square.
        size: f64,
        hotspot: Point,
        /// Shadow cast by the pointer texture, already resolved to pixels.
        #[serde(default)]
        shadow: Option<CursorShadow>,
        points: Vec<CursorPoint>,
    },
    /// One unit of a text overlay: a crop out of a field's bitmap, drawn
    /// where its keys say at each moment.
    ///
    /// Its own variant rather than a `Caption` with one word: a caption's box
    /// is fixed and its words come and go, while a text unit is *placed* by
    /// its keys — it slides, swells and softens on its way in and out. Like
    /// `motion` on a zoomed picture, the easing lives in where the editor put
    /// the keys, and this side only ever draws a straight line between two.
    ///
    /// Every field is one word on purpose: nothing here converts case, and a
    /// two-word name would need a rename on this side to be read at all.
    Overlay {
        /// Relative to the session directory, like a caption.
        path: String,
        /// The bitmap's own size in pixels, for the same reason a caption's.
        bitmap: Size,
        /// The crop, in bitmap pixels.
        src: Rect,
        /// The source-time range the unit is on screen for.
        span: Span,
        /// Where it is drawn over time, sorted by `at`. Held flat outside.
        keys: Vec<OverlayKey>,
    },
    /// One caption layer: a bitmap the editor rasterised, drawn whole or
    /// cropped to the word being spoken.
    ///
    /// There is no text here, and deliberately none anywhere in this crate.
    /// Laying out a line twice — once in Chromium for the preview and once in
    /// CoreText for the export — is the same mistake as computing the camera's
    /// position twice, and it fails the same way: a cue that breaks into two
    /// lines on screen and three in the file, noticed after the export. So the
    /// editor lays it out once, rasterises it once per resolution, and both
    /// rasterisers draw the pixels.
    Caption {
        /// Relative to the session directory, like a background image.
        path: String,
        /// The bitmap's own size in pixels. Carried rather than read off the
        /// texture so that `caption_at` is arithmetic on plain numbers, and so
        /// the editor and this side cannot disagree about what a word box is
        /// measured against.
        bitmap: Size,
        /// Where the whole bitmap lands in the output frame, in output pixels.
        #[serde(rename = "dstRect")]
        dst_rect: Rect,
        /// The source-time range the cue is on screen for.
        span: Span,
        /// Empty draws the whole bitmap across the span — the unlit layer.
        /// Non-empty draws only the word active at the moment, cropped out of a
        /// bitmap laid out identically — the lit layer. Two items rather than
        /// one item emitting two draws, so every plan item stays one quad.
        #[serde(default)]
        words: Vec<CaptionWord>,
        /// Two colours to choose between by what is behind the words, or
        /// `None` to draw the bitmap in the colour it was rasterised.
        ///
        /// Measured while the frame is drawn, because that is the only place
        /// the answer exists — a recording zooms, scrolls and cuts, so what is
        /// behind a word is not known when the words are laid out. Defaulted,
        /// so a plan written before this existed draws as it always did.
        #[serde(default)]
        tint: Option<Tint>,
    },
}

/// A cursor shadow is part of the cursor item rather than a rectangle shadow:
/// the pointer's alpha is the silhouette, and a rounded rectangle would leave
/// a dark square around every arrow.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CursorShadow {
    pub opacity: f64,
    pub blur: f64,
    pub dy: f64,
}

/// The two colours an adaptive caption chooses between.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Tint {
    #[serde(rename = "onDark")]
    pub on_dark: String,
    #[serde(rename = "onLight")]
    pub on_light: String,
}

/// A half-open range of source time.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Span {
    pub start: i64,
    pub end: i64,
}

/// One word's box within a caption bitmap, and when it is drawn.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CaptionWord {
    /// The source time this crop is on screen for.
    ///
    /// The word's own moment where the look lights only what is being said.
    /// To the end of the line where the look fills in instead: the word stays
    /// once it has been said, so the line fills up as it is spoken.
    pub at: i64,
    pub end: i64,
    /// The word's box, in bitmap pixels.
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// How much larger it is drawn than laid out, about its own centre. 1 for
    /// no pop.
    #[serde(default = "one")]
    pub scale: f64,
    /// How far out of focus the word starts, in bitmap pixels. 0 draws it
    /// sharp, and is what a plan written before this existed carries.
    #[serde(default)]
    pub blur: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// One sampled pointer position, in output pixels, at a source time.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CursorPoint {
    pub at: i64,
    pub x: f64,
    pub y: f64,
    /// How much larger the pointer is here than lying flat. 1 without a tilt.
    #[serde(default = "one")]
    pub scale: f64,
    /// False where the pointer had left the visible crop. Marked rather than
    /// omitted, so a gap is not interpolated straight through.
    pub visible: bool,
    /// How far the pointer smears here, as a vector in output pixels.
    ///
    /// The finished streak rather than a speed, for the reason the editor's
    /// `CursorPoint` gives: a speed would leave this side and the preview each
    /// picking a direction and a shutter, and two answers to "where is the
    /// pointer going" is how the two come to disagree.
    ///
    /// Along the *picture's* two axes rather than the frame's wherever `quad`
    /// is set: that is the basis the shader reads a smear in, and on a leaning
    /// picture the two differ. Identical without a tilt.
    ///
    /// Defaulted, so a plan written before motion blur existed loads and draws
    /// a sharp pointer rather than failing to parse.
    ///
    /// Renamed explicitly: nothing on this side converts case, and `layout.ts`
    /// writes `smearX`. Without the rename these silently read as 0, which is
    /// a sharp pointer in every export and a smeared one in every preview.
    #[serde(default, rename = "smearX")]
    pub smear_x: f64,
    #[serde(default, rename = "smearY")]
    pub smear_y: f64,
    /// The sprite's own four corners once the picture is tilted, as `x, y, w`
    /// each — the order and the divisor convention `RectKey::quad` uses.
    ///
    /// A fixed array rather than the `Vec` a `RectKey` carries, and the reason
    /// is the density: a plan holds a few dozen rectangle keys and sixty cursor
    /// points a second, so a `Vec` here would put a heap allocation on every
    /// one of them and cost `CursorPoint` its `Copy`.
    ///
    /// Defaulted, so a plan written before the pointer was laid on the picture
    /// loads and draws an upright one rather than failing to parse.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quad: Option<[f64; 12]>,
}

/// One sampled destination rectangle, in output pixels, at a source time.
///
/// The destination rather than the source: a zoom scales the whole picture and
/// lets it run past the edges of the frame, rather than cropping into the
/// recording and leaving the frame the size it was.
// No longer `Copy`: a tilted key carries its corners in a `Vec`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RectKey {
    pub at: i64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// Corner radius, which grows with the picture rather than staying put.
    pub radius: f64,
    /// Depth of field: what stays sharp, how far around it, and how soft it
    /// gets beyond. Absent when nothing is being softened.
    #[serde(default)]
    pub focus: Option<Focus>,
    /// How hard the frame darkens towards its edges, 0 to 1.
    ///
    /// Absent when nothing is being darkened, which is every zoom that does not
    /// ask for it — the same shape `focus` takes, so an ordinary plan carries
    /// neither field.
    #[serde(default)]
    pub vignette: Option<f64>,
    /// The picture's four corners once tilted, as `x, y, w` each — twelve
    /// numbers, top-left, top-right, bottom-left, bottom-right.
    ///
    /// Empty when nothing is tilted. `w` is the projective divisor,
    /// proportional to the corner's distance from the eye, so the GPU divides
    /// the varyings by it and the texture follows the perspective instead of
    /// being smeared across two flat triangles.
    #[serde(default)]
    pub quad: Vec<f64>,
}

/// What a zoom keeps sharp, and how soft the rest becomes.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Focus {
    pub x: f64,
    pub y: f64,
    /// How far around the point stays sharp, in output pixels.
    pub safe: f64,
    /// The widest blur beyond it, in output pixels.
    pub strength: f64,
}

/// The destination rectangle and radius at a moment.
///
/// Mirrors `rectAt` in `apps/desktop/src/shared/layout.ts`. Linear between
/// keys: the easing is already in where the editor put them, which is what
/// keeps a zoom from being implemented twice on either side of the boundary.
pub fn rect_at(keys: &[RectKey], at: i64, fallback: Rect, fallback_radius: f64) -> Moment {
    let (Some(first), Some(last)) = (keys.first(), keys.last()) else {
        return Moment {
            rect: fallback,
            radius: fallback_radius,
            quad: Vec::new(),
            focus: None,
            vignette: 0.0,
        };
    };

    let split = |key: &RectKey| Moment {
        rect: Rect {
            x: key.x,
            y: key.y,
            width: key.width,
            height: key.height,
        },
        radius: key.radius,
        quad: key.quad.clone(),
        focus: key.focus,
        vignette: key.vignette.unwrap_or(0.0),
    };

    if at <= first.at {
        return split(first);
    }
    if at >= last.at {
        return split(last);
    }

    let high = keys.partition_point(|key| key.at <= at);
    let a = &keys[high - 1];
    let b = &keys[high];

    let span = (b.at - a.at) as f64;
    let t = if span > 0.0 {
        (at - a.at) as f64 / span
    } else {
        0.0
    };
    let lerp = |from: f64, to: f64| from + (to - from) * t;

    // The corners ride along. Interpolating twelve numbers between two
    // projections is not the same as projecting the interpolated angle, but a
    // thirtieth of a second apart the difference is far below a pixel.
    //
    // A key with no corners is filled in from its own rectangle rather than
    // treated as having nothing to say. Taking whichever quad existed and
    // holding it across the span put a hard jump wherever a tilted key sits
    // next to a flat one — which every perspective zoom has, since it rests
    // flat and only leans while it is in, and it showed as the picture snapping
    // upright mid-zoom. Mirrors `cornersOf` in
    // `apps/desktop/src/shared/layout.ts`.
    let quad: Vec<f64> = if a.quad.is_empty() && b.quad.is_empty() {
        Vec::new()
    } else {
        let (from, to) = (corners_of(a), corners_of(b));
        from.iter()
            .zip(to.iter())
            .map(|(from, to)| lerp(*from, *to))
            .collect()
    };

    let focus = match (a.focus, b.focus) {
        (Some(from), Some(to)) => Some(Focus {
            x: lerp(from.x, to.x),
            y: lerp(from.y, to.y),
            safe: lerp(from.safe, to.safe),
            strength: lerp(from.strength, to.strength),
        }),
        (from, to) => to.or(from),
    };

    // Zero where a key does not carry it, rather than holding the neighbour's
    // value: the field is absent because there is no vignette at that key, so
    // falling back would darken a frame that asked not to be. Mirrors `rectAt`.
    let vignette = lerp(a.vignette.unwrap_or(0.0), b.vignette.unwrap_or(0.0));

    Moment {
        rect: Rect {
            x: lerp(a.x, b.x),
            y: lerp(a.y, b.y),
            width: lerp(a.width, b.width),
            height: lerp(a.height, b.height),
        },
        radius: lerp(a.radius, b.radius),
        quad,
        focus,
        vignette,
    }
}

/// A picture cut to the frame, with the source cropped to match.
///
/// Mirrors `cropToFrame` in `apps/desktop/src/shared/layout.ts`, and is pinned
/// to it by fixtures that are deliberately identical.
///
/// A zoom scales the destination well past every edge, so the picture's own
/// corners end up off screen and there is nothing left to round. Cutting the
/// destination back and taking the matching slice of the source shows exactly
/// the same pixels — the part outside was never drawn — and puts the corners
/// back where they can be seen. The radius is kept, which is the whole point.
///
/// Applied where a picture is drawn rather than baked into its motion track:
/// the track describes the zoom, and the pointer is placed at a fraction of it,
/// so a track holding a clamped rectangle would put the pointer somewhere it
/// never was.
///
/// A tilted picture is left alone. It is positioned by four projected corners
/// rather than by its rectangle, and a clipped projective quad is a polygon.
///
/// `mirror` says the picture is drawn flipped. The shader mirrors *within* the
/// source rect it is handed, so a cut on the left of a mirrored picture has to
/// come off the *right* of the source — otherwise the slice that survives is
/// the one that was already off screen, and a person dragged past the edge
/// stands still while their box leaves.
pub fn crop_to_frame(
    rect: Rect,
    src: Rect,
    frame: Size,
    tilted: bool,
    mirror: bool,
) -> (Rect, Rect) {
    if tilted || rect.width <= 0.0 || rect.height <= 0.0 {
        return (rect, src);
    }

    let x = rect.x.max(0.0);
    let y = rect.y.max(0.0);
    let right = (rect.x + rect.width).min(frame.width);
    let bottom = (rect.y + rect.height).min(frame.height);

    // Fully on screen, which is every moment that is not zoomed in — and off
    // screen entirely, where cutting to nothing would divide by zero.
    let untouched = x == rect.x
        && y == rect.y
        && right == rect.x + rect.width
        && bottom == rect.y + rect.height;
    if untouched || right <= x || bottom <= y {
        return (rect, src);
    }

    // The share of the destination that survived, applied to the source. The
    // two map linearly onto each other — that is what drawing a rectangle into
    // a rectangle means.
    let left = (x - rect.x) / rect.width;
    let top = (y - rect.y) / rect.height;
    let shown_x = (right - x) / rect.width;
    let shown_y = (bottom - y) / rect.height;
    let from_left = if mirror { 1.0 - left - shown_x } else { left };

    (
        Rect {
            x,
            y,
            width: right - x,
            height: bottom - y,
        },
        Rect {
            x: src.x + from_left * src.width,
            y: src.y + top * src.height,
            width: shown_x * src.width,
            height: shown_y * src.height,
        },
    )
}

/// Everything a motion track says about one moment.
///
/// A struct rather than the tuple this was, because it grew a sixth field and
/// `let (rect, radius, _, _, _)` had already stopped saying anything about what
/// was being ignored.
#[derive(Debug, Clone, PartialEq)]
pub struct Moment {
    pub rect: Rect,
    pub radius: f64,
    /// Empty when nothing is tilted.
    pub quad: Vec<f64>,
    pub focus: Option<Focus>,
    pub vignette: f64,
}

fn one() -> f64 {
    1.0
}

/// What a caption item draws at a source time, or None if it draws nothing.
///
/// Mirrors `captionAt` in `apps/desktop/src/shared/layout.ts`, and is pinned
/// against it by fixtures that are deliberately identical on both sides. Like
/// `cursor_at`, it exists twice because a plan cannot hold a rectangle per
/// output frame — not because either side is deciding anything.
///
/// `src` comes back in bitmap pixels; normalising it against the texture is the
/// caller's job, since only the caller knows what it bound.
pub fn caption_at(
    bitmap: Size,
    dst_rect: Rect,
    span: Span,
    words: &[CaptionWord],
    at: i64,
) -> Option<CaptionDraw> {
    // Half-open, so a cue ending exactly where the next begins does not draw
    // both for one frame.
    if at < span.start || at >= span.end {
        return None;
    }

    if words.is_empty() {
        return Some(CaptionDraw {
            src: Rect {
                x: 0.0,
                y: 0.0,
                width: bitmap.width,
                height: bitmap.height,
            },
            dst: dst_rect,
            blur: 0.0,
        });
    }

    // Nothing between words: the gap is silence, and lighting the word either
    // side of it through the gap reads as the highlight lagging the voice.
    let word = words.iter().find(|word| at >= word.at && at < word.end)?;

    if bitmap.width <= 0.0 || bitmap.height <= 0.0 {
        return None;
    }

    // The bitmap maps onto `dst_rect` whole, so a box inside it maps by the
    // same two factors. Nothing is re-derived: this is the one mapping, and it
    // is the same arithmetic on the other side.
    let sx = dst_rect.width / bitmap.width;
    let sy = dst_rect.height / bitmap.height;

    let dst = Rect {
        x: dst_rect.x + word.x * sx,
        y: dst_rect.y + word.y * sy,
        width: word.width * sx,
        height: word.height * sy,
    };

    Some(CaptionDraw {
        src: Rect {
            x: word.x,
            y: word.y,
            width: word.width,
            height: word.height,
        },
        // Grown about its own centre, so a pop swells the word in place rather
        // than pushing it down and to the right.
        dst: grown(dst, word.scale),
        blur: blur_at(word, at),
    })
}

/// A rectangle scaled about its own centre.
fn grown(rect: Rect, scale: f64) -> Rect {
    let width = rect.width * scale;
    let height = rect.height * scale;

    Rect {
        x: rect.x - (width - rect.width) * 0.5,
        y: rect.y - (height - rect.height) * 0.5,
        width,
        height,
    }
}

/// The crop and the destination for one caption draw.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CaptionDraw {
    /// In bitmap pixels.
    pub src: Rect,
    /// In output pixels.
    pub dst: Rect,
    /// How far out of focus to draw it, in bitmap pixels. 0 is sharp.
    pub blur: f64,
}

/// One sampled moment of a text unit's motion, in output pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct OverlayKey {
    pub at: i64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// 0 to 1.
    pub opacity: f64,
    /// How far out of focus, in bitmap pixels. 0 is sharp.
    pub blur: f64,
}

/// Where an overlay unit is at a moment, or `None` when it is off screen.
///
/// Mirrors `overlayAt` in `apps/desktop/src/shared/layout.ts`, pinned by
/// fixtures that are deliberately identical. Held at the first key before it
/// and the last after, like `rect_at`; a straight line between the two either
/// side otherwise.
pub fn overlay_at(span: Span, keys: &[OverlayKey], at: i64) -> Option<OverlayDraw> {
    if at < span.start || at >= span.end {
        return None;
    }
    let first = keys.first()?;
    let last = keys.last()?;

    if at <= first.at {
        return Some(OverlayDraw::from(first));
    }
    if at >= last.at {
        return Some(OverlayDraw::from(last));
    }

    // Binary search, as `rect_at` and `cursor_at` do: this runs per text unit
    // per frame. The early returns above hold `index` inside `1..len`.
    let index = keys.partition_point(|key| key.at <= at);
    let a = &keys[index - 1];
    let b = &keys[index];
    // Two keys on one nanosecond happen when a motion has no length; the lerp
    // then lands on the earlier one rather than dividing by zero.
    let length = b.at - a.at;
    let t = if length > 0 {
        (at - a.at) as f64 / length as f64
    } else {
        0.0
    };

    Some(OverlayDraw {
        dst: Rect {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            width: a.width + (b.width - a.width) * t,
            height: a.height + (b.height - a.height) * t,
        },
        opacity: a.opacity + (b.opacity - a.opacity) * t,
        blur: a.blur + (b.blur - a.blur) * t,
    })
}

/// Where one overlay unit is drawn at a moment.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OverlayDraw {
    /// In output pixels.
    pub dst: Rect,
    pub opacity: f64,
    /// In bitmap pixels. 0 is sharp.
    pub blur: f64,
}

impl From<&OverlayKey> for OverlayDraw {
    fn from(key: &OverlayKey) -> Self {
        OverlayDraw {
            dst: Rect {
                x: key.x,
                y: key.y,
                width: key.width,
                height: key.height,
            },
            opacity: key.opacity,
            blur: key.blur,
        }
    }
}

/// How long a word takes to come into focus.
///
/// Mirrors `BLUR_IN_NS` in `apps/desktop/src/shared/layout.ts`, where the note
/// on why it is this short lives.
const BLUR_IN_NS: i64 = 160_000_000;

/// The blur radius for a word at a moment, in bitmap pixels.
///
/// Mirrors `blurAt` in `apps/desktop/src/shared/layout.ts`: measured from the
/// word's own first instant, squared on the way out.
fn blur_at(word: &CaptionWord, at: i64) -> f64 {
    if word.blur <= 0.0 {
        return 0.0;
    }

    let left = 1.0 - ((at - word.at).max(0) as f64 / BLUR_IN_NS as f64).min(1.0);
    word.blur * left * left
}

/// A key's four corners, projected or flat.
///
/// The corner order the editor writes and the shaders read: top-left,
/// top-right, bottom-left, bottom-right, three numbers each. An untilted key's
/// divisor is 1 at every corner, which makes it the identity projection rather
/// than a special case.
fn corners_of(key: &RectKey) -> [f64; 12] {
    // A fixed array rather than a `Vec`: a quad is twelve numbers by definition
    // — four corners, each with a w — and this runs for every tilted item on
    // every frame. Returning an owned `Vec` meant three heap allocations per
    // interpolated quad, two here and one for the result.
    if let Ok(quad) = <[f64; 12]>::try_from(key.quad.as_slice()) {
        return quad;
    }

    let right = key.x + key.width;
    let bottom = key.y + key.height;
    [
        key.x, key.y, 1.0, right, key.y, 1.0, key.x, bottom, 1.0, right, bottom, 1.0,
    ]
}

/// Where the pointer is at a source time, or None if it is not on screen.
///
/// Mirrors `cursorAt` in `apps/desktop/src/shared/layout.ts`. The two are
/// pinned together by the golden-pixel test rather than by inspection: this is
/// the only arithmetic the two rasterisers each implement, and it exists on
/// both sides because a plan cannot hold a position per output frame.
pub fn cursor_at(points: &[CursorPoint], at: i64) -> Option<Placed> {
    let first = points.first()?;
    let last = points.last()?;

    // Before the first sample the pointer had not moved yet, so it was where
    // that sample says — not absent.
    if at <= first.at {
        return first.visible.then_some(Placed {
            x: first.x,
            y: first.y,
            scale: first.scale,
            smear_x: first.smear_x,
            smear_y: first.smear_y,
            quad: first.quad,
        });
    }
    if at >= last.at {
        return last.visible.then_some(Placed {
            x: last.x,
            y: last.y,
            scale: last.scale,
            smear_x: last.smear_x,
            smear_y: last.smear_y,
            quad: last.quad,
        });
    }

    let high = points.partition_point(|point| point.at <= at);
    let a = &points[high - 1];
    let b = &points[high];

    // Either end being off screen makes the span between them off screen: the
    // pointer left somewhere in there, and guessing where is worse than not
    // drawing it for one sample's width of time.
    if !a.visible || !b.visible {
        return None;
    }

    let span = (b.at - a.at) as f64;
    let t = if span > 0.0 {
        (at - a.at) as f64 / span
    } else {
        0.0
    };

    // Only where both ends carry corners, mirroring `cursorAt`. Not `rect_at`'s
    // case, which fills a missing quad in from the key's own rectangle: a
    // track legitimately puts a hard tilt next to a flat key and taking
    // whichever quad existed snapped the picture upright in one frame. A
    // pointer's flat neighbour is flat because the tilt there was below a
    // hundredth of a degree, so the picture really is upright and an upright
    // sprite is the right answer across that one span.
    let quad = match (a.quad, b.quad) {
        (Some(from), Some(to)) => {
            let mut corners = [0.0; 12];
            for (corner, (from, to)) in corners.iter_mut().zip(from.iter().zip(to.iter())) {
                *corner = from + (to - from) * t;
            }
            Some(corners)
        }
        _ => None,
    };

    Some(Placed {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        scale: a.scale + (b.scale - a.scale) * t,
        smear_x: a.smear_x + (b.smear_x - a.smear_x) * t,
        smear_y: a.smear_y + (b.smear_y - a.smear_y) * t,
        quad,
    })
}

/// A pointer position, with how big it is where it sits.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Placed {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    pub smear_x: f64,
    pub smear_y: f64,
    pub quad: Option<[f64; 12]>,
}

/// Which look a clip wears, by name.
///
/// A name rather than an index, which is the whole reason this is an enum and
/// not a `u32`: a plan naming a look this build does not have parses as
/// `Unknown` and renders the frame plainly, where a renumbered index would have
/// parsed as some *other* look and rendered nonsense. `#[serde(other)]` is what
/// makes the unknown case a value rather than a parse error — and a parse error
/// here fails the entire export, not one frame.
///
/// Mirrors `FilterId` in `apps/desktop/src/shared/filters.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FilterKind {
    Aberration,
    Grade,
    Dither,
    Halftone,
    Lcd,
    Fisheye,
    Crt,
    Vhs,
    Film,
    Bloom,
    WindowLight,
    LostSignal,
    Pico8,
    Gameboy,
    C64,
    Riso,
    Dream,
    /// Anything this build has never heard of. Drawn as no filter at all.
    #[serde(other)]
    Unknown,
}

impl FilterKind {
    /// Which arm of the shader's look switch this is.
    ///
    /// Hand-kept in lockstep with the same order in `filters.metal`, and pinned
    /// by `the_filter_kinds_match_the_shader` below. Nothing can compile across
    /// that boundary, so the guard is a test naming the numbers — the same
    /// discipline `the_uniform_block_matches_the_shader` uses.
    pub fn index(self) -> u32 {
        match self {
            Self::Aberration => 0,
            Self::Grade => 1,
            // 2 was `Pixelate`, whose two-colour arm this is and whose block
            // arm was dropped. Reused rather than left as a hole: a plan
            // carries a look's *name*, so nothing outside the shaders ever
            // sees the number.
            Self::Dither => 2,
            Self::Halftone => 3,
            Self::Lcd => 4,
            Self::Fisheye => 5,
            Self::Crt => 6,
            Self::Vhs => 7,
            Self::Film => 8,
            Self::Bloom => 9,
            Self::WindowLight => 10,
            // 11 was `Ascii`, dropped before it shipped. Left unused rather
            // than closed up: a plan carries a look's *name*, so renumbering
            // buys nothing and costs four tables agreeing again.
            Self::LostSignal => 12,
            Self::Pico8 => 13,
            Self::Gameboy => 14,
            Self::C64 => 15,
            Self::Riso => 16,
            Self::Dream => 17,
            Self::Unknown => u32::MAX,
        }
    }

    /// Which arm of the look's own variant switch `name` is.
    ///
    /// Mirrors `variantIndex` in `apps/desktop/src/shared/filters.ts`, and the
    /// two are kept honest by a test on each side naming the same numbers. An
    /// unrecognised name is 0 — the look's first variant, which is a look,
    /// where refusing would be a blank frame.
    pub fn variant_index(self, name: &str) -> u32 {
        self.variants()
            .iter()
            .position(|v| *v == name)
            .unwrap_or(0) as u32
    }

    /// This look's sub-looks, in the order `FILTERS[id].variants` lists them.
    ///
    /// Hand-kept in lockstep with the registry in
    /// `apps/desktop/src/shared/filters.ts`, and pinned by a test on each side
    /// naming the same numbers. A variant inserted in the middle of one list
    /// and not the other renumbers every variant after it — which does not fail
    /// to build, it draws the wrong sub-look in the export and the right one in
    /// the preview.
    fn variants(self) -> &'static [&'static str] {
        match self {
            Self::Grade => &["warm", "cool", "faded", "mono", "sepia", "teal-orange"],
            Self::Halftone => &["mono", "duotone", "cmyk"],
            Self::Lcd => &["rgb-stripe", "bgr-stripe", "dot-matrix"],
            Self::Fisheye => &["barrel", "pincushion", "dome"],
            Self::Crt => &["grille", "shadow-mask", "slot"],
            Self::Film => &["16mm", "35mm", "super8"],
            Self::WindowLight => &["blinds", "panes", "curtain", "leaves"],
            Self::Dream => &["mist", "halo", "rim"],
            // One way to be worn each, so the fallback of 0 is the only answer.
            Self::Aberration
            | Self::Dither
            | Self::Vhs
            | Self::Bloom
            | Self::LostSignal
            | Self::Pico8
            | Self::Gameboy
            | Self::C64
            | Self::Riso
            | Self::Unknown => &[],
        }
    }
}

/// The look laid over the frame once every item has been drawn into it.
///
/// Mirrors `PlanFilter` in `apps/desktop/src/shared/layout.ts`. Not a
/// `PlanItem`: items are drawn *into* the frame and this is what happens to the
/// frame after all of them have been.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlanFilter {
    pub id: FilterKind,
    #[serde(default)]
    pub variant: String,
    pub strength: f64,
    /// A fraction of the frame's shorter edge, not output pixels.
    ///
    /// The one distance in a plan that is not resolved, and it earns it: the
    /// preview rasterises at the size of the canvas on screen and this side at
    /// the output resolution, so a pitch in pixels would be three times as
    /// dense in the file as it was on screen.
    pub scale: f64,
    /// Radians, resolved from the setting's degrees by the editor.
    pub angle: f64,
    #[serde(default)]
    pub tint: String,
    #[serde(default)]
    pub animated: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenderPlan {
    pub frame: Size,
    /// Drawn in order, back to front.
    pub items: Vec<PlanItem>,
    /// The look laid over all of them, when the clip wears one.
    ///
    /// Defaulted, so a plan written before filters existed still parses — and
    /// parses as unfiltered, which is what it drew.
    #[serde(default)]
    pub filter: Option<PlanFilter>,
}

/// A colour as the plan carries it: `#rrggbb` or `rgba(r, g, b, a)`.
///
/// Both forms appear because the plan is written by a browser: hex for anything
/// the user picked, `rgba()` where an opacity was folded in.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rgba {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

impl Rgba {
    pub const TRANSPARENT: Self = Self {
        r: 0.0,
        g: 0.0,
        b: 0.0,
        a: 0.0,
    };

    /// Parses a colour, falling back to transparent.
    ///
    /// A colour that cannot be read is drawn as nothing rather than as black:
    /// an unexpected black rectangle in the middle of an export looks like a
    /// rendering bug, where a missing one looks like the setting did not apply.
    pub fn parse(value: &str) -> Self {
        let text = value.trim();

        if let Some(hex) = text.strip_prefix('#') {
            return Self::from_hex(hex).unwrap_or(Self::TRANSPARENT);
        }
        if let Some(rest) = text.strip_prefix("rgba(").and_then(|s| s.strip_suffix(')')) {
            return Self::from_rgba(rest).unwrap_or(Self::TRANSPARENT);
        }
        if let Some(rest) = text.strip_prefix("rgb(").and_then(|s| s.strip_suffix(')')) {
            return Self::from_rgba(rest).unwrap_or(Self::TRANSPARENT);
        }

        Self::TRANSPARENT
    }

    fn from_hex(hex: &str) -> Option<Self> {
        // Nibble by nibble rather than through an expanded `String`. Every fill,
        // shadow, stroke and tinted caption in a plan is parsed on every frame
        // of an export, and `#abc` — the shortest form and the one the editor
        // writes most — was the only one that allocated to do it.
        let digits = hex.as_bytes();
        let value = |index: usize| -> Option<u32> { char::from(*digits.get(index)?).to_digit(16) };

        let (r, g, b) = match hex.len() {
            // `#abc` is three doubled nibbles, and doubling a nibble is × 17.
            3 => (value(0)? * 17, value(1)? * 17, value(2)? * 17),
            6 => (
                value(0)? * 16 + value(1)?,
                value(2)? * 16 + value(3)?,
                value(4)? * 16 + value(5)?,
            ),
            _ => return None,
        };

        Some(Self {
            r: r as f32 / 255.0,
            g: g as f32 / 255.0,
            b: b as f32 / 255.0,
            a: 1.0,
        })
    }

    fn from_rgba(body: &str) -> Option<Self> {
        // Into a fixed array rather than a `Vec`, for the reason `from_hex`
        // parses nibbles: this is per colour, per item, per frame. Four is the
        // most a colour has, and a fifth component makes it malformed.
        let mut parts = [0.0f32; 4];
        let mut seen = 0usize;
        for part in body.split(',') {
            if seen == parts.len() {
                return None;
            }
            parts[seen] = part.trim().parse::<f32>().ok()?;
            seen += 1;
        }
        if seen < 3 {
            return None;
        }

        Some(Self {
            r: parts[0] / 255.0,
            g: parts[1] / 255.0,
            b: parts[2] / 255.0,
            a: if seen > 3 { parts[3] } else { 1.0 },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_plan_the_editor_would_send() {
        // Field names are what the browser writes, so a rename on either side
        // has to break here rather than at render time.
        let json = r##"{
            "frame": { "width": 1920, "height": 1080 },
            "items": [
                { "kind": "fill", "rect": { "x": 0, "y": 0, "width": 1920, "height": 1080 },
                  "paint": { "kind": "gradient", "from": "#3a6ff7", "to": "#9b4dff", "angle": 135 } },
                { "kind": "image", "source": "screen",
                  "srcRect": { "x": 0, "y": 0, "width": 2560, "height": 1440 },
                  "dstRect": { "x": 64, "y": 36, "width": 1792, "height": 1008 },
                  "shape": { "radius": 21.6, "exponent": 2 }, "mirror": false }
            ]
        }"##;

        let plan: RenderPlan = serde_json::from_str(json).expect("parse the plan");

        assert_eq!(plan.frame.width, 1920.0);
        assert_eq!(plan.items.len(), 2);
        assert!(matches!(
            plan.items[1],
            PlanItem::Image { mirror: false, .. }
        ));
    }

    #[test]
    fn round_trips() {
        let plan = RenderPlan {
            frame: Size {
                width: 1080.0,
                height: 1920.0,
            },
            items: vec![PlanItem::Stroke {
                motion: Vec::new(),
                rect: Rect {
                    x: 1.0,
                    y: 2.0,
                    width: 3.0,
                    height: 4.0,
                },
                shape: Shape {
                    radius: 5.0,
                    exponent: 4.0,
                },
                width: 2.0,
                color: "#ffffff".to_owned(),
            }],
            filter: None,
        };

        let json = serde_json::to_string(&plan).unwrap();
        assert_eq!(serde_json::from_str::<RenderPlan>(&json).unwrap(), plan);
    }

    /// A plan the browser wrote, with a look on it.
    ///
    /// Written out as JSON rather than built and round-tripped: the round trip
    /// above would pass just as happily with a field renamed on both sides at
    /// once, and the editor is the only thing that actually writes this.
    #[test]
    fn parses_a_plan_wearing_a_look() {
        let json = r##"{
            "frame": { "width": 1920, "height": 1080 },
            "items": [],
            "filter": {
                "id": "aberration",
                "variant": "",
                "strength": 0.35,
                "scale": 0.01,
                "angle": 1.5707963267948966,
                "tint": "#ffffff",
                "animated": false
            }
        }"##;

        let plan: RenderPlan = serde_json::from_str(json).unwrap();
        let filter = plan.filter.expect("the look survives the crossing");
        assert_eq!(filter.id, FilterKind::Aberration);
        assert_eq!(filter.strength, 0.35);
        assert!(!filter.animated);
    }

    #[test]
    fn a_plan_written_before_filters_existed_still_parses() {
        // And parses as unfiltered, which is what it drew. The whole reason
        // `filter` is `#[serde(default)]` and absent rather than null.
        let json = r#"{ "frame": { "width": 16, "height": 9 }, "items": [] }"#;

        let plan: RenderPlan = serde_json::from_str(json).unwrap();
        assert_eq!(plan.filter, None);
    }

    #[test]
    fn a_look_this_build_has_never_heard_of_draws_nothing() {
        // The forward-compatibility rule, and the reason the id crosses as a
        // name rather than an index. A renumbered index would have parsed as
        // some *other* look and rendered nonsense; an unknown name renders the
        // frame plainly. Refusing would fail the entire export at the first
        // parse, not one frame of it.
        let json = r#"{
            "frame": { "width": 16, "height": 9 },
            "items": [],
            "filter": { "id": "hologram", "strength": 1, "scale": 0.01, "angle": 0 }
        }"#;

        let plan: RenderPlan = serde_json::from_str(json).unwrap();
        let filter = plan.filter.expect("it still parses");
        assert_eq!(filter.id, FilterKind::Unknown);
        // Past every arm of the shader's switch, which draws the frame it was
        // given.
        assert_eq!(filter.id.index(), u32::MAX);
    }

    /// The numbering `FILTER_LOOKS` in
    /// `apps/desktop/src/renderer/src/editor/filters.ts` mirrors, and the arms
    /// of the switch in `filters.metal`.
    ///
    /// Written out on both sides because nothing compiles across the boundary.
    /// A look inserted in the middle of either list without the other renumbers
    /// every look after it — which does not fail to build, it draws the wrong
    /// effect.
    #[test]
    fn the_filter_kinds_match_the_shader() {
        assert_eq!(FilterKind::Aberration.index(), 0);
        assert_eq!(FilterKind::Grade.index(), 1);
        assert_eq!(FilterKind::Dither.index(), 2);
        assert_eq!(FilterKind::Halftone.index(), 3);
        assert_eq!(FilterKind::Lcd.index(), 4);
        assert_eq!(FilterKind::Fisheye.index(), 5);
        assert_eq!(FilterKind::Crt.index(), 6);
        assert_eq!(FilterKind::Vhs.index(), 7);
        assert_eq!(FilterKind::Film.index(), 8);
        assert_eq!(FilterKind::Bloom.index(), 9);
        assert_eq!(FilterKind::WindowLight.index(), 10);
        assert_eq!(FilterKind::LostSignal.index(), 12);
        assert_eq!(FilterKind::Pico8.index(), 13);
        assert_eq!(FilterKind::Gameboy.index(), 14);
        assert_eq!(FilterKind::C64.index(), 15);
        assert_eq!(FilterKind::Riso.index(), 16);
        assert_eq!(FilterKind::Dream.index(), 17);
    }

    /// The table `variantIndex` in `apps/desktop/src/shared/filters.ts`
    /// mirrors, written out on both sides because nothing compiles across the
    /// boundary.
    #[test]
    fn the_variant_numbering_matches_the_registry() {
        assert_eq!(FilterKind::Grade.variant_index("warm"), 0);
        assert_eq!(FilterKind::Grade.variant_index("teal-orange"), 5);
        assert_eq!(FilterKind::Halftone.variant_index("cmyk"), 2);
        assert_eq!(FilterKind::Lcd.variant_index("dot-matrix"), 2);
        assert_eq!(FilterKind::Fisheye.variant_index("dome"), 2);
        assert_eq!(FilterKind::Crt.variant_index("slot"), 2);
        assert_eq!(FilterKind::Film.variant_index("super8"), 2);
        assert_eq!(FilterKind::WindowLight.variant_index("leaves"), 3);
        assert_eq!(FilterKind::Dream.variant_index("rim"), 2);
    }

    #[test]
    fn an_unknown_variant_draws_the_looks_first() {
        // A variant name that is not the look's still names a look that is, and
        // the look drawn some way beats a blank frame.
        assert_eq!(FilterKind::Crt.variant_index("trinitron"), 0);
        // And a look with one way of being worn has nothing to pick from.
        assert_eq!(FilterKind::Aberration.variant_index(""), 0);
    }

    #[test]
    fn parses_the_colour_forms_a_browser_writes() {
        assert_eq!(Rgba::parse("#ffffff").r, 1.0);
        assert_eq!(Rgba::parse("#000000").a, 1.0);
        assert_eq!(Rgba::parse("#fff").g, 1.0);

        let shadow = Rgba::parse("rgba(0, 0, 0, 0.45)");
        assert_eq!(shadow.a, 0.45);
        assert_eq!(shadow.r, 0.0);

        let solid = Rgba::parse("rgb(255, 128, 0)");
        assert_eq!(solid.a, 1.0);
        assert!((solid.g - 128.0 / 255.0).abs() < f32::EPSILON);
    }

    #[test]
    fn an_unreadable_colour_draws_nothing() {
        // Rather than black: an unexpected black rectangle reads as a rendering
        // bug, where a missing one reads as a setting that did not apply.
        assert_eq!(Rgba::parse("chartreuse"), Rgba::TRANSPARENT);
        assert_eq!(Rgba::parse("#12345"), Rgba::TRANSPARENT);
        assert_eq!(Rgba::parse(""), Rgba::TRANSPARENT);
    }

    /// The same three points `cursorAt` is tested against in
    /// `apps/desktop/src/shared/layout.test.ts`. Deliberately identical: this
    /// is the one piece of arithmetic that exists on both sides, and the two
    /// answering differently is a pointer that sits in one place in the
    /// preview and another in the export.
    fn track() -> Vec<CursorPoint> {
        vec![
            CursorPoint {
                at: 0,
                x: 0.0,
                y: 0.0,
                scale: 1.0,
                visible: true,
                smear_x: 0.0,
                smear_y: 0.0,
                quad: None,
            },
            CursorPoint {
                at: 100,
                x: 100.0,
                y: 200.0,
                scale: 1.0,
                visible: true,
                smear_x: 4.0,
                smear_y: 8.0,
                quad: None,
            },
            CursorPoint {
                at: 200,
                x: 0.0,
                y: 0.0,
                scale: 1.0,
                visible: false,
                smear_x: 0.0,
                smear_y: 0.0,
                quad: None,
            },
        ]
    }

    #[test]
    fn interpolates_between_two_samples() {
        let point = cursor_at(&track(), 50).unwrap();
        assert_eq!(point.x, 50.0);
        assert_eq!(point.y, 100.0);
    }

    /// The same assertion `cursorAt` makes in `layout.test.ts`, against the
    /// same numbers: the streak is carried on the point rather than derived
    /// from the neighbours here, so it has to lerp like the position does.
    /// The same boundary `layout.test.ts` pins on the editor's side: a tilted
    /// key next to a flat one must blend rather than hold the tilt and jump.
    #[test]
    fn blends_a_tilted_key_into_a_flat_one() {
        let flat = RectKey {
            at: 2_000,
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 50.0,
            radius: 0.0,
            focus: None,
            vignette: None,
            quad: Vec::new(),
        };
        let tilted = RectKey {
            at: 1_000,
            quad: vec![
                20.0, 10.0, 1.0, 80.0, 10.0, 1.0, 0.0, 50.0, 1.0, 100.0, 50.0, 1.0,
            ],
            ..flat.clone()
        };

        let keys = vec![tilted, flat.clone()];
        let fallback = Rect {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
        };
        let half = rect_at(&keys, 1_500, fallback, 0.0);

        // Halfway along, the top-left corner is halfway between the tilt's and
        // the rectangle's own — not still sitting at the tilt.
        assert!((half.quad[0] - 10.0).abs() < 1e-6, "x was {}", half.quad[0]);
        assert!((half.quad[1] - 5.0).abs() < 1e-6, "y was {}", half.quad[1]);
    }

    /// The pointer's own corners, and the one way they differ from a
    /// rectangle key's: a missing quad is *not* filled in from the point's own
    /// box. Mirrors `cursorAt` in `layout.test.ts` — the two answering
    /// differently is a pointer that lies on the picture in the preview and
    /// stands upright in the export.
    #[test]
    fn interpolates_the_sprite_corners_with_the_position() {
        let sprite = |at: i64, offset: f64| CursorPoint {
            at,
            x: offset,
            y: 0.0,
            scale: 1.0,
            visible: true,
            smear_x: 0.0,
            smear_y: 0.0,
            quad: Some([
                offset,
                0.0,
                1.0,
                offset + 40.0,
                0.0,
                0.5,
                offset,
                40.0,
                1.0,
                offset + 40.0,
                40.0,
                0.5,
            ]),
        };

        let points = vec![sprite(0, 0.0), sprite(100, 100.0)];
        let half = cursor_at(&points, 50).unwrap().quad.expect("corners");

        // Halfway along, every corner is halfway — including the divisors,
        // which ride along rather than being recomputed.
        assert!((half[0] - 50.0).abs() < 1e-6, "x was {}", half[0]);
        assert!((half[3] - 90.0).abs() < 1e-6, "x was {}", half[3]);
        assert!((half[5] - 0.5).abs() < 1e-6, "w was {}", half[5]);
    }

    /// Deliberately unlike `blends_a_tilted_key_into_a_flat_one` above. A
    /// zoom's keys sit a thirtieth of a second apart and a track puts a hard
    /// tilt beside a flat key, so a picture has to blend into its own
    /// rectangle. A pointer's flat neighbour is flat because the tilt there
    /// was below a hundredth of a degree — the picture really is upright, and
    /// so is the sprite across that one span.
    #[test]
    fn leaves_a_span_upright_when_either_end_is_flat() {
        let mut points = track();
        points[0].quad = Some([0.0; 12]);

        assert!(cursor_at(&points, 50).unwrap().quad.is_none());
    }

    #[test]
    fn interpolates_the_streak_with_the_position() {
        let point = cursor_at(&track(), 50).unwrap();
        assert_eq!(point.smear_x, 2.0);
        assert_eq!(point.smear_y, 4.0);
    }

    #[test]
    fn holds_still_outside_the_track() {
        let before = cursor_at(&track(), -1000).unwrap();
        assert_eq!(before.x, 0.0);

        let single = vec![CursorPoint {
            at: 0,
            x: 7.0,
            y: 9.0,
            scale: 1.0,
            visible: true,
            smear_x: 0.0,
            smear_y: 0.0,
            quad: None,
        }];
        assert_eq!(cursor_at(&single, 9999).unwrap().x, 7.0);
    }

    #[test]
    fn draws_nothing_across_a_span_where_the_pointer_had_left() {
        assert!(cursor_at(&track(), 150).is_none());
        assert!(cursor_at(&track(), 200).is_none());
    }

    #[test]
    fn has_nothing_to_say_about_an_empty_track() {
        assert!(cursor_at(&[], 0).is_none());
    }

    /// The fixture `captionAt` is tested against in
    /// `apps/desktop/src/shared/layout.test.ts`. Deliberately identical: this
    /// arithmetic exists on both sides, and the numbers are the contract.
    fn caption() -> (Size, Rect, Span, Vec<CaptionWord>) {
        let bitmap = Size {
            width: 400.0,
            height: 100.0,
        };
        let dst = Rect {
            x: 100.0,
            y: 500.0,
            width: 800.0,
            height: 200.0,
        };
        let span = Span {
            start: 1_000,
            end: 4_000,
        };
        let words = vec![
            CaptionWord {
                at: 1_000,
                end: 2_000,
                x: 0.0,
                y: 10.0,
                width: 100.0,
                height: 80.0,
                scale: 1.0,
                blur: 0.0,
            },
            // A gap from 2_000 to 3_000: silence between two words.
            CaptionWord {
                at: 3_000,
                end: 4_000,
                x: 200.0,
                y: 10.0,
                width: 100.0,
                height: 80.0,
                scale: 1.0,
                blur: 0.0,
            },
        ];

        (bitmap, dst, span, words)
    }

    #[test]
    fn an_unlit_caption_draws_the_whole_bitmap_across_its_span() {
        let (bitmap, dst, span, _) = caption();

        let draw = caption_at(bitmap, dst, span, &[], 2_500).unwrap();
        assert_eq!(draw.src.x, 0.0);
        assert_eq!(draw.src.width, 400.0);
        assert_eq!(draw.src.height, 100.0);
        assert_eq!(draw.dst, dst);
    }

    #[test]
    fn a_caption_draws_nothing_outside_its_span() {
        let (bitmap, dst, span, words) = caption();

        assert!(caption_at(bitmap, dst, span, &[], 999).is_none());
        // Half-open, so a cue ending where the next begins does not draw both.
        assert!(caption_at(bitmap, dst, span, &[], 4_000).is_none());
        assert!(caption_at(bitmap, dst, span, &words, 4_000).is_none());
    }

    /// Deliberately the same numbers as the `captionAt` blur tests in
    /// `apps/desktop/src/shared/layout.test.ts`. The ramp exists on both sides,
    /// so the numbers are the contract between them.
    ///
    /// A cue on a realistic clock: the transition is 160 ms, where the fixture
    /// above is measured in nanoseconds because its job is the geometry.
    fn blurring(at: i64, blur: f64) -> (Size, Rect, Span, Vec<CaptionWord>) {
        const MS: i64 = 1_000_000;
        let (bitmap, dst, _, _) = caption();

        (
            bitmap,
            dst,
            Span {
                start: 0,
                end: 2_000 * MS,
            },
            vec![CaptionWord {
                // Drawn from the moment it is spoken to the end of the line,
                // which is what makes the sentence fill up rather than sit
                // there in advance.
                at,
                end: 2_000 * MS,
                x: 0.0,
                y: 10.0,
                width: 100.0,
                height: 80.0,
                scale: 1.0,
                blur,
            }],
        )
    }

    #[test]
    fn a_word_that_carries_no_radius_is_always_drawn_sharp() {
        let (bitmap, dst, span, words) = caption();

        assert_eq!(
            caption_at(bitmap, dst, span, &words, 3_500).unwrap().blur,
            0.0
        );
        assert_eq!(caption_at(bitmap, dst, span, &[], 2_500).unwrap().blur, 0.0);
    }

    #[test]
    fn a_blurred_word_is_not_drawn_at_all_before_it_is_spoken() {
        const MS: i64 = 1_000_000;
        let (bitmap, dst, span, words) = blurring(500 * MS, 12.0);
        let blur = |at: i64| caption_at(bitmap, dst, span, &words, at).unwrap().blur;

        // The line fills up as it is said. A word sitting there soft in
        // advance gives away what is coming.
        assert!(caption_at(bitmap, dst, span, &words, 0).is_none());
        assert!(caption_at(bitmap, dst, span, &words, 499 * MS).is_none());

        // It arrives at the full radius, clears, and stays for the line.
        assert_eq!(blur(500 * MS), 12.0);
        assert!(blur(580 * MS) < 12.0);
        assert_eq!(blur(660 * MS), 0.0);
        assert_eq!(blur(1_900 * MS), 0.0);
    }

    #[test]
    fn a_blurred_word_clears_most_of_it_early() {
        const MS: i64 = 1_000_000;
        let (bitmap, dst, span, words) = blurring(0, 16.0);

        // Squared, not linear: a quarter of the radius half way through.
        let half = caption_at(bitmap, dst, span, &words, 80 * MS).unwrap().blur;
        assert!((half - 4.0).abs() < 1e-6, "{half}");
    }

    #[test]
    fn a_lit_caption_draws_nothing_between_two_words() {
        let (bitmap, dst, span, words) = caption();

        // Inside the span but in the silence. Holding the previous word lit
        // through the gap reads as the highlight lagging the voice.
        assert!(caption_at(bitmap, dst, span, &words, 2_500).is_none());
    }

    #[test]
    fn a_lit_caption_crops_to_the_word_being_spoken() {
        let (bitmap, dst, span, words) = caption();

        let draw = caption_at(bitmap, dst, span, &words, 3_500).unwrap();

        // The crop is the word's own box, in bitmap pixels.
        assert_eq!(draw.src.x, 200.0);
        assert_eq!(draw.src.width, 100.0);

        // The bitmap is drawn at 2x here — 800 output pixels for 400 bitmap
        // ones — so every box inside it scales by the same two factors.
        assert_eq!(draw.dst.x, 100.0 + 400.0);
        assert_eq!(draw.dst.y, 500.0 + 20.0);
        assert_eq!(draw.dst.width, 200.0);
        assert_eq!(draw.dst.height, 160.0);
    }

    #[test]
    fn a_popped_word_grows_about_its_own_centre() {
        let (bitmap, dst, span, mut words) = caption();
        words[1].scale = 1.5;

        let flat = caption_at(bitmap, dst, span, &caption().3, 3_500).unwrap();
        let popped = caption_at(bitmap, dst, span, &words, 3_500).unwrap();

        // The crop is untouched: a pop changes where the pixels land, never
        // which pixels are taken.
        assert_eq!(popped.src, flat.src);

        let centre = |rect: Rect| (rect.x + rect.width * 0.5, rect.y + rect.height * 0.5);
        assert_eq!(centre(popped.dst), centre(flat.dst));
        assert_eq!(popped.dst.width, flat.dst.width * 1.5);
        assert_eq!(popped.dst.height, flat.dst.height * 1.5);
    }

    #[test]
    fn cuts_a_zoomed_picture_to_the_frame() {
        // Deliberately the same numbers as "cuts the picture to the frame and
        // takes the source to match" in `layout.test.ts`. This arithmetic runs
        // on both sides — the preview cuts the picture and so does the export —
        // so the numbers, not the code, are the contract between them.
        let frame = Size {
            width: 1920.0,
            height: 1080.0,
        };
        let source = Rect {
            x: 0.0,
            y: 0.0,
            width: 2560.0,
            height: 1440.0,
        };

        // A picture twice the frame, centred: half is off screen on each axis.
        let (cut, crop) = crop_to_frame(
            Rect {
                x: -960.0,
                y: -540.0,
                width: 3840.0,
                height: 2160.0,
            },
            source,
            frame,
            false,
            false,
        );

        assert_eq!(cut.x, 0.0);
        assert_eq!(cut.y, 0.0);
        assert_eq!(cut.width, 1920.0);
        assert_eq!(cut.height, 1080.0);

        // A quarter in from each edge, and half the source across.
        assert_eq!(crop.x, 640.0);
        assert_eq!(crop.y, 360.0);
        assert_eq!(crop.width, 1280.0);
        assert_eq!(crop.height, 720.0);
    }

    #[test]
    fn leaves_a_picture_that_fits_and_a_tilted_one_alone() {
        let frame = Size {
            width: 1920.0,
            height: 1080.0,
        };
        let source = Rect {
            x: 0.0,
            y: 0.0,
            width: 2560.0,
            height: 1440.0,
        };
        let inside = Rect {
            x: 100.0,
            y: 100.0,
            width: 400.0,
            height: 300.0,
        };

        // Fully on screen: the common case, and it must not drift or every
        // unzoomed frame moves.
        assert_eq!(
            crop_to_frame(inside, source, frame, false, false),
            (inside, source)
        );

        // Tilted: positioned by four projected corners rather than by its
        // rectangle, and a clipped projective quad is a polygon.
        let over = Rect {
            x: -500.0,
            y: -500.0,
            width: 4000.0,
            height: 3000.0,
        };
        assert_eq!(
            crop_to_frame(over, source, frame, true, false),
            (over, source)
        );
    }

    #[test]
    fn a_mirrored_picture_cut_on_the_left_takes_the_source_from_its_right() {
        // Deliberately the same numbers as "a mirrored picture cut on the left
        // takes the source from its right" in `layout.test.ts`. The shader
        // flips within the slice it is handed, so the slice has to be the
        // one that *is* on screen after the flip — the source's right, for a
        // cut on the left. The old arithmetic handed it the left, which is
        // the part off screen, and a person pushed past the edge stood still.
        let frame = Size {
            width: 1920.0,
            height: 1080.0,
        };
        let source = Rect {
            x: 0.0,
            y: 0.0,
            width: 1000.0,
            height: 500.0,
        };
        // Spills 30% off the left edge.
        let rect = Rect {
            x: -300.0,
            y: 0.0,
            width: 1000.0,
            height: 500.0,
        };

        let (cut, crop) = crop_to_frame(rect, source, frame, false, true);
        assert_eq!(cut.x, 0.0);
        assert_eq!(cut.width, 700.0);
        assert!(
            (crop.x - 0.0).abs() < 1e-9,
            "from the source's left: {crop:?}"
        );
        assert!((crop.width - 700.0).abs() < 1e-9);

        // Un-mirrored, the same cut comes off the same side.
        let (_, plain) = crop_to_frame(rect, source, frame, false, false);
        assert!(
            (plain.x - 300.0).abs() < 1e-9,
            "from the source's right: {plain:?}"
        );
    }

    #[test]
    fn reads_a_caption_item_the_editor_wrote() {
        // The field names are the contract with `layout.ts`, and `dstRect` is
        // the one that is not snake_case on the way in.
        let json = r#"{
            "kind": "caption",
            "path": "captions/cue-3.png",
            "bitmap": { "width": 400.0, "height": 100.0 },
            "dstRect": { "x": 100.0, "y": 500.0, "width": 800.0, "height": 200.0 },
            "span": { "start": 1000, "end": 4000 },
            "words": [
                { "at": 1000, "end": 2000, "x": 0.0, "y": 10.0, "width": 100.0, "height": 80.0 }
            ]
        }"#;

        let item: PlanItem = serde_json::from_str(json).unwrap();
        match item {
            PlanItem::Caption {
                path,
                bitmap,
                dst_rect,
                span,
                words,
                tint,
            } => {
                assert_eq!(path, "captions/cue-3.png");
                assert_eq!(bitmap.width, 400.0);
                assert_eq!(dst_rect.width, 800.0);
                assert_eq!(span.end, 4_000);
                assert_eq!(words.len(), 1);
                // Defaulted, like a cursor point's, so the ordinary caption
                // carries no `scale` at all.
                assert_eq!(words[0].scale, 1.0);
                // Same for the word's blur and the colours: a plan written
                // before either existed draws a sharp caption in its own
                // colour rather than failing to parse.
                assert_eq!(words[0].blur, 0.0);
                assert!(tint.is_none());
            }
            other => panic!("parsed as {other:?}"),
        }
    }

    #[test]
    fn reads_a_cursor_item_the_editor_wrote() {
        // The field names are the contract with `layout.ts`; a rename on either
        // side deserializes to a default rather than failing loudly.
        let json = r#"{
            "kind": "cursor",
            "path": "cursor.png",
            "size": 38.0,
            "hotspot": { "x": 0.055, "y": 0.055 },
            "points": [{ "at": 0, "x": 10.0, "y": 20.0, "visible": true }]
        }"#;

        let item: PlanItem = serde_json::from_str(json).unwrap();
        match item {
            PlanItem::Cursor {
                path,
                size,
                hotspot,
                shadow,
                points,
            } => {
                assert_eq!(path, "cursor.png");
                assert_eq!(size, 38.0);
                assert_eq!(hotspot.x, 0.055);
                assert!(shadow.is_none());
                assert_eq!(points.len(), 1);
            }
            other => panic!("parsed as {other:?}"),
        }
    }

    #[test]
    fn reads_the_pointer_smear_the_editor_wrote() {
        // `smearX`, as `layout.ts` spells it. This read as 0 for as long as the
        // field had no rename, and nothing failed — the export just drew a
        // sharp pointer.
        let json =
            r#"{ "at": 0, "x": 1.0, "y": 2.0, "visible": true, "smearX": 4.0, "smearY": -3.0 }"#;
        let point: CursorPoint = serde_json::from_str(json).unwrap();
        assert_eq!(point.smear_x, 4.0);
        assert_eq!(point.smear_y, -3.0);
    }

    #[test]
    fn reads_an_overlay_item_the_editor_wrote() {
        let json = r#"{
            "kind": "overlay",
            "path": "texts/abc.png",
            "bitmap": { "width": 400, "height": 100 },
            "src": { "x": 10, "y": 0, "width": 80, "height": 100 },
            "span": { "start": 1000, "end": 5000 },
            "keys": [
                { "at": 1000, "x": 0, "y": 40, "width": 80, "height": 100, "opacity": 0, "blur": 8 },
                { "at": 2000, "x": 0, "y": 0, "width": 80, "height": 100, "opacity": 1, "blur": 0 }
            ]
        }"#;

        let item: PlanItem = serde_json::from_str(json).unwrap();
        match item {
            PlanItem::Overlay {
                path, keys, span, ..
            } => {
                assert_eq!(path, "texts/abc.png");
                assert_eq!(span.start, 1000);
                assert_eq!(keys.len(), 2);
                assert_eq!(keys[0].blur, 8.0);
            }
            other => panic!("parsed as {other:?}"),
        }
    }

    /// The same keys `overlayAt` is tested against in `layout.test.ts`.
    fn overlay_keys() -> Vec<OverlayKey> {
        let key = |at, y, opacity, blur| OverlayKey {
            at,
            x: 100.0,
            y,
            width: 200.0,
            height: 50.0,
            opacity,
            blur,
        };
        vec![
            key(1_000, 130.0, 0.0, 12.0),
            key(2_000, 100.0, 1.0, 0.0),
            key(4_000, 100.0, 1.0, 0.0),
            key(5_000, 100.0, 0.0, 0.0),
        ]
    }

    #[test]
    fn an_overlay_is_held_flat_outside_its_keys_and_absent_outside_its_span() {
        let span = Span {
            start: 500,
            end: 6_000,
        };
        let keys = overlay_keys();

        assert!(overlay_at(span, &keys, 499).is_none());
        assert!(overlay_at(span, &keys, 6_000).is_none());

        let before = overlay_at(span, &keys, 500).unwrap();
        assert_eq!(before.opacity, 0.0);
        assert_eq!(before.dst.y, 130.0);

        let after = overlay_at(span, &keys, 5_999).unwrap();
        assert_eq!(after.opacity, 0.0);
        assert_eq!(after.dst.y, 100.0);
    }

    #[test]
    fn an_overlay_lerps_between_its_keys() {
        let span = Span {
            start: 0,
            end: 10_000,
        };
        let keys = overlay_keys();

        // Halfway through the entrance: halfway up, half opaque, half soft.
        let draw = overlay_at(span, &keys, 1_500).unwrap();
        assert!((draw.dst.y - 115.0).abs() < 1e-9);
        assert!((draw.opacity - 0.5).abs() < 1e-9);
        assert!((draw.blur - 6.0).abs() < 1e-9);

        // On the hold.
        let held = overlay_at(span, &keys, 3_000).unwrap();
        assert_eq!(held.opacity, 1.0);
        assert_eq!(held.dst.x, 100.0);
    }

    #[test]
    fn two_overlay_keys_on_one_nanosecond_are_stepped_over() {
        let span = Span {
            start: 0,
            end: 10_000,
        };
        let mut keys = overlay_keys();
        keys[1].at = keys[2].at;
        keys[1].opacity = 0.0;
        // Exactly on the doubled moment: the later of the two is where the
        // lerp starts from, and nothing divides by the zero between them.
        let draw = overlay_at(span, &keys, 4_000).unwrap();
        assert!(draw.opacity.is_finite());
        assert_eq!(draw.opacity, 1.0);
    }

    /// A zoom's keys always open and close on the un-zoomed rectangle, which is
    /// what lets the flat stretches between zooms carry no keys at all.
    fn motion_track() -> Vec<RectKey> {
        vec![
            RectKey {
                at: 0,
                x: 0.0,
                y: 0.0,
                width: 100.0,
                height: 100.0,
                radius: 10.0,
                quad: Vec::new(),
                focus: None,
                vignette: None,
            },
            RectKey {
                at: 100,
                x: -50.0,
                y: -50.0,
                width: 200.0,
                height: 200.0,
                radius: 20.0,
                quad: Vec::new(),
                focus: None,
                vignette: None,
            },
            RectKey {
                at: 200,
                x: 0.0,
                y: 0.0,
                width: 100.0,
                height: 100.0,
                radius: 10.0,
                quad: Vec::new(),
                focus: None,
                vignette: None,
            },
        ]
    }

    const BASE: Rect = Rect {
        x: 0.0,
        y: 0.0,
        width: 100.0,
        height: 100.0,
    };

    #[test]
    fn interpolates_a_rect_between_keys() {
        // The one piece of zoom arithmetic on this side. `rectAt` in
        // `layout.ts` answers the same, and a difference is a preview and an
        // export framed differently.
        let Moment { rect, radius, .. } = rect_at(&motion_track(), 50, BASE, 10.0);
        assert_eq!(rect.width, 150.0);
        assert_eq!(rect.x, -25.0);
        // The corners grow with the picture rather than staying put.
        assert_eq!(radius, 15.0);
    }

    #[test]
    fn holds_the_first_and_last_key_outside_the_track() {
        assert_eq!(
            rect_at(&motion_track(), -1000, BASE, 10.0).rect.width,
            100.0
        );
        assert_eq!(rect_at(&motion_track(), 9999, BASE, 10.0).rect.width, 100.0);
    }

    #[test]
    fn falls_back_when_nothing_zooms() {
        // Every item but a zoomed screen has no keys, and has to draw its own
        // rectangle rather than nothing.
        let Moment {
            rect, radius, quad, ..
        } = rect_at(&[], 0, BASE, 7.0);
        assert_eq!((rect, radius), (BASE, 7.0));
        assert!(quad.is_empty());
    }

    #[test]
    fn reads_an_image_item_with_no_motion_track() {
        // `crop` is absent on every item the editor does not zoom, so it has to
        // default rather than fail the whole plan.
        let json = r#"{
            "kind": "image",
            "source": "screen",
            "srcRect": { "x": 0, "y": 0, "width": 100, "height": 100 },
            "dstRect": { "x": 0, "y": 0, "width": 100, "height": 100 },
            "shape": { "radius": 0, "exponent": 2 },
            "mirror": false
        }"#;

        match serde_json::from_str::<PlanItem>(json).unwrap() {
            PlanItem::Image { motion, .. } => assert!(motion.is_empty()),
            other => panic!("parsed as {other:?}"),
        }
    }

    #[test]
    fn an_image_item_with_no_matte_flag_draws_the_whole_picture() {
        // Every plan written before the camera had a matte, and every
        // non-camera item since, carries no `matte`. They have to parse, and
        // parse as un-masked — masking a screen against a mask it never had
        // would draw nothing at all.
        let json = r#"{
            "kind": "image",
            "source": "camera",
            "srcRect": { "x": 0, "y": 0, "width": 100, "height": 100 },
            "dstRect": { "x": 0, "y": 0, "width": 100, "height": 100 },
            "shape": { "radius": 0, "exponent": 2 },
            "mirror": true
        }"#;

        match serde_json::from_str::<PlanItem>(json).unwrap() {
            PlanItem::Image { matte, .. } => assert!(!matte),
            other => panic!("parsed as {other:?}"),
        }

        let json = json.replace("\"mirror\": true", "\"mirror\": true, \"matte\": true");
        match serde_json::from_str::<PlanItem>(&json).unwrap() {
            PlanItem::Image { matte, .. } => assert!(matte),
            other => panic!("parsed as {other:?}"),
        }
    }
}
