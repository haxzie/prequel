//! Live recognition from the microphone, for the teleprompter.
//!
//! The Swift side (`swift/listen.swift`) owns the microphone and the engine;
//! this owns the callback's lifetime. A [`Listener`] holds the boxed closure
//! the C callback trampolines into, and stopping — explicitly or by drop —
//! goes through Swift first, which guarantees no callback is running or
//! pending by the time the box is freed.
use std::ffi::{CStr, CString, c_char, c_void};

use serde::Deserialize;

use crate::SpeechError;

unsafe extern "C" {
    fn prequel_speech_listen_start(
        locale: *const c_char,
        contextual: *const c_char,
        microphone: *const c_char,
        ctx: *mut c_void,
        on_update: extern "C" fn(*mut c_void, *const c_char),
    ) -> *mut c_void;

    fn prequel_speech_listen_stop(handle: *mut c_void);
}

/// One thing the engine has to say.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct ListenUpdate {
    /// `listening`, `level`, `partial`, `final`, `failed` or `stopped`.
    pub stage: String,
    /// The session's running hypothesis, on `partial` and `final`.
    #[serde(default)]
    pub text: Option<String>,
    /// Which hypothesis this belongs to; a new number is a fresh start.
    #[serde(default)]
    pub session: Option<u32>,
    /// Microphone level, 0–1, on `level`.
    #[serde(default)]
    pub level: Option<f64>,
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
}

/// What the engine is told to expect and favour.
pub struct ListenOptions<'a> {
    /// BCP-47. Resolved to a near neighbour the engine has a model for.
    pub locale: &'a str,
    /// Words to favour: the script's own vocabulary.
    pub contextual: &'a [String],
    /// The microphone to open, by the name AVFoundation gives it, or `None`
    /// for the system default. See `listen.swift`.
    pub microphone: Option<&'a str>,
}

type Callback = Box<dyn FnMut(ListenUpdate) + Send>;

/// A live session. Stops when dropped.
pub struct Listener {
    handle: *mut c_void,
    /// Owned here and pointed at from Swift; freed only after Swift has stopped.
    callback: *mut Callback,
}

// The handle is an `Unmanaged` Swift object and the callback box is only ever
// touched from Swift's serial queue; both are safe to move between threads.
unsafe impl Send for Listener {}

impl Listener {
    /// Starts listening. Updates arrive on `on_update` from a background thread.
    pub fn start(
        options: ListenOptions<'_>,
        on_update: impl FnMut(ListenUpdate) + Send + 'static,
    ) -> Result<Self, SpeechError> {
        let locale = CString::new(options.locale)
            .map_err(|_| SpeechError::Path("locale has a nul in it".into()))?;
        let contextual = serde_json::to_string(options.contextual)
            .map_err(|cause| SpeechError::Decode(cause.to_string()))?;
        let contextual = CString::new(contextual)
            .map_err(|_| SpeechError::Path("a contextual string has a nul in it".into()))?;
        // Empty means the default; Swift reads it that way rather than being
        // handed a null it would have to check for.
        let microphone = CString::new(options.microphone.unwrap_or(""))
            .map_err(|_| SpeechError::Path("the microphone name has a nul in it".into()))?;

        let callback: *mut Callback = Box::into_raw(Box::new(Box::new(on_update)));

        let handle = unsafe {
            prequel_speech_listen_start(
                locale.as_ptr(),
                contextual.as_ptr(),
                microphone.as_ptr(),
                callback.cast(),
                on_update_trampoline,
            )
        };

        if handle.is_null() {
            // Swift has already reported why through the callback, and has
            // nothing holding the context — so it is ours to free.
            drop(unsafe { Box::from_raw(callback) });
            return Err(SpeechError::Refused {
                code: "FAILED".into(),
                message: "listening could not start".into(),
            });
        }

        Ok(Self { handle, callback })
    }

    /// Stops listening. Safe to call more than once; `Drop` calls it too.
    pub fn stop(&mut self) {
        if self.handle.is_null() {
            return;
        }
        // Swift returns only once no callback is running or will run, which
        // is what makes freeing the box below sound.
        unsafe { prequel_speech_listen_stop(self.handle) };
        self.handle = std::ptr::null_mut();
        drop(unsafe { Box::from_raw(self.callback) });
        self.callback = std::ptr::null_mut();
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        self.stop();
    }
}

extern "C" fn on_update_trampoline(ctx: *mut c_void, json: *const c_char) {
    if ctx.is_null() || json.is_null() {
        return;
    }
    let text = unsafe { CStr::from_ptr(json) }.to_string_lossy();
    let update: ListenUpdate = match serde_json::from_str(&text) {
        Ok(update) => update,
        Err(cause) => ListenUpdate {
            stage: "failed".into(),
            text: None,
            session: None,
            level: None,
            code: Some("FAILED".into()),
            message: Some(format!("could not read what the engine said: {cause}")),
        },
    };
    let callback = unsafe { &mut *ctx.cast::<Callback>() };
    callback(update);
}
