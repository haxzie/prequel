//! How loud a track is, by ITU-R BS.1770-4.
//!
//! Not peak and not RMS. Loudness is what a listener would call "level", and
//! the two cheap measures disagree with it badly enough to be useless here: a
//! compressed voice and an uncompressed one can share a peak and be 8 dB apart
//! to the ear. Normalising on either leaves every recording at a different
//! apparent level, which is the thing this exists to stop.
//!
//! Pure arithmetic over `f32`, so none of it needs CoreAudio, a device or a
//! file — the tests below are sine waves and a silence.
//!
//! **The coefficients are the 48 kHz ones, and only those.** BS.1770 specifies
//! the K-weighting as a pair of biquads at 48 kHz and leaves the rate
//! conversion to the implementer; everything in this crate is resampled to
//! [`crate::SAMPLE_RATE`] on the way in, so there is one rate and no
//! conversion to get wrong.

/// The target a finished voice track is normalised to, in LUFS.
///
/// Apple Podcasts' number. −14 is the streaming one and −23 is broadcast; a
/// screen recording is listened to the way a podcast is, usually on a laptop
/// speaker, and −16 is loud enough to carry there without the compressor
/// having to work hard enough to hear.
pub const TARGET_LUFS: f64 = -16.0;

/// Block length, in seconds. BS.1770 §4: 400 ms.
const BLOCK_SECONDS: f64 = 0.400;

/// How far one block starts after the last, in seconds — 75 % overlap.
const STEP_SECONDS: f64 = 0.100;

/// The offset that turns mean square into LKFS. BS.1770 equation 2.
const OFFSET: f64 = -0.691;

/// Below this, a block is silence and is not part of the measurement.
///
/// Without it a take with a long quiet lead measures far below what anybody
/// would call its level, and normalising on that number makes the voice
/// deafening.
const ABSOLUTE_GATE: f64 = -70.0;

/// How far below the ungated mean a block may be and still count.
///
/// The second of the two gates, and the one that does the real work: it is
/// what stops the pauses between sentences from dragging the measurement down
/// towards the noise floor.
const RELATIVE_GATE: f64 = -10.0;

/// A two-pole section, as BS.1770 writes them: `b` over `a`, `a0` already 1.
#[derive(Debug, Clone, Copy)]
struct Section {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
}

/// Stage 1, the head model: a high shelf standing in for the way a head in
/// the sound field lifts the top end.
const SHELF: Section = Section {
    b0: 1.535_124_859_586_97,
    b1: -2.691_696_189_406_38,
    b2: 1.198_392_810_852_85,
    a1: -1.690_659_293_182_41,
    a2: 0.732_480_774_215_85,
};

/// Stage 2, "RLB": a high-pass that takes out the rumble the ear does not
/// hear as level.
const RLB: Section = Section {
    b0: 1.0,
    b1: -2.0,
    b2: 1.0,
    a1: -1.990_047_454_833_98,
    a2: 0.990_072_250_366_21,
};

/// One section's running state, in direct form I.
#[derive(Debug, Clone, Copy, Default)]
struct State {
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
}

impl State {
    fn step(&mut self, section: &Section, x: f64) -> f64 {
        let y = section.b0 * x + section.b1 * self.x1 + section.b2 * self.x2
            - section.a1 * self.y1
            - section.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}

/// Measures a track as it goes past, a chunk at a time.
///
/// Fed the same samples the writer is given, so what it measures is what the
/// file will hold. Holds one `f64` per 100 ms of audio — an hour is 36,000 of
/// them, which is why this can afford to keep every block rather than
/// approximating the gate.
#[derive(Debug)]
pub struct Meter {
    shelf: State,
    rlb: State,
    /// Frames in a block, and in the step between two blocks.
    block: usize,
    step: usize,
    /// The K-weighted squares of the frames since the last block boundary.
    ///
    /// A ring the length of one block: a block's mean square is the sum of the
    /// whole ring, and the oldest step's worth falls out as the newest comes
    /// in.
    window: Vec<f64>,
    filled: usize,
    at: usize,
    /// Mean square per block, in the order the blocks ended.
    blocks: Vec<f64>,
}

impl Meter {
    pub fn new(sample_rate: f64) -> Self {
        let block = (BLOCK_SECONDS * sample_rate).round() as usize;
        let step = (STEP_SECONDS * sample_rate).round() as usize;
        Self {
            shelf: State::default(),
            rlb: State::default(),
            block,
            step,
            window: vec![0.0; block],
            filled: 0,
            at: 0,
            blocks: Vec::new(),
        }
    }

