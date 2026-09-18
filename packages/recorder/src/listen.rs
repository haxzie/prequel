//! Driving live recognition from JavaScript, for the teleprompter.
//!
//! Shaped like `transcribe.rs`: one process-wide slot, updates through a
//! threadsafe function, and nothing returned but the fact that it started.
//! Unlike a transcription there is no end to wait for — it runs until
//! `stop_listening`, and a `failed` update is the only other way it ends.

use std::sync::Mutex;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

use prequel_speech::{ListenOptions as Options, Listener};

/// The session running, if any. One at a time: there is one microphone and
/// one island, and a second session would double every update.
static LISTENING: Mutex<Option<Listener>> = Mutex::new(None);

#[napi(object)]
#[derive(Debug)]
pub struct ListenOptions {
    /// BCP-47. The engine may resolve it to a near neighbour it does have.
    pub locale: String,
    /// Words the engine should expect — the script's own vocabulary.
    pub vocabulary: Vec<String>,
    /// The microphone to listen with, by `localizedName`. Omit for the
    /// system default.
    pub microphone: Option<String>,
}

#[napi(object)]
#[derive(Debug)]
pub struct ListenUpdate {
    /// `"listening"`, `"level"`, `"partial"`, `"final"`, `"failed"` or `"stopped"`.
    pub stage: String,
    /// The session's running hypothesis, as text.
    pub text: Option<String>,
    /// Which hypothesis this belongs to; a new number is a fresh start.
    pub session: Option<u32>,
    /// Microphone level, 0–1.
    pub level: Option<f64>,
    pub code: Option<String>,
    pub message: Option<String>,
}

/// Starts listening. Returns at once; everything else is on the callback.
#[napi]
pub fn start_listening(
    options: ListenOptions,
    on_update: ThreadsafeFunction<ListenUpdate, ()>,
) -> Result<()> {
    let mut slot = LISTENING
        .lock()
        .map_err(|_| Error::from_reason("LISTEN_POISONED: the listening lock is poisoned"))?;
    if slot.is_some() {
        return Err(Error::from_reason(
            "ALREADY_LISTENING: the microphone is already being listened to",
        ));
    }

    let listener = Listener::start(
        Options {
            locale: &options.locale,
            contextual: &options.vocabulary,
            microphone: options.microphone.as_deref(),
        },
        move |update| {
            // Non-blocking: a slow renderer must not stall the engine, and a
            // dropped level tick costs nothing.
            on_update.call(
                Ok(ListenUpdate {
                    stage: update.stage,
                    text: update.text,
                    session: update.session,
                    level: update.level,
                    code: update.code,
                    message: update.message,
                }),
                ThreadsafeFunctionCallMode::NonBlocking,
            );
        },
    )
    .map_err(|cause| Error::from_reason(format!("{}: {cause}", cause.code())))?;

    *slot = Some(listener);
    Ok(())
}

/// Stops listening. Safe when nothing is listening.
#[napi]
pub fn stop_listening() -> Result<()> {
    let mut slot = LISTENING
        .lock()
        .map_err(|_| Error::from_reason("LISTEN_POISONED: the listening lock is poisoned"))?;
    // Dropping the listener stops it, and stopping returns only once the
    // callback can no longer fire.
    *slot = None;
    Ok(())
}
