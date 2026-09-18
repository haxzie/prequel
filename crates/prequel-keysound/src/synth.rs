//! One keystroke, rendered.
//!
//! A voice is a few impacts laid on one timeline. Each impact is a burst of
//! contact noise — white noise under an exponential decay, low-passed by how
//! soft the contact is — driven through the profile's resonators, which ring
//! and fade the way a struck keycap does. There is no oscillator playing a
//! "click" here; the pitch a listener hears is the body ringing, which is why
//! the same code makes a thock and a clack from different tables.
//!
//! Everything random is drawn from the variant's own generator in a fixed
//! order, so a variant is a pure function of its seed. That is what lets the
//! preview and the export each render the bank and get the same samples.

use crate::profile::{CueKind, Gate, Mechanism, Mode, Profile};
use crate::rng::Rng;

/// A rendered press: mono samples and where the press itself sits in them.
#[derive(Debug, Clone, PartialEq)]
pub struct Voice {
    pub samples: Vec<f32>,
    /// The sample the key-down event falls on. The finger's touch is rendered
    /// *before* this, so a voice placed with its onset on the cue's moment
    /// puts the touch where it happened rather than late.
    pub onset: usize,
}

/// Where the press sits in the voice, in milliseconds. Leaves room for the
/// touch lead and its jitter in front of it.
pub const ONSET_MS: f32 = 15.0;

/// The longest a voice may be. Bounds the bank, and is what the tests check
/// the slowest mode has decayed inside.
pub const MAX_MS: f32 = 300.0;

/// The finger lands this long before the switch registers.
const TOUCH_LEAD_MS: f32 = 10.0;

/// The stem bottoms out this long after actuation, at typing speed.
const HIT_DELAY_MS: f32 = 5.0;

/// Every voice is scaled so its peak sits here, -6 dBFS. Leaves the scheduler
/// headroom for a louder long key and its jitter without the mixer clipping.
const TARGET_PEAK: f32 = 0.501;

/// Spread on every sub-event's timing, as a fraction. Two presses never land
/// their release at the same distance from the hit.
const TIMING_JITTER: f32 = 0.15;

/// Spread on each mode's frequency per variant. Keycaps are not identical and
/// neither are fingers; ±6 % is a semitone either way, which is the most that
/// still reads as the same key.
const DETUNE: f32 = 0.06;

/// Spread on the contact time per variant.
const TAU_SPREAD: f32 = 0.2;

/// Spread on a phone's pitch per variant. See `render_voice`.
const TAP_DETUNE: f32 = 0.012;

/// The stabiliser rattle lands this long after the hit.
const STABILISER_DELAY_MS: (f32, f32) = (2.0, 6.0);
const STABILISER_DB: f32 = -10.0;

/// The click jacket is its own impact: hard, tiny, and much brighter than the
/// bottom-out, so its own contact figures rather than the profile's.
const JACKET_DB: f32 = -6.0;
const JACKET_TAU_MS: f32 = 0.4;
const JACKET_LOWPASS_HZ: f32 = 12_000.0;

/// The touch is a fingertip, which is soft whatever the keyboard.
const TOUCH_LOWPASS_HZ: f32 = 1_000.0;

/// The tail is cut where it falls below this, -80 dBFS. Below the encoder's
/// noise floor, and well below the -60 dB the tests require of the last 5 ms.
const TRIM_FLOOR: f32 = 1e-4;

/// The contact of one impact.
#[derive(Debug, Clone, Copy)]
struct Excite {
    tau_ms: f32,
    lowpass_hz: f32,
    /// Noise, or a clean pulse. A real switch's contact is a scrape and no
    /// two are alike, which is what noise gives; a phone plays one file, and
    /// a random burst would ring its two low modes in a different balance on
    /// every variant. A half-sine pulse `tau_ms` long — the impact force of
    /// the contact literature — excites each mode by a known amount, so the
    /// table's gains mean what they say and only the detune varies.
    noisy: bool,
}

