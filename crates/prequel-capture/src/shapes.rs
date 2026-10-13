//! Finding the rectangles a screen is made of, so an area can be clicked
//! rather than dragged.
//!
//! Not segmentation in the machine-learning sense, and deliberately not: the
//! thing on screen is a user interface, and a user interface is a stack of
//! axis-aligned rectangles with flat fills and straight borders. That is a far
//! smaller problem than finding arbitrary objects in a photograph, and it
//! falls to two passes over one image — which is what makes this cheap enough
//! to run while an overlay is fading in.
//!
//! The two alternatives were both tried on paper and rejected.
//!
//! The Accessibility API would hand over real elements with real frames, and
//! needs the Accessibility grant — which area selection does not require
//! today and should not start requiring, because the one grant the app insists
//! on is Screen Recording. It is also synchronous IPC into the app being
//! inspected: a hung app hangs the picker, and the apps people record most are
//! Chromium shells whose element tree is either absent or expensive to wake.
//!
//! Vision has no rectangle detector in the SDK this tree binds, and the
//! requests it does have answer a different question — `VNDetectDocument-
//! Segmentation` looks for one page in a photo, and the saliency requests
//! return a 68×68 heat map. Neither produces an edge you could snap a crop to.
//!
//! So: edges, long straight runs of them, and the rectangles those runs bound.
//! [`detect`] is pure and takes a luma plane, which is why it can be tested
//! against pictures drawn by hand rather than against whatever was on screen.
//!
//! The constants below were settled against real screens rather than guessed,
//! and a dark low-contrast interface is the case that sets nearly all of them:
//! it separates its panels with a one-pixel line twelve levels off the
//! background, where a light one has borders twice that and fills that differ
//! outright.

use cidre::{arc, cm, cv, ns, sc};

use crate::targets::Bounds;
use crate::{Error, Result};

/// How much two pixels either side of a sample must differ to count as an edge.
///
/// Low, because the borders that matter are faint: macOS and the web both draw
/// a card edge as black at 8–12% over white, which is a step of twenty or so.
/// Lower still would start counting the dither in a photograph, and the run
/// filter below is what rejects that anyway.
const EDGE_THRESHOLD: i32 = 10;

/// How many samples either side of a candidate edge have to be flat, and how
/// flat "flat" is.
///
/// This pair is what makes the difference between a border and a texture, and
/// the first attempt did without it and was useless. The reasoning was that
/// text and photographs produce short edges where a border produces a long one,
/// so a length filter would be enough — but a dense texture produces an edge at
/// *every* sample, which reads as a run the full height of the screen. A length
/// filter cannot tell that from a border.
///
/// What a border actually is: a step or a thin line between two regions that
/// are themselves flat. Requiring both flanks to be flat costs a handful of
/// reads per sample and rejects noise, photographs and the inside of a glyph
/// outright, because none of those has a flat side.
const FLANK_SPAN: usize = 3;
const FLANK_FLATNESS: i32 = 6;

/// The shortest run of edge pixels that can still be a border.
///
/// What separates a panel from the words printed on it. A glyph stem is a real
/// enough line — flat paper either side of flat ink — and ten points tall;
/// forty points is about the height of a toolbar.
const MIN_RUN: usize = 40;

/// How long a break in a run is bridged.
///
/// A rounded corner stops a border eight or ten points short of where the
/// rectangle actually ends, and a divider is routinely interrupted by an icon
/// sitting on it. Without this every such border arrives as two or three
/// separate runs, none of them long enough to keep.
const MAX_GAP: usize = 8;

/// How far two edges may be apart and still be treated as the same one.
///
/// A border at a fractional position is anti-aliased across two columns, and
/// both of them carry enough gradient to pass [`EDGE_THRESHOLD`].
const TOLERANCE: usize = 3;

/// How far an edge is searched for when squaring up a proposed rectangle.
///
/// The vertical sides of a rounded rectangle are inset from its corners by the
/// corner radius, so a rectangle proposed from them is short by that much at
/// both ends. Sixteen points covers every radius in common use.
const SNAP_RANGE: usize = 16;

/// How much of a side must actually be an edge for the side to exist.
const MIN_SIDE_COVERAGE: f64 = 0.55;

/// How much of the whole perimeter must be an edge for the shape to be offered.
///
/// Below four fifths is usually three sides of something real and one side
/// guessed — which is a rectangle that does not match what the user can see,
/// and a snap target that does not match what is on screen is worse than none.
const MIN_PERIMETER_COVERAGE: f64 = 0.78;

/// The smallest shape worth offering, in points.
///
/// Smaller than this is a toolbar button, and a snap target that small is one
/// the pointer crosses on its way somewhere else.
const MIN_SHAPE_EDGE: f64 = 36.0;

/// The largest, as a fraction of the display's area.
///
/// The whole screen is already a mode of its own, and the desktop's own
/// bounding box would otherwise be the first and largest shape on the list.
const MAX_SHAPE_AREA: f64 = 0.985;

/// How many segments are paired up.
///
/// Pairing is quadratic in this, so it is capped rather than trusted. The
/// longest runs are kept, which are the ones bounding the largest shapes — and
/// a screen with more than this many borders in one direction has far more
/// shapes on it than anybody is going to read.
const MAX_SEGMENTS: usize = 320;

/// How much of one shape may be another before it is treated as the same one.
///
/// Well above what nesting produces — a card inside a panel shares a fraction
/// of its area with it — and well below what a sidebar's several near-identical
/// proposals do.
const MAX_SHAPE_OVERLAP: f64 = 0.55;

