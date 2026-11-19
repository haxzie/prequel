//! Taking the hiss off an "s", without taking the top off everything else.
//!
//! Sibilance is the one thing the tone shaping in `chain.rs` makes worse: the
//! air shelf that turns a dull laptop microphone into something worth
//! listening to also lifts every "s" and "t" by the same 3 dB, and a close
//! microphone has far too much of both to begin with. Lifting the top end
//! without this is how a voice comes back bright and unlistenable.
//!
//! **Written here rather than built out of audio units**, because macOS ships
//! no de-esser — there is no `aufx` for it, and the usual way of faking one
//! out of a band-pass and a compressor costs a second unit, a second render
//! and a phase relationship nobody can see. This is forty lines of arithmetic
//! that the tests below can drive with a tone.
//!
//! **The split reconstructs exactly.** The high band is the signal minus the
//! low band rather than a second filter, so when the de-esser is doing nothing
//! — which is most of a take — `low + 1.0 × high` is the input sample for
//! sample. A pair of complementary filters would comb-filter the whole track
//! in exchange for nothing.

/// Where the signal is split, in hertz.
///
/// Sibilance lives above this; the voice's body and all of its intelligibility
/// live below it. Lower and the de-esser starts pulling down consonants that
/// carry words.
const CROSSOVER_HZ: f64 = 5_500.0;

/// What the detector listens to, in hertz.
///
/// Narrower than the band being worked on and centred where an "s" peaks, so
/// a cymbal-free voice track triggers it and a bright vowel does not.
const DETECTOR_HZ: f64 = 7_000.0;
const DETECTOR_Q: f64 = 1.4;

/// How quickly the gain follows the sibilance up, in seconds.
///
/// An "s" is on in a couple of milliseconds; a slower attack lets its front
/// edge through at full level, which is the part that stings.
const ATTACK_SECONDS: f64 = 0.001;

/// And back down. Long enough not to modulate the band audibly, short enough
/// to be out of the way before the next vowel.
const RELEASE_SECONDS: f64 = 0.060;

/// Above this much energy in the detector band, the high band is pulled down.
///
/// In linear amplitude, not decibels: roughly −26 dBFS of band energy, which
/// a spoken "s" passes and ordinary speech does not.
const THRESHOLD: f32 = 0.05;

/// How hard, past the threshold. 4:1 — three quarters of the excess, gone.
const RATIO: f32 = 4.0;

/// The most the high band is ever pulled down, in decibels.
///
/// A ceiling rather than a straight ratio, because the arithmetic has no
/// natural floor: a shout straight into a built-in microphone can exceed the
/// threshold by 20 dB, and removing all of that leaves a lisp, which is a more
/// obvious fault than the sibilance was.
const MAX_REDUCTION_DB: f32 = 10.0;

