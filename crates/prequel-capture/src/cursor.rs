//! Where the pointer was, sampled on its own thread against the session clock.
//!
//! Recorded during capture because it cannot be recovered afterwards: the
//! cursor is drawn into the frames, but its position is not something an editor
//! can read back out of them. Without this, zoom-to-cursor is only ever
//! possible for recordings made after it is added — which is why it is worth
//! sampling now, before there is any UI that uses it.
//!
//! Sampled from `spawn_cursor` rather than from the frame callback, and the
//! reason is worth stating because the callback is the obvious place and it is
//! wrong. `pointer_location` answers where the pointer is *now*; a frame
//! callback carries the time the frame was *captured*, and ScreenCaptureKit
//! delivers it a queue's worth of encoding later. Filing a position read now
//! under a timestamp from a tenth of a second ago moves the whole track ahead
//! of the picture — measured at 130-180ms against the clicks, which are stamped
//! by their own tap — and jitter in that delay stretches and squeezes the time
//! between samples, so a hand moving at one speed is recorded as moving at two.
//! Neither survives reading the clock in the same breath as the position.
//!
//! Straight CoreGraphics rather than a cidre binding, matching `permission.rs`:
//! two functions, and the global pointer location has no Objective-C wrapper
//! worth the indirection.

use std::ffi::{CString, c_char, c_void};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU8, Ordering};

use prequel_session::MediaTime;

/// Slowest sampling that still reads as continuous when interpolated.
///
/// A screen recording runs at 60 fps, and a sample per frame would put tens of
/// thousands of entries in the manifest for a ten-minute take. Half that rate
/// is indistinguishable once the path is smoothed, which `smoothPath` in
/// `shared/layout.ts` does.
///
/// The sampler thread sleeps for `SAMPLE_INTERVAL`, and the gate below is the
/// same number so the two cannot drift apart. Missing the gate by a fraction of
/// a millisecond would silently halve the rate.
const SAMPLE_INTERVAL_NS: MediaTime = 33_000_000;

/// `SAMPLE_INTERVAL_NS` as the sampler thread's sleep.
pub const SAMPLE_INTERVAL: std::time::Duration =
    std::time::Duration::from_nanos(SAMPLE_INTERVAL_NS);

/// Movement below this is not worth an entry.
///
/// A still pointer would otherwise write an identical sample thirty times a
/// second, which is pure file size — the reader holds the last position anyway.
const MIN_MOVEMENT_POINTS: f64 = 1.0;

/// Which pointer the system was showing.
///
/// Named for what it means rather than for the `NSCursor` it came from, because
/// several of those map onto one of these: a pane edge that can only be dragged
/// one way is `resizeLeft`, and drawing a one-headed arrow for it would be a
/// pointer nobody has ever seen in a screen recording.
///
/// `Arrow` is the fallback for everything unrecognised, which is what every kind
/// not listed here already looked like.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum CursorKind {
    #[default]
    Arrow,
    /// The link cursor.
    Hand,
    /// The I-beam, over anything editable.
    Text,
    /// Dragging a vertical edge — a pane divider, a column.
    ResizeH,
    /// Dragging a horizontal edge.
    ResizeV,
}

impl CursorKind {
    /// What the manifest writes. Read by `shared/manifest.ts`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Arrow => "arrow",
            Self::Hand => "hand",
            Self::Text => "text",
            Self::ResizeH => "resize-h",
            Self::ResizeV => "resize-v",
        }
    }

    /// The default, and so the one the manifest leaves out.
    pub fn is_arrow(&self) -> bool {
        matches!(self, Self::Arrow)
    }

    fn from_u8(value: u8) -> Self {
        match value {
            1 => Self::Hand,
            2 => Self::Text,
            3 => Self::ResizeH,
            4 => Self::ResizeV,
            _ => Self::Arrow,
        }
    }

    fn to_u8(self) -> u8 {
        match self {
            Self::Arrow => 0,
            Self::Hand => 1,
            Self::Text => 2,
            Self::ResizeH => 3,
            Self::ResizeV => 4,
        }
    }
}