/// How many shapes are offered.
///
/// The overlay animates every one of them in, and past a few dozen that is
/// confetti rather than an answer.
const MAX_SHAPES: usize = 40;

/// How long a single frame is waited for. See `still.rs`, which waits the same.
const CAPTURE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// The rectangles found on one display, in points relative to its own origin.
///
/// Largest first, so a picker looking for "the smallest shape under the
/// pointer" can walk the list backwards and a picker drawing them can draw
/// them in the order they nest.
pub fn find_shapes(display_id: u32, excluded_windows: &[u32]) -> Result<Vec<Bounds>> {
    let content = crate::targets::current_shareable_content()?;

    let display = content
        .displays()
        .iter()
        .find(|candidate| candidate.display_id().0 == display_id)
        .ok_or_else(|| {
            if crate::targets::is_display_asleep(display_id) {
                Error::DisplayAsleep(display_id)
            } else {
                Error::DisplayNotFound(display_id)
            }
        })?
        .retained();

    // Points, not pixels. One sample per point is the resolution the interface
    // was laid out at: a hairline border is exactly one sample wide, which is
    // what the gradient test below is tuned for, and on a Retina display it is
    // a quarter of the pixels to walk. It also means a found rectangle needs no
    // conversion at all — the overlay draws in CSS pixels, which are points —
    // so there is no scale factor here to get the wrong way round.
    let width = display.width() as usize;
    let height = display.height() as usize;

    if width == 0 || height == 0 {
        return Err(Error::EmptyRegion {
            width: width as f64,
            height: height as f64,
        });
    }

    // Our own overlays are on screen by the time this runs — they are what the
    // user is looking at while it runs — and a sheet of dimming over the whole
    // display has exactly one edge on it. Excluding them is the only mechanism
    // that works; see the note in `capture-flow.ts`.
    let excluded: Vec<_> = content
        .windows()
        .iter()
        .filter(|window| excluded_windows.contains(&window.id()))
        .map(|window| window.retained())
        .collect();

    let filter = sc::ContentFilter::with_display_excluding_windows(
        &display,
        &ns::Array::from_slice_retained(&excluded),
    );

    let mut cfg = sc::StreamCfg::new();
    cfg.set_width(width);
    cfg.set_height(height);
    // Full-range biplanar YUV, asked for rather than accepted.
    //
    // ScreenCaptureKit hands back `420v` by default here — biplanar YUV, not
    // BGRA — and the first version of this read the buffer as four bytes a
    // pixel. A 1512-wide frame has a 1536-byte luma stride, so reading
    // `width * 4` took four rows per row and the detector saw the screen tiled
    // four times across and squashed to a quarter. Every rectangle it reported
    // was real geometry of a garbled picture, which is the worst shape a bug
    // like this can take: plausible output, nothing to see in a log.
    //
    // Full range rather than the default video range so a luma byte means
    // 0–255, which is what the thresholds above are tuned against; video range
    // packs the same picture into 16–235 and quietly costs a seventh of the
    // contrast every one of them is measured in.
    cfg.set_pixel_format(cv::PixelFormat::_420F);
    // The pointer is not part of the interface, and an arrow parked over a
    // border is a gap in that border.
    cfg.set_shows_cursor(false);
    cfg.set_scales_to_fit(false);
    cfg.set_preserves_aspect_ratio(true);

    let sample = capture_one(&filter, &cfg)?;
    let buffer = sample
        .image_buf()
        .ok_or_else(|| Error::ScreenCaptureKit("the captured frame carried no image".to_owned()))?;

    let luma = luma_of(buffer)?;
    let frame_width = buffer.width();
    let frame_height = buffer.height();

    let shapes = detect(&luma, frame_width, frame_height);

    // Out of the frame's own pixels and into the display's points, which is the
    // space the overlay draws in.
    //
    // Asking for a size is not being given it. ScreenCaptureKit rounds the
    // output for alignment, and will clamp it outright, so `buffer.width()` is
    // the only honest answer to how big the picture is — `still.rs` returns the
    // measured size rather than the requested one for the same reason. Treating
    // frame pixels as points works perfectly until the two differ, and then
    // every rectangle is uniformly off and the picker highlights a little to
    // the side of everything it names.
    Ok(rebase(shapes, frame_width, frame_height, width, height))
}

/// Rectangles found in a frame, expressed in the display's points.
///
/// Separated from the capture so the arithmetic can be tested without one.
fn rebase(
    shapes: Vec<Bounds>,
    frame_width: usize,
    frame_height: usize,
    width: usize,
    height: usize,
) -> Vec<Bounds> {
    if frame_width == 0 || frame_height == 0 {
        return Vec::new();
    }
    if frame_width == width && frame_height == height {
        return shapes;
    }

    // Worth saying out loud. It means the frame is not the size this asked for,
    // which is the sort of thing that changes with a macOS release and would
    // otherwise only show up as a picker that is slightly wrong everywhere.
    tracing::warn!(
        frame = format!("{frame_width}x{frame_height}"),
        display = format!("{width}x{height}"),
        "captured frame is not the display's size; scaling the shapes to fit"
    );

    let sx = width as f64 / frame_width as f64;
    let sy = height as f64 / frame_height as f64;

    shapes
        .into_iter()
        .map(|rect| Bounds {
            x: rect.x * sx,
            y: rect.y * sy,
            width: rect.width * sx,
            height: rect.height * sy,
        })
        .collect()
}

