//! Fits the person matte to one free-form closed curve, ten times a second, so
//! the editor can draw the camera as a shape that leans and swells with them.
//!
//! A radius that varies with the angle, written as harmonics of it. What is
//! measured here is the silhouette; what is *drawn* is the editor's business,
//! and it takes only the first two — a circle, a lean and an oval. That split
//! is deliberate and it is not only tidiness: the look can then be changed for
//! recordings already made, where a shape baked in at capture would need every
//! one of them recording again.
//!
//! Three harmonics: a lean, an oval, and the three-lobed term that gives the
//! shape its lobes. That third one is the whole character and also the whole
//! danger — a head over two shoulders is three lobes, so drawn at full strength
//! it makes a rounded triangle. How much of it to show is the Roundness control,
//! and it is applied in the editor, not here. Four would start finding the gap
//! between a raised arm and a head, which is the body-tracing this shape exists
//! not to do: an earlier version fitted eight circles to the mask and unioned
//! them, which followed the body far too well and read as a cut-out of somebody
//! rather than as a shape they sit in.
//!
//! Dimensionless on purpose. The fitter says what shape the person makes, not
//! how big to draw it: the size is the camera's own size setting, and the editor
//! multiplies. It is the same rule the sound plan follows — decide here, place
//! there.
//!
//! No Apple framework in this file. The fitter takes a flat grayscale buffer, so
//! a synthetic mask — a torso with an arm out of it — can assert what comes back.

use prequel_session::Blob;

/// Cells across the picture's wider edge.
///
/// Coarse deliberately. The shape is a bubble somebody sits in, not a cutout,
/// and three harmonics discard nearly everything a finer grid would resolve.
const GRID: usize = 24;

/// Where a cell counts as covered, out of 255.
///
/// Half. Vision's mask is soft at the edges, and averaging a cell already pulls
/// a half-covered cell towards the middle of the range.
const SOLID: u32 = 128;

/// Directions the silhouette's reach is measured in, before it is smoothed.
///
/// Far more than the three harmonics keep. The harmonics *are* the smoothing;
/// measuring in twelve directions instead would alias a raised arm into a lobe
/// pointing somewhere else.
const SPOKES: usize = 64;

/// Harmonics measured, beyond the circle itself.
///
/// Three: a lean, an oval, and the three-lobed term. The first two are every
/// egg; the third is what makes the shape lobed rather than merely oval, and how
/// much of it survives is the Roundness control's business — see `shown` in
/// `shared/layout.ts`. Both shaders evaluate exactly this many, written out term
/// by term — `blobDistance` in `webgl.ts` and `blob_distance` in
/// `shaders.metal`, which a test pins to each other. Changing this number means
/// changing all three.
pub const HARMONICS: usize = 3;

/// Occupied share of the frame below which there is nobody to fit.
///
/// The camera looking at an empty chair segments to nothing, and a frame of
/// nothing has no centroid. Fitting one anyway would put the shape's centre at
/// the origin — the top-left corner — and it would lunge there. The caller
/// closes the shape instead, which is what somebody stepping out of frame
/// should look like.
const MIN_COVERAGE: f32 = 0.005;

/// Cells a connected group needs before it counts as part of somebody.
///
/// Below this it is mask noise — a strand of hair, a fleck off a bookshelf — and
/// the reach of one stray cell in the corner is what would drag the whole shape
/// towards it.
const MIN_GROUP: usize = 3;

/// The furthest a direction's reach may count, as a multiple of the average.
///
/// Only to keep one wild direction from drowning out the rest — a hand at four
/// times the average reach should not be four times the shape. How much of what
/// is left becomes a visible bulge is the editor's decision, not this one, which
/// is why it is generous: `BLOB_DEVIATION` in `shared/layout.ts` is what
/// actually sets how far from a circle the drawn shape gets.
const MAX_REACH: f32 = 2.0;
const MIN_REACH: f32 = 0.5;