/// Collects pointer positions on the session timeline.
#[derive(Debug, Default)]
pub struct CursorTrack {
    /// The captured region in global display points.
    ///
    /// Samples are stored as fractions of it rather than as the raw global
    /// points they arrive in. Everything needed to do that conversion — the
    /// display's origin, the crop, the scale — is known here and nowhere
    /// downstream: the manifest records no display origin, and by the time the
    /// editor sees a recording the window it came from may have moved or
    /// closed. Fractions also survive the recording being opened on another
    /// machine, which raw screen coordinates would not.
    region: Region,
    samples: Vec<CursorSample>,
    last_at: Option<MediaTime>,
    last_position: Option<(f64, f64)>,
    last_kind: CursorKind,
}

/// A rectangle in global display points.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Region {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Where the pointer was, as a fraction of the captured frame.
///
/// Outside 0..1 means it had left the recorded area. Kept rather than dropped:
/// a missing sample would be interpolated straight through by whatever draws
/// the track, sliding a pointer across the picture that was never there.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CursorSample {
    pub at: MediaTime,
    pub x: f64,
    pub y: f64,
    /// Which pointer the system was showing at this moment.
    ///
    /// The one thing about the pointer's *appearance* worth recording. A
    /// composited pointer that never changes shape is the tell that it was
    /// composited — and an arrow sitting in a text field while somebody types
    /// is the version of that nobody can unsee.
    pub kind: CursorKind,
}

impl CursorTrack {
    pub fn new(region: Region) -> Self {
        Self {
            region,
            ..Default::default()
        }
    }

    /// Records the pointer's position, if this moment is worth a sample.
    ///
    /// `at` must be the media time of the moment this is *called*, not of some
    /// frame that arrived around now — the position is read inside, from the
    /// window server, as of now. See the note at the top of the file for what
    /// filing one under the other does to the track.
    pub fn sample(&mut self, at: MediaTime) {
        // A region with no area cannot be divided by. Belt and braces: the
        // recorder refuses an empty capture before it gets this far.
        if self.region.width <= 0.0 || self.region.height <= 0.0 {
            return;
        }

        if let Some(last) = self.last_at
            && at.saturating_sub(last) < SAMPLE_INTERVAL_NS
        {
            return;
        }

        let Some((x, y)) = pointer_location() else {
            return;
        };

        // Cheap here — one atomic load. The AppKit call behind it is made on
        // its own thread, which is what keeps the frame callback out of a
        // framework with no promise of thread safety.
        let kind = pointer_kind();

        if !worth_recording(self.last_position, self.last_kind, x, y, kind) {
            // Still, and the same shape. The rate gate is updated anyway, so a
            // pointer that never moves is checked at the sample rate rather
            // than on every frame.
            self.last_at = Some(at);
            return;
        }

        self.last_at = Some(at);
        self.last_position = Some((x, y));
        self.last_kind = kind;

        // Gated on raw points, stored as fractions: a pixel of movement means
        // the same thing whatever the display, and the threshold would drift
        // with the capture size if it were applied after the division.
        self.samples.push(CursorSample {
            at,
            x: (x - self.region.x) / self.region.width,
            y: (y - self.region.y) / self.region.height,
            kind,
        });
    }

    /// Empties the track, leaving it usable. Not `into_samples`, so the caller
    /// does not have to replace the whole thing to get at them.
    pub fn take_samples(&mut self) -> Vec<CursorSample> {
        std::mem::take(&mut self.samples)
    }

    pub fn len(&self) -> usize {
        self.samples.len()
    }
}

/// Whether a reading says anything the last sample did not.
///
/// Pulled out of `sample` so it can be tested without a real pointer under it:
/// everything else in that method reads the window server, and this is the part
/// that decides what ends up in the manifest.
///
/// A shape change counts even from a pointer that has not moved. The hand
/// appears under a link that scrolled up to meet a parked pointer, and the
/// I-beam appears the moment a field takes focus under a still pointer — gating
/// on movement alone would hold the arrow until the mouse next twitched, which
/// reads worse than a pointer that never changes at all.
fn worth_recording(
    last_position: Option<(f64, f64)>,
    last_kind: CursorKind,
    x: f64,
    y: f64,
    kind: CursorKind,
) -> bool {
    let Some((px, py)) = last_position else {
        return true;
    };

    kind != last_kind
        || (x - px).abs() >= MIN_MOVEMENT_POINTS
        || (y - py).abs() >= MIN_MOVEMENT_POINTS
}