/// Takes one frame, blocking until ScreenCaptureKit hands it over.
///
/// The same shape as `still::capture_one` and deliberately a separate copy:
/// that one is reached through a `StillOptions` whose crop, cursor and output
/// path all mean something here, and a signature covering both would be the
/// union of two option sets to share nine lines.
fn capture_one(filter: &sc::ContentFilter, cfg: &sc::StreamCfg) -> Result<arc::R<cm::SampleBuf>> {
    let (tx, rx) = std::sync::mpsc::channel();

    let mut handler = cidre::blocks::ResultCh::new2(
        move |sample: Option<&cm::SampleBuf>, error: Option<&ns::Error>| {
            let _ = tx.send(match (sample, error) {
                (Some(sample), _) => Ok(sample.retained()),
                (None, Some(error)) => Err(error.to_string()),
                (None, None) => Err("no image and no error".to_owned()),
            });
        },
    );

    sc::ScreenshotManager::capture_sample_buf_ch(filter, cfg, Some(&mut handler));

    rx.recv_timeout(CAPTURE_TIMEOUT)
        .map_err(|_| Error::Timeout(CAPTURE_TIMEOUT))?
        .map_err(Error::ScreenCaptureKit)
}

/// One byte of brightness per pixel.
///
/// The luma plane straight out of the frame, which is what a `420*` buffer
/// already carries — brightness in plane 0, colour in plane 1. So this is a
/// copy rather than a conversion, and a quarter of the bytes a BGRA frame
/// would have been.
///
/// Brightness alone, because an edge in a user interface is nearly always an
/// edge in brightness — a border drawn in a colour of the same luminance as its
/// background is invisible to the user too.
fn luma_of(image: &cv::PixelBuf) -> Result<Vec<u8>> {
    let width = image.width();
    let height = image.height();

    // Cloned to get a mutable handle: locking counts as a mutation, and the
    // clone is a retain on the same buffer rather than a copy of the pixels.
    let mut locked = image.retained();

    // Safety: the buffer is locked for reading across every access below and
    // unlocked on the way out, and the slice is built from the stride and
    // height the buffer itself reports, so it spans only what the buffer owns.
    unsafe {
        locked
            .lock_base_addr(cv::pixel_buffer::LockFlags::READ_ONLY)
            .result()
            .map_err(|e| Error::ScreenCaptureKit(format!("could not lock the frame: {e:?}")))?;

        // Planar means plane 0 is the luma plane, which is the whole of what is
        // wanted here. `bytes_per_row` on such a buffer describes that plane
        // and not a packed row of pixels — reading it as one is the bug this
        // shape of code exists to make impossible.
        let planar = locked.plane_count() > 0;
        let (stride, base, sample) = if planar {
            (locked.plane_bytes_per_row(0), locked.plane_base_address(0), 1)
        } else {
            (locked.bytes_per_row(), locked.base_address().cast::<u8>(), 4)
        };

        let plane = (!base.is_null())
            .then(|| std::slice::from_raw_parts(base, stride * height))
            .and_then(|bytes| plane_to_luma(bytes, stride, width, height, sample));

        locked
            .unlock_lock_base_addr(cv::pixel_buffer::LockFlags::READ_ONLY)
            .result()
            .map_err(|e| Error::ScreenCaptureKit(format!("could not unlock the frame: {e:?}")))?;

        plane.ok_or_else(|| {
            Error::ScreenCaptureKit(format!(
                "cannot read a {width}x{height} frame with {stride}-byte rows \
                 at {sample} bytes per pixel"
            ))
        })
    }
}

/// Brightness out of one plane of a frame, or None if the numbers do not
/// describe a picture.
///
/// Pure, and separated for one reason: reading a frame in a layout it does not
/// have produces a picture rather than an error, and a detector fed a garbled
/// picture returns tidy rectangles for shapes that were never on screen. That
/// is exactly what happened — ScreenCaptureKit hands back `420v` here, and the
/// first version read it as four bytes a pixel, so each row swallowed four and
/// the screen arrived tiled four times across and squashed to a quarter.
///
/// The stride check is the guard. A row cannot be shorter than the pixels it
/// holds, and in that bug it was short by precisely the factor the picture
/// repeated by.
fn plane_to_luma(
    bytes: &[u8],
    stride: usize,
    width: usize,
    height: usize,
    sample: usize,
) -> Option<Vec<u8>> {
    // Padded strides are normal — a 1512-wide frame rounds up to 1536 — so this
    // is a floor and never an equality.
    if width == 0 || height == 0 || stride < width * sample || bytes.len() < stride * height {
        return None;
    }

    let mut luma = vec![0u8; width * height];

    for y in 0..height {
        let row = &bytes[y * stride..y * stride + width * sample];
        let out = &mut luma[y * width..(y + 1) * width];

        if sample == 1 {
            out.copy_from_slice(row);
        } else {
            for (bgra, value) in row.chunks_exact(4).zip(out.iter_mut()) {
                // Rec. 601 weights in fixed point.
                let (b, g, r) = (u32::from(bgra[0]), u32::from(bgra[1]), u32::from(bgra[2]));
                *value = ((r * 54 + g * 183 + b * 19) >> 8) as u8;
            }
        }
    }

    Some(luma)
}

/// A straight run of edge pixels: where it is, and how far it goes.
///
/// One type for both directions. `at` is the column for a vertical run and the
/// row for a horizontal one, and `from`/`to` are the span along it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Segment {
    at: usize,
    from: usize,
    to: usize,
}

