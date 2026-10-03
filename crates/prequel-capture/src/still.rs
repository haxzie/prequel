//! Taking one frame of a display, a window or a region.
//!
//! A screenshot rather than a recording, and a separate path from
//! `recorder.rs` for one reason: `SCScreenshotManager` hands over a single
//! sample buffer and is done, where an `SCStream` has to be started, fed
//! through a writer and stopped. Driving the stream for one frame would mean
//! an `AVAssetWriter`, a clock, a delivery queue and a teardown to produce a
//! file nothing plays — and the first frame off a stream is the one that
//! arrives before the capture has settled.
//!
//! The PNG write and the one-frame capture are shared with `wallpaper.rs`,
//! which is the same operation aimed at the desktop with every window taken
//! off it. Two copies of `write_png` would be two colour spaces eventually,
//! and a wallpaper and a screenshot that do not match is a background that
//! does not look like the desktop it was taken from.

use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use cidre::{arc, cg, ci, cm, ns, sc};

use crate::targets::{Bounds, Target, TargetKind};
use crate::{Error, Result};

/// How long a single frame is waited for.
///
/// Generous, and deliberately the same as the wallpaper's: this is one
/// callback from a framework that occasionally takes its time over the first
/// capture after a grant, and the alternative to waiting is a screenshot that
/// silently did not happen.
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(10);

/// What to take a still of.
///
/// A narrower `RecordOptions`: no codec, no frame rate, no audio, no key
/// presses. Shaped the same way where it overlaps, so `capture_flow` hands the
/// same target and crop to either and cannot describe one differently.
#[derive(Debug, Clone)]
pub struct StillOptions {
    /// Display or window to capture.
    pub target: Target,
    /// Sub-region of the target, in points relative to the target's own
    /// origin. `None` captures all of it. Displays only — the same restriction
    /// `RecordOptions::crop` carries, and for the same reason.
    pub crop: Option<Bounds>,
    /// Whether the pointer is drawn into the shot.
    ///
    /// False by default for a still, which is the opposite of a recording: a
    /// recording is of something happening and the pointer is what is doing
    /// it, where a screenshot is of something on screen and an arrow parked
    /// over it is nearly always in the way. Nothing samples a pointer track
    /// here, so this is the only say over it there is.
    pub show_cursor: bool,
    /// `CGWindowID`s to keep out of the shot — the panel, the camera bubble,
    /// the picker overlays. Exactly `RecordOptions::excluded_windows`, and the
    /// only mechanism that works; see the note there.
    pub excluded_windows: Vec<u32>,
}

impl StillOptions {
    pub fn new(target: Target) -> Self {
        Self {
            target,
            crop: None,
            show_cursor: false,
            excluded_windows: Vec::new(),
        }
    }
}

/// The picture a still turned out to be, in pixels.
///
/// Returned rather than left to be read back off the file, because the caller
/// writes a `session.json` naming it and an image decoded twice is two answers
/// to how big the shot is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StillSize {
    pub width: u32,
    pub height: u32,
}

