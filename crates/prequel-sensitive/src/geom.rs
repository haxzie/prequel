//! Rectangles, and the one coordinate conversion the whole pass turns on.

use serde::{Deserialize, Serialize};

/// A rectangle on a frame, as fractions of the frame, measured from its
/// **top-left**.
///
/// Fractions rather than pixels for the reason every geometry value in this
/// project is a fraction: a take re-framed from 16:9 to 9:16 keeps its masks.
/// Top-left because that is what `shared/layout.ts`, the render plan and
/// `ZoomSlice.x`/`y` all use — Vision is the odd one out, and [`from_vision`]
/// is the single place that is reconciled.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct NormRect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl NormRect {
    pub const fn new(x: f32, y: f32, w: f32, h: f32) -> Self {
        Self { x, y, w, h }
    }

    /// A rectangle from Vision, with its origin moved to the top-left.
    ///
    /// Vision normalises to the image's **lower**-left corner. Nothing else
    /// here does. Left unconverted, every mask is mirrored vertically about the
    /// middle of the frame — which on a page with a header and a footer, or a
    /// sidebar, or any roughly symmetric layout, lands on text and looks
    /// entirely plausible. It is only ever noticed by reading the thing that
    /// was supposed to be covered.
    ///
    /// This is the only place the flip happens, deliberately: applied twice it
    /// is a no-op and the bug comes back.
    pub fn from_vision(x: f32, y: f32, w: f32, h: f32) -> Self {
        Self {
            x,
            y: 1.0 - y - h,
            w,
            h,
        }
    }

    /// The axis-aligned bounds of four corners.
    ///
    /// Taken in preference to a Vision observation's own `bounding_box` because
    /// a `VNRectangleObservation` also carries its quad, and text that is not
    /// level — a recording of a tilted window, a CSS transform, a photograph of
    /// a screen — has a quad wider than the box. Covering the box and not the
    /// quad leaves the corners of the glyphs showing.
    ///
    /// Corners arrive in Vision's own lower-left space, so this flips too.
    pub fn from_vision_quad(corners: [(f32, f32); 4]) -> Self {
        let min_x = corners.iter().map(|c| c.0).fold(f32::INFINITY, f32::min);
        let max_x = corners.iter().map(|c| c.0).fold(f32::NEG_INFINITY, f32::max);
        let min_y = corners.iter().map(|c| c.1).fold(f32::INFINITY, f32::min);
        let max_y = corners.iter().map(|c| c.1).fold(f32::NEG_INFINITY, f32::max);

        Self::from_vision(min_x, min_y, max_x - min_x, max_y - min_y)
    }

    /// The rectangle trimmed to the frame, or `None` if nothing is left of it.
    ///
    /// Vision does emit rectangles that leave the frame — rotated text and text
    /// clipped by the edge of the screen both produce them, and a negative
    /// origin or an extent past 1 is routine rather than exceptional. Passed on
    /// unclamped they become a mask that either vanishes or covers the whole
    /// picture depending on which rasteriser drew it, and the preview and the
    /// export then disagree. `None` rather than a zero-area rectangle so the
    /// caller has to decide, and the decision is always to drop it.
    pub fn clamped(self) -> Option<Self> {
        let left = self.x.max(0.0);
        let top = self.y.max(0.0);
        let right = (self.x + self.w).min(1.0);
        let bottom = (self.y + self.h).min(1.0);

        let w = right - left;
        let h = bottom - top;

        // Not `> 0.0`: a rectangle a thousandth of a frame across is a mask
        // nobody can see over text nobody could read, and NaN — which arrives
        // from a degenerate quad — fails this test rather than passing it.
        if w > f32::EPSILON && h > f32::EPSILON {
            Some(Self::new(left, top, w, h))
        } else {
            None
        }
    }

    /// The rectangle grown by `fraction` of its own height on every side.
    ///
    /// A glyph box hugs the ink. A cover that hugs the ink leaves the tops of
    /// the ascenders and the tails of the descenders showing, and a redaction
    /// you can read the top half of is not a redaction. Measured against height
    /// on both axes on purpose: a long line's width would pad its ends by a
    /// wild amount while leaving the same two pixels above the letters.
    pub fn padded(self, fraction: f32) -> Self {
        let grow = self.h * fraction;
        Self::new(
            self.x - grow,
            self.y - grow,
            self.w + grow * 2.0,
            self.h + grow * 2.0,
        )
    }

    pub fn centre(self) -> (f32, f32) {
        (self.x + self.w / 2.0, self.y + self.h / 2.0)
    }

    /// Distance between two rectangles' centres, in frame fractions.
    pub fn centre_distance(self, other: Self) -> f32 {
        let (ax, ay) = self.centre();
        let (bx, by) = other.centre();
        ((ax - bx).powi(2) + (ay - by).powi(2)).sqrt()
    }

    /// How differently sized two rectangles are, 0 for identical and rising
    /// towards 1. Used to tell a second copy of the same text from the first.
    pub fn size_mismatch(self, other: Self) -> f32 {
        let dw = (self.w - other.w).abs() / self.w.max(other.w).max(f32::EPSILON);
        let dh = (self.h - other.h).abs() / self.h.max(other.h).max(f32::EPSILON);
        dw.max(dh)
    }

    /// The smallest rectangle containing both.
    pub fn union(self, other: Self) -> Self {
        let left = self.x.min(other.x);
        let top = self.y.min(other.y);
        let right = (self.x + self.w).max(other.x + other.w);
        let bottom = (self.y + self.h).max(other.y + other.h);
        Self::new(left, top, right - left, bottom - top)
    }

    /// The rectangle `t` of the way from this one to `other`, `t` in 0 to 1.
    ///
    /// The bridge across a sample a finding was missed in. Linear because both
    /// rasterisers interpolate a key track linearly and the easing is baked in
    /// before it is stored — a different curve here would show up as a mask
    /// lagging the text it covers.
    pub fn lerp(self, other: Self, t: f32) -> Self {
        let mix = |a: f32, b: f32| a + (b - a) * t;
        Self::new(
            mix(self.x, other.x),
            mix(self.y, other.y),
            mix(self.w, other.w),
            mix(self.h, other.h),
        )
    }
}
