//! Mixing two audio tracks down to one.
//!
//! Mixed by hand rather than through `AVAudioMix`, for three reasons: the sum
//! is a plain per-source multiply, which is *exactly* what WebAudio's
//! `GainNode` does in the preview, so the two cannot diverge; per-slice gain
//! changes and cuts fall out naturally, where `AVAudioMix`'s per-asset-track
//! model would have to be fought; and plain arithmetic on `f32` is testable
//! with two synthetic ramps and no file at all.
//!
//! Pure, so none of this needs a display, a GPU or CoreAudio.

use prequel_session::MediaTime;

/// Interleaved stereo `f32`, which is what every stage here speaks.
pub const CHANNELS: usize = 2;

/// One source's contribution to the mix.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Gain(pub f32);

impl Gain {
    /// Silent, either by being muted or by being turned all the way down.
    pub fn is_silent(self) -> bool {
        self.0 <= 0.0
    }
}

/// Adds `source` into `into`, scaled.
///
/// Clipped at the end rather than normalised: two tracks at full volume can
/// exceed unity, and quietly rescaling the whole mix would change the balance
/// the user set while listening to the preview. Clipping is audible where a
/// silent rebalance is not.
pub fn mix_into(into: &mut [f32], source: &[f32], gain: Gain) {
    if gain.is_silent() {
        return;
    }

    for (target, sample) in into.iter_mut().zip(source) {
        *target += sample * gain.0;
    }
}

/// Clamps every sample into range.
///
/// Applied once, after all sources are summed — clamping each source first
/// would distort a track that is only loud because another is about to be
/// mixed under it.
pub fn clip(samples: &mut [f32]) {
    for sample in samples {
        *sample = sample.clamp(-1.0, 1.0);
    }
}

/// Frames of audio in a span of media time, at a sample rate.
pub fn frames_for(duration: MediaTime, sample_rate: f64) -> usize {
    ((duration as f64 / 1_000_000_000.0) * sample_rate).round() as usize
}

/// Samples covering `duration`, silent.
///
/// A slice whose audio is missing still occupies time in the output, so it is
/// filled with silence rather than skipped — otherwise every later slice would
/// slide earlier and the audio would drift out of step with the picture.
pub fn silence(duration: MediaTime, sample_rate: f64) -> Vec<f32> {
    vec![0.0; frames_for(duration, sample_rate) * CHANNELS]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A ramp from 0 to 1 over `frames`, in both channels.
    fn ramp(frames: usize) -> Vec<f32> {
        (0..frames)
            .flat_map(|i| {
                let value = i as f32 / frames as f32;
                [value, value]
            })
            .collect()
    }

    #[test]
    fn a_gain_of_one_passes_the_signal_through() {
        let source = ramp(4);
        let mut mixed = vec![0.0; source.len()];

        mix_into(&mut mixed, &source, Gain(1.0));

        assert_eq!(mixed, source);
    }

    #[test]
    fn halving_the_gain_halves_every_sample() {
        // The same arithmetic WebAudio does, which is why the preview and the
        // export sound the same.
        let source = ramp(4);
        let mut mixed = vec![0.0; source.len()];

        mix_into(&mut mixed, &source, Gain(0.5));

        for (mixed, original) in mixed.iter().zip(&source) {
            assert!((mixed - original * 0.5).abs() < f32::EPSILON);
        }
    }

    #[test]
    fn a_silent_source_contributes_nothing() {
        let mut mixed = vec![0.25; 8];

        mix_into(&mut mixed, &ramp(4), Gain(0.0));

        assert_eq!(mixed, vec![0.25; 8]);
    }

    #[test]
    fn sums_two_sources() {
        let mut mixed = vec![0.0; 8];

        mix_into(&mut mixed, &[0.25; 8], Gain(1.0));
        mix_into(&mut mixed, &[0.25; 8], Gain(1.0));

        assert_eq!(mixed, vec![0.5; 8]);
    }

    #[test]
    fn stops_at_the_shorter_of_the_two() {
        // A track that ended early — an unplugged microphone — must not run off
        // the end of the buffer being mixed into.
        let mut mixed = vec![0.0; 4];

        mix_into(&mut mixed, &[1.0; 16], Gain(1.0));

        assert_eq!(mixed.len(), 4);
        assert_eq!(mixed, vec![1.0; 4]);
    }

    #[test]
    fn clips_rather_than_rescaling() {
        // Rescaling would change the balance the user set while listening to
        // the preview; clipping is at least audible.
        let mut mixed = vec![1.5, -1.5, 0.5];

        clip(&mut mixed);

        assert_eq!(mixed, vec![1.0, -1.0, 0.5]);
    }

    #[test]
    fn clips_only_after_everything_is_summed() {
        let mut mixed = vec![0.0; 4];

        mix_into(&mut mixed, &[0.8; 4], Gain(1.0));
        mix_into(&mut mixed, &[0.8; 4], Gain(1.0));
        clip(&mut mixed);

        assert_eq!(mixed, vec![1.0; 4]);
    }

    #[test]
    fn counts_frames_for_a_span() {
        assert_eq!(frames_for(1_000_000_000, 48_000.0), 48_000);
        assert_eq!(frames_for(500_000_000, 48_000.0), 24_000);
        assert_eq!(frames_for(0, 48_000.0), 0);
    }

    #[test]
    fn silence_still_occupies_its_time() {
        // A slice whose audio is missing has to hold its place, or every later
        // slice slides earlier and the sound drifts off the picture.
        let quiet = silence(1_000_000_000, 48_000.0);

        assert_eq!(quiet.len(), 48_000 * CHANNELS);
        assert!(quiet.iter().all(|&sample| sample == 0.0));
    }
}