/// Which pointer the system was showing, as of the last look.
///
/// A cache rather than a live read. Asking `NSCursor` costs about 50µs and
/// reaches into AppKit, and neither belongs in the frame callback sixty times a
/// second — so `spawn_pointer_shape` in `recorder.rs` refreshes this from its
/// own thread, the way typing is sampled, and the callback pays a load.
static POINTER_KIND: AtomicU8 = AtomicU8::new(0);

pub fn pointer_kind() -> CursorKind {
    CursorKind::from_u8(POINTER_KIND.load(Ordering::Relaxed))
}

/// Looks at the system cursor and records which one it is.
///
/// Call from a dedicated thread, not from the capture callback.
pub fn refresh_pointer_shape() {
    POINTER_KIND.store(read_pointer_kind().to_u8(), Ordering::Relaxed);
}

/// Clears the cached shape, so a recording does not open holding the last one.
///
/// The static outlives a recording — only one runs at a time, the same
/// reasoning `clicks.rs` uses — and a hand left over from the previous take
/// would put one on the first few frames of the next one.
pub fn reset_pointer_shape() {
    POINTER_KIND.store(CursorKind::Arrow.to_u8(), Ordering::Relaxed);
}

/// Tolerance on the proportions below. Generous: these are compared against
/// the system's own cursors, not against constants, so anything within a
/// fiftieth of the image is the same cursor.
const SHAPE_TOLERANCE: f64 = 0.02;

/// Every `NSCursor` worth telling apart, and what it is drawn as.
///
/// Both I-beams map onto one kind on purpose: a vertical text cursor is still
/// a text cursor, and drawing the upright one for it is closer than an arrow.
///
/// The arrow itself is absent — it is what anything unrecognised falls back to,
/// so matching it would only be a slower way of reaching the same answer.
///
/// The *one-way* resize cursors are absent too, and that is not an oversight.
/// `resizeUp` sits at (0.50, 0.5417) of a square image and `openHand` at
/// (0.50, 0.5312) of one: a hundredth apart, which is inside the tolerance
/// below. Listing them would draw a vertical resize arrow every time somebody
/// picked up a canvas to pan it — the collision is pinned by
/// `no_two_measured_cursors_of_different_kinds_look_alike`. Three numbers are
/// enough to separate the five drawn here and not enough to separate those, so
/// a pane edge at the end of its travel keeps the arrow it always had.
const REFERENCES: &[(&str, CursorKind)] = &[
    ("pointingHandCursor", CursorKind::Hand),
    ("IBeamCursor", CursorKind::Text),
    ("IBeamCursorForVerticalLayout", CursorKind::Text),
    ("resizeLeftRightCursor", CursorKind::ResizeH),
    ("resizeUpDownCursor", CursorKind::ResizeV),
];

/// Which of the cursors above the window server is currently showing.
///
/// Compared against `NSCursor`'s own instances rather than against measured
/// numbers, so a macOS release that redraws its cursors does not quietly turn
/// this off — the reference moves with them. What is compared is the *shape*:
/// the hotspot as a fraction of the image, and the image's aspect ratio. Those
/// survive the pointer being scaled up in Accessibility settings, which the raw
/// sizes would not.
///
/// Three numbers is not much to tell twenty cursors apart, and it is not asked
/// to: it separates the five drawn here by a wide margin — the arrow's hotspot
/// sits at (0.18, 0.13) of a 0.7 image, the hand's at (0.41, 0.25) of a square
/// one, the I-beam's at (0.52, 0.50) of a 1.05, and the two resize pointers
/// share a centred hotspot and are told apart by aspect alone, 1.25 against
/// 0.86. Anything else falls through to the arrow, which is what it was already.
///
/// `Arrow` on any failure. The pointer then stays an arrow throughout, which is
/// exactly how it behaved before the shape was sampled at all.
fn read_pointer_kind() -> CursorKind {
    let references = references();
    if references.is_empty() {
        return CursorKind::Arrow;
    }

    // Safety: `+[NSCursor currentSystemCursor]` returns an autoreleased cursor
    // or nil, and `image`/`hotSpot` only read from it. The pool is pushed
    // because this runs on a thread of ours, which has none of its own — with
    // no pool the autoreleased cursor and its image leak on every look.
    let shape = unsafe {
        let pool = objc_autoreleasePoolPush();
        let shape = objc_getClass(c"NSCursor".as_ptr())
            .as_mut()
            .and_then(|class| send(class, selector("currentSystemCursor")).as_mut())
            .and_then(|cursor| shape_of(cursor));
        objc_autoreleasePoolPop(pool);
        shape
    };

    let Some(shape) = shape else {
        return CursorKind::Arrow;
    };

    references
        .iter()
        .find(|(reference, _)| matches(shape, *reference))
        .map_or(CursorKind::Arrow, |(_, kind)| *kind)
}

