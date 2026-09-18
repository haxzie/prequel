//! Every voice a profile can play, rendered once.
//!
//! A bank is a pure function of its profile: the variant seeds are fixed, so
//! the export's bank and the preview's bank are the same samples without either
//! having to send them to the other. Twelve variants a kind is enough that a
//! run of letters does not repeat inside a word, and small enough — about
//! 3.5 MB of `f32` for a keyboard — to cross to the renderer once and keep.

use crate::SAMPLE_RATE;
use crate::profile::{ClickProfile, CueKind, KeyProfile, Profile};
use crate::rng::Rng;
use crate::synth::render_voice;

/// Variants rendered per kind.
pub const VARIANTS: usize = 12;

#[derive(Debug, Clone, PartialEq)]
pub struct Bank {
    sample_rate: u32,
    /// Where the press falls in every voice. The same for all of them, so a
    /// player subtracts one number rather than one per voice.
    onset: usize,
    kinds: Vec<CueKind>,
    /// `kinds.len() * VARIANTS` voices, kind-major.
    voices: Vec<Vec<f32>>,
}

/// A bank laid flat, for crossing to JavaScript as two typed arrays.
///
/// `offsets` has one more entry than there are voices; voice `i` is
/// `samples[offsets[i]..offsets[i + 1]]`. One buffer rather than seventy-two
/// because a napi call per voice is seventy-two copies, and because a flat
/// `Float32Array` is exactly what `AudioBuffer.copyToChannel` takes a view of.
#[derive(Debug, Clone, PartialEq)]
pub struct Flat {
    pub sample_rate: u32,
    pub onset: u32,
    pub kinds: Vec<CueKind>,
    pub variants: u32,
    pub offsets: Vec<u32>,
    pub samples: Vec<f32>,
}

impl Bank {
    /// The five key kinds of a keyboard.
    pub fn keys(profile: KeyProfile) -> Self {
        Self::render(profile.id(), profile.table(), &CueKind::KEYS)
    }

    /// The one kind of a mouse.
    pub fn clicks(profile: ClickProfile) -> Self {
        Self::render(profile.id(), profile.table(), &[CueKind::Click])
    }

    fn render(id: &str, profile: &Profile, kinds: &[CueKind]) -> Self {
        let mut onset = 0;
        let mut voices = Vec::with_capacity(kinds.len() * VARIANTS);

        for kind in kinds {
            for variant in 0..VARIANTS {
                // Seeded by name, kind and index rather than by position in
                // the loop, so adding a kind or a profile leaves every existing
                // voice exactly as it was.
                let seed = Rng::from_str(&format!("{id}/{}/{variant}", kind.index())).next_u64();
                let voice = render_voice(profile, *kind, seed, SAMPLE_RATE);
                onset = voice.onset;
                voices.push(voice.samples);
            }
        }

        Self {
            sample_rate: SAMPLE_RATE,
            onset,
            kinds: kinds.to_vec(),
            voices,
        }
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn onset(&self) -> usize {
        self.onset
    }

    pub fn kinds(&self) -> &[CueKind] {
        &self.kinds
    }

    /// The samples for a cue, or `None` for a kind this bank does not have —
    /// a click asked of a keyboard bank, which a player treats as silence.
    pub fn voice(&self, kind: CueKind, variant: u8) -> Option<&[f32]> {
        let slot = self.kinds.iter().position(|k| *k == kind)?;
        let variant = usize::from(variant);
        if variant >= VARIANTS {
            return None;
        }
        self.voices
            .get(slot * VARIANTS + variant)
            .map(Vec::as_slice)
    }

    pub fn flatten(&self) -> Flat {
        let mut offsets = Vec::with_capacity(self.voices.len() + 1);
        let mut samples = Vec::with_capacity(self.voices.iter().map(Vec::len).sum());
        offsets.push(0);
        for voice in &self.voices {
            samples.extend_from_slice(voice);
            offsets.push(samples.len() as u32);
        }
        Flat {
            sample_rate: self.sample_rate,
            onset: self.onset as u32,
            kinds: self.kinds.clone(),
            variants: VARIANTS as u32,
            offsets,
            samples,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::synth::MAX_MS;

    #[test]
    fn a_bank_holds_every_variant_of_every_kind_it_claims() {
        let bank = Bank::keys(KeyProfile::Thock);
        for kind in CueKind::KEYS {
            for variant in 0..VARIANTS as u8 {
                assert!(bank.voice(kind, variant).is_some(), "{kind:?}/{variant}");
            }
            assert!(bank.voice(kind, VARIANTS as u8).is_none());
        }
        assert!(bank.voice(CueKind::Click, 0).is_none());

        let clicks = Bank::clicks(ClickProfile::Mechanical);
        assert!(clicks.voice(CueKind::Click, 0).is_some());
        assert!(clicks.voice(CueKind::Letter, 0).is_none());
    }

    #[test]
    fn flatten_round_trips() {
        let bank = Bank::keys(KeyProfile::Clicky);
        let flat = bank.flatten();
        assert_eq!(flat.offsets.len(), CueKind::KEYS.len() * VARIANTS + 1);
        for (slot, kind) in CueKind::KEYS.into_iter().enumerate() {
            for variant in 0..VARIANTS {
                let i = slot * VARIANTS + variant;
                let from = flat.offsets[i] as usize;
                let to = flat.offsets[i + 1] as usize;
                assert_eq!(
                    &flat.samples[from..to],
                    bank.voice(kind, variant as u8).unwrap()
                );
            }
        }
        assert_eq!(flat.onset as usize, bank.onset());
    }

    #[test]
    fn no_voice_outlives_the_cap() {
        let cap = (SAMPLE_RATE as f32 * MAX_MS / 1_000.0) as usize;
        for profile in KeyProfile::ALL {
            for voice in &Bank::keys(profile).voices {
                assert!(voice.len() <= cap);
            }
        }
    }

    #[test]
    fn two_renders_of_a_bank_are_identical() {
        assert_eq!(
            Bank::keys(KeyProfile::Linear),
            Bank::keys(KeyProfile::Linear)
        );
        assert_ne!(
            Bank::keys(KeyProfile::Linear),
            Bank::keys(KeyProfile::Tactile)
        );
    }
}
