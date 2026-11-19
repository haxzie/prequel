//! Turning a clean voice into a finished one.
//!
//! [`crate::Isolation`] takes the room away. That is not the same as making a
//! recording sound studio-made, and the difference is the whole of this file:
//! a denoised built-in microphone is a *quiet* built-in microphone, still
//! boxy at 300 Hz, still dull above 8 kHz, still eight decibels louder on a
//! stressed word than a trailing one.
//!
//! Four things in order, each a thing a person would do to a voice track:
//!
//! 1. the rumble comes off,
//! 2. the tone is corrected — the mud cut, the presence and air lifted,
//! 3. the sibilance the air lift just made worse is pulled back
//!    ([`crate::deess`], the one stage macOS has no unit for),
//! 4. the level is evened out.
//!
//! The loudness is not here. It is one static gain over the whole track, so it
//! belongs to whoever has measured the track — see [`crate::loudness`].
//!
//! **All of it is Apple's, and already on the machine.** `AUNBandEQ`,
//! `AUDynamicsProcessor` and `AUPeakLimiter` ship with macOS next to the
//! isolation unit. Nothing is bundled, nothing is downloaded, nothing is
//! signed, no audio leaves the machine, and the licence question that comes
//! with a neural model does not arise.
//!
//! The numbers below are a voice-shaping preset and nothing cleverer. They are
//! written down once here rather than exposed, because a control for each
//! would be eleven controls to arrive at a choice nobody wants to make.

use cidre::at::au;

use crate::Result;
use crate::deess::DeEsser;
use crate::unit::Effect;

/// How many bands the EQ is told to allocate.
///
/// A property, not a parameter, so it is set before `initialize` — asking band
/// 3 for a frequency on a unit that allocated one band is a parameter error,
/// and the EQ then runs with the one band it has while the other three are
/// silently nothing.
const BANDS: u32 = 4;

/// `kAUNBandEQProperty_NumberOfBands`. Not in cidre 0.20.
const NUMBER_OF_BANDS: au::PropId = au::PropId(2200);

/// The `AUNBandEQ` parameter blocks, each one `base + band`. Not in cidre
/// 0.20 either, and they are plain integers rather than anything derived.
const BYPASS_BAND: u32 = 1000;
const FILTER_TYPE: u32 = 2000;
const FREQUENCY: u32 = 3000;
const GAIN: u32 = 4000;
const BANDWIDTH: u32 = 5000;

/// The `AUNBandEQFilterType` values this file uses.
const PARAMETRIC: f32 = 0.0;
const BUTTERWORTH_HIGH_PASS: f32 = 2.0;
const HIGH_SHELF: f32 = 8.0;

/// One band of the corrective EQ.
struct Band {
    kind: f32,
    hz: f32,
    /// Decibels. Ignored by the high-pass, which only has a corner.
    gain: f32,
    /// Octaves, 0.05 to 5.0. Ignored by the high-pass and the shelf.
    width: f32,
}

/// What the EQ does to a voice, in order of frequency.
///
/// Three corrections and a cut, and each one is a complaint somebody has about
/// laptop-microphone audio rather than a number from a book.
const SHAPE: [Band; BANDS as usize] = [
    // Desk rumble, the fan, a knock on the table, and the handling noise of a
    // laptop being typed on while it records. None of it is the voice and all
    // of it eats the compressor's headroom.
    Band {
        kind: BUTTERWORTH_HIGH_PASS,
        hz: 80.0,
        gain: 0.0,
        width: 0.0,
    },
    // The boxiness. Every small capsule in a hard room piles up here, and it
    // is what "recorded in a bedroom" actually sounds like.
    Band {
        kind: PARAMETRIC,
        hz: 300.0,
        gain: -3.0,
        width: 1.0,
    },
    // Presence: where a consonant becomes a word. Lifted gently and wide,
    // because this is the band that turns harsh the moment it is overdone.
    Band {
        kind: PARAMETRIC,
        hz: 2_800.0,
        gain: 2.5,
        width: 1.2,
    },
    // Air. The single change that reads as expensive — and the one that makes
    // the de-esser necessary, because it lifts every "s" by the same 3 dB.
    Band {
        kind: HIGH_SHELF,
        hz: 9_000.0,
        gain: 3.0,
        width: 0.0,
    },
];