/// A two-pole filter, as the cookbook writes them.
#[derive(Debug, Clone, Copy)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl Biquad {
    /// Normalised into the form the step function wants: `a0` divided out.
    fn new(b0: f64, b1: f64, b2: f64, a0: f64, a1: f64, a2: f64) -> Self {
        Self {
            b0: (b0 / a0) as f32,
            b1: (b1 / a0) as f32,
            b2: (b2 / a0) as f32,
            a1: (a1 / a0) as f32,
            a2: (a2 / a0) as f32,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    fn low_pass(hz: f64, q: f64, sample_rate: f64) -> Self {
        let w = std::f64::consts::TAU * hz / sample_rate;
        let (sin, cos) = w.sin_cos();
        let alpha = sin / (2.0 * q);
        Self::new(
            (1.0 - cos) / 2.0,
            1.0 - cos,
            (1.0 - cos) / 2.0,
            1.0 + alpha,
            -2.0 * cos,
            1.0 - alpha,
        )
    }

    /// Constant peak gain, so the detector's reading is the band's level
    /// rather than its level times whatever the Q happened to be.
    fn band_pass(hz: f64, q: f64, sample_rate: f64) -> Self {
        let w = std::f64::consts::TAU * hz / sample_rate;
        let (sin, cos) = w.sin_cos();
        let alpha = sin / (2.0 * q);
        Self::new(alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * cos, 1.0 - alpha)
    }

    fn step(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}

/// One de-esser, run over a track a chunk at a time.
#[derive(Debug)]
pub struct DeEsser {
    /// Two in series: one pole pair is a 12 dB slope, which leaves enough
    /// sibilance in the low band to be worth hearing.
    split: [Biquad; 2],
    detector: Biquad,
    envelope: f32,
    attack: f32,
    release: f32,
    /// The hardest this de-esser has pulled, as a multiplier. Not used by the
    /// arithmetic — read by the caller for the log.
    hardest: f32,
}

impl DeEsser {
    pub fn new(sample_rate: f64) -> Self {
        // Butterworth Q, so the two sections in series are flat through the
        // crossover rather than peaked at it.
        let q = std::f64::consts::FRAC_1_SQRT_2;
        Self {
            split: [
                Biquad::low_pass(CROSSOVER_HZ, q, sample_rate),
                Biquad::low_pass(CROSSOVER_HZ, q, sample_rate),
            ],
            detector: Biquad::band_pass(DETECTOR_HZ, DETECTOR_Q, sample_rate),
            envelope: 0.0,
            attack: coefficient(ATTACK_SECONDS, sample_rate),
            release: coefficient(RELEASE_SECONDS, sample_rate),
            hardest: 1.0,
        }
    }

    /// Runs one chunk, in place.
    pub fn process(&mut self, samples: &mut [f32]) {
        let floor = 10f32.powf(-MAX_REDUCTION_DB / 20.0);

        for sample in samples.iter_mut() {
            let input = *sample;

            // Follow the sibilant band. Rectified rather than squared: an "s"
            // is noise, and its peak is what is heard.
            let band = self.detector.step(input).abs();
            let coefficient = if band > self.envelope {
                self.attack
            } else {
                self.release
            };
            self.envelope += (band - self.envelope) * coefficient;

            let gain = if self.envelope > THRESHOLD {
                let over = self.envelope / THRESHOLD;
                // The excess, divided by the ratio, and the rest removed.
                (over.powf(1.0 / RATIO - 1.0)).max(floor)
            } else {
                1.0
            };
            self.hardest = self.hardest.min(gain);

            let first = self.split[0].step(input);
            let low = self.split[1].step(first);
            let high = input - low;
            *sample = low + high * gain;
        }
    }

    /// The hardest this pass pulled the high band down, in decibels.
    pub fn hardest_db(&self) -> f32 {
        -20.0 * self.hardest.max(f32::MIN_POSITIVE).log10()
    }
}

/// A one-pole follower's coefficient for a time constant.
fn coefficient(seconds: f64, sample_rate: f64) -> f32 {
    if seconds <= 0.0 {
        return 1.0;
    }
    (1.0 - (-1.0 / (seconds * sample_rate)).exp()) as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f64 = 48_000.0;

    fn sine(hz: f64, amplitude: f32, seconds: f64) -> Vec<f32> {
        let frames = (seconds * RATE) as usize;
        (0..frames)
            .map(|i| {
                let t = i as f64 / RATE;
                amplitude * (t * hz * std::f64::consts::TAU).sin() as f32
            })
            .collect()
    }

    fn peak(samples: &[f32]) -> f32 {
        samples.iter().fold(0.0f32, |most, s| most.max(s.abs()))
    }

    /// The settled part of a signal, past the filters' start-up.
    fn settled(samples: &[f32]) -> &[f32] {
        &samples[(RATE * 0.3) as usize..]
    }

    /// A voice with no sibilance in it comes back untouched.
    ///
    /// The property the complementary split exists for: with the detector
    /// quiet, `low + high` has to be the input again, not an approximation of
    /// it. A pair of independent filters passes every other test in this file
    /// and fails this one by a decibel somewhere near the crossover.
    #[test]
    fn a_signal_with_no_sibilance_passes_through_unchanged() {
        let original = sine(200.0, 0.8, 1.0);
        let mut processed = original.clone();

        DeEsser::new(RATE).process(&mut processed);

        for (was, now) in original.iter().zip(&processed) {
            assert!(
                (was - now).abs() < 1e-5,
                "a 200 Hz tone came back changed: {was} became {now}"
            );
        }
    }

    /// And so does a quiet one near the top, which is air rather than an "s".
    #[test]
    fn a_quiet_high_tone_is_left_alone() {
        let original = sine(7_000.0, 0.01, 1.0);
        let mut processed = original.clone();

        DeEsser::new(RATE).process(&mut processed);

        assert!(
            (peak(settled(&processed)) - peak(settled(&original))).abs() < 1e-4,
            "a −40 dBFS 7 kHz tone was pulled down; the threshold is too low"
        );
    }

    /// A loud sibilant comes back quieter.
    #[test]
    fn a_loud_sibilant_is_pulled_down() {
        let original = sine(7_000.0, 0.8, 1.0);
        let mut processed = original.clone();

        DeEsser::new(RATE).process(&mut processed);

        let was = peak(settled(&original));
        let now = peak(settled(&processed));
        let decibels = 20.0 * (now / was).log10();

        assert!(
            decibels < -6.0,
            "a loud 7 kHz tone came back {decibels:.1} dB down — fewer than the 6 dB a working \
             de-esser takes off"
        );
    }

    /// And never by more than the ceiling.
    ///
    /// Without the floor a shout into a built-in microphone loses its whole
    /// top end and the speaker comes back with a lisp, which is worse than
    /// what was being fixed.
    #[test]
    fn the_reduction_stops_at_the_ceiling() {
        let mut processed = sine(7_000.0, 1.0, 1.0);
        let mut deesser = DeEsser::new(RATE);

        deesser.process(&mut processed);

        assert!(
            deesser.hardest_db() <= MAX_REDUCTION_DB + 0.01,
            "pulled {:.1} dB, past the {MAX_REDUCTION_DB} dB ceiling",
            deesser.hardest_db()
        );
    }

    /// The bottom of the voice survives an "s" happening over it.
    ///
    /// The whole point of splitting: a de-esser that ducked the broadband
    /// signal would pull the vowel down with the consonant, which is heard as
    /// the voice lurching every few words.
    #[test]
    fn sibilance_does_not_duck_the_body_of_the_voice() {
        let body = sine(200.0, 0.5, 1.0);
        let hiss = sine(7_000.0, 0.8, 1.0);
        let mut both: Vec<f32> = body.iter().zip(&hiss).map(|(a, b)| a + b).collect();

        DeEsser::new(RATE).process(&mut both);

        // Pull the 200 Hz component back out: the high band is 35 dB down at
        // 200 Hz, so whatever is left at that frequency is the body.
        let mut low = Biquad::low_pass(500.0, 0.707, RATE);
        let recovered: Vec<f32> = both.iter().map(|s| low.step(*s)).collect();

        let was = peak(settled(&body));
        let now = peak(settled(&recovered));

        assert!(
            (now / was) > 0.9,
            "the 200 Hz body came back at {:.2} of its level while the sibilance was being \
             removed",
            now / was
        );
    }
}
