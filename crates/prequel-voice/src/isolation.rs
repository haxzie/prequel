//! Apple's voice isolation audio unit, driven offline.
//!
//! `AUSoundIsolation` — `aufx`/`vois`/`appl` — is the unit behind Logic's "AU
//! Sound Isolation" and Final Cut's voice isolation. It is public API from
//! macOS 13, and the neural net it runs ships with the OS inside
//! `AudioDSP.component`, so there is no model to bundle and nothing to
//! download. Measured on nine seconds of speech over pink noise and mains
//! hum: the noise floor drops 52 dB while the voice loses 0.9, and the nine
//! seconds render in a tenth of one.
//!
//! The mechanics of opening and rendering a unit live in `unit.rs`; this is
//! only what is particular to this one.
//!
//! **Mono.** The unit is a model of a voice, and a voice is one signal — so
//! the track goes in and comes out as one channel, whatever the microphone
//! offered. Everything downstream reads through `AVAssetReader` or an
//! `<audio>` element, both of which put a mono track on both speakers.

use cidre::at::au;

use crate::Result;
use crate::unit::Effect;

/// Which of the unit's two models runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Quality {
    /// `kAUSoundIsolationSoundType_HighQualityVoice`. The gentler of the two:
    /// on the same clip it took the noise floor down 26 dB where [`Strong`]
    /// took it down 52, and left the voice a decibel closer to untouched.
    ///
    /// macOS 15 and up. On 14 the parameter takes only [`Strong`], and asking
    /// for this one is a parameter error rather than a quieter result — see
    /// [`natural_is_available`].
    ///
    /// [`Strong`]: Quality::Strong
    #[default]
    Natural,
    /// `kAUSoundIsolationSoundType_Voice`. Removes very nearly everything that
    /// is not speech, at the cost of thinning the voice slightly.
    Strong,
}

impl Quality {
    /// The value `kAUSoundIsolationParam_SoundToIsolate` takes.
    fn sound_type(self) -> f32 {
        match self {
            Self::Natural => 0.0,
            Self::Strong => 1.0,
        }
    }

    /// The model this machine can actually run, which on macOS 14 is one.
    pub fn available(self) -> Self {
        if self == Self::Natural && !natural_is_available() {
            Self::Strong
        } else {
            self
        }
    }
}

/// One open unit, fed a chunk at a time.
pub struct Isolation(Effect);

impl Isolation {
    /// Opens the unit at `sample_rate`, isolating `amount` of the voice.
    ///
    /// `amount` runs 0 to 1 and reaches the unit as its wet/dry mix. The blend
    /// is linear in amplitude, not in decibels: half wet leaves half the
    /// original noise, which is 6 dB down, not half of the 52 the unit can
    /// manage. Whoever draws the slider decides what its middle means.
    pub fn open(sample_rate: f64, amount: f32, quality: Quality) -> Result<Self> {
        let quality = quality.available();
        let effect = Effect::open(
            au::SubType::SOUND_ISOLATION,
            sample_rate,
            |_| Ok(()),
            |effect| {
                effect.set(
                    au::ParamId::SOUND_ISOLATION_SOUND_TO_ISOLATE,
                    quality.sound_type(),
                )?;
                effect.set(
                    au::ParamId::SOUND_ISOLATION_WET_DRY_MIX_PERCENT,
                    amount.clamp(0.0, 1.0) * 100.0,
                )
            },
        )?;

        Ok(Self(effect))
    }

    /// Frames of lookahead the unit adds, which the caller has to drop.
    pub fn latency(&self) -> u64 {
        self.0.latency()
    }

    /// Runs one chunk: `samples` in, the unit's answer back in its place.
    pub fn process(&mut self, samples: &mut [f32]) -> Result<()> {
        self.0.process(samples)
    }
}

/// Whether the gentler model is on this machine at all.
///
/// `HighQualityVoice` arrived in macOS 15; the unit itself, and `Voice`, go
/// back to 13. The app runs on 14, so this is a real branch and not a
/// formality.
pub fn natural_is_available() -> bool {
    cidre::api::macos_available("15.0")
}
