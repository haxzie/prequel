//! Capturing the desktop picture as it currently looks.
//!
//! Reading the wallpaper *file* on macOS 14+ is unreliable: the legacy
//! `desktoppicture.db` is often gone, the current store leaves its file list
//! empty for the stock pictures and hides the identity in an NSKeyedArchiver
//! blob, `NSWorkspace.desktopImageURL(for:)` is unbound and returns a
//! multi-image dynamic HEIC anyway, and `osascript` needs an Automation grant
//! that fails confusingly.
//!
//! Screenshotting the desktop sidesteps all of it, and Prequel is unusually
//! well placed to do so: it already holds the Screen Recording grant and cannot
//! function without one. It is also the only approach that is correct for
//! dynamic and video wallpapers, where there is no still file to find — what
//! you get is what is on screen.
//!
//! The screenshot takes the display and excludes every *normal* window, rather
//! than hunting for the window the wallpaper is drawn in. Which window that is
//! has moved between releases, and a guess that stops matching does not
//! degrade — it fails outright, and every recording quietly falls back to a
//! gradient.

use std::path::Path;

use cidre::{cg, ns, sc};

use crate::still::{capture_one, write_png};
use crate::{Error, Result};

/// Writes the current desktop picture of `display_id` to `path`, as a PNG.
///
/// `display_id` is a `CGDirectDisplayID`; zero means the main display.
pub fn capture_wallpaper(display_id: u32, path: &Path) -> Result<()> {
    let content = crate::targets::current_shareable_content()?;

    let displays = content.displays();
    let display = displays
        .iter()
        .find(|candidate| {
            display_id == 0 || candidate.display_id() == cg::DirectDisplayId(display_id)
        })
        .or_else(|| displays.iter().next())
        .ok_or(Error::DisplayNotFound(display_id))?;

    // The display with every *normal* window taken off it — not literally every
    // window. The desktop picture is drawn by a real on-screen window too — on
    // this release it is one the Dock process owns, named "Wallpaper-" — sitting
    // at a window layer far below `kCGNormalWindowLevel` (0); it is a member of
    // `content.windows()` exactly like Finder's or Safari's. Excluding the whole
    // list therefore excludes the very thing this function is trying to capture,
    // and what ScreenCaptureKit hands back is the display with nothing left to
    // draw it: solid black, with only the cursor showing, since that is
    // composited separately. Pinned by
    // `crates/prequel-capture/tests/captures_the_wallpaper_not_black.rs`.
    //
    // This used to hunt for the wallpaper's own window instead — by the agent's
    // bundle id, then by the furthest-back window layer — and hand that to
    // `with_desktop_independent_window`. Both tests are guesses about how
    // WindowServer happens to be arranged, and on macOS 26 neither matches: the
    // capture failed with "no wallpaper window on screen" and every recording
    // fell back to a gradient with a blank swatch in the picker.
    //
    // The layer is the one thing here that is not a guess: it is a stable, public
    // distinction between the desktop and everything a user can bring to front,
    // not an identity or an owning process that shifts between releases.
    // Excluding only windows at `kCGNormalWindowLevel` or above keeps every
    // ordinary app window off the shot while leaving the desktop's own layer —
    // the wallpaper, the desktop icons, and nothing else lives that low — in it.
    let excluded: Vec<_> = content
        .windows()
        .iter()
        .filter(|window| window.window_layer() >= 0)
        .map(|window| window.retained())
        .collect();

    let filter = sc::ContentFilter::with_display_excluding_windows(
        display,
        &ns::Array::from_slice_retained(&excluded),
    );

    let mut cfg = sc::StreamCfg::new();
    cfg.set_width(display.width() as usize);
    cfg.set_height(display.height() as usize);

    // The one-frame capture and the PNG write are `still.rs`'s, which is the
    // same operation aimed at a target rather than at the desktop. Shared so a
    // background and a screenshot cannot come out in two colour spaces.
    let sample = capture_one(&filter, &cfg)?;
    write_png(&sample, path)
}
