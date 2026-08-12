//! Turning host timestamps into media timestamps.
//!
//! Three problems have to be solved together, and getting any of them wrong
//! produces a file that looks fine until you scrub it:
//!
//! 1. **A shared origin.** Screen, camera, microphone and system audio arrive on
//!    separate streams. They are only reassemblable later if every track is
//!    measured from the same `t0`, so the origin lives here, once, rather than
//!    per track.
//! 2. **Paused spans must vanish.** A 10 s recording paused for 30 s in the
//!    middle is a 10 s file, not a 40 s one with a freeze. Pauses are subtracted
//!    from every track's timeline.
//! 3. **Monotonicity.** ScreenCaptureKit does not guarantee non-decreasing
//!    timestamps, and `AVAssetWriter` rejects a sample that does not advance.
//!    Small regressions get nudged forward (imperceptible); large ones mean the
//!    sample is genuinely stale and get dropped.

use std::sync::{Arc, Mutex};

/// Nanoseconds on the host clock (`mach_absolute_time`, converted).
pub type HostTime = u64;

/// Nanoseconds from the start of the recording, with paused spans removed.
pub type MediaTime = u64;

/// A regression smaller than this is treated as jitter and nudged forward
/// rather than dropped. Roughly half a frame at 60 fps.
const JITTER_TOLERANCE_NS: u64 = 8_000_000;

/// How far a nudged sample is pushed past its predecessor.
const NUDGE_NS: u64 = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SampleDecision {
    /// Write the sample at this media time.
    Accept(MediaTime),
    /// Arrived while the recording was paused.
    DropPaused,
    /// Arrived before the recording started.
    DropBeforeStart,
    /// Timestamp went backwards further than jitter can explain.
    DropOutOfOrder,
}

impl SampleDecision {
    pub fn accepted(self) -> Option<MediaTime> {
        match self {
            Self::Accept(t) => Some(t),
            _ => None,
        }
    }
}

/// The recording-wide clock: one origin, shared by every track.
#[derive(Debug, Default)]
pub struct SessionClock {
    origin: Option<HostTime>,
    /// Total time spent paused, in nanoseconds.
    paused_total: u64,
    /// When the current pause began, if paused.
    pause_started: Option<HostTime>,
}

impl SessionClock {
    pub fn new() -> Self {
        Self::default()
    }

    /// Anchors the timeline. Called once, when the first sample of any track
    /// arrives, so `t0` is a real sample time rather than a wall-clock guess
    /// taken before the capture pipeline warmed up.
    pub fn start(&mut self, at: HostTime) {
        self.origin.get_or_insert(at);
    }

    pub fn origin(&self) -> Option<HostTime> {
        self.origin
    }

    pub fn is_paused(&self) -> bool {
        self.pause_started.is_some()
    }

    pub fn pause(&mut self, at: HostTime) {
        if self.pause_started.is_none() {
            self.pause_started = Some(at);
        }
    }

    pub fn resume(&mut self, at: HostTime) {
        if let Some(started) = self.pause_started.take() {
            self.paused_total += at.saturating_sub(started);
        }
    }

    /// Total paused time so far, including an in-progress pause as of `now`.
    pub fn paused_total(&self, now: HostTime) -> u64 {
        match self.pause_started {
            Some(started) => self.paused_total + now.saturating_sub(started),
            None => self.paused_total,
        }
    }

    /// Converts a host timestamp to media time, or explains why it can't.
    ///
    /// Does not enforce monotonicity — that is per-track, and lives in
    /// [`TrackTimeline`].
    pub fn media_time(&self, host: HostTime) -> Result<MediaTime, SampleDecision> {
        let Some(origin) = self.origin else {
            return Err(SampleDecision::DropBeforeStart);
        };
        if host < origin {
            return Err(SampleDecision::DropBeforeStart);
        }
        // A sample stamped during a pause belongs to no part of the output.
        if let Some(started) = self.pause_started
            && host >= started
        {
            return Err(SampleDecision::DropPaused);
        }
        Ok(host - origin - self.paused_total.min(host - origin))
    }
}

/// A [`SessionClock`] shared between capture pipelines.
///
/// Screen frames arrive on ScreenCaptureKit's dispatch queue and camera frames
/// on AVFoundation's — different queues, different threads, one recording. They
/// have to agree on the origin and on how much time has been spent paused, or
/// the tracks cannot be lined up afterwards, so there is exactly one clock and
/// every pipeline holds a handle to it.
///
/// Cloning shares the clock rather than copying it.
#[derive(Debug, Clone, Default)]
pub struct SharedClock(Arc<Mutex<SessionClock>>);