/// How far the centre may lean from the middle of the picture, as a fraction of
/// the shorter edge.
///
/// The shape follows somebody within their own camera frame rather than sitting
/// where the picture happens to be cropped. Capped, because the *bubble* is
/// placed by the position control and a shape that wandered out of it would read
/// as the camera drifting rather than as the shape following anybody.
const MAX_LEAN: f32 = 0.18;

/// How much of the vertical lean is kept.
///
/// A third, where sideways keeps all of it. A webcam silhouette's vertical
/// centre is set by how much torso is in shot — it is the framing, not where
/// anybody is, and it does not move when they do. Taken whole it pinned the
/// shape to the bottom of its cap for an entire take and sat the curve over
/// somebody's shoulders with their head out of the top.
const VERTICAL_LEAN: f32 = 0.33;

/// One frame of mask, as the fitter reads it.
///
/// Borrowed rather than copied: the caller has the buffer locked and this makes
/// one pass over it. `stride` is separate from `width` because CoreVideo pads
/// rows to its own alignment — the trap `copy_mask_into_luma` documents.
pub struct MaskView<'a> {
    pub bytes: &'a [u8],
    pub width: usize,
    pub height: usize,
    pub stride: usize,
}

/// The mask reduced to a grid of covered cells.
///
/// Square-celled *in the picture*, which is not the same as in the mask. Vision
/// hands back a fixed size — 512x384 whatever it was given — so the mask of a
/// 16:9 camera is that frame squashed into 4:3. Both rasterisers sample it with
/// the picture's own normalised coordinates, which stretches it back out; a grid
/// laid out on the mask's proportions would measure the shape in squashed space
/// and draw it a third too narrow. Hence the aspect, which is the camera's and
/// never the mask's.
struct Grid {
    cells: Vec<bool>,
    cols: usize,
    rows: usize,
}

impl Grid {
    fn of(mask: &MaskView<'_>, aspect: f32) -> Self {
        let (cols, rows) = if aspect >= 1.0 {
            (GRID, ((GRID as f32 / aspect).round() as usize).max(1))
        } else {
            (((GRID as f32 * aspect).round() as usize).max(1), GRID)
        };

        let mut sums = vec![0u32; cols * rows];
        let mut counts = vec![0u32; cols * rows];

        for y in 0..mask.height {
            let row = y * mask.stride;
            let cell_y = y * rows / mask.height;
            for x in 0..mask.width {
                let Some(&value) = mask.bytes.get(row + x) else {
                    continue;
                };
                let cell = cell_y * cols + x * cols / mask.width;
                sums[cell] += value as u32;
                counts[cell] += 1;
            }
        }

        let cells = sums
            .iter()
            .zip(&counts)
            .map(|(sum, count)| *count > 0 && sum / *count >= SOLID)
            .collect();

        Self { cells, cols, rows }
    }

    fn at(&self, col: usize, row: usize) -> bool {
        self.cells[row * self.cols + col]
    }
}

