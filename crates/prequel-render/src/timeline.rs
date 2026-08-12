//! Output frames back to source times.
//!
//! The export loop is driven by the *output* frame index, not by the input
//! frames. For frame `i` it asks "what moment of the recording belongs here?"
//! and pulls each reader forward to it.
//!
//! That is what makes the awkward cases fall out for free: the 60 fps screen
//! against the 30 fps camera, frames dropped during capture, a camera that
//! opened late, and cuts. It also guarantees constant frame rate output, which
//! is what the preview assumes it is watching. Driving from the input instead
//! would need a resampler per source and would still get cuts wrong.
//!
//! Pure arithmetic, so it is testable without a GPU or a file.

use prequel_session::MediaTime;

use crate::plan::RenderPlan;

const NS_PER_SECOND: u64 = 1_000_000_000;

/// One kept span of the recording, and how it should look and sound.
#[derive(Debug, Clone)]
pub struct SliceRender {
    /// Half-open range of source time: `start` is included, `end` is not.
    pub start: MediaTime,
    pub end: MediaTime,
    pub plan: RenderPlan,
    pub audio: AudioMix,
}

/// Per-source gain, applied as a plain multiply.
///
/// Deliberately the same arithmetic WebAudio does in the preview, which is why
/// the exporter mixes raw samples by hand rather than handing the job to
/// `AVAudioMix` — the two would then be different code doing the same sum.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AudioMix {
    pub mic: f32,
    pub system: f32,
}

impl SliceRender {
    pub fn duration(&self) -> MediaTime {
        self.end.saturating_sub(self.start)
    }
}

/// Where each output frame lands in the source recording.
#[derive(Debug)]
pub struct Timeline {
    /// Project-time start of each slice, parallel to the slices themselves.
    starts: Vec<MediaTime>,
    duration: MediaTime,
    fps: u32,
}

impl Timeline {
    pub fn new(slices: &[SliceRender], fps: u32) -> Self {
        let mut starts = Vec::with_capacity(slices.len());
        let mut at = 0;

        for slice in slices {
            starts.push(at);
            at += slice.duration();
        }

        Self {
            starts,
            duration: at,
            fps: fps.max(1),
        }
    }

    /// Total length of the edit.
    pub fn duration(&self) -> MediaTime {
        self.duration
    }

    /// How many frames the export will contain.
    ///
    /// Rounded rather than truncated, so a ten-second edit at 60 fps is 600
    /// frames instead of 599 — the last frame is otherwise dropped whenever the
    /// duration is a hair under a whole frame.
    pub fn frame_count(&self) -> u64 {
        let frames = (self.duration as f64 / NS_PER_SECOND as f64) * self.fps as f64;
        frames.round() as u64
    }

    /// Project time of one output frame.
    pub fn frame_time(&self, index: u64) -> MediaTime {
        index * NS_PER_SECOND / self.fps as u64
    }

    /// Nanoseconds each output frame occupies.
    pub fn frame_duration(&self) -> MediaTime {
        NS_PER_SECOND / self.fps as u64
    }

