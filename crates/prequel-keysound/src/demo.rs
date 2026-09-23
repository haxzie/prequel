//! A fixed sample, for the sound pickers' play button.
//!
//! The picker previews a profile before anything has been recorded, so there
//! is no real typing or clicking to plan from — only stand-in events, fixed
//! once here so the same keyboard always sounds the same in the picker.
//! `cues` still decides the variant, the loudness and the pan; only the input
//! events are invented, which is the same licence `audition.rs`'s test takes
//! to compare profiles by ear.
//!
//! A keyboard gets a phrase and a mouse gets one click. What distinguishes two
//! keyboards is partly the rhythm of a run of keys, which takes a few seconds
//! to hear; a mouse has one voice and no rhythm, so a second click only says
//! what the first already did.

use prequel_session::{KeyClass, KeyPress, MediaTime};

use crate::SAMPLE_RATE;
use crate::bank::Bank;
use crate::profile::{ClickProfile, KeyProfile};
use crate::schedule::{Cue, cues};

const MS: MediaTime = 1_000_000;

/// The typing phrase: long enough to hear a rhythm, short enough that pressing
/// play again is not a wait.
const PHRASE_MS: MediaTime = 5_000;

/// One click, and the room it needs to ring out.
///
/// `synth::MAX_MS` caps a voice at 300 ms and the press sits `ONSET_MS` into
/// it, so a click placed at `CLICK_AT` has died away well inside this. A
/// buffer that ended first would cut the voice mid-ring, which is a pop.
const CLICK_MS: MediaTime = 400;

/// Where the click falls — far enough in that its lead-in is not clipped.
const CLICK_AT: MediaTime = 60;

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

/// Mixes a plan into interleaved stereo at `SAMPLE_RATE`, `duration_ms` long.
///
/// The same equal-power pan law and truncation the export mixer uses, so a
/// picker's preview and a recording's playback place a voice identically.
fn mix(bank: &Bank, planned: &[Cue], duration_ms: MediaTime) -> Vec<f32> {
    let total = (duration_ms as f64 / 1e3 * f64::from(SAMPLE_RATE)) as usize;
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
    mix(
        &Bank::keys(profile),
        &cues(&phrase(), &[], "demo"),
        PHRASE_MS,
    )
}

/// One click, interleaved stereo, for a mouse's play button.
pub fn demo_clicks(profile: ClickProfile) -> Vec<f32> {
    mix(
        &Bank::clicks(profile),
        &cues(&[], &[CLICK_AT * MS], "demo"),
        CLICK_MS,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frames(samples: &[f32]) -> usize {
        samples.len() / 2
    }

    fn frames_in(ms: MediaTime) -> usize {
        (ms as usize * SAMPLE_RATE as usize) / 1_000
    }

    #[test]
    fn a_keyboard_demo_is_the_phrase_and_a_mouse_demo_is_one_click() {
        for profile in KeyProfile::ALL {
            let samples = demo_keys(profile);
            assert_eq!(frames(&samples), frames_in(PHRASE_MS));
            assert!(samples.iter().any(|sample| *sample != 0.0), "{profile:?}");
        }
        for profile in ClickProfile::ALL {
            let samples = demo_clicks(profile);
            assert_eq!(frames(&samples), frames_in(CLICK_MS));
            assert!(samples.iter().any(|sample| *sample != 0.0), "{profile:?}");
        }
    }

    /// A voice still ringing when the buffer ends is cut mid-swing, and a
    /// waveform that stops at a non-zero sample is a click of its own — on a
    /// preview whose whole job is to say what a click sounds like.
    #[test]
    fn the_click_has_died_away_before_the_buffer_ends() {
        for profile in ClickProfile::ALL {
            let samples = demo_clicks(profile);
            let tail = &samples[(frames(&samples) - frames_in(20)) * 2..];
            assert!(
                tail.iter().all(|sample| *sample == 0.0),
                "{profile:?} is still sounding at the end"
            );
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