fn matches(shape: (f64, f64, f64), reference: (f64, f64, f64)) -> bool {
    (shape.0 - reference.0).abs() < SHAPE_TOLERANCE
        && (shape.1 - reference.1).abs() < SHAPE_TOLERANCE
        && (shape.2 - reference.2).abs() < SHAPE_TOLERANCE
}

/// The reference cursors' proportions, read once AppKit can give them.
///
/// `NSCursor`'s class cursors hand back an empty image until the process has
/// finished launching as a GUI app — measurably: `arrowCursor` and `IBeamCursor`
/// report no size in one that has not, while `pointingHandCursor` does. So the
/// arrow is the canary. If even it cannot be measured there is no window server
/// worth asking and the table stays empty, which leaves every pointer an arrow —
/// exactly what a build with no cursors to compare against drew before.
///
/// Cached only once the canary answers. Caching a table built too early would
/// mean the I-beam never appearing for the life of the process, which is the
/// failure this whole dance exists to avoid: it looks precisely like a recording
/// where the user never happened to click into a text field.
fn references() -> Vec<((f64, f64, f64), CursorKind)> {
    static SHAPES: OnceLock<Vec<((f64, f64, f64), CursorKind)>> = OnceLock::new();

    if let Some(cached) = SHAPES.get() {
        return cached.clone();
    }

    // Safety: as `read_pointer_kind`. These are shared instances rather than
    // autoreleased ones, but the pool costs nothing and covers the images they
    // are asked for.
    let built: Option<Vec<_>> = unsafe {
        let pool = objc_autoreleasePoolPush();

        let ready = shape_named("arrowCursor").is_some();
        let built = ready.then(|| {
            REFERENCES
                .iter()
                .filter_map(|(name, kind)| Some((shape_named(name)?, *kind)))
                .collect::<Vec<_>>()
        });

        objc_autoreleasePoolPop(pool);
        built
    };

    let Some(built) = built else {
        return Vec::new();
    };

    let _ = SHAPES.set(built.clone());
    built
}

/// One `NSCursor` class cursor's shape, by selector name.
///
/// # Safety
///
/// Must be called inside an autorelease pool, on a thread that has one pushed.
unsafe fn shape_named(name: &str) -> Option<(f64, f64, f64)> {
    unsafe {
        objc_getClass(c"NSCursor".as_ptr())
            .as_mut()
            .and_then(|class| send(class, selector(name)).as_mut())
            .and_then(|cursor| shape_of(cursor))
    }
}

/// A cursor's shape signature: hotspot as a fraction of the image, and aspect.
///
/// Fractions rather than the raw numbers so the comparison survives the pointer
/// being scaled up in Accessibility settings — the image doubles, and every one
/// of these three stays where it was.
///
/// # Safety
///
/// `cursor` must be a live `NSCursor`, inside an autorelease pool.
unsafe fn shape_of(cursor: &mut c_void) -> Option<(f64, f64, f64)> {
    unsafe {
        let image = send(cursor, selector("image")).as_mut()?;

        let size: unsafe extern "C" fn(*mut c_void, *mut c_void) -> CGSize =
            std::mem::transmute(objc_msgSend as *const c_void);
        let point: unsafe extern "C" fn(*mut c_void, *mut c_void) -> CGPoint =
            std::mem::transmute(objc_msgSend as *const c_void);

        let size = size(image, selector("size"));
        // A cursor with no size cannot be divided by, and is not a hand.
        if size.width <= 0.0 || size.height <= 0.0 {
            return None;
        }

        let hot = point(cursor, selector("hotSpot"));
        Some((
            hot.x / size.width,
            hot.y / size.height,
            size.width / size.height,
        ))
    }
}