    /// Adds samples to the measurement.
    pub fn push(&mut self, samples: &[f32]) {
        for sample in samples {
            let weighted = {
                let shelved = self.shelf.step(&SHELF, f64::from(*sample));
                self.rlb.step(&RLB, shelved)
            };

            self.window[self.at] = weighted * weighted;
            self.at = (self.at + 1) % self.block;
            self.filled = (self.filled + 1).min(self.block);

            // A block ends every `step` frames, but only once the window holds
            // a whole block — the first 300 ms of a track are not a 400 ms
            // block and measuring them as one reads the opening quieter than
            // it is.
            if self.filled == self.block && self.at.is_multiple_of(self.step) {
                let sum: f64 = self.window.iter().sum();
                self.blocks.push(sum / self.block as f64);
            }
        }
    }

    /// The integrated loudness of everything pushed so far, in LUFS.
    ///
    /// `None` when there is nothing to measure: a track shorter than one block,
    /// or one with no sound in it anywhere. The caller has to decide what to do
    /// about that rather than be handed an infinity to multiply by.
    pub fn integrated(&self) -> Option<f64> {
        if self.blocks.is_empty() {
            return None;
        }

        let loud = |mean_square: f64| {
            if mean_square <= 0.0 {
                f64::NEG_INFINITY
            } else {
                OFFSET + 10.0 * mean_square.log10()
            }
        };

        // First gate: drop the blocks that are silence on any reading.
        let above: Vec<f64> = self
            .blocks
            .iter()
            .copied()
            .filter(|ms| loud(*ms) > ABSOLUTE_GATE)
            .collect();
        if above.is_empty() {
            return None;
        }

        // Second gate: 10 LU below the mean of what survived the first.
        let mean = above.iter().sum::<f64>() / above.len() as f64;
        let threshold = loud(mean) + RELATIVE_GATE;

        let kept: Vec<f64> = above
            .into_iter()
            .filter(|ms| loud(*ms) > threshold)
            .collect();
        if kept.is_empty() {
            return None;
        }

        let mean = kept.iter().sum::<f64>() / kept.len() as f64;
        Some(loud(mean))
    }

    /// The gain that would put this track at `target`, as a multiplier.
    ///
    /// One number for the whole track rather than a moving one: a static gain
    /// cannot pump, cannot breathe, and cannot change the balance between a
    /// loud sentence and a quiet one — all of which a normaliser that followed
    /// the signal would do, and all of which are heard as the recording being
    /// processed.
    ///
    /// Clamped at both ends. A take recorded at −45 LUFS wants 29 dB, which
    /// would bring its noise floor up with it; the ceiling is what stops a
    /// quiet recording from becoming a loud hiss.
    pub fn gain_to(&self, target: f64) -> f32 {
        let Some(measured) = self.integrated() else {
            return 1.0;
        };
        let decibels = (target - measured).clamp(MIN_GAIN_DB, MAX_GAIN_DB);
        10f64.powf(decibels / 20.0) as f32
    }
}

/// The most a track is lifted, in decibels.
///
/// 18 dB is two and a half times further than a sensibly recorded take needs.
/// Past it the thing being made louder is the room, not the voice.
const MAX_GAIN_DB: f64 = 18.0;

/// The most a track is pulled down, in decibels.
const MIN_GAIN_DB: f64 = -18.0;

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f64 = 48_000.0;

    /// `seconds` of a sine at `hz`, peaking at `amplitude`.
    fn sine(hz: f64, amplitude: f32, seconds: f64) -> Vec<f32> {
        let frames = (seconds * RATE) as usize;
        (0..frames)
            .map(|i| {
                let t = i as f64 / RATE;
                amplitude * (t * hz * std::f64::consts::TAU).sin() as f32
            })
            .collect()
    }

    fn measure(samples: &[f32]) -> f64 {
        let mut meter = Meter::new(RATE);
        meter.push(samples);
        meter.integrated().expect("the signal is measurable")
    }

    /// The calibration, at the one frequency the K-weighting leaves alone.
    ///
    /// A full-scale sine has a mean square of 0.5, so by BS.1770 equation 2 it
    /// measures −0.691 + 10·log10(0.5) = −3.70 LUFS. Any deviation here is
    /// the filter arithmetic rather than the weighting doing its job.
    ///
    /// 500 Hz, and the choice matters: the pair is within 0.05 dB of unity
    /// there and nowhere else useful. The obvious pick of 100 Hz is 1.13 dB
    /// *down*, because the high-pass sits at 38 Hz with a Q of 0.5 and a
    /// second-order slope that gentle is still working two octaves up — so a
    /// correct meter reads −4.84 there and looks broken. 997 Hz, the other
    /// obvious pick, is 0.69 dB up: the head shelf has already started.
    #[test]
    fn a_full_scale_tone_measures_minus_three_point_seven() {
        let measured = measure(&sine(500.0, 1.0, 3.0));
        assert!(
            (measured - -3.70).abs() < 0.1,
            "a full-scale 500 Hz sine measured {measured:.2} LUFS, not −3.70"
        );
    }