/// Renders one press of `kind` on `profile`.
pub fn render_voice(
    profile: &Profile,
    kind: CueKind,
    variant_seed: u64,
    sample_rate: u32,
) -> Voice {
    let mut rng = Rng::new(variant_seed);
    let rate = sample_rate as f32;
    let ms = |value: f32| (value * rate / 1_000.0).round() as usize;

    let mut out = vec![0.0f32; ms(MAX_MS)];
    let onset = ms(ONSET_MS);

    // A class with its own sound uses it whole; otherwise the board's body,
    // lower for a long key.
    let custom = profile.overrides.iter().find(|sound| sound.kind == kind);
    let ratio = if custom.is_none() && kind.is_long_key() {
        profile.long_key_ratio
    } else {
        1.0
    };
    // A phone plays the same file every time, so its variants are barely
    // detuned — a tone that wandered a semitone between presses would sound
    // like a different instrument, not a different finger.
    let detune = match profile.mechanism {
        Mechanism::Tap => TAP_DETUNE,
        Mechanism::Keyboard | Mechanism::Mouse => DETUNE,
    };
    // The body is detuned once per variant and then struck several times, so
    // the touch, the hit and the release all ring the same keycap.
    let body: Vec<Mode> = custom
        .map(|sound| sound.modes)
        .unwrap_or(profile.modes)
        .iter()
        .map(|mode| Mode {
            hz: mode.hz * ratio * rng.around(detune),
            ..*mode
        })
        .collect();
    let tau = profile.excite_tau_ms * rng.around(TAU_SPREAD);
    let contact = Excite {
        tau_ms: tau,
        lowpass_hz: profile.contact_lowpass_hz,
        noisy: !matches!(profile.mechanism, Mechanism::Tap),
    };

    let trim = custom.map_or(0.0, |sound| sound.trim_db);

    match profile.mechanism {
        Mechanism::Keyboard => {
            let touch_at = onset.saturating_sub(ms(TOUCH_LEAD_MS * rng.around(TIMING_JITTER)));
            strike(
                &mut out,
                touch_at,
                db(profile.touch_db),
                Excite {
                    tau_ms: tau * 2.0,
                    lowpass_hz: TOUCH_LOWPASS_HZ.min(profile.contact_lowpass_hz),
                    noisy: true,
                },
                &body,
                rate,
                &mut rng,
            );

            if let Some(jacket) = profile.jacket {
                let jacket: Vec<Mode> = jacket
                    .iter()
                    .map(|mode| Mode {
                        hz: mode.hz * rng.around(DETUNE),
                        ..*mode
                    })
                    .collect();
                strike(
                    &mut out,
                    onset,
                    db(JACKET_DB),
                    Excite {
                        tau_ms: JACKET_TAU_MS,
                        lowpass_hz: JACKET_LOWPASS_HZ,
                        noisy: true,
                    },
                    &jacket,
                    rate,
                    &mut rng,
                );
            }

            let hit_at = onset + ms(HIT_DELAY_MS * rng.around(TIMING_JITTER));
            strike(&mut out, hit_at, 1.0, contact, &body, rate, &mut rng);

            if kind.is_long_key() {
                let (low, high) = STABILISER_DELAY_MS;
                let tick_at = hit_at + ms(rng.range(low, high));
                strike(
                    &mut out,
                    tick_at,
                    db(STABILISER_DB),
                    Excite {
                        tau_ms: tau * 0.7,
                        ..contact
                    },
                    &body,
                    rate,
                    &mut rng,
                );
            }

            let (low, high) = profile.release_delay_ms;
            let release_at = onset + ms(rng.range(low, high));
            // The ping is struck by the release like any other mode, rather
            // than added as a tone: driven by the same burst it sits at a level
            // relative to the body that the table can reason about.
            let mut release_body = body.clone();
            if let Some(ping) = profile.ping {
                release_body.push(Mode {
                    hz: ping.hz * rng.around(DETUNE),
                    ..ping
                });
            }
            strike(
                &mut out,
                release_at,
                db(profile.release_db),
                Excite {
                    tau_ms: tau * 0.8,
                    ..contact
                },
                &release_body,
                rate,
                &mut rng,
            );
        }
        Mechanism::Tap => {
            strike(&mut out, onset, 1.0, contact, &body, rate, &mut rng);
            if let Some(gate) = custom.and_then(|sound| sound.gate) {
                release(&mut out, onset, gate, rate);
            }
        }
        Mechanism::Mouse => {
            strike(&mut out, onset, 1.0, contact, &body, rate, &mut rng);

            let (low, high) = profile.release_delay_ms;
            let release_at = onset + ms(rng.range(low, high));
            strike(
                &mut out,
                release_at,
                db(profile.release_db),
                Excite {
                    tau_ms: tau * 0.8,
                    ..contact
                },
                &body,
                rate,
                &mut rng,
            );
        }
    }

    normalise(&mut out);
    // After the normalise, so a class's trim is against the letter's peak
    // and not against whatever level its own body happened to sum to.
    if trim != 0.0 {
        let scale = db(trim);
        for sample in out.iter_mut() {
            *sample *= scale;
        }
    }
    cut_tail(&mut out, onset);

    Voice {
        samples: out,
        onset,
    }
}