/// Where the compressor starts working, in decibels full scale.
const THRESHOLD_DB: f32 = -22.0;

/// How much the compressor is allowed to take, in decibels.
///
/// `AUDynamicsProcessor` has **no ratio parameter** — the surprise in its API.
/// Head room is the whole control: the unit works out a ratio that keeps the
/// output under threshold + head room, so a smaller number here is a harder
/// compression. 5 dB over a −22 dB threshold is about 3:1 on speech, which is
/// a voice evened out rather than a voice squashed.
const HEAD_ROOM_DB: f32 = 5.0;

/// Fast enough to catch a stressed syllable, slow enough to let the attack of
/// a word through — which is what keeps a compressed voice sounding spoken.
const ATTACK_SECONDS: f32 = 0.003;

/// And back off within a syllable or two, so the gain is not still moving when
/// the next word starts.
const RELEASE_SECONDS: f32 = 0.080;

/// What the compressor gives back, in decibels.
///
/// Enough to put the track back roughly where it started, so the loudness
/// measurement that follows has a sensible signal to work on rather than one
/// 10 dB down. The exact number does not matter: the normaliser measures
/// whatever comes out of here and corrects for it.
const MAKE_UP_DB: f32 = 8.0;

/// The tone and dynamics stages, run over a track a chunk at a time.
///
/// Deliberately **not** holding the limiter. The limiter's job is to catch
/// what the loudness gain pushes over, and that gain is applied after this —
/// so a limiter in here would be limiting a signal that is about to be made
/// louder, which is no limiting at all.
pub struct Studio {
    eq: Effect,
    deesser: DeEsser,
    compressor: Effect,
}

impl Studio {
    pub fn open(sample_rate: f64) -> Result<Self> {
        let eq = Effect::open(
            au::SubType::N_BAND_EQ,
            sample_rate,
            |unit| {
                unit.unit_mut()
                    .set_prop(NUMBER_OF_BANDS, au::Scope::GLOBAL, au::Element(0), &BANDS)
                    .map_err(crate::Error::unit)
            },
            |effect| {
                for (index, band) in SHAPE.iter().enumerate() {
                    let at = index as u32;
                    effect.set(au::ParamId(BYPASS_BAND + at), 0.0)?;
                    effect.set(au::ParamId(FILTER_TYPE + at), band.kind)?;
                    effect.set(au::ParamId(FREQUENCY + at), band.hz)?;
                    effect.set(au::ParamId(GAIN + at), band.gain)?;
                    // The high-pass and the shelf have no bandwidth, and the
                    // unit answers -10878 for one rather than ignoring it.
                    // Not a failure worth stopping for: the band is still
                    // configured, so the refusal is dropped on purpose.
                    if band.width > 0.0 {
                        let _ = effect.set(au::ParamId(BANDWIDTH + at), band.width);
                    }
                }
                Ok(())
            },
        )?;

        let compressor = Effect::open(
            au::SubType::DYNAMICS_PROCESSOR,
            sample_rate,
            |_| Ok(()),
            |effect| {
                effect.set(au::ParamId::DYNAMICS_PROCESSOR_THRESHOLD, THRESHOLD_DB)?;
                effect.set(au::ParamId::DYNAMICS_PROCESSOR_HEAD_ROOM, HEAD_ROOM_DB)?;
                effect.set(au::ParamId::DYNAMICS_PROCESSOR_ATTACK_TIME, ATTACK_SECONDS)?;
                effect.set(
                    au::ParamId::DYNAMICS_PROCESSOR_RELEASE_TIME,
                    RELEASE_SECONDS,
                )?;
                effect.set(au::ParamId::DYNAMICS_PROCESSOR_OVERALL_GAIN, MAKE_UP_DB)?;
                // The expander half of the unit, off. It is a gate by another
                // name, and the isolation pass has already taken the noise
                // floor down 52 dB — a gate after that has nothing to close
                // on but the quiet end of the voice. A ratio of 1 is no
                // expansion.
                effect.set(au::ParamId::DYNAMICS_PROCESSOR_EXPANSION_RATIO, 1.0)
            },
        )?;

        Ok(Self {
            eq,
            deesser: DeEsser::new(sample_rate),
            compressor,
        })
    }

