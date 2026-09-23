//! The sound plan and its voices, for the editor's preview.
//!
//! The editor never synthesises a sound and never decides which variant a
//! press gets: it asks here for the cues of a recording once, and for a bank
//! per keyboard it needs, and plays what it is given. The export takes the
//! same cues back through `ExportOptions::sound` and renders the same banks
//! itself, which is how the two stay one plan.
//!
//! Struct-of-arrays rather than an array of objects. A five-minute typing
//! take is thousands of cues, and a bank is a million and a half samples; as
//! typed arrays each crosses as one buffer, and a flat `Float32Array` is what
//! `AudioBuffer.copyToChannel` takes a view of on the other side.

use napi::bindgen_prelude::*;
use napi_derive::napi;

use prequel_keysound::{
    Bank, ClickProfile, Cue, CueKind, KeyProfile, SAMPLE_RATE, cues, demo_clicks, demo_keys,
};
use prequel_session::{KeyClass, KeyPress};

/// What a recording noted about its input, as the manifest carries it.
#[napi(object)]
pub struct SoundEvents {
    /// Nanoseconds on the recording's timeline, one per press.
    pub press_at: Float64Array,
    /// The class of each press, as an index into `KeyClass::ALL`:
    /// letter, space, enter, backspace, modifier.
    pub press_class: Uint8Array,
    /// Nanoseconds, one per mouse click.
    pub click_at: Float64Array,
    /// The recording's id. The plan is drawn from it, so opening the same
    /// recording twice plans the same sounds.
    pub seed: String,
}

/// The plan: parallel arrays, one entry per cue, sorted by `at`.
#[napi(object)]
pub struct SoundCues {
    pub at: Float64Array,
    /// An index into `CueKind::ALL`: the five key classes, then click.
    pub kind: Uint8Array,
    pub variant: Uint8Array,
    pub gain: Float32Array,
    pub pan: Float32Array,
}

/// Every voice of one keyboard or mouse, flat.
///
/// Voice `i` is `samples[offsets[i]..offsets[i + 1]]`, where
/// `i = slot * variants + variant` and `slot` is the position of the voice's
/// kind in `kinds`.
#[napi(object)]
pub struct SoundBank {
    pub sample_rate: u32,
    /// The sample of every voice the press falls on. The finger's touch is
    /// before it, so a voice starts `onset` samples ahead of its cue.
    pub onset: u32,
    /// `CueKind` indices, in the order the voices are laid out.
    pub kinds: Uint8Array,
    pub variants: u32,
    pub offsets: Uint32Array,
    pub samples: Float32Array,
}

/// Plans the sounds for a recording.
#[napi]
pub fn sound_cues(events: SoundEvents) -> SoundCues {
    let presses: Vec<KeyPress> = events
        .press_at
        .iter()
        .zip(events.press_class.iter())
        .filter_map(|(at, class)| {
            Some(KeyPress {
                at: at.max(0.0) as u64,
                class: *KeyClass::ALL.get(usize::from(*class))?,
            })
        })
        .collect();
    let clicks: Vec<u64> = events
        .click_at
        .iter()
        .map(|at| at.max(0.0) as u64)
        .collect();

    SoundCues::from(cues(&presses, &clicks, &events.seed).as_slice())
}

/// Renders the bank for a keyboard or mouse profile by id.
///
/// An unknown id is an error here, where the caller can say so, rather than
/// silence: the editor only asks for ids it offered.
#[napi]
pub fn sound_bank(profile: String) -> Result<SoundBank> {
    let bank = if let Some(keys) = KeyProfile::from_id(&profile) {
        Bank::keys(keys)
    } else if let Some(clicks) = ClickProfile::from_id(&profile) {
        Bank::clicks(clicks)
    } else {
        return Err(Error::from_reason(format!(
            "UNKNOWN_SOUND: no keyboard or mouse is called {profile:?}"
        )));
    };

    let flat = bank.flatten();
    Ok(SoundBank {
        sample_rate: flat.sample_rate,
        onset: flat.onset,
        kinds: Uint8Array::new(flat.kinds.iter().map(|kind| kind.index()).collect()),
        variants: flat.variants,
        offsets: Uint32Array::new(flat.offsets),
        samples: Float32Array::new(flat.samples),
    })
}

/// A ready-mixed listen, for a picker's play button.
///
/// Not a bank: there is no cue to place, so the renderer decodes and starts
/// this outright rather than scheduling a voice against a plan. Its length is
/// whatever the profile needs — see `prequel_keysound::demo`.
#[napi(object)]
pub struct SoundSample {
    pub sample_rate: u32,
    /// Always 2. Stated rather than assumed, the way `SoundBank::variants` is.
    pub channels: u32,
    /// Interleaved, channel-minor: `samples[frame * channels + channel]`.
    pub samples: Float32Array,
}

/// The demo for a keyboard or a mouse by id — the picker's preview before a
/// profile has ever recorded anything. A phrase for a keyboard, one click for
/// a mouse.
#[napi]
pub fn sound_sample(profile: String) -> Result<SoundSample> {
    let samples = if let Some(keys) = KeyProfile::from_id(&profile) {
        demo_keys(keys)
    } else if let Some(clicks) = ClickProfile::from_id(&profile) {
        demo_clicks(clicks)
    } else {
        return Err(Error::from_reason(format!(
            "UNKNOWN_SOUND: no keyboard or mouse is called {profile:?}"
        )));
    };

    Ok(SoundSample {
        sample_rate: SAMPLE_RATE,
        channels: 2,
        samples: Float32Array::new(samples),
    })
}

impl From<&[Cue]> for SoundCues {
    fn from(cues: &[Cue]) -> Self {
        Self {
            at: Float64Array::new(cues.iter().map(|cue| cue.at as f64).collect()),
            kind: Uint8Array::new(cues.iter().map(|cue| cue.kind.index()).collect()),
            variant: Uint8Array::new(cues.iter().map(|cue| cue.variant).collect()),
            gain: Float32Array::new(cues.iter().map(|cue| cue.gain).collect()),
            pan: Float32Array::new(cues.iter().map(|cue| cue.pan).collect()),
        }
    }
}

// Typed arrays do not derive `Debug`, and `ExportOptions` does. Thousands of
// samples in a log line would not be a debug representation anyway.
impl std::fmt::Debug for SoundCues {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SoundCues")
            .field("cues", &self.at.len())
            .finish()
    }
}

impl SoundCues {
    /// Back to the crate's cues, for the export.
    ///
    /// An entry with a kind this build does not know is dropped rather than
    /// refused: the cues came from this same addon, so it cannot happen, and
    /// if it somehow did, one missing sound beats a failed export.
    pub fn to_cues(&self) -> Vec<Cue> {
        let count = self
            .at
            .len()
            .min(self.kind.len())
            .min(self.variant.len())
            .min(self.gain.len())
            .min(self.pan.len());
        (0..count)
            .filter_map(|i| {
                Some(Cue {
                    at: self.at[i].max(0.0) as u64,
                    kind: CueKind::from_index(self.kind[i])?,
                    variant: self.variant[i],
                    gain: self.gain[i],
                    pan: self.pan[i],
                })
            })
            .collect()
    }
}