/// `objc_msgSend` for the object-returning selectors used here.
///
/// # Safety
///
/// `receiver` must be a live object that responds to `sel` with an object.
unsafe fn send(receiver: &mut c_void, sel: *mut c_void) -> *mut c_void {
    unsafe {
        let send: unsafe extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void =
            std::mem::transmute(objc_msgSend as *const c_void);
        send(receiver, sel)
    }
}

/// Selectors are interned for the life of the process, so this never frees one.
fn selector(name: &str) -> *mut c_void {
    // Safety: `sel_registerName` copies the name; the `CString` may go.
    unsafe { sel_registerName(CString::new(name).unwrap().as_ptr()) }
}

/// The pointer's position in global display coordinates, in points.
///
/// Returns None rather than a default when the event cannot be created, so a
/// failure shows up as a gap in the track rather than as a cursor that appears
/// to teleport to the top-left corner.
fn pointer_location() -> Option<(f64, f64)> {
    // Safety: `CGEventCreate(NULL)` returns a retained event or null, and
    // `CGEventGetLocation` only reads from it. The event is released before
    // returning, so nothing outlives this call.
    unsafe {
        let event = CGEventCreate(std::ptr::null());
        if event.is_null() {
            return None;
        }
        let point = CGEventGetLocation(event);
        CFRelease(event);
        Some((point.x, point.y))
    }
}

#[repr(C)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
struct CGSize {
    width: f64,
    height: f64,
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventCreate(source: *const c_void) -> *mut c_void;
    fn CGEventGetLocation(event: *mut c_void) -> CGPoint;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(cf: *mut c_void);
}

// `objc_msgSend` is declared without a signature and transmuted per call site.
// It has to be: the real thing dispatches on the selector, and a return value
// of `NSSize` comes back in floating-point registers where a pointer comes back
// in an integer one. One Rust declaration for all of them would put the size
// somewhere the caller does not look, which reads as a cursor of 0x0 rather
// than as a mistake. arm64 only, and this app is Apple Silicon only: on x86_64
// a struct return would need `objc_msgSend_stret` as well.
#[link(name = "objc", kind = "dylib")]
unsafe extern "C" {
    fn objc_getClass(name: *const c_char) -> *mut c_void;
    fn sel_registerName(name: *const c_char) -> *mut c_void;
    fn objc_msgSend();
    fn objc_autoreleasePoolPush() -> *mut c_void;
    fn objc_autoreleasePoolPop(pool: *mut c_void);
}

