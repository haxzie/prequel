//! ScreenCaptureKit-backed capture primitives for Prequel.
//!
//! macOS only. Everything here targets macOS 14+ and goes through
//! ScreenCaptureKit — the legacy `CGDisplayStream` / `CGWindowListCreateImage`
//! paths are deprecated and make modern macOS show the user a security warning.

mod cursor;
mod error;
mod permission;
mod recorder;
mod targets;
mod typing;
mod wallpaper;

pub use cursor::CursorSample;
pub use error::{Error, Result};
pub use permission::{PermissionStatus, request_screen_access, screen_access_status};
pub use recorder::{
    MICROPHONE_FILE, RecordOptions, RecordingSummary, SCREEN_FILE, SYSTEM_AUDIO_FILE,
    ScreenRecorder,
};
pub use targets::{
    Bounds, Target, TargetKind, find_target, is_display_asleep, list_targets, main_display_asleep,
};
pub use typing::{TypingSample, is_trusted as accessibility_trusted};
pub use wallpaper::capture_wallpaper;

pub use prequel_encode::VideoCodec;
// Re-exported so a caller driving both pipelines does not have to depend on
// `prequel-session` just to construct the clock they share.
pub use prequel_session::SharedClock;