impl SharedClock {
    pub fn new() -> Self {
        Self::default()
    }

    /// Anchors the timeline at the first sample of the *primary* track.
    ///
    /// Only the screen calls this. Camera and audio deliberately do not: if a
    /// device that warms up faster were allowed to define `t0`, the screen
    /// track would start at a non-zero offset and every consumer would have to
    /// know to shift it. Samples arriving before the anchor are dropped, which
    /// costs a few frames of head that had nothing to line up against anyway.
    pub fn start(&self, at: HostTime) {
        self.with(|clock| clock.start(at));
    }

    pub fn origin(&self) -> Option<HostTime> {
        self.with(|clock| clock.origin())
    }

    pub fn is_paused(&self) -> bool {
        self.with(|clock| clock.is_paused())
    }

    pub fn pause(&self, at: HostTime) {
        self.with(|clock| clock.pause(at));
    }

    pub fn resume(&self, at: HostTime) {
        self.with(|clock| clock.resume(at));
    }

    pub fn paused_total(&self, now: HostTime) -> u64 {
        self.with(|clock| clock.paused_total(now))
    }

    pub fn media_time(&self, host: HostTime) -> Result<MediaTime, SampleDecision> {
        self.with(|clock| clock.media_time(host))
    }

    /// Runs `f` against the clock.
    ///
    /// A poisoned lock is recovered from rather than propagated: the clock is
    /// three integers with no invariant a panic could leave half-applied, and
    /// killing an in-progress recording over it would lose far more.
    fn with<T>(&self, f: impl FnOnce(&mut SessionClock) -> T) -> T {
        f(&mut self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()))
    }
}

/// Per-track monotonicity guard. One per output track.
#[derive(Debug, Default)]
pub struct TrackTimeline {
    last: Option<MediaTime>,
    /// Samples accepted, for diagnostics and tests.
    accepted: u64,
    nudged: u64,
    dropped: u64,
    paused: u64,
}

impl TrackTimeline {
    pub fn new() -> Self {
        Self::default()
    }

    /// Runs a host timestamp through the session clock and this track's
    /// monotonicity guard.
    pub fn accept(&mut self, clock: &SharedClock, host: HostTime) -> SampleDecision {
        let media = match clock.media_time(host) {
            Ok(media) => media,
            // A sample arriving mid-pause is discarded by design, so it is
            // counted apart from real drops — otherwise every paused recording
            // looks like it lost frames.
            Err(decision @ SampleDecision::DropPaused) => {
                self.paused += 1;
                return decision;
            }
            Err(decision) => {
                self.dropped += 1;
                return decision;
            }
        };

        let decision = match self.last {
            // Strictly increasing: the common case.
            Some(last) if media > last => SampleDecision::Accept(media),
            // Equal or slightly behind — jitter. Nudge past the previous
            // sample so the writer accepts it; a sub-frame shift is invisible,
            // whereas dropping the frame is not.
            Some(last) if last - media <= JITTER_TOLERANCE_NS => {
                self.nudged += 1;
                SampleDecision::Accept(last + NUDGE_NS)
            }
            // Far behind: genuinely reordered or stale.
            Some(_) => {
                self.dropped += 1;
                SampleDecision::DropOutOfOrder
            }
            None => SampleDecision::Accept(media),
        };

        if let SampleDecision::Accept(t) = decision {
            self.last = Some(t);
            self.accepted += 1;
        }
        decision
    }

    pub fn last(&self) -> Option<MediaTime> {
        self.last
    }