// AppKit is not otherwise linked by this crate — `NSCursor` lives there, and
// without this the symbol resolves to nothing at load time.
#[link(name = "AppKit", kind = "framework")]
unsafe extern "C" {}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 1000x500 region at the origin, so a fraction is easy to read back.
    const REGION: Region = Region {
        x: 0.0,
        y: 0.0,
        width: 1000.0,
        height: 500.0,
    };

    /// A track that records whatever it is told, bypassing the real pointer.
    fn push(track: &mut CursorTrack, at: MediaTime, x: f64, y: f64) {
        track.last_at = Some(at);
        track.last_position = Some((x, y));
        track.samples.push(CursorSample {
            at,
            x,
            y,
            kind: track.last_kind,
        });
    }

    /// Every system cursor's shape, measured on macOS 26 with `NSCursor`.
    ///
    /// Constants here and the live system in the test below, deliberately. The
    /// live check can only run where AppKit will answer, which a test binary is
    /// not — so on its own it would be a test that never checks anything. These
    /// are what exercise the matcher everywhere, and they are the numbers the
    /// tolerance was chosen against.
    ///
    /// Includes cursors this does *not* draw. Those are the dangerous ones: a
    /// reference that reaches too far turns an open hand into a resize pointer,
    /// and the recording just quietly shows the wrong thing.
    const MEASURED: &[(&str, (f64, f64, f64))] = &[
        ("arrow", (0.1786, 0.1250, 0.7000)),
        ("iBeam", (0.5217, 0.5000, 1.0455)),
        ("iBeamVertical", (0.5000, 0.4762, 1.0476)),
        ("pointingHand", (0.4062, 0.2500, 1.0000)),
        ("resizeLeftRight", (0.5000, 0.5000, 1.2500)),
        ("resizeUpDown", (0.5000, 0.5000, 0.8571)),
        ("resizeLeft", (0.5000, 0.5000, 1.0000)),
        ("resizeUp", (0.5000, 0.5417, 1.0000)),
        ("resizeDown", (0.5000, 0.4583, 1.0000)),
        ("openHand", (0.5000, 0.5312, 1.0000)),
        ("closedHand", (0.5000, 0.5312, 1.0000)),
        ("crosshair", (0.4583, 0.4583, 1.0000)),
    ];

    /// What each measured cursor should be drawn as.
    fn expected(name: &str) -> CursorKind {
        match name {
            "iBeam" | "iBeamVertical" => CursorKind::Text,
            "pointingHand" => CursorKind::Hand,
            "resizeLeftRight" => CursorKind::ResizeH,
            "resizeUpDown" => CursorKind::ResizeV,
            _ => CursorKind::Arrow,
        }
    }

    /// `REFERENCES`, by the measured shapes rather than by asking AppKit.
    fn reference_table() -> Vec<((f64, f64, f64), CursorKind)> {
        let named = |name: &str| {
            MEASURED
                .iter()
                .find(|(other, _)| *other == name)
                .unwrap_or_else(|| panic!("no measurement for {name}"))
                .1
        };

        let table: Vec<_> = [
            "pointingHand",
            "iBeam",
            "iBeamVertical",
            "resizeLeftRight",
            "resizeUpDown",
        ]
        .iter()
        .map(|name| (named(name), expected(name)))
        .collect();

        // Or this stops describing what the code actually does the first time a
        // cursor is added to one list and not the other.
        assert_eq!(
            table.len(),
            REFERENCES.len(),
            "the two reference lists disagree"
        );
        table
    }

    #[test]
    fn the_matcher_draws_each_system_cursor_as_the_right_pointer() {
        // Three numbers telling twelve cursors apart, and every way of getting
        // it wrong is silent: a tolerance too tight loses the I-beam, one too
        // loose turns an open hand into a resize arrow, and either way the
        // recording just looks like one where the user never did the thing.
        let table = reference_table();

        for (name, shape) in MEASURED {
            let drawn = table
                .iter()
                .find(|(reference, _)| matches(*shape, *reference))
                .map_or(CursorKind::Arrow, |(_, kind)| *kind);

            assert_eq!(
                drawn,
                expected(name),
                "{name} is drawn as the wrong pointer"
            );
        }
    }

    #[test]
    fn no_two_measured_cursors_of_different_kinds_look_alike() {
        // The failure the tolerance exists to avoid, stated directly: whichever
        // reference is listed first would win for both, and nothing anywhere
        // would say so.
        for (index, (name, shape)) in MEASURED.iter().enumerate() {
            for (other_name, other) in MEASURED.iter().skip(index + 1) {
                if expected(name) == expected(other_name) {
                    continue;
                }

                assert!(
                    !matches(*shape, *other),
                    "{name} and {other_name} are the same shape but drawn differently"
                );
            }
        }
    }

    #[test]
    fn the_live_reference_cursors_are_whole() {
        let references = references();

        // Empty is the honest answer here, and the reason the check above uses
        // constants: `NSCursor`'s class cursors hand back no image until a
        // process has finished launching as a GUI app, and a test binary never
        // does. The canary in `references` spots that and builds nothing, which
        // leaves every pointer an arrow — what this drew before any shape was
        // sampled at all. Run from inside the app, this is a real check.
        if references.is_empty() {
            return;
        }

        // With AppKit up, a short table is a kind that silently never appears.
        assert_eq!(
            references.len(),
            REFERENCES.len(),
            "NSCursor gave no shape for one of the reference cursors"
        );

        // And asking about the live one must not crash, whatever the pointer
        // happens to be doing while the tests run.
        refresh_pointer_shape();
    }

    #[test]
    fn the_sampler_sleeps_exactly_as_long_as_the_gate_demands() {
        // The two halves of one rate: `spawn_cursor` sleeps for the duration
        // and `sample` gates on the nanoseconds. A sleep a hair shorter than
        // the gate has every other tick rejected, and the track then comes back
        // at half the rate with nothing anywhere to say why.
        assert_eq!(SAMPLE_INTERVAL.as_nanos() as u64, SAMPLE_INTERVAL_NS);
    }

    #[test]
    fn starts_empty() {
        let mut track = CursorTrack::new(REGION);
        assert_eq!(track.len(), 0);
        assert_eq!(track.take_samples(), vec![]);
    }

    #[test]
    fn keeps_samples_in_order() {
        let mut track = CursorTrack::new(REGION);
        push(&mut track, 0, 10.0, 20.0);
        push(&mut track, SAMPLE_INTERVAL_NS, 30.0, 40.0);

        let samples = track.take_samples();
        assert_eq!(samples.len(), 2);
        assert!(samples[0].at < samples[1].at);
    }

    #[test]
    fn skips_a_frame_that_arrives_too_soon() {
        // The rate gate: at 60 fps every other frame is inside the interval,
        // and sampling both would double the manifest for no extra fidelity.
        let mut track = CursorTrack::new(REGION);
        push(&mut track, 1_000_000_000, 0.0, 0.0);

        track.sample(1_000_000_000 + SAMPLE_INTERVAL_NS / 2);

        assert_eq!(track.len(), 1);
    }

    #[test]
    fn a_still_pointer_of_the_same_shape_is_not_worth_a_sample() {
        // The whole point of the movement gate: a parked pointer would
        // otherwise write an identical entry thirty times a second.
        assert!(!worth_recording(
            Some((10.0, 20.0)),
            CursorKind::Arrow,
            10.2,
            20.3,
            CursorKind::Arrow
        ));
    }

    #[test]
    fn a_shape_change_is_worth_a_sample_from_a_pointer_that_did_not_move() {
        // A link scrolls up to meet a parked pointer and the system swaps to
        // the hand. Gating on movement alone holds the arrow until the mouse
        // next twitches, which is a pointer that changes shape a second late.
        assert!(worth_recording(
            Some((10.0, 20.0)),
            CursorKind::Arrow,
            10.0,
            20.0,
            CursorKind::Hand
        ));
        // And back the other way, or the hand would outstay the link.
        assert!(worth_recording(
            Some((10.0, 20.0)),
            CursorKind::Hand,
            10.0,
            20.0,
            CursorKind::Arrow
        ));
        // A field taking focus under a still pointer is the same event, and the
        // one the I-beam exists for.
        assert!(worth_recording(
            Some((10.0, 20.0)),
            CursorKind::Arrow,
            10.0,
            20.0,
            CursorKind::Text
        ));
    }

    #[test]
    fn the_first_reading_is_always_worth_a_sample() {
        assert!(worth_recording(
            None,
            CursorKind::Arrow,
            0.0,
            0.0,
            CursorKind::Arrow
        ));
    }

    #[test]
    fn a_region_with_no_area_records_nothing() {
        // Rather than dividing by zero and writing a track of infinities that
        // only fails once something tries to draw it.
        let mut track = CursorTrack::new(Region::default());
        track.sample(0);

        assert_eq!(track.len(), 0);
    }

    #[test]
    fn stores_a_position_as_a_fraction_of_the_region() {
        // The conversion the whole track exists to do. A display's origin is
        // not recorded anywhere downstream, so getting this wrong here cannot
        // be corrected later.
        let region = Region {
            x: 100.0,
            y: 200.0,
            width: 1000.0,
            height: 500.0,
        };

        let sample = normalise(region, 600.0, 450.0);
        assert_eq!(sample, (0.5, 0.5));
    }

    #[test]
    fn keeps_a_position_that_left_the_captured_area() {
        // Outside 0..1 rather than dropped: whatever draws the track
        // interpolates between neighbours, and a hole would be filled in with
        // a pointer sliding across a picture it was never on.
        let (x, _) = normalise(REGION, -50.0, 0.0);
        assert!(x < 0.0);
    }

    /// The arithmetic `sample` applies, without needing a real pointer.
    fn normalise(region: Region, x: f64, y: f64) -> (f64, f64) {
        (
            (x - region.x) / region.width,
            (y - region.y) / region.height,
        )
    }
}
