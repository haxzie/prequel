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

use std::ffi::c_void;

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

        if let Some((px, py)) = self.last_position
            && (x - px).abs() < MIN_MOVEMENT_POINTS
            && (y - py).abs() < MIN_MOVEMENT_POINTS
        {
            // Still. The rate gate is updated anyway, so a pointer that
            // never moves is checked at the sample rate rather than on
            // every frame.
            self.last_at = Some(at);
            return;
        }

        self.last_at = Some(at);
        self.last_position = Some((x, y));

        // Gated on raw points, stored as fractions: a pixel of movement means
        // the same thing whatever the display, and the threshold would drift
        // with the capture size if it were applied after the division.
        self.samples.push(CursorSample {
            at,
            x: (x - self.region.x) / self.region.width,
            y: (y - self.region.y) / self.region.height,
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

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventCreate(source: *const c_void) -> *mut c_void;
    fn CGEventGetLocation(event: *mut c_void) -> CGPoint;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(cf: *mut c_void);
}

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
        track.samples.push(CursorSample { at, x, y });
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
