//! Which voice plays when, decided once per recording.
//!
//! The cues carry everything a player needs that is not the samples: the
//! moment, the kind, which of the twelve variants, how loud, and where in the
//! stereo field. They are independent of the profile — a different keyboard is
//! a different bank under the same cues — so switching profiles in the editor
//! swaps a bank rather than re-planning, and the export's plan is the
//! preview's plan by construction.
//!
//! The variation here is what stops a run of presses sounding like a machine
//! gun: no two consecutive presses of a kind share a variant, every press is a
//! little louder or quieter than the last, and letters wander slightly across
//! the stereo image the way hands do across a board.

use prequel_session::{KeyPress, MediaTime};

use crate::bank::VARIANTS;
use crate::profile::CueKind;
use crate::rng::Rng;

/// One sound to place.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Cue {
    /// The press, on the recording's timeline. The player puts the voice's
    /// `onset` here.
    pub at: MediaTime,
    pub kind: CueKind,
    pub variant: u8,
    /// Linear gain, before the slice's own volume.
    pub gain: f32,
    /// -1 left to +1 right.
    pub pan: f32,
}

/// Two presses of the same kind closer than this are one sound.
///
/// Twelve milliseconds: rollover on a real board — two fingers landing almost
/// together — is one sound to the ear, and a stuck key reporting twice would
/// otherwise double every voice. Two *different* kinds this close both play:
/// Shift and a letter land together all day.
pub const MIN_SAME_KIND_GAP: MediaTime = 12_000_000;

/// Level jitter per press, in dB either way.
const JITTER_DB: f32 = 2.0;

/// A long key on a stabiliser is a bigger cap and a heavier hit.
const LONG_KEY_DB: f32 = 2.5;

/// A modifier is pressed with the side of a finger and held; softer.
const MODIFIER_DB: f32 = -4.0;

/// How far a letter may sit off centre.
const LETTER_SPREAD: f32 = 0.15;

/// Plans the sounds for a recording.
///
/// `presses` and `clicks` need not be sorted; the result is, by `at`, with a
/// stable order for equal moments. `seed` is the recording's id, so the plan
/// for a recording is the same every time it is opened.
pub fn cues(presses: &[KeyPress], clicks: &[MediaTime], seed: &str) -> Vec<Cue> {
    let mut events: Vec<(MediaTime, CueKind)> = presses
        .iter()
        .map(|press| (press.at, CueKind::from(press.class)))
        .chain(clicks.iter().map(|at| (*at, CueKind::Click)))
        .collect();
    events.sort_by_key(|(at, _)| *at);

    let mut rng = Rng::from_str(seed);
    let mut last_at: [Option<MediaTime>; 6] = [None; 6];
    let mut last_variant: [Option<u8>; 6] = [None; 6];
    let mut out = Vec::with_capacity(events.len());

    for (at, kind) in events {
        let slot = usize::from(kind.index());

        if let Some(previous) = last_at[slot]
            && at.saturating_sub(previous) < MIN_SAME_KIND_GAP
        {
            continue;
        }
        last_at[slot] = Some(at);

        // Drawn from the range one short and stepped past the last, so the
        // choice is uniform over the eleven that are not a repeat.
        let mut variant = rng.below(VARIANTS - 1) as u8;
        if let Some(previous) = last_variant[slot]
            && variant >= previous
        {
            variant += 1;
        }
        last_variant[slot] = Some(variant);

        let base_db = match kind {
            CueKind::Space | CueKind::Enter | CueKind::Backspace => LONG_KEY_DB,
            CueKind::Modifier => MODIFIER_DB,
            CueKind::Letter | CueKind::Click => 0.0,
        };
        let gain = db(base_db + rng.range(-JITTER_DB, JITTER_DB));

        // Always drawn, even for the kinds that ignore it, so a kind's place
        // in the sequence of draws does not depend on which kinds came before.
        let wander = rng.range(-LETTER_SPREAD, LETTER_SPREAD);
        let pan = match kind {
            CueKind::Letter => wander,
            // Return and Delete sit at the right hand; the modifiers a typist
            // holds are mostly on the left.
            CueKind::Enter | CueKind::Backspace => LETTER_SPREAD,
            CueKind::Modifier => -LETTER_SPREAD,
            CueKind::Space | CueKind::Click => 0.0,
        };

        out.push(Cue {
            at,
            kind,
            variant,
            gain,
            pan,
        });
    }

    out
}

