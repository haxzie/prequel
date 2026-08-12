//! Where text is being typed, sampled alongside the video.
//!
//! Not keystrokes. Nothing here reads what was typed, or that anything was: it
//! asks the Accessibility API which element has keyboard focus and, if that
//! element is somewhere text goes, where it is on screen. A zoom can then frame
//! the field being typed into, which is the thing anyone watching wants to see —
//! and the app never touches an event tap or a key code.
//!
//! Raw `extern "C"` rather than a binding, matching `cursor.rs` and
//! `permission.rs`: cidre has no Accessibility coverage, and the handful of
//! calls needed here do not justify a dependency.
//!
//! **This can block.** `AXUIElementCopyAttributeValue` is synchronous IPC into
//! the focused application, and an application that is busy — or hung — does
//! not answer. That is why the messaging timeout is set explicitly and why this
//! is sampled from its own thread rather than from the frame callback, where a
//! stalled app would stall the recording.

use std::ffi::{CString, c_char, c_void};

use prequel_session::MediaTime;

use crate::cursor::Region;

/// Roles worth following.
///
/// A focused button or window is not somewhere text goes, and framing one would
/// send the shot somewhere for no reason. `AXComboBox` and `AXSearchField` are
/// in because both take typing; `AXStaticText` is deliberately out.
const TEXT_ROLES: [&str; 4] = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"];

/// How often a field that has not moved is recorded again.
///
/// Without this the track says only *when focus arrived somewhere*, and a
/// minute of typing into one box is a single sample. Anything downstream then
/// has no way to tell it from a field that was clicked once and abandoned —
/// which is exactly the difference between holding a zoom and dropping it.
const HEARTBEAT_NS: MediaTime = 1_000_000_000;

/// How long to wait for an application to answer before giving up on it.
///
/// Short on purpose. A missed sample is a zoom that holds its last position for
/// a fifth of a second; a long wait is the recorder itself stuttering.
const MESSAGING_TIMEOUT: f32 = 0.05;

/// Where text was being typed, as a fraction of the captured frame.
///
/// The same units the cursor track uses, and for the same reasons: the display
/// origin and the crop are known only during capture, and fractions survive the
/// recording being opened on another machine.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TypingSample {
    pub at: MediaTime,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Collects focused text areas on the session timeline.
#[derive(Debug, Default)]
pub struct TypingTrack {
    region: Region,
    samples: Vec<TypingSample>,
    last: Option<TypingSample>,
}

impl TypingTrack {
    pub fn new(region: Region) -> Self {
        Self {
            region,
            ..Default::default()
        }
    }

    /// Records the focused text area, if there is one and it has moved.
    ///
    /// Nothing focused, or something focused that is not a text area, writes no
    /// sample at all — a gap, which whatever draws the track reads as "no
    /// answer here" rather than as an area of zero size at the origin.
    pub fn sample(&mut self, at: MediaTime) {
        if self.region.width <= 0.0 || self.region.height <= 0.0 {
            return;
        }

        let Some(rect) = focused_text_bounds() else {
            self.last = None;
            return;
        };

        let sample = TypingSample {
            at,
            x: (rect.origin.x - self.region.x) / self.region.width,
            y: (rect.origin.y - self.region.y) / self.region.height,
            width: rect.size.width / self.region.width,
            height: rect.size.height / self.region.height,
        };

        // A caret blinking in a field that has not moved is not news — but a
        // field that is *still* focused is, once a second. That heartbeat is
        // what turns "focus arrived here" into "text was going in here from
        // then until then", which is the only way to know how long to hold.
        if let Some(previous) = self.last
            && at.saturating_sub(previous.at) < HEARTBEAT_NS
            && (previous.x - sample.x).abs() < f64::EPSILON
            && (previous.y - sample.y).abs() < f64::EPSILON
            && (previous.width - sample.width).abs() < f64::EPSILON
        {
            return;
        }

        self.last = Some(sample);
        self.samples.push(sample);
    }

    pub fn take_samples(&mut self) -> Vec<TypingSample> {
        std::mem::take(&mut self.samples)
    }

    pub fn len(&self) -> usize {
        self.samples.len()
    }
}

/// Whether the app may ask the Accessibility API anything at all.
///
/// Checked rather than assumed: without the grant every call below returns an
/// error, and a track of nothing is indistinguishable from a recording where
/// nobody typed.
pub fn is_trusted() -> bool {
    // Safety: takes no arguments and only reads process state.
    unsafe { AXIsProcessTrusted() }
}