/// Fits one frame of mask, or `None` when there is nobody in it.
///
/// `aspect` is the *camera picture's* width over its height, not the mask's —
/// see `Grid`.
pub fn fit(mask: &MaskView<'_>, aspect: f32) -> Option<Blob> {
    let aspect = aspect.max(0.01);
    let grid = Grid::of(mask, aspect);

    // Everything connected and big enough to be part of somebody. The reach
    // below is a maximum over a direction, so a single stray cell in a corner
    // is not a speck in the outline — it is the whole shape pulled towards it.
    let points: Vec<(f32, f32)> = groups(&grid)
        .into_iter()
        .filter(|group| group.len() >= MIN_GROUP)
        .flatten()
        .collect();

    if (points.len() as f32) < MIN_COVERAGE * (grid.cols * grid.rows) as f32 {
        return None;
    }

    let count = points.len() as f32;
    let cx = points.iter().map(|p| p.0).sum::<f32>() / count;
    let cy = points.iter().map(|p| p.1).sum::<f32>() / count;

    // How far somebody reaches in each direction, in cells. A maximum rather
    // than an average: the gesture worth following is the hand at the end of the
    // arm, and an average over the arm puts the bulge at the elbow.
    let mut reach = [0.0f32; SPOKES];
    for (x, y) in &points {
        let (dx, dy) = (x - cx, y - cy);
        let distance = (dx * dx + dy * dy).sqrt();
        if distance <= 0.0 {
            continue;
        }
        // Screen angles: y runs down, and both shaders measure the same way, so
        // the two agree without either of them flipping anything.
        let angle = dy.atan2(dx);
        let spoke = angle_to_spoke(angle);
        reach[spoke] = reach[spoke].max(distance);
    }

    // A direction nobody reaches into at all — the gaps beside a head — takes
    // the average, so an empty spoke is a shape that neither dents nor bulges
    // there. Left at zero it would be a bite out of the curve.
    let touched: Vec<f32> = reach.iter().copied().filter(|r| *r > 0.0).collect();
    if touched.is_empty() {
        return None;
    }
    let mean = touched.iter().sum::<f32>() / touched.len() as f32;
    if mean <= 0.0 {
        return None;
    }
    for spoke in &mut reach {
        if *spoke <= 0.0 {
            *spoke = mean;
        }
    }

    // What the fitter actually says: how much more or less than average somebody
    // reaches in each direction. Dimensionless, because how big to draw it is the
    // camera's size setting and not the mask's business — and unscaled, because
    // how *far* from a circle to draw it is the editor's.
    let mut deform = [0.0f32; SPOKES];
    for (out, r) in deform.iter_mut().zip(&reach) {
        *out = (r / mean).clamp(MIN_REACH, MAX_REACH) - 1.0;
    }

    // Three harmonics of it. Everything finer is discarded here rather than
    // never measured — see `SPOKES`.
    let mut h = [0.0f32; HARMONICS * 2];
    for k in 1..=HARMONICS {
        let (mut a, mut b) = (0.0f32, 0.0f32);
        for (spoke, value) in deform.iter().enumerate() {
            let angle = spoke_to_angle(spoke) * k as f32;
            a += value * angle.cos();
            b += value * angle.sin();
        }
        h[(k - 1) * 2] = a * 2.0 / SPOKES as f32;
        h[(k - 1) * 2 + 1] = b * 2.0 / SPOKES as f32;
    }

    // The centre, as an offset from the middle of the picture in fractions of
    // its shorter edge. A cell is `1/cols` of the width, and the width is
    // `aspect` shorter edges across when the picture is landscape and one when
    // it is portrait — so `max(aspect, 1)` is how many shorter edges wide it is
    // either way.
    let cell = aspect.max(1.0) / grid.cols as f32;
    let lean = |value: f32| (value * cell).clamp(-MAX_LEAN, MAX_LEAN);

    Some(Blob {
        x: lean(cx - grid.cols as f32 / 2.0),
        y: lean((cy - grid.rows as f32 / 2.0) * VERTICAL_LEAN),
        h,
        // Whoever is here is wholly here. Easing in is the tracker's business.
        presence: 1.0,
    })
}

fn angle_to_spoke(angle: f32) -> usize {
    let turns = angle / std::f32::consts::TAU + 1.0;
    ((turns * SPOKES as f32).round() as usize) % SPOKES
}

fn spoke_to_angle(spoke: usize) -> f32 {
    spoke as f32 / SPOKES as f32 * std::f32::consts::TAU
}

