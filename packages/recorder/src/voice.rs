//! Cleaning a recorded microphone track, from JavaScript.
//!
//! An `AsyncTask` rather than the thread-and-callback shape `export.rs` and
//! `transcribe.rs` use. Those run for minutes and have a fraction worth
//! reporting; this renders around ninety times faster than real time and has
//! nothing to say in the middle, so a promise that resolves with the file is
//! the whole interface.

use std::path::PathBuf;

use napi::bindgen_prelude::*;
use napi_derive::napi;

use prequel_voice::{Enhancement, Quality};

/// How hard to clean, as the editor's control names it.
///
/// Two settings rather than a slider: the pass writes a file, so every value
/// is a render, and the unit's own useful range is two points rather than a
/// continuum — see `prequel_voice::Quality`.
#[napi(string_enum)]
#[derive(Debug)]
pub enum DenoiseLevel {
    /// Apple's gentler model, or half-strength of the other one on a machine
    /// too old to have it.
    Light,
    /// Everything that is not a voice, gone.
    Strong,
}

impl DenoiseLevel {
    fn enhancement(&self) -> Enhancement {
        match self {
            // `Quality::Natural` falls back to `Strong` on macOS 14, where it
            // does not exist — and `Strong` at full wet is not "light" by any
            // reading. Half wet is: a linear blend, so it leaves half the
            // noise, which is 6 dB down rather than 50.
            Self::Light if prequel_voice::natural_is_available() => Enhancement {
                amount: 1.0,
                quality: Quality::Natural,
            },
            Self::Light => Enhancement {
                amount: 0.5,
                quality: Quality::Strong,
            },
            Self::Strong => Enhancement {
                amount: 1.0,
                quality: Quality::Strong,
            },
        }
    }
}

pub struct Enhance {
    input: PathBuf,
    output: PathBuf,
    enhancement: Enhancement,
}

impl Task for Enhance {
    type Output = u32;
    type JsValue = u32;

    fn compute(&mut self) -> Result<Self::Output> {
        // Written under a neighbouring name and moved into place. The pass
        // takes seconds, and a quit part way through would otherwise leave a
        // half-written file under the name the editor is about to play — which
        // decodes as a truncated track rather than as a missing one, so
        // nothing downstream can tell it is wrong.
        let partial = self.output.with_extension("partial.m4a");

        let summary = prequel_voice::enhance(&self.input, &partial, self.enhancement)
            .map_err(|err| Error::from_reason(format!("DENOISE_FAILED: {err}")))?;

        std::fs::rename(&partial, &self.output).map_err(|err| {
            let _ = std::fs::remove_file(&partial);
            Error::from_reason(format!(
                "DENOISE_FAILED: could not put the cleaned track in place: {err}"
            ))
        })?;

        Ok((summary.frames / 48) as u32)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Cleans `input` into `output`, replacing whatever is there.
///
/// Resolves with the milliseconds of audio written, which is the recording's
/// own length: the caller already knows the path it asked for, and a length
/// that came back wrong is the one thing worth seeing in the log.
#[napi(ts_return_type = "Promise<number>")]
pub fn enhance_voice(input: String, output: String, level: DenoiseLevel) -> AsyncTask<Enhance> {
    AsyncTask::new(Enhance {
        input: PathBuf::from(input),
        output: PathBuf::from(output),
        enhancement: level.enhancement(),
    })
}

/// Whether this machine can clean a microphone track at all.
///
/// The audio unit is macOS 13 and up and the app runs on 14, so this is only
/// ever false if Apple drops the component — but the editor has to draw
/// something either way, and a control that does nothing is worse than one
/// that is not there.
#[napi]
pub fn can_enhance_voice() -> bool {
    prequel_voice::is_available()
}
