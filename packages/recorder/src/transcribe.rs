//! Driving on-device transcription from JavaScript.
//!
//! Shaped exactly like `export.rs`, and for the same reasons: a plain
//! `std::thread` rather than `AsyncTask`, because transcribing a long take runs
//! for as long as an export and would otherwise hold one of libuv's four
//! default threadpool slots for the whole of it; progress through a threadsafe
//! function; and completion delivered as a terminal progress event rather than
//! a resolved promise, so there is one channel and no race between "done" and
//! the tick before it.
//!
//! The words cross as a JSON string, the way the render plan already does — it
//! is the one representation both sides agree on, and a napi object per word
//! would be a structural conversion of every word in a half-hour recording.

use std::sync::Mutex;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

use prequel_speech::{Cancel, SpeechError};

/// What macOS can transcribe on this machine.
#[napi(object)]
#[derive(Debug)]
pub struct SpeechAvailability {
    /// `SpeechTranscriber`: macOS 26 and up, no permission, no length ceiling.
    pub analyzer: bool,
    /// `SFSpeechRecognizer` with an on-device model for the locale.
    pub recogniser: bool,
    /// The locale actually asked about, echoed back.
    pub locale: String,
}

#[napi(object)]
#[derive(Debug)]
pub struct TranscribeOptions {
    /// Absolute path to the audio, normally the recording's `mic.m4a`.
    pub audio: String,
    /// BCP-47. The engine may resolve it to a near neighbour it does have.
    pub locale: String,
}

#[napi(object)]
#[derive(Debug)]
pub struct TranscribeUpdate {
    /// `"preparing"`, `"transcribing"`, `"done"`, `"failed"` or `"cancelled"`.
    pub stage: String,
    /// How far through the audio, 0-1, or absent when the stage has no measure.
    pub progress: Option<f64>,
    /// The words, as JSON, present only on `done`.
    pub words: Option<String>,
    pub language: Option<String>,
    pub model: Option<String>,
    /// `"native"` or `"interpolated"`, present only on `done`.
    pub timings: Option<String>,
    /// The code the editor turns into something a user can act on.
    pub code: Option<String>,
    pub message: Option<String>,
}

/// The transcription currently running, if any.
///
/// Process-wide, matching the export. Two runs over the same recording would
/// both write `transcript.json` and the loser would overwrite the winner.
static RUNNING: Mutex<Option<Cancel>> = Mutex::new(None);

/// What this machine can do. Cheap, and never puts a permission dialog on screen.
#[napi]
pub fn speech_availability(locale: String) -> SpeechAvailability {
    let available = prequel_speech::availability(&locale);

    SpeechAvailability {
        analyzer: available.analyzer,
        recogniser: available.recogniser,
        locale: available.locale,
    }
}

/// Starts a transcription. Returns immediately; everything else is on the callback.
#[napi]
pub fn start_transcribe(
    options: TranscribeOptions,
    on_progress: ThreadsafeFunction<TranscribeUpdate, ()>,
) -> Result<()> {
    let cancel = Cancel::new();

    {
        let mut slot = RUNNING.lock().map_err(|_| {
            Error::from_reason("TRANSCRIBE_POISONED: the transcription lock is poisoned")
        })?;
        if slot.is_some() {
            return Err(Error::from_reason(
                "ALREADY_TRANSCRIBING: a transcription is already running",
            ));
        }
        *slot = Some(cancel.clone());
    }

    std::thread::spawn(move || {
        let emit = |update: TranscribeUpdate| {
            // Non-blocking: a slow renderer must not stall the engine, and a
            // dropped progress tick costs nothing.
            on_progress.call(Ok(update), ThreadsafeFunctionCallMode::NonBlocking);
        };

        // Before any audio is read. On a machine that has never transcribed
        // this covers a model download, which is minutes with nothing to
        // divide — hence a stage rather than a percentage.
        emit(update("preparing", None));

        let result = prequel_speech::transcribe(
            options.audio.as_ref(),
            &options.locale,
            &cancel,
            &mut |fraction| emit(update("transcribing", Some(fraction))),
        );

        emit(match result {
            Ok(transcription) => match serde_json::to_string(&Words(&transcription.words)) {
                Ok(words) => TranscribeUpdate {
                    stage: "done".to_owned(),
                    progress: Some(1.0),
                    words: Some(words),
                    language: Some(transcription.language),
                    model: Some(transcription.model),
                    timings: Some(transcription.timings),
                    code: None,
                    message: None,
                },
                Err(err) => failed("FAILED", &format!("could not encode the words: {err}")),
            },
            // Cancellation reaches the engine between chunks, so it comes back
            // as a refusal with this code rather than as a separate channel.
            Err(SpeechError::Refused { code, .. }) if code == "CANCELLED" => {
                update("cancelled", None)
            }
            Err(err) => failed(err.code(), &err.to_string()),
        });

        if let Ok(mut slot) = RUNNING.lock() {
            *slot = None;
        }
    });

    Ok(())
}

/// Asks the running transcription to stop. Safe to call when nothing is running.
#[napi]
pub fn cancel_transcribe() -> Result<()> {
    let slot = RUNNING.lock().map_err(|_| {
        Error::from_reason("TRANSCRIBE_POISONED: the transcription lock is poisoned")
    })?;
    if let Some(cancel) = slot.as_ref() {
        cancel.cancel();
    }
    Ok(())
}

fn update(stage: &str, progress: Option<f64>) -> TranscribeUpdate {
    TranscribeUpdate {
        stage: stage.to_owned(),
        progress,
        words: None,
        language: None,
        model: None,
        timings: None,
        code: None,
        message: None,
    }
}

fn failed(code: &str, message: &str) -> TranscribeUpdate {
    TranscribeUpdate {
        stage: "failed".to_owned(),
        progress: None,
        words: None,
        language: None,
        model: None,
        timings: None,
        code: Some(code.to_owned()),
        message: Some(message.to_owned()),
    }
}

/// Serialises words into the shape `main/transcribe/apple.ts` reads.
///
/// Written out here rather than deriving `Serialize` on `prequel_speech::Word`,
/// so the crate's own type is not also a wire format that this file's consumer
/// depends on.
struct Words<'a>(&'a [prequel_speech::Word]);

impl serde::Serialize for Words<'_> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeSeq;

        let mut seq = serializer.serialize_seq(Some(self.0.len()))?;
        for word in self.0 {
            seq.serialize_element(&serde_json::json!({
                // Seconds here, nanoseconds on the other side. The conversion —
                // and the microphone's late start with it — happens once, in
                // `onSessionClock`.
                "at": word.at,
                "end": word.end,
                "text": word.text,
                "confidence": word.confidence,
            }))?;
        }
        seq.end()
    }
}