    /// Frames of lookahead the stages add between them.
    pub fn latency(&self) -> u64 {
        // The de-esser has none: it is a biquad pair and a follower, all
        // causal, so a sample out depends only on samples already in.
        self.eq.latency() + self.compressor.latency()
    }

    /// Runs one chunk through all three stages, in place.
    pub fn process(&mut self, samples: &mut [f32]) -> Result<()> {
        self.eq.process(samples)?;
        self.deesser.process(samples);
        self.compressor.process(samples)
    }

    /// The hardest the de-esser pulled, in decibels — for the log.
    pub fn hardest_deess_db(&self) -> f32 {
        self.deesser.hardest_db()
    }
}

/// How quickly the limiter clamps down, in seconds. As fast as it will go.
const LIMITER_ATTACK_SECONDS: f32 = 0.001;

/// And releases. Short enough to be inaudible on speech, long enough not to
/// distort the low end.
const LIMITER_DECAY_SECONDS: f32 = 0.050;

/// Where no sample may go, in decibels full scale.
///
/// Not 0, for the reason the broadcast convention is not 0 either: a lossy
/// encoder downstream can reconstruct a sample slightly above the one it was
/// given, so a track that peaks at exactly full scale clips after it is
/// encoded rather than before. A decibel of headroom absorbs that.
///
/// **A sample peak, not a true peak.** The two are not the same number and it
/// is worth not confusing them: the waveform between two samples can rise
/// above both of them, so a track clamped here still measures a little hotter
/// on a true-peak meter — −0.8 dBTP against this −1.0 dBFS, on the speech
/// this was checked against. Measuring the true peak properly means
/// oversampling four times, and the point of this ceiling is headroom rather
/// than a number to put in a specification.
pub const CEILING_DB: f32 = -1.0;

/// The last stage: catching whatever the loudness gain pushed too far.
///
/// `AUPeakLimiter`'s ceiling is fixed at full scale and cannot be moved, so
/// the unit does the shaping and [`ceiling`] does the arithmetic the unit has
/// no parameter for.
pub struct Limiter(Effect);

impl Limiter {
    pub fn open(sample_rate: f64) -> Result<Self> {
        let effect = Effect::open(
            au::SubType::PEAK_LIMITER,
            sample_rate,
            |_| Ok(()),
            |effect| {
                effect.set(au::ParamId::LIMITER_ATTACK_TIME, LIMITER_ATTACK_SECONDS)?;
                effect.set(au::ParamId::LIMITER_DECAY_TIME, LIMITER_DECAY_SECONDS)?;
                effect.set(au::ParamId::LIMITER_PRE_GAIN, 0.0)
            },
        )?;

        Ok(Self(effect))
    }

    pub fn latency(&self) -> u64 {
        self.0.latency()
    }

    /// Runs one chunk, then puts the ceiling on it.
    pub fn process(&mut self, samples: &mut [f32]) -> Result<()> {
        self.0.process(samples)?;
        ceiling(samples);
        Ok(())
    }
}

/// Clamps every sample under [`CEILING_DB`].
///
/// A backstop rather than the limiter. By the time this runs, the track has
/// been compressed and then limited, so it engages on a handful of samples in
/// a take or none at all — which is why a hard clamp is honest here and would
/// not be as a limiter in its own right.
pub fn ceiling(samples: &mut [f32]) {
    let most = 10f32.powf(CEILING_DB / 20.0);
    for sample in samples {
        *sample = sample.clamp(-most, most);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Nothing may leave the chain above the ceiling.
    #[test]
    fn the_ceiling_holds() {
        let mut samples = vec![1.5, -1.5, 0.5, -0.2, 1.0, -1.0];
        ceiling(&mut samples);

        let most = 10f32.powf(CEILING_DB / 20.0);
        for sample in &samples {
            assert!(
                sample.abs() <= most + f32::EPSILON,
                "{sample} is past the {CEILING_DB} dBFS ceiling"
            );
        }
    }

    /// And a track already under it comes back untouched.
    #[test]
    fn the_ceiling_leaves_a_quiet_track_alone() {
        let original = vec![0.5, -0.5, 0.1, -0.886];
        let mut samples = original.clone();

        ceiling(&mut samples);

        assert_eq!(samples, original);
    }
}