    /// Which slice an output frame belongs to, and where in the source it lands.
    ///
    /// Slices are half-open, so a frame exactly on a boundary belongs to the
    /// later slice — which is what makes a cut land on a frame rather than
    /// between two. Returns None past the end of the edit.
    pub fn locate(&self, index: u64, slices: &[SliceRender]) -> Option<(usize, MediaTime)> {
        let at = self.frame_time(index);
        if at >= self.duration && self.duration > 0 {
            return None;
        }

        let slot = self
            .starts
            .iter()
            .rposition(|&start| at >= start)
            .filter(|&slot| slot < slices.len())?;

        let into = at - self.starts[slot];
        let slice = &slices[slot];

        // Clamped: rounding at the frame boundary can otherwise ask for a
        // moment a hair past the end of the slice, which reads as a frame from
        // the wrong side of a cut.
        let source = (slice.start + into).min(slice.end.saturating_sub(1));
        Some((slot, source))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plan::{RenderPlan, Size};

    const S: MediaTime = 1_000_000_000;

    fn slice(start: MediaTime, end: MediaTime) -> SliceRender {
        SliceRender {
            start,
            end,
            plan: RenderPlan {
                frame: Size {
                    width: 1920.0,
                    height: 1080.0,
                },
                items: vec![],
            },
            audio: AudioMix {
                mic: 1.0,
                system: 1.0,
            },
        }
    }

    #[test]
    fn counts_the_frames_an_edit_produces() {
        let slices = [slice(0, 10 * S)];
        let timeline = Timeline::new(&slices, 60);

        assert_eq!(timeline.duration(), 10 * S);
        assert_eq!(timeline.frame_count(), 600);
    }

    #[test]
    fn reports_the_edited_length_rather_than_the_recorded_one() {
        // 0–2s and 4–10s kept: eight seconds of output from a ten-second take.
        let slices = [slice(0, 2 * S), slice(4 * S, 10 * S)];
        let timeline = Timeline::new(&slices, 30);

        assert_eq!(timeline.duration(), 8 * S);
        assert_eq!(timeline.frame_count(), 240);
    }

    #[test]
    fn maps_a_frame_straight_through_when_nothing_was_cut() {
        let slices = [slice(0, 10 * S)];
        let timeline = Timeline::new(&slices, 60);

        let (slot, source) = timeline.locate(60, &slices).unwrap();
        assert_eq!(slot, 0);
        assert_eq!(source, S);
    }

    #[test]
    fn skips_the_removed_span() {
        // The load-bearing case: the frame after the cut must come from 4s of
        // source, not from 2s.
        let slices = [slice(0, 2 * S), slice(4 * S, 10 * S)];
        let timeline = Timeline::new(&slices, 30);

        // 1s of output is still 1s of source.
        assert_eq!(timeline.locate(30, &slices).unwrap(), (0, S));
        // 2s of output is 4s of source, in the second slice.
        assert_eq!(timeline.locate(60, &slices).unwrap(), (1, 4 * S));
        // 3s of output is 5s of source.
        assert_eq!(timeline.locate(90, &slices).unwrap(), (1, 5 * S));
    }

    #[test]
    fn gives_a_boundary_frame_to_the_later_slice() {
        // Half-open ranges are what make a cut land on a frame rather than
        // between two.
        let slices = [slice(0, 2 * S), slice(4 * S, 10 * S)];
        let timeline = Timeline::new(&slices, 30);

        assert_eq!(timeline.locate(60, &slices).unwrap().0, 1);
        assert_eq!(timeline.locate(59, &slices).unwrap().0, 0);
    }

    #[test]
    fn never_asks_for_a_moment_past_the_end_of_a_slice() {
        // Rounding at the boundary would otherwise pull a frame from the wrong
        // side of a cut.
        let slices = [slice(0, 2 * S), slice(4 * S, 10 * S)];
        let timeline = Timeline::new(&slices, 30);

        for index in 0..timeline.frame_count() {
            let (slot, source) = timeline.locate(index, &slices).unwrap();
            assert!(source >= slices[slot].start);
            assert!(
                source < slices[slot].end,
                "frame {index} ran past its slice"
            );
        }
    }

    #[test]
    fn stops_at_the_end_of_the_edit() {
        let slices = [slice(0, S)];
        let timeline = Timeline::new(&slices, 30);

        assert!(timeline.locate(29, &slices).is_some());
        assert!(timeline.locate(30, &slices).is_none());
        assert!(timeline.locate(999, &slices).is_none());
    }

    #[test]
    fn survives_an_edit_with_no_slices() {
        let timeline = Timeline::new(&[], 60);

        assert_eq!(timeline.frame_count(), 0);
        assert!(timeline.locate(0, &[]).is_none());
    }

    #[test]
    fn frame_duration_matches_the_rate() {
        assert_eq!(Timeline::new(&[], 60).frame_duration(), S / 60);
        assert_eq!(Timeline::new(&[], 30).frame_duration(), S / 30);
        // A zero rate would divide by zero; clamped to one instead.
        assert_eq!(Timeline::new(&[], 0).frame_duration(), S);
    }
}
