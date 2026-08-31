//! On-device speech recognition.
//!
//! The whole of the Apple work is in `swift/speech.swift`; this is the safe
//! face of it. Two engines live behind one call — `SpeechAnalyzer` on macOS 26
//! and up, `SFSpeechRecognizer` below it — and which one ran is visible only in
//! [`Transcription::model`].
//!
//! Nothing here reaches the network, and it must stay that way: the recogniser
//! is asked for on-device recognition and told to fail rather than fall back to
//! Apple's servers if the machine has no model for the language.
//!
//! Times come back in seconds from the start of the file, which is where they
//! stay. The microphone track's late start lives only in `session.json`, and
//! applying it is `onSessionClock`'s job in the editor — doing it here as well
//! is what puts every caption a few hundred milliseconds out.
use std::{
    ffi::{CStr, CString, c_char, c_double, c_int, c_void},
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use serde::Deserialize;

pub mod stitch;

unsafe extern "C" {
    fn prequel_speech_probe(locale: *const c_char) -> *mut c_char;

    fn prequel_speech_transcribe(
        path: *const c_char,
        locale: *const c_char,
        ctx: *mut c_void,
        on_progress: extern "C" fn(*mut c_void, c_double),
        cancelled: extern "C" fn(*mut c_void) -> c_int,
    ) -> *mut c_char;

    fn prequel_speech_free(text: *mut c_char);
}

/// One word, on the file's own clock.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct Word {
    /// Seconds from the start of the audio.
    pub at: f64,
    pub end: f64,
    pub text: String,
    /// 0-1. An engine that does not score a word reports 1.
    pub confidence: f64,
}

#[derive(Debug, Clone)]
pub struct Transcription {
    pub words: Vec<Word>,
    /// BCP-47, as the engine resolved it — not necessarily what was asked for.
    pub language: String,
    /// Which engine ran, so the editor can say so and a bug report can name it.
    pub model: String,
    /// `native` or `interpolated`, in the editor's own vocabulary.
    pub timings: String,
}

/// What this machine can do, without asking anyone for permission.
#[derive(Debug, Clone, Deserialize)]
pub struct Availability {
    /// `SpeechTranscriber`, which needs no authorisation and has no ceiling.
    pub analyzer: bool,
    /// `SFSpeechRecognizer` with an on-device model for the locale.
    pub recogniser: bool,
    pub locale: String,
}

impl Availability {
    /// Whether anything here can transcribe at all.
    pub fn any(&self) -> bool {
        self.analyzer || self.recogniser
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SpeechError {
    /// Carries the Swift side's own code, which `apple.ts` maps to a message.
    #[error("{message}")]
    Refused { code: String, message: String },
    #[error("the path is not something that can be handed to macOS: {0}")]
    Path(String),
    #[error("could not read what the speech engine returned: {0}")]
    Decode(String),
}

impl SpeechError {
    /// The code the editor branches on, for anything it can tell a user about.
    pub fn code(&self) -> &str {
        match self {
            Self::Refused { code, .. } => code,
            _ => "FAILED",
        }
    }
}

/// A flag the caller can raise to stop a run in progress.
///
/// Shaped like `prequel_render`'s: transcription runs for as long as an export
/// does on a long take, and "stop" has to reach it between chunks rather than
/// only at the end.
#[derive(Clone, Default)]
pub struct Cancel(Arc<AtomicBool>);

impl Cancel {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// What macOS can transcribe here. Never prompts, so it is safe to call eagerly.
pub fn availability(locale: &str) -> Availability {
    let fallback = Availability {
        analyzer: false,
        recogniser: false,
        locale: locale.to_owned(),
    };

    let Ok(locale) = CString::new(locale) else {
        return fallback;
    };

    let raw = unsafe { prequel_speech_probe(locale.as_ptr()) };
    let Some(json) = take(raw) else {
        return fallback;
    };

    serde_json::from_str(&json).unwrap_or(fallback)
}

/// Everything the caller needs to drive one run.
struct Progress<'a> {
    cancel: &'a Cancel,
    report: &'a mut dyn FnMut(f64),
}

/// Transcribes a file, blocking until it is done.
///
/// Long-running: call it on a thread of its own. `report` is handed a fraction
/// of the audio consumed, which is not the same as a fraction of the wall clock
/// — the model download on a first run happens before any of it.
pub fn transcribe(
    path: &Path,
    locale: &str,
    cancel: &Cancel,
    report: &mut dyn FnMut(f64),
) -> Result<Transcription, SpeechError> {
    let path_c = CString::new(path.as_os_str().as_encoded_bytes())
        .map_err(|_| SpeechError::Path(path.display().to_string()))?;
    let locale_c =
        CString::new(locale).map_err(|_| SpeechError::Path("locale has a nul in it".into()))?;

    let mut progress = Progress { cancel, report };

    let raw = unsafe {
        prequel_speech_transcribe(
            path_c.as_ptr(),
            locale_c.as_ptr(),
            (&raw mut progress).cast(),
            on_progress,
            is_cancelled,
        )
    };

    let json = take(raw).ok_or_else(|| SpeechError::Decode("no result".into()))?;

    #[derive(Deserialize)]
    struct Answer {
        ok: bool,
        #[serde(default)]
        code: String,
        #[serde(default)]
        message: String,
        #[serde(default)]
        language: String,
        #[serde(default)]
        model: String,
        #[serde(default)]
        timings: String,
        #[serde(default)]
        words: Vec<Word>,
    }

    let answer: Answer =
        serde_json::from_str(&json).map_err(|cause| SpeechError::Decode(cause.to_string()))?;

    if !answer.ok {
        return Err(SpeechError::Refused {
            code: answer.code,
            message: answer.message,
        });
    }

    Ok(Transcription {
        // Repaired rather than trusted. The times drive the caption clock, and
        // one word out of order shows up as a caption that flickers rather than
        // as bad data.
        words: stitch::tidy(answer.words),
        language: answer.language,
        model: answer.model,
        timings: answer.timings,
    })
}

/// Takes ownership of a string Swift `strdup`ed, and frees the original.
fn take(raw: *mut c_char) -> Option<String> {
    if raw.is_null() {
        return None;
    }

    let text = unsafe { CStr::from_ptr(raw) }.to_string_lossy().into_owned();
    unsafe { prequel_speech_free(raw) };
    Some(text)
}

extern "C" fn on_progress(ctx: *mut c_void, fraction: c_double) {
    if ctx.is_null() {
        return;
    }
    let progress = unsafe { &mut *ctx.cast::<Progress>() };
    (progress.report)(fraction);
}

extern "C" fn is_cancelled(ctx: *mut c_void) -> c_int {
    if ctx.is_null() {
        return 0;
    }
    let progress = unsafe { &*ctx.cast::<Progress>() };
    c_int::from(progress.cancel.is_cancelled())
}