impl Segment {
    fn len(&self) -> usize {
        self.to - self.from
    }
}

/// The rectangles in a brightness plane.
///
/// Pure, and the whole reason this is testable: a picture drawn by hand into a
/// `Vec<u8>` is a screen as far as this is concerned.
///
/// Three steps. Find the long straight edges. Pair them up into candidate
/// rectangles, squaring each one against the edges actually present. Then throw
/// away everything that does not have a perimeter.
fn detect(luma: &[u8], width: usize, height: usize) -> Vec<Bounds> {
    if width < 4 || height < 4 || luma.len() < width * height {
        return Vec::new();
    }

    let edges = EdgeMap::new(luma, width, height);

    let mut verticals = edges.vertical_runs();
    let mut horizontals = edges.horizontal_runs();

    // The longest runs bound the biggest shapes, which are the ones worth
    // offering if the cap bites.
    verticals.sort_unstable_by_key(|run| std::cmp::Reverse(run.len()));
    verticals.truncate(MAX_SEGMENTS);
    horizontals.sort_unstable_by_key(|run| std::cmp::Reverse(run.len()));
    horizontals.truncate(MAX_SEGMENTS);

    // Into positional order, so the answer is the same every time rather than
    // following whatever order the sort by length happened to leave behind.
    verticals.sort_unstable_by_key(|s| (s.at, s.from));
    horizontals.sort_unstable_by_key(|s| (s.at, s.from));

    let mut found: Vec<(f64, Bounds)> = Vec::new();

    // From the left and right sides. Two vertical borders are a panel, a card,
    // a sidebar or a column, and this is the case that covers most of a screen.
    for (index, left) in verticals.iter().enumerate() {
        for right in &verticals[index + 1..] {
            // Where the two overlap, rather than where either one starts.
            //
            // Requiring the two sides to span the same rows is the obvious rule
            // and it is wrong: a card sits against a window border running the
            // whole height of the display, so the card's short edge and that
            // long one agree about neither end, and the card is never found.
            // The first version did this and found three shapes on a real
            // screen. What two sides have in common is the rectangle.
            let Some((from, to)) = overlap(left, right) else {
                continue;
            };

            let (x1, x2) = (left.at, right.at);
            if x2 - x1 < MIN_SHAPE_EDGE as usize {
                continue;
            }

            // The overlap gives the span only approximately — a rounded corner
            // ends a border short at both ends — so the top and bottom are
            // found rather than taken.
            if let (Some(y1), Some(y2)) = (edges.snap_row(from, x1, x2), edges.snap_row(to, x1, x2))
            {
                edges.keep(&mut found, x1, y1, x2, y2);
            }
        }
    }

    // And from the top and bottom. A full-width toolbar or a table row is two
    // horizontal borders whose own sides are the edges of the window around
    // them, so the pass above has no pair of verticals to find it by.
    for (index, top) in horizontals.iter().enumerate() {
        for bottom in &horizontals[index + 1..] {
            let Some((from, to)) = overlap(top, bottom) else {
                continue;
            };

            let (y1, y2) = (top.at, bottom.at);
            if y2 - y1 < MIN_SHAPE_EDGE as usize {
                continue;
            }

            if let (Some(x1), Some(x2)) =
                (edges.snap_column(from, y1, y2), edges.snap_column(to, y1, y2))
            {
                edges.keep(&mut found, x1, y1, x2, y2);
            }
        }
    }

    let limit = (width * height) as f64 * MAX_SHAPE_AREA;
    found.retain(|(_, rect)| area(rect) <= limit);

    // Best first, so the survivor of a near-duplicate is the one whose sides
    // are most completely there.
    found.sort_unstable_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    // One shape per thing on screen.
    //
    // A sidebar whose right edge is broken into several runs proposes itself
    // half a dozen times over, each a slightly different slice, and all of them
    // pass: they are all real rectangles. A picker offering six overlapping
    // answers to "what is under the pointer" is worse than one offering one, so
    // anything that is mostly the same rectangle as something better is
    // dropped. Nesting survives — a card inside a panel shares little of its
    // area with the panel — which is the distinction that matters.
    let mut kept: Vec<Bounds> = Vec::new();
    for (_, rect) in found {
        if kept.iter().all(|other| intersection_over_union(&rect, other) < MAX_SHAPE_OVERLAP) {
            kept.push(rect);
        }
        if kept.len() == MAX_SHAPES {
            break;
        }
    }

    // By area rather than by score, because this order is what the picker
    // reads: the smallest shape containing the pointer is the one it means, and
    // that is the last match walking down a list that nests outside in.
    kept.sort_unstable_by(|a, b| {
        area(b)
            .partial_cmp(&area(a))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    kept
}

/// How much of two rectangles is the same rectangle, from nothing to all of it.
fn intersection_over_union(a: &Bounds, b: &Bounds) -> f64 {
    let width = (a.x + a.width).min(b.x + b.width) - a.x.max(b.x);
    let height = (a.y + a.height).min(b.y + b.height) - a.y.max(b.y);
    if width <= 0.0 || height <= 0.0 {
        return 0.0;
    }

    let shared = width * height;
    let union = area(a) + area(b) - shared;
    if union <= 0.0 { 0.0 } else { shared / union }
}

/// The span two parallel runs have in common, if they share enough of one to
/// be the two sides of a rectangle.
fn overlap(a: &Segment, b: &Segment) -> Option<(usize, usize)> {
    let from = a.from.max(b.from);
    let to = a.to.min(b.to);
    (to > from && to - from >= MIN_RUN).then_some((from, to))
}

fn area(rect: &Bounds) -> f64 {
    rect.width * rect.height
}

/// Where the edges are, and how much of any given line is one.
///
/// The prefix sums are the point. Scoring a candidate rectangle means asking
/// how much of each of its four sides is actually an edge, and a screen
/// generates tens of thousands of candidates — so each of those four questions
/// has to be two array reads rather than a walk along the side.
struct EdgeMap {
    width: usize,
    height: usize,
    /// Running count of vertical edges down each column: `down[x * (h + 1) + y]`
    /// is how many lie above `y` in column `x`.
    down: Vec<u32>,
    /// Running count of horizontal edges across each row.
    across: Vec<u32>,
}

impl EdgeMap {
    fn new(luma: &[u8], width: usize, height: usize) -> Self {
        let mut down = vec![0u32; width * (height + 1)];
        let mut across = vec![0u32; height * (width + 1)];

        // Which map holds which gradient is the one thing here that is easy to
        // get backwards, and it was: a *vertical* border is a change in
        // brightness along x, and it is scored by summing down a column. So
        // `down` holds the x-gradient and `across` the y-gradient. Transposed,
        // every side of every rectangle scores against the wrong edges and
        // nothing on a screen is ever found.
        for y in 0..height {
            let out = y * (width + 1);
            for x in 0..width {
                // The screen's own edges count as edges. Without this a sidebar
                // flush against the left of the display has no left side, fails
                // the perimeter test and is never offered — and the edge of the
                // screen is as real a boundary as any border drawn on it.
                let frame = y == 0 || y + 1 == height;
                let edge = frame || is_edge(luma, width, height, x, y, Axis::Y);
                across[out + x + 1] = across[out + x] + u32::from(edge);
            }
        }

        for x in 0..width {
            let out = x * (height + 1);
            for y in 0..height {
                let frame = x == 0 || x + 1 == width;
                let edge = frame || is_edge(luma, width, height, x, y, Axis::X);
                down[out + y + 1] = down[out + y] + u32::from(edge);
            }
        }

        Self {
            width,
            height,
            down,
            across,
        }
    }

    /// Whether the single sample at `(x, y)` is a vertical edge.
    fn vertical_at(&self, x: usize, y: usize) -> bool {
        let base = x * (self.height + 1);
        self.down[base + y + 1] > self.down[base + y]
    }

    fn horizontal_at(&self, x: usize, y: usize) -> bool {
        let base = y * (self.width + 1);
        self.across[base + x + 1] > self.across[base + x]
    }

    /// How much of the vertical line at `x` between `y1` and `y2` is an edge.
    fn column_coverage(&self, x: usize, y1: usize, y2: usize) -> f64 {
        if x >= self.width || y2 <= y1 || y2 > self.height {
            return 0.0;
        }
        let base = x * (self.height + 1);
        f64::from(self.down[base + y2] - self.down[base + y1]) / (y2 - y1) as f64
    }

    fn row_coverage(&self, y: usize, x1: usize, x2: usize) -> f64 {
        if y >= self.height || x2 <= x1 || x2 > self.width {
            return 0.0;
        }
        let base = y * (self.width + 1);
        f64::from(self.across[base + x2] - self.across[base + x1]) / (x2 - x1) as f64
    }

    /// Every long vertical run of edge pixels.
    fn vertical_runs(&self) -> Vec<Segment> {
        let mut runs = Vec::new();
        for x in 0..self.width {
            collect_runs(self.height, &mut runs, x, |y| self.vertical_at(x, y));
        }
        runs
    }

    fn horizontal_runs(&self) -> Vec<Segment> {
        let mut runs = Vec::new();
        for y in 0..self.height {
            collect_runs(self.width, &mut runs, y, |x| self.horizontal_at(x, y));
        }
        runs
    }

    /// The row nearest `guess` that really is a border across `x1..x2`.
    ///
    /// The search exists because of rounded corners: the vertical sides of a
    /// card stop at the start of its curve, so a rectangle proposed from them
    /// is a corner radius short at the top and at the bottom. Without this
    /// every card on screen would snap to a crop visibly inside itself.
    fn snap_row(&self, guess: usize, x1: usize, x2: usize) -> Option<usize> {
        let mut best: Option<(f64, usize)> = None;

        for y in guess.saturating_sub(SNAP_RANGE)..=(guess + SNAP_RANGE).min(self.height - 1) {
            let coverage = self.row_coverage(y, x1, x2);
            // Strictly better, so a tie goes to the row nearest the top of the
            // search — the outer edge of a border drawn two pixels thick.
            if coverage >= MIN_SIDE_COVERAGE && best.is_none_or(|(score, _)| coverage > score) {
                best = Some((coverage, y));
            }
        }

        best.map(|(_, y)| y)
    }

    fn snap_column(&self, guess: usize, y1: usize, y2: usize) -> Option<usize> {
        let mut best: Option<(f64, usize)> = None;

        for x in guess.saturating_sub(SNAP_RANGE)..=(guess + SNAP_RANGE).min(self.width - 1) {
            let coverage = self.column_coverage(x, y1, y2);
            if coverage >= MIN_SIDE_COVERAGE && best.is_none_or(|(score, _)| coverage > score) {
                best = Some((coverage, x));
            }
        }

        best.map(|(_, x)| x)
    }

    /// Scores a candidate rectangle and keeps it if it is worth offering.
    ///
    /// The duplicate check is here rather than in a pass afterwards because the
    /// candidates arrive in their thousands and nearly all of them are the same
    /// few rectangles found again from an adjacent column of anti-aliasing.
    fn keep(&self, found: &mut Vec<(f64, Bounds)>, x1: usize, y1: usize, x2: usize, y2: usize) {
        let (w, h) = ((x2 - x1) as f64, (y2 - y1) as f64);
        if w < MIN_SHAPE_EDGE || h < MIN_SHAPE_EDGE {
            return;
        }

        // Weighted by side length, which is the same as asking what fraction of
        // the perimeter is an edge. An unweighted mean of the four would let a
        // complete short side pay for a missing long one.
        let covered = self.column_coverage(x1, y1, y2) * h
            + self.column_coverage(x2, y1, y2) * h
            + self.row_coverage(y1, x1, x2) * w
            + self.row_coverage(y2, x1, x2) * w;
        let score = covered / (2.0 * (w + h));

        if score < MIN_PERIMETER_COVERAGE {
            return;
        }

        let rect = Bounds {
            x: x1 as f64,
            y: y1 as f64,
            width: w,
            height: h,
        };

        for (existing, other) in found.iter_mut() {
            if same_rect(&rect, other) {
                if score > *existing {
                    *existing = score;
                    *other = rect;
                }
                return;
            }
        }

        // A screen of genuinely distinct rectangles past this point is a screen
        // nobody is reading forty shapes off anyway, and the scan above is
        // linear in what is already kept.
        if found.len() < MAX_SHAPES * 8 {
            found.push((score, rect));
        }
    }
}

/// Which way a gradient is measured. `X` finds vertical borders.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Axis {
    X,
    Y,
}

/// Whether `(x, y)` sits on a border running across `axis`.
///
/// Two flat flanks with something different between them, which covers the only
/// two ways an interface draws a boundary: a step, where one flat fill gives way
/// to another, and a line, where a hairline of its own colour separates two
/// regions that may well be identical. A test for one misses the other
/// entirely — a step detector cannot see a 1px divider on a white page, because
/// the brightness five samples either side of it is the same white.
///
/// The flatness requirement is doing the real work. It is what a texture cannot
/// satisfy, and without it this returns true almost everywhere on a photograph.
fn is_edge(luma: &[u8], width: usize, height: usize, x: usize, y: usize, axis: Axis) -> bool {
    let length = if axis == Axis::X { width } else { height };
    // Clamped rather than skipped, so a border a few samples from the edge of
    // the screen is still found; the frame's own rows and columns are counted
    // by the caller.
    let at = |offset: isize| -> i32 {
        let index = (offset.clamp(0, length as isize - 1)) as usize;
        let (sx, sy) = if axis == Axis::X { (index, y) } else { (x, index) };
        i32::from(luma[sy * width + sx])
    };

    let centre = if axis == Axis::X { x } else { y } as isize;

    // The two samples under the candidate: one covers a hairline, two cover the
    // same hairline anti-aliased across a fractional position.
    let core = [at(centre), at(centre + 1)];

    let mut before = [0i32; FLANK_SPAN];
    let mut after = [0i32; FLANK_SPAN];
    for step in 0..FLANK_SPAN {
        before[step] = at(centre - 1 - step as isize);
        after[step] = at(centre + 2 + step as isize);
    }

    if spread(&before) > FLANK_FLATNESS || spread(&after) > FLANK_FLATNESS {
        return false;
    }

    let left = mean(&before);
    let right = mean(&after);

    // A step: the two flanks are different.
    if (left - right).abs() >= EDGE_THRESHOLD {
        return true;
    }

    // Or a line: the flanks agree, and what lies between them does not.
    core.iter()
        .any(|&value| (value - left).abs() >= EDGE_THRESHOLD && (value - right).abs() >= EDGE_THRESHOLD)
}

fn spread(values: &[i32]) -> i32 {
    let (mut low, mut high) = (i32::MAX, i32::MIN);
    for &value in values {
        low = low.min(value);
        high = high.max(value);
    }
    high - low
}

fn mean(values: &[i32]) -> i32 {
    values.iter().sum::<i32>() / values.len() as i32
}

/// Maximal runs of a predicate, long enough to be a border and bridging the
/// gaps a corner or an overlapping icon leaves in one.
fn collect_runs(length: usize, runs: &mut Vec<Segment>, at: usize, set: impl Fn(usize) -> bool) {
    let mut start: Option<usize> = None;
    let mut last = 0usize;

    for index in 0..length {
        if set(index) {
            if start.is_none() {
                start = Some(index);
            }
            last = index;
            continue;
        }

        // Still inside the run as far as the gap allows; the run only ends once
        // the break is longer than a corner.
        if let Some(from) = start
            && index - last > MAX_GAP
        {
            push_run(runs, at, from, last);
            start = None;
        }
    }

    if let Some(from) = start {
        push_run(runs, at, from, last);
    }
}

fn push_run(runs: &mut Vec<Segment>, at: usize, from: usize, to: usize) {
    if to - from >= MIN_RUN {
        runs.push(Segment { at, from, to });
    }
}

/// Whether two rectangles are the same one found twice.
fn same_rect(a: &Bounds, b: &Bounds) -> bool {
    let near = |p: f64, q: f64| (p - q).abs() <= TOLERANCE as f64;
    near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A screen to draw on: mid grey, so a shape can be drawn lighter or darker.
    struct Canvas {
        luma: Vec<u8>,
        width: usize,
        height: usize,
    }

    impl Canvas {
        fn new(width: usize, height: usize) -> Self {
            Self {
                luma: vec![128; width * height],
                width,
                height,
            }
        }

        /// A filled rectangle, which is how nearly every panel on a real screen
        /// is distinguished from what is behind it.
        fn fill(&mut self, x: usize, y: usize, w: usize, h: usize, value: u8) -> &mut Self {
            for row in y..(y + h).min(self.height) {
                for column in x..(x + w).min(self.width) {
                    self.luma[row * self.width + column] = value;
                }
            }
            self
        }

        /// A one-pixel outline and nothing inside it — a bordered card on the
        /// same background, which is the harder of the two cases.
        fn outline(&mut self, x: usize, y: usize, w: usize, h: usize, value: u8) -> &mut Self {
            for column in x..x + w {
                self.luma[y * self.width + column] = value;
                self.luma[(y + h - 1) * self.width + column] = value;
            }
            for row in y..y + h {
                self.luma[row * self.width + x] = value;
                self.luma[row * self.width + x + w - 1] = value;
            }
            self
        }

        fn detect(&self) -> Vec<Bounds> {
            detect(&self.luma, self.width, self.height)
        }
    }

    /// Whether a rectangle like this came back, within the tolerance the
    /// detector itself works to.
    fn found(shapes: &[Bounds], x: f64, y: f64, w: f64, h: f64) -> bool {
        shapes.iter().any(|shape| {
            (shape.x - x).abs() <= TOLERANCE as f64
                && (shape.y - y).abs() <= TOLERANCE as f64
                && (shape.width - w).abs() <= TOLERANCE as f64
                && (shape.height - h).abs() <= TOLERANCE as f64
        })
    }

    #[test]
    fn finds_a_filled_panel() {
        let mut canvas = Canvas::new(400, 300);
        canvas.fill(50, 40, 200, 160, 220);

        let shapes = canvas.detect();
        assert!(
            found(&shapes, 50.0, 40.0, 199.0, 159.0),
            "expected the panel; got {shapes:?}"
        );
    }

    #[test]
    fn finds_a_bordered_card() {
        let mut canvas = Canvas::new(400, 300);
        canvas.outline(80, 60, 180, 140, 40);

        let shapes = canvas.detect();
        assert!(
            found(&shapes, 80.0, 60.0, 179.0, 139.0),
            "expected the card; got {shapes:?}"
        );
    }

    #[test]
    fn finds_a_panel_inside_a_panel() {
        // The nesting a real window is: a frame, a sidebar, and content.
        let mut canvas = Canvas::new(600, 400);
        canvas
            .fill(40, 30, 500, 330, 230)
            .fill(60, 60, 140, 270, 200)
            .fill(230, 60, 280, 200, 250);

        let shapes = canvas.detect();
        assert!(found(&shapes, 40.0, 30.0, 499.0, 329.0), "no frame");
        assert!(found(&shapes, 60.0, 60.0, 139.0, 269.0), "no sidebar");
        assert!(found(&shapes, 230.0, 60.0, 279.0, 199.0), "no content");

        // Largest first, because the picker reads the list in that order to
        // find the smallest shape under the pointer.
        let areas: Vec<f64> = shapes.iter().map(area).collect();
        assert!(
            areas.windows(2).all(|pair| pair[0] >= pair[1]),
            "shapes are not ordered outside in: {areas:?}"
        );
    }

    #[test]
    fn squares_up_a_rounded_card() {
        // Corners knocked off, which is what every card on a real screen looks
        // like: the vertical sides stop short of the top and bottom by the
        // radius. The shape offered must still be the card, not the straight
        // part of its sides.
        const RADIUS: usize = 12;
        let mut canvas = Canvas::new(400, 300);
        canvas.fill(80, 60, 200, 160, 235);
        for inset in 0..RADIUS {
            let bite = RADIUS - inset;
            for x in 0..bite {
                canvas.luma[(60 + inset) * 400 + 80 + x] = 128;
                canvas.luma[(60 + inset) * 400 + 279 - x] = 128;
                canvas.luma[(219 - inset) * 400 + 80 + x] = 128;
                canvas.luma[(219 - inset) * 400 + 279 - x] = 128;
            }
        }

        let shapes = canvas.detect();
        assert!(
            found(&shapes, 80.0, 60.0, 199.0, 159.0),
            "the card was not squared up; got {shapes:?}"
        );
    }

    #[test]
    fn ignores_text_and_noise() {
        // The thing that would make this feature useless: a page of text
        // generates far more edge pixels than any border on screen, and none of
        // them a straight line. Nothing here is a shape.
        let mut canvas = Canvas::new(400, 300);
        let mut seed = 0x2545_f491_4f6c_dd1du64;
        for value in canvas.luma.iter_mut() {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            *value = (seed >> 56) as u8;
        }

        assert_eq!(canvas.detect(), vec![], "noise produced shapes");
    }

    #[test]
    fn ignores_a_short_run() {
        // A button. Long enough to have four clean sides, too small to be a
        // snap target worth crossing the screen for.
        let mut canvas = Canvas::new(400, 300);
        canvas.fill(100, 100, 24, 20, 230);

        assert_eq!(canvas.detect(), vec![]);
    }

    #[test]
    fn ignores_the_whole_screen() {
        // A display with one flat window over all of it. "Entire screen" is
        // already a mode, and offering it here as a shape would put the largest
        // and least useful target at the top of the list.
        let mut canvas = Canvas::new(400, 300);
        canvas.fill(0, 0, 400, 300, 230);

        assert_eq!(canvas.detect(), vec![]);
    }

    #[test]
    fn ignores_three_sides() {
        // A rectangle with its bottom missing is a guess, and a snap target the
        // user cannot see the edge of is worse than no snap target.
        let mut canvas = Canvas::new(400, 300);
        canvas.outline(80, 60, 180, 140, 40);
        for column in 80..260 {
            canvas.luma[199 * 400 + column] = 128;
        }

        let shapes = canvas.detect();
        assert!(
            !found(&shapes, 80.0, 60.0, 179.0, 139.0),
            "kept a rectangle with no bottom: {shapes:?}"
        );
    }

    #[test]
    fn finds_a_full_width_bar() {
        // A toolbar: two long horizontal borders whose own vertical sides are
        // the window's, not the bar's. Only the horizontal pass can see it.
        let mut canvas = Canvas::new(600, 400);
        canvas.fill(40, 30, 500, 330, 235).fill(40, 30, 500, 48, 215);

        let shapes = canvas.detect();
        assert!(
            found(&shapes, 40.0, 30.0, 499.0, 47.0),
            "expected the toolbar; got {shapes:?}"
        );
    }

    #[test]
    fn an_empty_screen_has_no_shapes() {
        assert_eq!(Canvas::new(400, 300).detect(), vec![]);
    }

    /// The bug that shipped, as a test.
    ///
    /// A 420v frame's rows are its luma plane — one byte a pixel — and reading
    /// them as four took four rows per row, so the screen arrived tiled four
    /// times across. Nothing failed: the detector returned honest rectangles
    /// for a picture that was never on screen.
    /// The frame is the detector's ruler; the display is the picker's.
    ///
    /// These are the same number until ScreenCaptureKit decides otherwise, and
    /// the failure when they part is the quiet kind: every rectangle correct in
    /// shape and uniformly in the wrong place.
    #[test]
    fn shapes_are_scaled_out_of_the_frame_and_into_points() {
        let found = vec![Bounds { x: 100.0, y: 50.0, width: 200.0, height: 100.0 }];
        // A frame captured at twice the display's points.
        let rebased = rebase(found, 2000, 1000, 1000, 500);
        assert_eq!(
            rebased,
            vec![Bounds { x: 50.0, y: 25.0, width: 100.0, height: 50.0 }]
        );
    }

    #[test]
    fn a_frame_that_is_already_the_display_is_left_alone() {
        // The ordinary case, and it must not drift through the arithmetic.
        let found = vec![Bounds { x: 3.0, y: 7.0, width: 11.0, height: 13.0 }];
        assert_eq!(rebase(found.clone(), 1512, 982, 1512, 982), found);
    }

    #[test]
    fn a_frame_with_no_size_yields_nothing() {
        let found = vec![Bounds { x: 1.0, y: 1.0, width: 1.0, height: 1.0 }];
        assert_eq!(rebase(found, 0, 0, 1512, 982), vec![]);
    }

    #[test]
    fn a_luma_plane_read_as_packed_pixels_is_refused() {
        // Exactly the numbers off a 1512-wide capture: a luma plane padded to
        // 1536, which is nowhere near the 6048 a packed row would need.
        let bytes = vec![0u8; 1536 * 982];
        assert_eq!(plane_to_luma(&bytes, 1536, 1512, 982, 4), None);
    }

    #[test]
    fn a_padded_luma_plane_reads_back_exactly() {
        // The padding is the other half of it: a stride wider than the picture
        // is normal, and a reader that ignores it shears every row along.
        let (width, height, stride) = (3usize, 2usize, 5usize);
        let mut bytes = vec![0u8; stride * height];
        bytes[0..3].copy_from_slice(&[10, 20, 30]);
        bytes[5..8].copy_from_slice(&[40, 50, 60]);
        // Junk in the padding, which must not reach the picture.
        bytes[3] = 255;
        bytes[4] = 255;
        bytes[8] = 255;

        assert_eq!(
            plane_to_luma(&bytes, stride, width, height, 1),
            Some(vec![10, 20, 30, 40, 50, 60])
        );
    }

    #[test]
    fn a_packed_frame_is_still_read_as_colour() {
        // The other branch: a four-byte BGRA pixel, weighted to brightness.
        // White and black either side of the one that matters.
        let bytes = vec![255, 255, 255, 255, 0, 0, 0, 255];
        let luma = plane_to_luma(&bytes, 8, 2, 1, 4).expect("a packed row");
        assert_eq!(luma.len(), 2);
        assert!(luma[0] > 240, "white came out at {}", luma[0]);
        assert_eq!(luma[1], 0);
    }

    #[test]
    fn a_truncated_plane_is_refused() {
        // A buffer shorter than its own geometry claims. Reading it is a crash
        // rather than a wrong picture, which is the one failure worse than this.
        assert_eq!(plane_to_luma(&[0; 10], 16, 16, 4, 1), None);
    }

    #[test]
    fn a_degenerate_plane_is_not_a_panic() {
        assert_eq!(detect(&[], 0, 0), vec![]);
        assert_eq!(detect(&[0; 4], 2, 2), vec![]);
        // Short of what the dimensions claim, which is the shape a truncated
        // read would arrive in.
        assert_eq!(detect(&[0; 16], 400, 300), vec![]);
    }
}