    /// Twice the amplitude is 6.02 LU louder, exactly.
    ///
    /// The property the normaliser rests on: if this is not linear in
    /// decibels, the gain computed from a measurement does not land on the
    /// target.
    #[test]
    fn doubling_the_amplitude_adds_six_decibels() {
        let quiet = measure(&sine(1_000.0, 0.1, 3.0));
        let loud = measure(&sine(1_000.0, 0.2, 3.0));

        assert!(
            (loud - quiet - 6.02).abs() < 0.01,
            "doubling moved the measurement {:.3} LU, not 6.02",
            loud - quiet
        );
    }

    /// The K-weighting has to actually weight.
    ///
    /// Same amplitude, two frequencies: the shelf lifts the top, so the high
    /// tone has to measure louder. A meter whose filters were bypassed — a
    /// plausible way to break this file, since it would still pass the
    /// doubling test — measures them identically.
    #[test]
    fn the_top_end_counts_for_more_than_the_bottom() {
        let low = measure(&sine(100.0, 0.5, 3.0));
        let high = measure(&sine(8_000.0, 0.5, 3.0));

        assert!(
            high > low + 2.0,
            "8 kHz measured {high:.2} LUFS against 100 Hz at {low:.2} — the weighting is not \
             being applied"
        );
    }

    /// Silence either side of the voice must not drag the number down.
    ///
    /// This is what the gates are for, and the failure is loud: a take with a
    /// long lead measures far below its real level, so normalising it
    /// multiplies the voice up to meet a target it was already at.
    #[test]
    fn leading_and_trailing_silence_is_gated_out() {
        let mut track = vec![0.0f32; (RATE * 5.0) as usize];
        track.extend(sine(1_000.0, 0.5, 3.0));
        track.extend(std::iter::repeat_n(0.0f32, (RATE * 5.0) as usize));

        let with_silence = measure(&track);
        let without = measure(&sine(1_000.0, 0.5, 3.0));

        assert!(
            (with_silence - without).abs() < 0.5,
            "eleven seconds measured {with_silence:.2} LUFS where its three seconds of sound \
             measured {without:.2}"
        );
    }

    /// Nothing to measure is `None`, not an infinity.
    #[test]
    fn a_silent_track_cannot_be_measured() {
        let mut meter = Meter::new(RATE);
        meter.push(&vec![0.0; (RATE * 3.0) as usize]);

        assert_eq!(meter.integrated(), None);
        // And the gain it offers is the one that changes nothing, rather than
        // the infinity the arithmetic would otherwise produce.
        assert_eq!(meter.gain_to(TARGET_LUFS), 1.0);
    }

    /// A track shorter than one block has no blocks in it.
    #[test]
    fn a_track_shorter_than_a_block_cannot_be_measured() {
        let mut meter = Meter::new(RATE);
        meter.push(&sine(1_000.0, 0.5, 0.2));

        assert_eq!(meter.integrated(), None);
    }

    /// The gain has to put the track on the target.
    #[test]
    fn the_gain_lands_the_track_on_the_target() {
        let track = sine(1_000.0, 0.5, 3.0);
        let mut meter = Meter::new(RATE);
        meter.push(&track);

        let gain = meter.gain_to(TARGET_LUFS);
        let lifted: Vec<f32> = track.iter().map(|s| s * gain).collect();

        let now = measure(&lifted);
        assert!(
            (now - TARGET_LUFS).abs() < 0.1,
            "after the gain the track measured {now:.2} LUFS, not {TARGET_LUFS}"
        );
    }

    /// A recording too quiet to rescue is lifted as far as is sensible and no
    /// further.
    #[test]
    fn a_very_quiet_track_is_not_lifted_without_limit() {
        let mut meter = Meter::new(RATE);
        meter.push(&sine(1_000.0, 0.0005, 3.0));

        let gain = meter.gain_to(TARGET_LUFS);
        let ceiling = 10f64.powf(MAX_GAIN_DB / 20.0) as f32;

        assert!(
            (gain - ceiling).abs() < 0.001,
            "a −60 LUFS take asked for {gain}×, past the {ceiling}× ceiling"
        );
    }
}
