//! Display geometry the shell cannot get from Electron.

use napi_derive::napi;

use prequel_capture as capture;

/// The strip along the top of a display that the notch and menu bar occupy.
#[napi(object)]
#[derive(Debug)]
pub struct DisplaySafeArea {
    /// Height in points. Zero on a display with no notch.
    pub top: f64,
    /// The notch's left edge in points from the display's left, if it has one.
    pub notch_left: Option<f64>,
    /// The notch's right edge, likewise.
    pub notch_right: Option<f64>,
}

/// What a display hides behind its camera, or null when no screen has that id.
///
/// Synchronous on purpose: it reads `NSScreen`, which is AppKit and wants the
/// main thread — and napi calls arrive on Electron's main thread, which is it.
#[napi]
pub fn display_safe_area(display_id: u32) -> Option<DisplaySafeArea> {
    capture::display_safe_area(display_id).map(|area| DisplaySafeArea {
        top: area.top,
        notch_left: area.notch.map(|(left, _)| left),
        notch_right: area.notch.map(|(_, right)| right),
    })
}
