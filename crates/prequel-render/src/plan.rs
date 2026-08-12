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
    },
    Stroke {
        rect: Rect,
        shape: Shape,
        width: f64,
        color: String,
        #[serde(default)]
        motion: Vec<RectKey>,
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
        points: Vec<CursorPoint>,
    },
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
pub fn rect_at(
    keys: &[RectKey],
    at: i64,
    fallback: Rect,
    fallback_radius: f64,
) -> (Rect, f64, Vec<f64>, Option<Focus>) {
    let (Some(first), Some(last)) = (keys.first(), keys.last()) else {
        return (fallback, fallback_radius, Vec::new(), None);
    };

    let split = |key: &RectKey| {
        (
            Rect {
                x: key.x,
                y: key.y,
                width: key.width,
                height: key.height,
            },
            key.radius,
            key.quad.clone(),
            key.focus,
        )
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
    let quad = if a.quad.len() == b.quad.len() {
        a.quad
            .iter()
            .zip(&b.quad)
            .map(|(from, to)| lerp(*from, *to))
            .collect()
    } else if b.quad.is_empty() {
        a.quad.clone()
    } else {
        b.quad.clone()
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

    (
        Rect {
            x: lerp(a.x, b.x),
            y: lerp(a.y, b.y),
            width: lerp(a.width, b.width),
            height: lerp(a.height, b.height),
        },
        lerp(a.radius, b.radius),
        quad,
        focus,
    )
}

fn one() -> f64 {
    1.0
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
        });
    }
    if at >= last.at {
        return last.visible.then_some(Placed {
            x: last.x,
            y: last.y,
            scale: last.scale,
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

    Some(Placed {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        scale: a.scale + (b.scale - a.scale) * t,
    })
}

/// A pointer position, with how big it is where it sits.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Placed {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenderPlan {
    pub frame: Size,
    /// Drawn in order, back to front.
    pub items: Vec<PlanItem>,
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
        let expanded: String = match hex.len() {
            // `#abc` is three doubled nibbles.
            3 => hex.chars().flat_map(|c| [c, c]).collect(),
            6 => hex.to_owned(),
            _ => return None,
        };

        let value = u32::from_str_radix(&expanded, 16).ok()?;
        Some(Self {
            r: ((value >> 16) & 0xff) as f32 / 255.0,
            g: ((value >> 8) & 0xff) as f32 / 255.0,
            b: (value & 0xff) as f32 / 255.0,
            a: 1.0,
        })
    }

    fn from_rgba(body: &str) -> Option<Self> {
        let parts: Vec<f32> = body
            .split(',')
            .map(|part| part.trim().parse::<f32>().ok())
            .collect::<Option<Vec<_>>>()?;

        Some(Self {
            r: parts.first().copied()? / 255.0,
            g: parts.get(1).copied()? / 255.0,
            b: parts.get(2).copied()? / 255.0,
            a: parts.get(3).copied().unwrap_or(1.0),
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
        };

        let json = serde_json::to_string(&plan).unwrap();
        assert_eq!(serde_json::from_str::<RenderPlan>(&json).unwrap(), plan);
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
            },
            CursorPoint {
                at: 100,
                x: 100.0,
                y: 200.0,
                scale: 1.0,
                visible: true,
            },
            CursorPoint {
                at: 200,
                x: 0.0,
                y: 0.0,
                scale: 1.0,
                visible: false,
            },
        ]
    }

    #[test]
    fn interpolates_between_two_samples() {
        let point = cursor_at(&track(), 50).unwrap();
        assert_eq!(point.x, 50.0);
        assert_eq!(point.y, 100.0);
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
                points,
            } => {
                assert_eq!(path, "cursor.png");
                assert_eq!(size, 38.0);
                assert_eq!(hotspot.x, 0.055);
                assert_eq!(points.len(), 1);
            }
            other => panic!("parsed as {other:?}"),
        }
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
        let (rect, radius, _, _) = rect_at(&motion_track(), 50, BASE, 10.0);
        assert_eq!(rect.width, 150.0);
        assert_eq!(rect.x, -25.0);
        // The corners grow with the picture rather than staying put.
        assert_eq!(radius, 15.0);
    }

    #[test]
    fn holds_the_first_and_last_key_outside_the_track() {
        assert_eq!(rect_at(&motion_track(), -1000, BASE, 10.0).0.width, 100.0);
        assert_eq!(rect_at(&motion_track(), 9999, BASE, 10.0).0.width, 100.0);
    }

    #[test]
    fn falls_back_when_nothing_zooms() {
        // Every item but a zoomed screen has no keys, and has to draw its own
        // rectangle rather than nothing.
        let (rect, radius, quad, _) = rect_at(&[], 0, BASE, 7.0);
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
}