    pub fn stats(&self) -> TrackStats {
        TrackStats {
            accepted: self.accepted,
            nudged: self.nudged,
            dropped: self.dropped,
            paused: self.paused,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrackStats {
    pub accepted: u64,
    /// Timestamps nudged forward past a small regression.
    pub nudged: u64,
    /// Samples genuinely lost — stale or out of order.
    pub dropped: u64,
    /// Samples discarded because the recording was paused. Intended, not a
    /// fault.
    pub paused: u64,
}

#[cfg(test)]
// `1 * S` reads better next to `2 * S` and `30 * S` than a bare `S` does.
#[allow(clippy::identity_op)]
mod tests {
    use super::*;

    const MS: u64 = 1_000_000;
    const S: u64 = 1_000_000_000;

    fn started_at(t: HostTime) -> SharedClock {
        let clock = SharedClock::new();
        clock.start(t);
        clock
    }

    #[test]
    fn first_sample_defines_the_origin() {
        let clock = started_at(5 * S);
        assert_eq!(clock.media_time(5 * S), Ok(0));
        assert_eq!(clock.media_time(6 * S), Ok(S));
    }

    #[test]
    fn origin_is_only_set_once() {
        let clock = started_at(5 * S);
        clock.start(9 * S);
        assert_eq!(clock.origin(), Some(5 * S));
    }

    #[test]
    fn samples_before_the_origin_are_dropped() {
        let clock = started_at(5 * S);
        assert_eq!(
            clock.media_time(4 * S),
            Err(SampleDecision::DropBeforeStart)
        );
    }

    #[test]
    fn samples_are_dropped_before_the_clock_starts() {
        let clock = SharedClock::new();
        assert_eq!(clock.media_time(S), Err(SampleDecision::DropBeforeStart));
    }

    #[test]
    fn a_pause_is_removed_from_the_timeline() {
        let clock = started_at(0);
        assert_eq!(clock.media_time(1 * S), Ok(1 * S));

        clock.pause(1 * S);
        assert_eq!(clock.media_time(2 * S), Err(SampleDecision::DropPaused));

        clock.resume(31 * S); // paused for 30 s
        // Wall clock is 32 s in; media time must be 2 s.
        assert_eq!(clock.media_time(32 * S), Ok(2 * S));
    }

    #[test]
    fn repeated_pauses_accumulate() {
        let clock = started_at(0);
        clock.pause(1 * S);
        clock.resume(3 * S); // +2 s
        clock.pause(4 * S);
        clock.resume(9 * S); // +5 s
        // 12 s of wall clock, 7 s of it paused.
        assert_eq!(clock.media_time(12 * S), Ok(5 * S));
    }

    #[test]
    fn pausing_twice_without_resuming_is_idempotent() {
        let clock = started_at(0);
        clock.pause(1 * S);
        clock.pause(5 * S);
        clock.resume(6 * S);
        // The second pause must not restart the span: paused for 5 s, not 1 s.
        assert_eq!(clock.media_time(11 * S), Ok(6 * S));
    }

    #[test]
    fn resuming_without_pausing_is_a_no_op() {
        let clock = started_at(0);
        clock.resume(5 * S);
        assert_eq!(clock.media_time(5 * S), Ok(5 * S));
    }

    #[test]
    fn paused_total_includes_an_open_pause() {
        let clock = started_at(0);
        clock.pause(2 * S);
        assert_eq!(clock.paused_total(5 * S), 3 * S);
        clock.resume(5 * S);
        assert_eq!(clock.paused_total(9 * S), 3 * S);
    }

    #[test]
    fn increasing_timestamps_pass_straight_through() {
        let clock = started_at(0);
        let mut track = TrackTimeline::new();

        for i in 0..10u64 {
            assert_eq!(
                track.accept(&clock, i * 16 * MS),
                SampleDecision::Accept(i * 16 * MS)
            );
        }
        assert_eq!(track.stats().accepted, 10);
        assert_eq!(track.stats().nudged, 0);
    }

    #[test]
    fn small_regressions_are_nudged_not_dropped() {
        let clock = started_at(0);
        let mut track = TrackTimeline::new();

        track.accept(&clock, 100 * MS);
        // 2 ms behind — well inside jitter tolerance.
        let decision = track.accept(&clock, 98 * MS);

        assert_eq!(decision, SampleDecision::Accept(100 * MS + NUDGE_NS));
        assert_eq!(track.stats().nudged, 1);
        assert_eq!(track.stats().dropped, 0);
    }

    #[test]
    fn a_duplicate_timestamp_still_advances() {
        // AVAssetWriter rejects a sample that does not advance, so equal
        // timestamps must not be passed through unchanged.
        let clock = started_at(0);
        let mut track = TrackTimeline::new();

        track.accept(&clock, 100 * MS);
        let decision = track.accept(&clock, 100 * MS);

        assert!(matches!(decision, SampleDecision::Accept(t) if t > 100 * MS));
    }

    #[test]
    fn large_regressions_are_dropped_as_stale() {
        let clock = started_at(0);
        let mut track = TrackTimeline::new();

        track.accept(&clock, 500 * MS);
        let decision = track.accept(&clock, 100 * MS); // 400 ms behind

        assert_eq!(decision, SampleDecision::DropOutOfOrder);
        assert_eq!(track.stats().dropped, 1);
        assert_eq!(track.last(), Some(500 * MS));
    }

    #[test]
    fn nudging_never_lets_the_timeline_go_backwards() {
        // Adversarial: a long run of samples all landing on the same instant.
        // Every accepted timestamp must still strictly increase, because
        // AVAssetWriter drops the whole append otherwise.
        let clock = started_at(0);
        let mut track = TrackTimeline::new();
        let mut previous = 0;

        for _ in 0..1000 {
            if let SampleDecision::Accept(t) = track.accept(&clock, 100 * MS) {
                assert!(t > previous, "{t} must exceed {previous}");
                previous = t;
            }
        }

        assert_eq!(track.stats().accepted, 1000);
        assert!(track.last().unwrap() > 100 * MS);
    }

    #[test]
    fn tracks_share_the_origin_but_keep_independent_monotonicity() {
        let clock = started_at(1_000 * S);
        let mut video = TrackTimeline::new();
        let mut audio = TrackTimeline::new();

        // Audio arrives first in host time, video slightly later.
        assert_eq!(
            audio.accept(&clock, 1_000 * S + 5 * MS),
            SampleDecision::Accept(5 * MS)
        );
        assert_eq!(
            video.accept(&clock, 1_000 * S + 8 * MS),
            SampleDecision::Accept(8 * MS)
        );

        // Video going backwards must not disturb audio's timeline.
        video.accept(&clock, 1_000 * S + 1 * MS);
        assert_eq!(audio.last(), Some(5 * MS));
    }

    #[test]
    fn paused_samples_are_counted_apart_from_real_drops() {
        // A paused recording must not look like it lost frames.
        let clock = started_at(0);
        let mut track = TrackTimeline::new();

        track.accept(&clock, 1 * S);
        clock.pause(1 * S);
        for i in 2..10 {
            track.accept(&clock, i * S);
        }

        let stats = track.stats();
        assert_eq!(stats.paused, 8);
        assert_eq!(stats.dropped, 0, "paused samples are not lost frames");
    }

    #[test]
    fn cloning_the_clock_shares_it_rather_than_copying_it() {
        // The camera pipeline holds a clone while the screen pipeline holds the
        // original. If a clone were a copy, pausing from one would leave the
        // other still writing, and the tracks would drift apart by the length
        // of the pause.
        let screen = started_at(0);
        let camera = screen.clone();

        screen.pause(1 * S);
        assert!(camera.is_paused(), "the pause must be visible to both");
        assert_eq!(camera.media_time(2 * S), Err(SampleDecision::DropPaused));

        camera.resume(11 * S);
        assert!(!screen.is_paused());
        // 12 s of wall clock, 10 s of it paused, seen identically from both.
        assert_eq!(screen.media_time(12 * S), Ok(2 * S));
        assert_eq!(camera.media_time(12 * S), Ok(2 * S));
    }

    #[test]
    fn a_late_track_never_moves_the_origin() {
        // Only the screen anchors `t0`. A camera frame that arrives first must
        // be dropped rather than redefine the origin, because that would push
        // the screen track to a non-zero start.
        let clock = SharedClock::new();
        let mut camera = TrackTimeline::new();

        assert_eq!(
            camera.accept(&clock, 5 * S),
            SampleDecision::DropBeforeStart
        );
        assert_eq!(clock.origin(), None, "the camera must not anchor the clock");

        clock.start(6 * S);
        assert_eq!(
            camera.accept(&clock, 6 * S + 20 * MS),
            SampleDecision::Accept(20 * MS)
        );
    }

    #[test]
    fn a_track_recovers_after_a_pause() {
        let clock = started_at(0);
        let mut track = TrackTimeline::new();

        track.accept(&clock, 1 * S);
        clock.pause(1 * S);
        assert_eq!(track.accept(&clock, 2 * S), SampleDecision::DropPaused);
        clock.resume(11 * S);

        // 12 s wall clock, 10 s paused → 2 s of media, and still increasing.
        assert_eq!(track.accept(&clock, 12 * S), SampleDecision::Accept(2 * S));
    }
}
