//! Capturing the desktop picture as it currently looks.
//!
//! Reading the wallpaper *file* on macOS 14+ is unreliable: the legacy
//! `desktoppicture.db` is often gone, the current store leaves its file list
//! empty for the stock pictures and hides the identity in an NSKeyedArchiver
//! blob, `NSWorkspace.desktopImageURL(for:)` is unbound and returns a
//! multi-image dynamic HEIC anyway, and `osascript` needs an Automation grant
//! that fails confusingly.
//!
//! Screenshotting the wallpaper window sidesteps all of it, and Prequel is
//! unusually well placed to do so: it already holds the Screen Recording grant
//! and cannot function without one. It is also the only approach that is
//! correct for dynamic and video wallpapers, where there is no still file to
//! find — what you get is what is on screen.

use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use cidre::{cg, ci, cm, ns, sc};

use crate::{Error, Result};

/// The agent that draws the desktop picture.
const WALLPAPER_BUNDLE_ID: &str = "com.apple.wallpaper.agent";

/// Also matched on layer, because the agent's bundle id has changed between
/// macOS releases and the wallpaper is always at the very back.
const DESKTOP_LAYER: ns::Integer = -2_147_483_648;

const CAPTURE_TIMEOUT: Duration = Duration::from_secs(10);

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

    let windows = content.windows();
    let wallpaper = windows
        .iter()
        .find(|window| {
            window
                .owning_app()
                .is_some_and(|app| app.bundle_id().to_string() == WALLPAPER_BUNDLE_ID)
        })
        // The desktop is the bottom-most layer, which is what identifies it
        // when the bundle id does not.
        .or_else(|| {
            windows
                .iter()
                .filter(|window| window.window_layer() <= DESKTOP_LAYER)
                .min_by_key(|window| window.window_layer())
        })
        .ok_or_else(|| Error::ScreenCaptureKit("no wallpaper window on screen".to_owned()))?;

    let filter = sc::ContentFilter::with_desktop_independent_window(wallpaper);

    let mut cfg = sc::StreamCfg::new();
    cfg.set_width(display.width() as usize);
    cfg.set_height(display.height() as usize);

    let sample = capture(&filter, &cfg)?;
    write_png(&sample, path)
}

/// Takes one frame, blocking until ScreenCaptureKit hands it over.
///
/// Block-based rather than async: this is called from a worker thread whose
/// whole job is to produce the file, and introducing a runtime to await one
/// callback would be a lot of machinery for no benefit.
fn capture(
    filter: &sc::ContentFilter,
    cfg: &sc::StreamCfg,
) -> Result<cidre::arc::R<cm::SampleBuf>> {
    let (tx, rx) = mpsc::channel();

    let mut handler = cidre::blocks::ResultCh::new2(
        move |sample: Option<&cm::SampleBuf>, error: Option<&ns::Error>| {
            let _ = tx.send(match (sample, error) {
                (Some(sample), _) => Ok(sample.retained()),
                (None, Some(error)) => Err(error.to_string()),
                (None, None) => Err("no image and no error".to_owned()),
            });
        },
    );

    sc::ScreenshotManager::capture_sample_buf_ch(filter, cfg, Some(&mut handler));

    rx.recv_timeout(CAPTURE_TIMEOUT)
        .map_err(|_| Error::Timeout(CAPTURE_TIMEOUT))?
        .map_err(Error::ScreenCaptureKit)
}

/// Writes a captured frame out as a PNG.
///
/// Through Core Image because it is the one path cidre binds end to end —
/// `ci::Context::write_png_to_url` — and this runs once per background choice,
/// so nothing here is on a hot path.
fn write_png(sample: &cm::SampleBuf, path: &Path) -> Result<()> {
    let buffer = sample
        .image_buf()
        .ok_or_else(|| Error::ScreenCaptureKit("the captured frame carried no image".to_owned()))?;

    let image = ci::Image::with_cv_image_buf(buffer, None)
        .ok_or_else(|| Error::ScreenCaptureKit("could not read the captured frame".to_owned()))?;

    let path = path
        .to_str()
        .ok_or_else(|| Error::ScreenCaptureKit("output path is not valid UTF-8".to_owned()))?;

    let context = ci::Context::new();
    let url = ns::Url::with_fs_path_str(path, false);
    let color_space = cg::ColorSpace::device_rgb()
        .ok_or_else(|| Error::ScreenCaptureKit("no device colour space".to_owned()))?;

    context
        .write_png_to_url(
            &image,
            &url,
            ci::Format::rgba8(),
            &color_space,
            &ns::Dictionary::new(),
        )
        .map_err(|err| Error::ScreenCaptureKit(err.to_string()))
}