/// Writes one frame of `options.target` to `path`, as a PNG.
pub fn capture_still(options: &StillOptions, path: &Path) -> Result<StillSize> {
    let content = crate::targets::current_shareable_content()?;
    let filter = filter_for(&content, options)?;

    // Physical pixels, because the bounds are points — the same arithmetic
    // `ScreenRecorder::start` runs, so a still of an area and a recording of
    // the same area come out the same size.
    //
    // Not rounded down to an even number, which that one does: an even width
    // is an H.264 requirement and a PNG has none. Forcing it here would crop a
    // column off an odd-width window for a constraint that does not apply.
    let scale = options.target.scale_factor.max(1.0);
    let region = options.crop.unwrap_or(options.target.bounds);
    let width = (region.width * scale).round() as u32;
    let height = (region.height * scale).round() as u32;

    if width == 0 || height == 0 {
        return Err(Error::EmptyRegion {
            width: region.width,
            height: region.height,
        });
    }

    let mut cfg = sc::StreamCfg::new();
    cfg.set_width(width as usize);
    cfg.set_height(height as usize);
    cfg.set_shows_cursor(options.show_cursor);
    cfg.set_scales_to_fit(false);
    cfg.set_preserves_aspect_ratio(true);

    if let Some(crop) = options.crop {
        // Paired with the output size above, or ScreenCaptureKit scales the
        // crop back up to the whole display — see the same pairing in
        // `ScreenRecorder::start`.
        cfg.set_src_rect(cg::Rect {
            origin: cg::Point {
                x: crop.x,
                y: crop.y,
            },
            size: cg::Size {
                width: crop.width,
                height: crop.height,
            },
        });
        cfg.set_dst_rect(cg::Rect {
            origin: cg::Point { x: 0.0, y: 0.0 },
            size: cg::Size {
                width: f64::from(width),
                height: f64::from(height),
            },
        });
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| Error::Output {
            path: parent.display().to_string(),
            reason: e.to_string(),
        })?;
    }

    let sample = capture_one(&filter, &cfg)?;
    write_png(&sample, path)?;

    // What the buffer turned out to be rather than what was asked for.
    // ScreenCaptureKit honours the size it is given in every case seen so far,
    // but the file is the thing a manifest is about to describe and the buffer
    // is what was written into it.
    let buffer = sample
        .image_buf()
        .ok_or_else(|| Error::ScreenCaptureKit("the captured frame carried no image".to_owned()))?;

    Ok(StillSize {
        width: buffer.width() as u32,
        height: buffer.height() as u32,
    })
}

/// The content filter one still is taken through.
///
/// A near-twin of `recorder.rs`'s `build_filter` and deliberately not shared
/// with it: that one is reached from a `RecordOptions` and this from a
/// `StillOptions`, and the one thing a shared signature would have to take is
/// the three fields both already carry. The sleeping-display distinction is
/// the part worth keeping in step, and it is the part that is identical.
fn filter_for(
    content: &sc::ShareableContent,
    options: &StillOptions,
) -> Result<arc::R<sc::ContentFilter>> {
    match options.target.kind {
        TargetKind::Display => {
            let display = content
                .displays()
                .iter()
                .find(|candidate| candidate.display_id().0 == options.target.id)
                // Missing from the snapshot and asleep are indistinguishable
                // from here, and the fix for one is "wake the screen" where the
                // other is a real fault.
                .ok_or_else(|| {
                    if crate::targets::is_display_asleep(options.target.id) {
                        Error::DisplayAsleep(options.target.id)
                    } else {
                        Error::DisplayNotFound(options.target.id)
                    }
                })?
                .retained();

            let excluded: Vec<_> = content
                .windows()
                .iter()
                .filter(|window| options.excluded_windows.contains(&window.id()))
                .map(|window| window.retained())
                .collect();

            Ok(sc::ContentFilter::with_display_excluding_windows(
                &display,
                &ns::Array::from_slice_retained(&excluded),
            ))
        }
        TargetKind::Window => {
            let window = content
                .windows()
                .iter()
                .find(|candidate| candidate.id() == options.target.id)
                .ok_or(Error::WindowNotFound(options.target.id))?
                .retained();

            Ok(sc::ContentFilter::with_desktop_independent_window(&window))
        }
    }
}

/// Takes one frame, blocking until ScreenCaptureKit hands it over.
///
/// Block-based rather than async: this is called from a worker thread whose
/// whole job is to produce the file, and introducing a runtime to await one
/// callback would be a lot of machinery for no benefit.
pub(crate) fn capture_one(
    filter: &sc::ContentFilter,
    cfg: &sc::StreamCfg,
) -> Result<arc::R<cm::SampleBuf>> {
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
/// `ci::Context::write_png_to_url` — and this runs once per shot, so nothing
/// here is on a hot path.
pub(crate) fn write_png(sample: &cm::SampleBuf, path: &Path) -> Result<()> {
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