/// Connected groups of covered cells.
///
/// Four-neighbour rather than eight: two things that touch only at a corner are
/// two things, and a speck that happens to graze a shoulder would otherwise be
/// kept as part of it.
fn groups(grid: &Grid) -> Vec<Vec<(f32, f32)>> {
    let mut seen = vec![false; grid.cols * grid.rows];
    let mut found = Vec::new();

    for row in 0..grid.rows {
        for col in 0..grid.cols {
            if seen[row * grid.cols + col] || !grid.at(col, row) {
                continue;
            }

            let mut group = Vec::new();
            let mut stack = vec![(col, row)];
            seen[row * grid.cols + col] = true;

            while let Some((c, r)) = stack.pop() {
                group.push((c as f32 + 0.5, r as f32 + 0.5));

                let neighbours = [
                    (c.wrapping_sub(1), r),
                    (c + 1, r),
                    (c, r.wrapping_sub(1)),
                    (c, r + 1),
                ];
                for (nc, nr) in neighbours {
                    if nc >= grid.cols || nr >= grid.rows || seen[nr * grid.cols + nc] {
                        continue;
                    }
                    if grid.at(nc, nr) {
                        seen[nr * grid.cols + nc] = true;
                        stack.push((nc, nr));
                    }
                }
            }

            found.push(group);
        }
    }

    found
}

/// How fast the shape follows the mask, per sample.
///
/// A third, over samples a tenth of a second apart, so a gesture arrives in
/// about a third of a second. One rate rather than one for swelling and another
/// for pulling in: a harmonic coefficient is not bigger or smaller than another,
/// it is a different shape, and there is no direction for an asymmetry to be in.
///
/// Slow enough to absorb one bad fit, which matters: Vision drops a raised arm
/// for a frame at the edge of its confidence, and a shape that took each sample
/// whole would flinch every time it did.
const EASE: f32 = 0.33;

/// How fast the shape closes behind somebody who left the frame, per sample.
///
/// Slower than it follows them, and much slower than it opens. Closing is the
/// one thing here nobody is waiting for — a shape that snapped shut the instant
/// segmentation lost somebody would blink every time it was briefly unsure.
const CLOSE: f32 = 0.15;

/// Presence below which the shape has closed and there is nothing to draw.
const GONE: f32 = 0.02;

/// Holds the shape between samples, so it is continuous.
///
/// The fitter is pure and knows one frame; this is the part that knows a hand
/// went up. Nine numbers eased, and `presence` easing to nothing when the frame
/// empties — which is somebody stepping out of shot, and should look like the
/// shape closing rather than like the camera cutting out.
#[derive(Default)]
pub struct Tracker {
    held: Option<Blob>,
    /// Whether any shape has been held yet. See the first branch of `push`.
    seen: bool,
}

impl Tracker {
    /// Eases this frame's fit into the shape, or `None` once it has closed.
    pub fn push(&mut self, fitted: Option<Blob>) -> Option<Blob> {
        // The first shape of a recording is the shape, not something to ease
        // into. Opened from nothing like every later change, the camera spends
        // the first third of a second swelling out of a point — which is not an
        // entrance anybody asked for, and on a short clip it is most of the clip.
        //
        // Only the first, which is why this is a flag rather than a test for an
        // empty hand: somebody who steps out of frame and back has a shape that
        // closed behind them, and that one *should* open again rather than snap.
        if !self.seen {
            if let Some(fitted) = fitted {
                self.seen = true;
                self.held = Some(Blob {
                    presence: 1.0,
                    ..fitted
                });
                return self.held;
            }
            return None;
        }

        let held = self.held.unwrap_or(Blob {
            presence: 0.0,
            ..fitted.unwrap_or(Blob {
                x: 0.0,
                y: 0.0,
                h: [0.0; HARMONICS * 2],
                presence: 0.0,
            })
        });

        let next = match fitted {
            Some(to) => {
                let rate = |from: f32, to: f32| from + (to - from) * EASE;
                let mut h = [0.0f32; HARMONICS * 2];
                for (out, (from, to)) in h.iter_mut().zip(held.h.iter().zip(&to.h)) {
                    *out = rate(*from, *to);
                }
                Blob {
                    x: rate(held.x, to.x),
                    y: rate(held.y, to.y),
                    h,
                    presence: rate(held.presence, 1.0),
                }
            }
            // Nobody in frame. The shape keeps the form it had and closes, so
            // stepping out of shot is it shrinking away rather than vanishing.
            None => Blob {
                presence: held.presence + (0.0 - held.presence) * CLOSE,
                ..held
            },
        };

        self.held = (next.presence > GONE).then_some(next);
        self.held
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A mask with filled rectangles in it, in fractions of the frame.
    fn mask(width: usize, height: usize, boxes: &[(f32, f32, f32, f32)]) -> Vec<u8> {
        let mut bytes = vec![0u8; width * height];
        for &(x, y, w, h) in boxes {
            for row in (y * height as f32) as usize..((y + h) * height as f32) as usize {
                for col in (x * width as f32) as usize..((x + w) * width as f32) as usize {
                    if row < height && col < width {
                        bytes[row * width + col] = 255;
                    }
                }
            }
        }
        bytes
    }

    fn view(bytes: &[u8], width: usize, height: usize) -> MaskView<'_> {
        MaskView {
            bytes,
            width,
            height,
            stride: width,
        }
    }

