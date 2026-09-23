//! A fixed five-second sample, for the sound pickers' play button.
//!
//! The picker previews a profile before anything has been recorded, so there
//! is no real typing or clicking to plan from — only a stand-in phrase, fixed
//! once here so the same keyboard always sounds the same in the picker.
//! `cues` still decides the variant, the loudness and the pan; only the input
//! events are invented, which is the same licence `audition.rs`'s test takes
//! to compare profiles by ear.

use prequel_session::{KeyClass, KeyPress, MediaTime};

use crate::SAMPLE_RATE;
use crate::bank::Bank;
use crate::profile::{ClickProfile, KeyProfile};
use crate::schedule::{Cue, cues};

const MS: MediaTime = 1_000_000;

/// Long enough to hear a rhythm, short enough that pressing play again is not
/// a wait.
const DURATION_MS: MediaTime = 5_000;

/// "quick brown fox jumps", backspaced once and finished with Return — every
/// key class but Shift lands at least once, at a real typist's cadence.
fn phrase() -> Vec<KeyPress> {
    let mut at = 300 * MS;
    let mut presses = Vec::new();
    for word in ["quick", "brown", "fox", "jumps"] {
        for (i, _) in word.chars().enumerate() {
            presses.push(KeyPress {
                at,
                class: KeyClass::Letter,
            });
            at += (70 + (i * 23 % 40) as MediaTime) * MS;
        }
        presses.push(KeyPress {
            at,
            class: KeyClass::Space,
        });
        at += 160 * MS;
    }
    presses.push(KeyPress {
        at,
        class: KeyClass::Backspace,
    });
    at += 220 * MS;
    presses.push(KeyPress {
        at,
        class: KeyClass::Enter,
    });
    presses
}

/// Five clicks, evenly spaced — the way someone tries a mouse before buying it.
fn click_times() -> Vec<MediaTime> {
    (0..5).map(|i| (400 + i * 900) * MS).collect()
}

/// Mixes a plan into interleaved stereo at `SAMPLE_RATE`, `DURATION_MS` long.
///
/// The same equal-power pan law and truncation the export mixer uses, so a
/// picker's preview and a recording's playback place a voice identically.
fn mix(bank: &Bank, planned: &[Cue]) -> Vec<f32> {
    let total = (DURATION_MS as f64 / 1e3 * f64::from(SAMPLE_RATE)) as usize;
    let mut out = vec![0.0f32; total * 2];
    for cue in planned {
        let Some(voice) = bank.voice(cue.kind, cue.variant) else {
            continue;
        };
        let start = (cue.at as f64 / 1e9 * f64::from(SAMPLE_RATE)) as i64 - bank.onset() as i64;
        let left = ((1.0 - cue.pan) / 2.0).sqrt() * cue.gain;
        let right = ((1.0 + cue.pan) / 2.0).sqrt() * cue.gain;
        for (i, sample) in voice.iter().enumerate() {
            let frame = start + i as i64;
            if frame < 0 || frame as usize >= total {
                continue;
            }
            out[frame as usize * 2] += sample * left;
            out[frame as usize * 2 + 1] += sample * right;
        }
    }
    out
}

/// Five seconds of the phrase, interleaved stereo, for a keyboard's play button.
pub fn demo_keys(profile: KeyProfile) -> Vec<f32> {
    mix(&Bank::keys(profile), &cues(&phrase(), &[], "demo"))
}

/// Five seconds of clicks, interleaved stereo, for a mouse's play button.
pub fn demo_clicks(profile: ClickProfile) -> Vec<f32> {
    mix(&Bank::clicks(profile), &cues(&[], &click_times(), "demo"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frames(samples: &[f32]) -> usize {
        samples.len() / 2
    }

    #[test]
    fn a_demo_is_five_seconds_of_stereo_and_not_silent() {
        for profile in KeyProfile::ALL {
            let samples = demo_keys(profile);
            assert_eq!(
                frames(&samples),
                (DURATION_MS as usize * SAMPLE_RATE as usize) / 1_000
            );
            assert!(samples.iter().any(|sample| *sample != 0.0), "{profile:?}");
        }
        for profile in ClickProfile::ALL {
            let samples = demo_clicks(profile);
            assert_eq!(
                frames(&samples),
                (DURATION_MS as usize * SAMPLE_RATE as usize) / 1_000
            );
            assert!(samples.iter().any(|sample| *sample != 0.0), "{profile:?}");
        }
    }

    #[test]
    fn a_demo_is_the_same_every_time() {
        assert_eq!(demo_keys(KeyProfile::Thock), demo_keys(KeyProfile::Thock));
        assert_eq!(
            demo_clicks(ClickProfile::Soft),
            demo_clicks(ClickProfile::Soft)
        );
    }
}
