//! What a display hides behind its camera.
//!
//! The teleprompter hangs from the top edge of the built-in display, and on a
//! MacBook with a notch it has to know how tall the notch is and how wide, so
//! the island can be drawn as the notch grown outwards rather than as a panel
//! floating a few points under it. Electron's `Display` says nothing about
//! this; AppKit does, through `NSScreen.safeAreaInsets` and the two auxiliary
//! areas either side of the notch.
//!
//! Looked up by `CGDirectDisplayID` because that is the id the shell already
//! has for a display. `NSScreen` only learned to answer that id on macOS 26,
//! so the screen is matched by its frame instead — the same rectangle in two
//! coordinate systems, one flipped.
use cidre::{cg, ns};

/// The strip along the top of a display that a window cannot use.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SafeArea {
    /// Height of the menu bar and notch, in points. Zero on a display with no notch.
    pub top: f64,
    /// The notch's left and right edges in points from the display's left,
    /// or `None` where there is no notch.
    pub notch: Option<(f64, f64)>,
}

/// The safe area of a display, or `None` when no screen has that id.
///
/// Must be called on the main thread: `NSScreen` is AppKit.
pub fn display_safe_area(display_id: u32) -> Option<SafeArea> {
    let wanted = cg::DirectDisplayId(display_id).bounds();
    if wanted.size.width <= 0.0 {
        return None;
    }

    let screens = ns::Screen::screens();
    // Cocoa's origin is the bottom-left of the primary screen and CoreGraphics'
    // is its top-left, so a frame flips through the primary screen's height.
    let primary_height = screens.iter().next()?.frame().size.height;

    for screen in screens.iter() {
        let frame = screen.frame();
        let top = primary_height - frame.origin.y - frame.size.height;
        if (frame.origin.x - wanted.origin.x).abs() > 1.0
            || (top - wanted.origin.y).abs() > 1.0
            || (frame.size.width - wanted.size.width).abs() > 1.0
        {
            continue;
        }

        let insets = screen.safe_area_insets();
        if insets.top <= 0.0 {
            return Some(SafeArea {
                top: 0.0,
                notch: None,
            });
        }

        // The two areas are the usable ears either side of the notch, in the
        // screen's own coordinates. The gap between them is the notch.
        let left = screen.auxiliary_top_left_area();
        let right = screen.auxiliary_top_right_area();
        let notch_left = left.origin.x - frame.origin.x + left.size.width;
        let notch_right = right.origin.x - frame.origin.x;

        return Some(SafeArea {
            top: insets.top,
            notch: Some((notch_left, notch_right)),
        });
    }

    None
}