/// Adds one impact to `out`, starting at `start`.
///
/// The burst is generated once and pushed through every mode; each mode is a
/// two-pole resonator run in f64, because at a T60 of 120 ms the pole sits at
/// 0.9988 and f32 recursion drifts audibly over a quarter of a second.
fn strike(
    out: &mut [f32],
    start: usize,
    level: f32,
    excite: Excite,
    modes: &[Mode],
    rate: f32,
    rng: &mut Rng,
) {
    if start >= out.len() {
        return;
    }

    let tau_samples = excite.tau_ms * rate / 1_000.0;
    // Noise: eight time constants, by when the burst is at -70 dB. A pulse:
    // one half-sine, `tau` long.
    let burst_len = if excite.noisy {
        ((tau_samples * 8.0).ceil() as usize).max(2)
    } else {
        (tau_samples.ceil() as usize).max(2)
    };
    let lowpass = 1.0 - (-2.0 * std::f32::consts::PI * excite.lowpass_hz / rate).exp();

    let mut burst = Vec::with_capacity(burst_len);
    let mut smoothed = 0.0f32;
    for n in 0..burst_len {
        let shaped = if excite.noisy {
            (rng.next_f32() * 2.0 - 1.0) * (-(n as f32) / tau_samples).exp()
        } else {
            (std::f32::consts::PI * n as f32 / burst_len as f32).sin()
        };
        smoothed += lowpass * (shaped - smoothed);
        burst.push(smoothed);
    }

    for mode in modes {
        // T60 to a time constant: 60 dB is a factor of 1000 in amplitude.
        let decay_samples = f64::from(mode.t60_ms) * f64::from(rate) / 1_000.0 / 1000f64.ln();
        let r = (-1.0 / decay_samples).exp();
        let omega = 2.0 * std::f64::consts::PI * f64::from(mode.hz) / f64::from(rate);
        let a1 = 2.0 * r * omega.cos();
        let a2 = -(r * r);
        // A resonator's impulse response peaks at about 1/sin(ω), which would
        // make a 200 Hz mode twenty times louder than a 4 kHz one for the same
        // table gain. Scaled back so the table's gains mean what they say.
        let gain = f64::from(level * mode.gain) * omega.sin();

        // Run until the mode has fallen 80 dB below where the burst left it.
        let run = burst_len + (decay_samples * 80.0 / 20.0 * 10f64.ln()) as usize;
        let end = (start + run).min(out.len());

        let mut y1 = 0.0f64;
        let mut y2 = 0.0f64;
        for (n, sample) in out[start..end].iter_mut().enumerate() {
            let x = burst.get(n).copied().unwrap_or(0.0) as f64;
            let y = x + a1 * y1 + a2 * y2;
            y2 = y1;
            y1 = y;
            *sample += (gain * y) as f32;
        }
    }
}