    /// The shape's radius in a direction, as a multiple of its own size.
    ///
    /// The same series both shaders evaluate, written out here so a change to
    /// either of them that this file did not intend shows up as a failure rather
    /// than as a shape nobody looked at. Unscaled, unlike what is drawn: the
    /// editor is what decides how far from a circle the curve gets.
    fn radius(blob: &Blob, angle: f32) -> f32 {
        let mut r = 1.0;
        for k in 1..=HARMONICS {
            let (a, b) = (blob.h[(k - 1) * 2], blob.h[(k - 1) * 2 + 1]);
            r += a * (angle * k as f32).cos() + b * (angle * k as f32).sin();
        }
        r
    }

    /// The widest and narrowest the shape gets, and where it is widest.
    fn extremes(blob: &Blob) -> (f32, f32, f32) {
        let mut widest = (f32::MIN, 0.0);
        let mut narrowest = f32::MAX;
        for spoke in 0..360 {
            let angle = spoke as f32 / 360.0 * std::f32::consts::TAU;
            let r = radius(blob, angle);
            if r > widest.0 {
                widest = (r, angle);
            }
            narrowest = narrowest.min(r);
        }
        (widest.0, narrowest, widest.1)
    }

    #[test]
    fn measures_the_lobes_without_drawing_them() {
        // A head over two shoulders is three lobes and so is a head with a hand
        // up beside it, and the third harmonic is the term that says so. It is
        // measured here at whatever strength the silhouette has it — the editor
        // is what decides how much of it to draw, which is how the shape can be
        // a gentle egg at one end of the Roundness control and lobed at the
        // other.
        let poses = [
            vec![(0.42, 0.18, 0.16, 0.34), (0.05, 0.5, 0.9, 0.5)],
            vec![(0.4, 0.35, 0.2, 0.5), (0.2, 0.08, 0.14, 0.3)],
        ];

        for boxes in poses {
            let bytes = mask(256, 192, &boxes);
            let blob = fit(&view(&bytes, 256, 192), 16.0 / 9.0).expect("a shape");
            let third = (blob.h[4] * blob.h[4] + blob.h[5] * blob.h[5]).sqrt();

            assert!(third > 0.02, "the lobes are there to be drawn: {third}");
        }

        // And nothing runs away: the reach a direction may count is capped, so
        // no single harmonic can arrive large enough to fold the curve through
        // its own centre whatever the editor multiplies it by.
        let bytes = mask(
            256,
            192,
            &[(0.45, 0.45, 0.06, 0.06), (0.05, 0.05, 0.06, 0.06)],
        );
        if let Some(blob) = fit(&view(&bytes, 256, 192), 16.0 / 9.0) {
            let total: f32 = (0..HARMONICS)
                .map(|k| (blob.h[k * 2].powi(2) + blob.h[k * 2 + 1].powi(2)).sqrt())
                .sum();
            assert!(total < 1.0, "a bounded shape: {total}");
        }
    }

