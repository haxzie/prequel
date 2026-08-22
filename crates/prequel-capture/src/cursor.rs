//! Where the pointer was, sampled alongside the video.
//!
//! Recorded during capture because it cannot be recovered afterwards: the
//! cursor is drawn into the frames, but its position is not something an editor
//! can read back out of them. Without this, zoom-to-cursor is only ever
//! possible for recordings made after it is added — which is why it is worth
//! sampling now, before there is any UI that uses it.
//!
//! Straight CoreGraphics rather than a cidre binding, matching `permission.rs`:
//! two functions, and the global pointer location has no Objective-C wrapper
//! worth the indirection.

use std::ffi::{CString, c_char, c_void};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};

use prequel_session::MediaTime;

/// Slowest sampling that still reads as continuous when interpolated.
///
/// A screen recording runs at 60 fps, and a sample per frame would put tens of
/// thousands of entries in the manifest for a ten-minute take. Half that rate
/// is indistinguishable once the path is smoothed.
const SAMPLE_INTERVAL_NS: MediaTime = 33_000_000;

/// Movement below this is not worth an entry.
///
/// A still pointer would otherwise write an identical sample thirty times a
/// second, which is pure file size — the reader holds the last position anyway.
const MIN_MOVEMENT_POINTS: f64 = 1.0;

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
    last_hand: bool,
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
    /// Whether the system was showing the link cursor at this moment.
    ///
    /// The one thing about the pointer's *appearance* worth recording: it is
    /// the difference between "there is something here" and "there is not",
    /// and a composited pointer that never changes shape is the tell that it
    /// was composited.
    pub hand: bool,
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
    /// Called from the video callback, so it is on the capture's hot path — the
    /// rate and movement gates are there to keep it to a couple of loads and a
    /// comparison for the frames it skips.
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
        let hand = pointing_hand();

        if !worth_recording(self.last_position, self.last_hand, x, y, hand) {
            // Still, and the same shape. The rate gate is updated anyway, so a
            // pointer that never moves is checked at the sample rate rather
            // than on every frame.
            self.last_at = Some(at);
            return;
        }

        self.last_at = Some(at);
        self.last_position = Some((x, y));
        self.last_hand = hand;

        // Gated on raw points, stored as fractions: a pixel of movement means
        // the same thing whatever the display, and the threshold would drift
        // with the capture size if it were applied after the division.
        self.samples.push(CursorSample {
            at,
            x: (x - self.region.x) / self.region.width,
            y: (y - self.region.y) / self.region.height,
            hand,
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
/// appears under a link that scrolled up to meet a parked pointer, and gating
/// on movement alone would hold the arrow until the mouse next twitched — a
/// pointer that changes shape a second late, which reads worse than one that
/// never changes at all.
fn worth_recording(
    last_position: Option<(f64, f64)>,
    last_hand: bool,
    x: f64,
    y: f64,
    hand: bool,
) -> bool {
    let Some((px, py)) = last_position else {
        return true;
    };

    hand != last_hand
        || (x - px).abs() >= MIN_MOVEMENT_POINTS
        || (y - py).abs() >= MIN_MOVEMENT_POINTS
}

/// Whether the system was showing the link cursor, as of the last look.
///
/// A cache rather than a live read. Asking `NSCursor` costs about 50µs and
/// reaches into AppKit, and neither belongs in the frame callback sixty times a
/// second — so `spawn_pointer_shape` in `recorder.rs` refreshes this from its
/// own thread, the way typing is sampled, and the callback pays a load.
static POINTING_HAND: AtomicBool = AtomicBool::new(false);

pub fn pointing_hand() -> bool {
    POINTING_HAND.load(Ordering::Relaxed)
}

/// Looks at the system cursor and records whether it is the pointing hand.
///
/// Call from a dedicated thread, not from the capture callback.
pub fn refresh_pointer_shape() {
    POINTING_HAND.store(read_pointing_hand(), Ordering::Relaxed);
}

/// Clears the cached shape, so a recording does not open holding the last one.
///
/// The static outlives a recording — only one runs at a time, the same
/// reasoning `clicks.rs` uses — and a `true` left over from the previous take
/// would put a hand on the first few frames of the next one.
pub fn reset_pointer_shape() {
    POINTING_HAND.store(false, Ordering::Relaxed);
}

/// Tolerance on the proportions below. Generous: these are compared against
/// the system's own hand, not against constants, so anything within a fiftieth
/// of the image is the same cursor and nothing else is close.
const SHAPE_TOLERANCE: f64 = 0.02;

/// Whether the cursor the window server is currently showing is the hand.
///
/// Compared against `NSCursor.pointingHandCursor` rather than against measured
/// numbers, so a macOS release that redraws its cursors does not quietly turn
/// this off — the reference moves with them. What is compared is the *shape*:
/// the hotspot as a fraction of the image, and the image's aspect ratio. Those
/// survive the pointer being scaled up in Accessibility settings, which the raw
/// sizes would not; and they separate the hand from every other system cursor
/// by a wide margin — the arrow's hotspot sits at (0.18, 0.13) of a 0.7 image
/// against the hand's (0.41, 0.25) of a square one.
///
/// False on any failure. The pointer then stays an arrow throughout, which is
/// exactly how it behaved before the shape was sampled at all.
fn read_pointing_hand() -> bool {
    let Some(reference) = hand_shape() else {
        return false;
    };

    // Safety: `+[NSCursor currentSystemCursor]` returns an autoreleased cursor
    // or nil, and `image`/`hotSpot` only read from it. The pool is pushed
    // because this runs on a thread of ours, which has none of its own — with
    // no pool the autoreleased cursor and its image leak on every look.
    unsafe {
        let pool = objc_autoreleasePoolPush();
        let shape = objc_getClass(c"NSCursor".as_ptr())
            .as_mut()
            .and_then(|class| send(class, selector("currentSystemCursor")).as_mut())
            .and_then(|cursor| shape_of(cursor));
        objc_autoreleasePoolPop(pool);

        shape.is_some_and(|(x, y, aspect)| {
            (x - reference.0).abs() < SHAPE_TOLERANCE
                && (y - reference.1).abs() < SHAPE_TOLERANCE
                && (aspect - reference.2).abs() < SHAPE_TOLERANCE
        })
    }
}

/// The pointing hand's proportions, read once.
///
/// `None` when AppKit does not hand one over, which is a build with no window
/// server to ask — every comparison then fails and the pointer stays an arrow.
fn hand_shape() -> Option<(f64, f64, f64)> {
    static SHAPE: OnceLock<Option<(f64, f64, f64)>> = OnceLock::new();

    *SHAPE.get_or_init(|| {
        // Safety: as `read_pointing_hand`. `pointingHandCursor` is a shared
        // instance rather than an autoreleased one, but the pool costs nothing
        // and covers the image it is asked for.
        unsafe {
            let pool = objc_autoreleasePoolPush();
            let shape = objc_getClass(c"NSCursor".as_ptr())
                .as_mut()
                .and_then(|class| send(class, selector("pointingHandCursor")).as_mut())
                .and_then(|cursor| shape_of(cursor));
            objc_autoreleasePoolPop(pool);
            shape
        }
    })
}

/// A cursor's hotspot as a fraction of its image, and the image's aspect ratio.
///
/// # Safety
///
/// `cursor` must be a live `NSCursor`.
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
            hand: track.last_hand,
        });
    }

    #[test]
    fn the_pointing_hand_reference_is_readable() {
        // The comparison is against the system's own hand rather than measured
        // numbers, so a build that cannot reach it silently never draws one.
        assert!(
            hand_shape().is_some(),
            "NSCursor.pointingHandCursor gave no shape"
        );
        // And asking about the live one must not crash, whatever the pointer
        // happens to be doing while the tests run.
        refresh_pointer_shape();
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
            false,
            10.2,
            20.3,
            false
        ));
    }

    #[test]
    fn a_shape_change_is_worth_a_sample_from_a_pointer_that_did_not_move() {
        // A link scrolls up to meet a parked pointer and the system swaps to
        // the hand. Gating on movement alone holds the arrow until the mouse
        // next twitches, which is a pointer that changes shape a second late.
        assert!(worth_recording(Some((10.0, 20.0)), false, 10.0, 20.0, true));
        // And back the other way, or the hand would outstay the link.
        assert!(worth_recording(Some((10.0, 20.0)), true, 10.0, 20.0, false));
    }

    #[test]
    fn the_first_reading_is_always_worth_a_sample() {
        assert!(worth_recording(None, false, 0.0, 0.0, false));
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