/// The focused element's bounds in global points, if it takes text.
fn focused_text_bounds() -> Option<CGRect> {
    // Safety: every `Copy` call hands back a +1 reference, and each is released
    // on both paths below. The system-wide element is created per call rather
    // than cached — it is cheap, and a cached one held across a permission
    // change goes stale.
    unsafe {
        let system = AXUIElementCreateSystemWide();
        if system.is_null() {
            return None;
        }
        // Before anything is asked of it, or the first question is the one that
        // hangs.
        AXUIElementSetMessagingTimeout(system, MESSAGING_TIMEOUT);

        let focused = copy_attribute(system, "AXFocusedUIElement");
        CFRelease(system);
        let focused = focused?;

        AXUIElementSetMessagingTimeout(focused, MESSAGING_TIMEOUT);

        let bounds = text_bounds(focused);
        CFRelease(focused);
        bounds
    }
}

/// The bounds of an element, if its role says text goes into it.
///
/// Safety: `element` must be a live `AXUIElementRef`; it is not released here.
unsafe fn text_bounds(element: *const c_void) -> Option<CGRect> {
    unsafe {
        let role = copy_attribute(element, "AXRole")?;
        let name = cf_string(role);
        CFRelease(role);

        if !TEXT_ROLES.contains(&name?.as_str()) {
            return None;
        }

        let position = copy_attribute(element, "AXPosition")?;
        let size = copy_attribute(element, "AXSize")?;

        let mut origin = CGPoint { x: 0.0, y: 0.0 };
        let mut extent = CGSize {
            width: 0.0,
            height: 0.0,
        };
        let ok = AXValueGetValue(position, AX_VALUE_CG_POINT, (&raw mut origin).cast())
            && AXValueGetValue(size, AX_VALUE_CG_SIZE, (&raw mut extent).cast());

        CFRelease(position);
        CFRelease(size);

        // A field with no area is one that has been laid out but not shown.
        (ok && extent.width > 0.0 && extent.height > 0.0).then_some(CGRect {
            origin,
            size: extent,
        })
    }
}

/// One attribute of an element, or None if it has none or would not answer.
///
/// Safety: `element` must be a live `AXUIElementRef`. The returned reference is
/// owned by the caller.
unsafe fn copy_attribute(element: *const c_void, name: &str) -> Option<*const c_void> {
    unsafe {
        // The attribute names are `CFSTR` macros in the headers rather than
        // exported symbols, so there is nothing to link against — they have to
        // be built here.
        let key = CString::new(name).ok()?;
        let attribute = CFStringCreateWithCString(std::ptr::null(), key.as_ptr(), UTF8);
        if attribute.is_null() {
            return None;
        }

        let mut value: *const c_void = std::ptr::null();
        let error = AXUIElementCopyAttributeValue(element, attribute, &raw mut value);
        CFRelease(attribute);

        (error == 0 && !value.is_null()).then_some(value)
    }
}

/// A `CFStringRef` as a Rust string.
///
/// Safety: `value` must be a live `CFStringRef`; it is not released here.
unsafe fn cf_string(value: *const c_void) -> Option<String> {
    unsafe {
        let mut buffer = [0i8; 64];
        if !CFStringGetCString(value, buffer.as_mut_ptr(), buffer.len() as isize, UTF8) {
            return None;
        }
        std::ffi::CStr::from_ptr(buffer.as_ptr())
            .to_str()
            .ok()
            .map(str::to_owned)
    }
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct CGSize {
    width: f64,
    height: f64,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct CGRect {
    origin: CGPoint,
    size: CGSize,
}

const UTF8: u32 = 0x0800_0100;
const AX_VALUE_CG_POINT: u32 = 1;
const AX_VALUE_CG_SIZE: u32 = 2;

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXUIElementCreateSystemWide() -> *const c_void;
    fn AXUIElementSetMessagingTimeout(element: *const c_void, timeout: f32) -> i32;
    fn AXUIElementCopyAttributeValue(
        element: *const c_void,
        attribute: *const c_void,
        value: *mut *const c_void,
    ) -> i32;
    fn AXValueGetValue(value: *const c_void, kind: u32, out: *mut c_void) -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFStringCreateWithCString(
        alloc: *const c_void,
        cstr: *const c_char,
        encoding: u32,
    ) -> *const c_void;
    fn CFStringGetCString(
        string: *const c_void,
        buffer: *mut c_char,
        size: isize,
        encoding: u32,
    ) -> bool;
    fn CFRelease(cf: *const c_void);
}

#[cfg(test)]
mod tests {
    use super::*;

    const REGION: Region = Region {
        x: 0.0,
        y: 0.0,
        width: 1000.0,
        height: 500.0,
    };

    #[test]
    fn a_region_with_no_area_records_nothing() {
        let mut track = TypingTrack::new(Region::default());
        track.sample(0);
        assert_eq!(track.len(), 0);
    }

    #[test]
    fn starts_empty() {
        let mut track = TypingTrack::new(REGION);
        assert_eq!(track.len(), 0);
        assert_eq!(track.take_samples(), vec![]);
    }

    #[test]
    fn asking_whether_it_may_look_does_not_panic() {
        // The answer depends on the grant and on whether the test runner is
        // itself trusted, so the value is not asserted — only that the call is
        // safe to make without one.
        let _ = is_trusted();
    }
}