    #[test]
    fn leans_towards_a_raised_hand() {
        // What the shape is for. A hand up and to one side has to push the curve
        // out *that way* — and the shape must still be a pebble, which the test
        // above asserts of the same mask.
        let plain = mask(256, 192, &[(0.4, 0.35, 0.2, 0.5)]);
        let raised = mask(256, 192, &[(0.4, 0.35, 0.2, 0.5), (0.63, 0.08, 0.12, 0.3)]);

        let before = fit(&view(&plain, 256, 192), 16.0 / 9.0).expect("a shape");
        let after = fit(&view(&raised, 256, 192), 16.0 / 9.0).expect("a shape");

        let (_, _, was) = extremes(&before);
        let (widest, _, now) = extremes(&after);

        // Up and to the right, which in screen angles — y down — is the third
        // quarter turn back from zero.
        let up_right = -std::f32::consts::FRAC_PI_4;
        let away = |angle: f32| {
            let mut d = (angle - up_right).abs();
            if d > std::f32::consts::PI {
                d = std::f32::consts::TAU - d;
            }
            d
        };

        assert!(
            away(now) < away(was),
            "the widest point moved towards the hand: {now} from {was}"
        );
        assert!(widest > 1.05, "and it is a bulge: {widest}");
    }

    #[test]
    fn leans_the_centre_towards_somebody_standing_off_to_one_side() {
        let left = mask(256, 192, &[(0.12, 0.3, 0.22, 0.6)]);
        let blob = fit(&view(&left, 256, 192), 16.0 / 9.0).expect("a shape");

        assert!(blob.x < -0.05, "leaning left: {}", blob.x);
        // But never out of the bubble it is drawn in.
        assert!(blob.x.abs() <= MAX_LEAN + 1e-6);
    }

    #[test]
    fn finds_nobody_in_an_empty_frame() {
        // An empty chair segments to nothing, and a frame of nothing has no
        // centroid — fitted anyway, the shape's centre lands on the origin and
        // it lunges into the corner.
        let bytes = mask(128, 128, &[]);
        assert!(fit(&view(&bytes, 128, 128), 1.0).is_none());
    }

    #[test]
    fn ignores_a_fleck_of_mask() {
        // The reach in a direction is a maximum, so one stray cell in a corner
        // is not a speck in the outline — it is the whole shape hauled towards
        // it.
        let clean = mask(256, 192, &[(0.4, 0.3, 0.2, 0.5)]);
        let specked = mask(
            256,
            192,
            &[(0.4, 0.3, 0.2, 0.5), (0.95, 0.94, 0.015, 0.015)],
        );

        let a = fit(&view(&clean, 256, 192), 16.0 / 9.0).expect("a shape");
        let b = fit(&view(&specked, 256, 192), 16.0 / 9.0).expect("a shape");

        for (from, to) in a.h.iter().zip(&b.h) {
            assert!((from - to).abs() < 0.02, "the speck moved the shape");
        }
    }

    #[test]
    fn reads_a_padded_mask_by_its_stride() {
        // CoreVideo pads rows. Reading by width instead shears the mask, which
        // drags the shape diagonally — the trap `copy_mask_into_luma` guards on
        // the other side of the same buffer.
        let (width, height, stride) = (100, 64, 128);
        let mut bytes = vec![0u8; stride * height];
        for row in 16..48 {
            for col in 38..62 {
                bytes[row * stride + col] = 255;
            }
        }

        let blob = fit(
            &MaskView {
                bytes: &bytes,
                width,
                height,
                stride,
            },
            1.0,
        )
        .expect("a shape");

        assert!(blob.x.abs() < 0.05, "not sheared: {}", blob.x);
    }