/// Ends a held tone: everything past `hold_ms` after the press fades with the
/// gate's time constant. A resonator with a three-second T60 is flat over
/// 80 ms, which is the sustain; this is what stops it.
fn release(out: &mut [f32], onset: usize, gate: Gate, rate: f32) {
    let hold = onset + (gate.hold_ms * rate / 1_000.0) as usize;
    let tau = gate.release_ms * rate / 1_000.0;
    for (n, sample) in out.iter_mut().enumerate().skip(hold) {
        *sample *= (-((n - hold) as f32) / tau).exp();
    }
}

fn db(value: f32) -> f32 {
    10f32.powf(value / 20.0)
}

fn normalise(out: &mut [f32]) {
    let peak = out
        .iter()
        .fold(0.0f32, |peak, sample| peak.max(sample.abs()));
    if peak > 0.0 {
        let scale = TARGET_PEAK / peak;
        for sample in out.iter_mut() {
            *sample *= scale;
        }
    }
}

/// Cuts the silent tail, but never into the onset.
fn cut_tail(out: &mut Vec<f32>, onset: usize) {
    let last = out
        .iter()
        .rposition(|sample| sample.abs() >= TRIM_FLOOR)
        .unwrap_or(0);
    out.truncate(last.max(onset) + 1);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SAMPLE_RATE;
    use crate::profile::{ClickProfile, KeyProfile};

    fn every_profile() -> Vec<(&'static str, &'static Profile)> {
        let mut all: Vec<(&str, &Profile)> = KeyProfile::ALL
            .into_iter()
            .map(|p| (p.id(), p.table()))
            .collect();
        all.extend(ClickProfile::ALL.into_iter().map(|p| (p.id(), p.table())));
        all
    }

    /// Spectral centroid, in Hz, of the 40 ms from the onset — where the
    /// energy sits, which is what "bright" and "dark" mean. A naive DFT on a
    /// 50 Hz grid under a Hann window: forty milliseconds by 240 bins is
    /// nothing, and the window keeps a 150 Hz mode from leaking its energy
    /// into bins that would pull the centroid up.
    fn brightness(voice: &Voice) -> f32 {
        let window = (SAMPLE_RATE as usize * 40) / 1_000;
        let slice = &voice.samples[voice.onset..(voice.onset + window).min(voice.samples.len())];
        let hann = |n: usize| {
            0.5 - 0.5 * (2.0 * std::f64::consts::PI * n as f64 / slice.len() as f64).cos()
        };
        let mut weighted = 0.0f64;
        let mut total = 0.0f64;
        for bin in 1..=240 {
            let hz = bin as f64 * 50.0;
            let omega = 2.0 * std::f64::consts::PI * hz / f64::from(SAMPLE_RATE);
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for (n, sample) in slice.iter().enumerate() {
                let phase = omega * n as f64;
                let value = f64::from(*sample) * hann(n);
                re += value * phase.cos();
                im -= value * phase.sin();
            }
            let power = re * re + im * im;
            weighted += hz * power;
            total += power;
        }
        (weighted / total) as f32
    }

    fn mean_brightness(profile: &Profile, kind: CueKind) -> f32 {
        (0..8)
            .map(|seed| brightness(&render_voice(profile, kind, seed, SAMPLE_RATE)))
            .sum::<f32>()
            / 8.0
    }

    #[test]
    fn every_voice_peaks_at_the_target_and_never_clips() {
        for (name, profile) in every_profile() {
            for kind in CueKind::ALL {
                for seed in 0..12 {
                    let voice = render_voice(profile, kind, seed, SAMPLE_RATE);
                    let peak = voice
                        .samples
                        .iter()
                        .fold(0.0f32, |peak, s| peak.max(s.abs()));
                    // A class with its own sound may sit a few dB off the
                    // target, by its trim; nothing may be louder than the
                    // scheduler's headroom allows.
                    let trim = profile
                        .overrides
                        .iter()
                        .find(|sound| sound.kind == kind)
                        .map_or(0.0, |sound| sound.trim_db);
                    let expected = TARGET_PEAK * db(trim);
                    assert!(
                        (peak - expected).abs() < 1e-3,
                        "{name}/{kind:?}/{seed} peaks at {peak}, expected {expected}"
                    );
                    assert!(peak < 0.9, "{name}/{kind:?}/{seed} leaves no headroom");
                }
            }
        }
    }

    #[test]
    fn every_voice_has_died_away_before_it_ends() {
        // The bank's length bound. A voice still ringing at MAX_MS would be
        // cut off with a step, and the step would be on every press. The trim
        // guarantees the last sample is at the floor *if* the voice decayed in
        // time; a voice that did not is left ending mid-ring, which is what
        // this catches.
        let cap = (SAMPLE_RATE as f32 * MAX_MS / 1_000.0) as usize;
        for (name, profile) in every_profile() {
            for kind in CueKind::ALL {
                for seed in 0..12 {
                    let voice = render_voice(profile, kind, seed, SAMPLE_RATE);
                    assert!(
                        voice.samples.len() <= cap,
                        "{name}/{kind:?}/{seed} is too long"
                    );
                    let last = voice.samples.last().copied().unwrap_or(0.0).abs();
                    assert!(
                        last < 2.0 * TRIM_FLOOR,
                        "{name}/{kind:?}/{seed} ends at {last}"
                    );
                }
            }
        }
    }

    #[test]
    fn a_variant_is_a_pure_function_of_its_seed() {
        let a = render_voice(KeyProfile::Linear.table(), CueKind::Letter, 7, SAMPLE_RATE);
        let b = render_voice(KeyProfile::Linear.table(), CueKind::Letter, 7, SAMPLE_RATE);
        let c = render_voice(KeyProfile::Linear.table(), CueKind::Letter, 8, SAMPLE_RATE);
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn thock_is_darker_than_linear_which_is_darker_than_clicky() {
        // The ordering the profile names promise. Tuning may move the numbers;
        // it may not swap these.
        let thock = mean_brightness(KeyProfile::Thock.table(), CueKind::Letter);
        let linear = mean_brightness(KeyProfile::Linear.table(), CueKind::Letter);
        let clicky = mean_brightness(KeyProfile::Clicky.table(), CueKind::Letter);
        assert!(thock < linear, "thock {thock} vs linear {linear}");
        assert!(linear < clicky, "linear {linear} vs clicky {clicky}");
    }

    #[test]
    fn a_long_key_rings_lower_than_a_letter() {
        // Every mechanical board. Not the phone, whose space bar is a
        // different sound rather than a bigger cap on the same switch.
        for profile in KeyProfile::ALL
            .into_iter()
            .filter(|p| *p != KeyProfile::Phone)
        {
            let letter = mean_brightness(profile.table(), CueKind::Letter);
            let space = mean_brightness(profile.table(), CueKind::Space);
            assert!(
                space < letter,
                "{}: space {space} vs letter {letter}",
                profile.id()
            );
        }
    }

    #[test]
    fn the_touch_lands_before_the_onset_and_the_release_after() {
        // A keyboard voice has energy on both sides of its onset; a mouse
        // voice has none before it. This is what lets a cue be placed on the
        // press rather than on the first sound.
        let energy = |samples: &[f32]| samples.iter().map(|s| s * s).sum::<f32>();
        let key = render_voice(KeyProfile::Tactile.table(), CueKind::Letter, 1, SAMPLE_RATE);
        assert!(energy(&key.samples[..key.onset]) > 0.0);
        assert!(energy(&key.samples[key.onset..]) > energy(&key.samples[..key.onset]));

        let mouse = render_voice(ClickProfile::Soft.table(), CueKind::Click, 1, SAMPLE_RATE);
        assert_eq!(energy(&mouse.samples[..mouse.onset]), 0.0);

        // And a phone is one strike with nothing before it: glass has no
        // travel for a finger to land on first.
        let phone = render_voice(KeyProfile::Phone.table(), CueKind::Letter, 1, SAMPLE_RATE);
        assert_eq!(energy(&phone.samples[..phone.onset]), 0.0);
    }

    #[test]
    fn the_phone_sounds_like_its_files() {
        // Fitted to iOS's own `keyboard_press_normal`, `_delete` and `_clear`,
        // and pinned by what makes each one itself. Wide tolerances: the point
        // is that tuning does not turn a letter back into the 3 kHz Tock of
        // iOS 6, or Delete into a knock.
        let ms = |value: usize| (SAMPLE_RATE as usize * value) / 1_000;
        let rms = |samples: &[f32]| {
            (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
        };
        let db = |a: f32, b: f32| 20.0 * (a / b).log10();
        let table = KeyProfile::Phone.table();

        for seed in 0..4 {
            // A letter: low, and mostly over in 20 ms.
            let letter = render_voice(table, CueKind::Letter, seed, SAMPLE_RATE);
            let centroid = brightness(&letter);
            assert!(
                (300.0..500.0).contains(&centroid),
                "letter {seed}: {centroid} Hz"
            );
            let first = rms(&letter.samples[letter.onset..letter.onset + ms(5)]);
            let later = rms(&letter.samples[letter.onset + ms(20)..letter.onset + ms(25)]);
            assert!(
                db(later, first) < -12.0,
                "letter {seed}: tail only {} dB down",
                db(later, first)
            );

            // Delete: a tone that holds for 80 ms and is gone by 130.
            let delete = render_voice(table, CueKind::Backspace, seed, SAMPLE_RATE);
            let early = rms(&delete.samples[delete.onset + ms(10)..delete.onset + ms(30)]);
            let held = rms(&delete.samples[delete.onset + ms(55)..delete.onset + ms(75)]);
            assert!(
                db(held, early).abs() < 3.0,
                "delete {seed}: sustain drifted {} dB",
                db(held, early)
            );
            assert!(
                delete.samples.len() < delete.onset + ms(140),
                "delete {seed} rings on"
            );
            let tone = brightness(&delete);
            assert!((400.0..500.0).contains(&tone), "delete {seed}: {tone} Hz");

            // Clear: the same note, held, for Return and the modifiers.
            let enter = render_voice(table, CueKind::Enter, seed, SAMPLE_RATE);
            let held = rms(&enter.samples[enter.onset + ms(55)..enter.onset + ms(75)]);
            let early = rms(&enter.samples[enter.onset + ms(10)..enter.onset + ms(30)]);
            // Five rather than three: the partial fades under the held note,
            // and Apple's own file drops 3 dB between these windows.
            assert!(
                db(held, early).abs() < 5.0,
                "enter {seed}: sustain drifted {} dB",
                db(held, early)
            );

            // And the space bar is a letter, not a note: the same low tick.
            let space = render_voice(table, CueKind::Space, seed, SAMPLE_RATE);
            let centroid = brightness(&space);
            assert!(
                (300.0..500.0).contains(&centroid),
                "space {seed}: {centroid} Hz"
            );
            let first = rms(&space.samples[space.onset..space.onset + ms(5)]);
            let later = rms(&space.samples[space.onset + ms(20)..space.onset + ms(25)]);
            assert!(db(later, first) < -12.0, "space {seed}: held like a note");
        }

        // And the phone's variants barely differ in pitch — one file, many
        // presses — where a mechanical board's may wander a semitone.
        let a = brightness(&render_voice(table, CueKind::Backspace, 0, SAMPLE_RATE));
        let b = brightness(&render_voice(table, CueKind::Backspace, 1, SAMPLE_RATE));
        assert!((a - b).abs() < 20.0, "delete pitch wandered {a} vs {b}");
    }
}