fn db(value: f32) -> f32 {
    10f32.powf(value / 20.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use prequel_session::KeyClass;

    const MS: MediaTime = 1_000_000;

    fn press(ms: MediaTime, class: KeyClass) -> KeyPress {
        KeyPress { at: ms * MS, class }
    }

    fn letters(count: usize, gap_ms: MediaTime) -> Vec<KeyPress> {
        (0..count)
            .map(|i| press(100 + i as MediaTime * gap_ms, KeyClass::Letter))
            .collect()
    }

    #[test]
    fn the_same_recording_plans_the_same_sounds() {
        let presses = letters(50, 90);
        let clicks = [3_000 * MS, 7_500 * MS];
        assert_eq!(
            cues(&presses, &clicks, "take-1"),
            cues(&presses, &clicks, "take-1")
        );
        assert_ne!(
            cues(&presses, &clicks, "take-1"),
            cues(&presses, &clicks, "take-2")
        );
    }

    #[test]
    fn cues_come_out_in_time_order_whatever_order_they_went_in() {
        let mut presses = letters(20, 90);
        presses.reverse();
        let clicks = [2_000 * MS, 50 * MS];
        let planned = cues(&presses, &clicks, "x");
        assert_eq!(planned.len(), 22);
        assert!(planned.windows(2).all(|pair| pair[0].at <= pair[1].at));
        assert_eq!(planned[0].kind, CueKind::Click);
        assert_eq!(planned[0].at, 50 * MS);
    }

    #[test]
    fn a_press_never_repeats_the_variant_before_it() {
        let planned = cues(&letters(500, 60), &[], "many");
        assert_eq!(planned.len(), 500);
        assert!(
            planned
                .windows(2)
                .all(|pair| pair[0].variant != pair[1].variant)
        );
        assert!(
            planned
                .iter()
                .all(|cue| usize::from(cue.variant) < VARIANTS)
        );
        // And uses all of them — a stuck generator would pass the test above.
        let distinct: std::collections::HashSet<u8> = planned.iter().map(|c| c.variant).collect();
        assert_eq!(distinct.len(), VARIANTS);
    }

    #[test]
    fn two_presses_almost_together_are_one_sound() {
        // Rollover, or a switch that bounced. 5 ms apart is one; 20 ms is two.
        let close = [press(100, KeyClass::Letter), press(105, KeyClass::Letter)];
        assert_eq!(cues(&close, &[], "s").len(), 1);
        let apart = [press(100, KeyClass::Letter), press(120, KeyClass::Letter)];
        assert_eq!(cues(&apart, &[], "s").len(), 2);
        // But Shift and a letter landing together are two sounds.
        let chord = [press(100, KeyClass::Modifier), press(103, KeyClass::Letter)];
        assert_eq!(cues(&chord, &[], "s").len(), 2);
    }

    #[test]
    fn a_long_key_is_louder_than_a_letter_and_a_modifier_softer() {
        let mean = |class: KeyClass| {
            let presses: Vec<KeyPress> = (0..200).map(|i| press(100 + i * 50, class)).collect();
            let planned = cues(&presses, &[], "gain");
            planned.iter().map(|c| c.gain).sum::<f32>() / planned.len() as f32
        };
        assert!(mean(KeyClass::Space) > mean(KeyClass::Letter));
        assert!(mean(KeyClass::Modifier) < mean(KeyClass::Letter));
        // Loud enough to matter, never so loud a -6 dBFS voice clips on its own.
        for cue in cues(&letters(200, 50), &[], "peak") {
            assert!(cue.gain > 0.5 && cue.gain < 1.5, "{}", cue.gain);
        }
    }

    #[test]
    fn pans_stay_narrow_and_the_space_bar_stays_centred() {
        let presses: Vec<KeyPress> = KeyClass::ALL
            .into_iter()
            .cycle()
            .take(100)
            .enumerate()
            .map(|(i, class)| press(100 + i as MediaTime * 50, class))
            .collect();
        for cue in cues(&presses, &[500 * MS], "pan") {
            assert!(cue.pan.abs() <= LETTER_SPREAD + 1e-6);
            if matches!(cue.kind, CueKind::Space | CueKind::Click) {
                assert_eq!(cue.pan, 0.0);
            }
        }
    }
}