    #[test]
    fn measures_the_lean_in_the_picture_rather_than_in_the_squashed_mask() {
        // Vision hands back a fixed 4:3 whatever it was given, so a 16:9
        // camera's mask is that frame squashed. Read in the mask's own
        // proportions, a lean sideways comes out a third short — and the mask
        // being a different shape from the camera is the ordinary case.
        // Near enough the middle that neither reading is stopped by `MAX_LEAN`,
        // which both hit at a quarter of the frame out and then agree by
        // accident.
        let bytes = mask(512, 384, &[(0.36, 0.3, 0.12, 0.5)]);
        let square = fit(&view(&bytes, 512, 384), 1.0).expect("a shape");
        let wide = fit(&view(&bytes, 512, 384), 16.0 / 9.0).expect("a shape");

        assert!(
            wide.x.abs() > square.x.abs(),
            "the widescreen lean is further: {} against {}",
            wide.x,
            square.x
        );
    }

    #[test]
    fn the_first_shape_is_already_there() {
        // Eased in from nothing, the camera spends the opening third of a second
        // swelling out of a point.
        let mut tracker = Tracker::default();
        let blob = Blob {
            x: 0.1,
            y: 0.0,
            h: [0.2, 0.0, 0.0, 0.0, 0.0, 0.0],
            presence: 1.0,
        };

        let first = tracker.push(Some(blob)).expect("a shape");
        assert_eq!(first.presence, 1.0);
        assert_eq!(first.h, blob.h);
    }

    #[test]
    fn eases_rather_than_taking_each_sample_whole() {
        // One bad fit is ordinary — Vision drops a raised arm for a frame at the
        // edge of its confidence. Taken whole, that one sample is the shape
        // flinching flat and back.
        let mut tracker = Tracker::default();
        let flat = Blob {
            x: 0.0,
            y: 0.0,
            h: [0.0; HARMONICS * 2],
            presence: 1.0,
        };
        let lobed = Blob {
            h: [0.4, 0.0, 0.0, 0.0, 0.0, 0.0],
            ..flat
        };

        tracker.push(Some(flat));
        let after_one = tracker.push(Some(lobed)).expect("a shape").h[0];
        assert!(
            after_one > 0.0 && after_one < 0.4 * 0.8,
            "part way: {after_one}"
        );

        // And it does arrive, rather than lagging for ever.
        let mut held = after_one;
        for _ in 0..20 {
            held = tracker.push(Some(lobed)).expect("a shape").h[0];
        }
        assert!((held - 0.4).abs() < 0.01, "arrives: {held}");
    }

    #[test]
    fn closes_the_shape_when_they_leave_the_frame() {
        let mut tracker = Tracker::default();
        let blob = Blob {
            x: 0.0,
            y: 0.0,
            h: [0.0; HARMONICS * 2],
            presence: 1.0,
        };
        for _ in 0..20 {
            tracker.push(Some(blob));
        }

        let closing = tracker.push(None).expect("closing, not gone");
        assert!(closing.presence < 1.0);

        let mut held = Some(closing);
        for _ in 0..200 {
            held = tracker.push(None);
        }
        assert!(held.is_none(), "closed");
    }

    #[test]
    fn opens_again_when_they_come_back() {
        // Distinct from the first shape of a recording, which snaps. Somebody
        // who stepped out has a shape that closed behind them, and that one
        // swells again.
        let mut tracker = Tracker::default();
        let blob = Blob {
            x: 0.0,
            y: 0.0,
            h: [0.0; HARMONICS * 2],
            presence: 1.0,
        };

        tracker.push(Some(blob));
        for _ in 0..200 {
            tracker.push(None);
        }

        let back = tracker.push(Some(blob)).expect("a shape");
        assert!(back.presence > 0.0 && back.presence < 1.0, "swelling back");
    }
}
