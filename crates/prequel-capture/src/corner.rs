//! The corner radius of a recorded window, read off the window itself.
//!
//! A window capture comes back the shape of the window: ScreenCaptureKit
//! leaves the rounded corners transparent, and the 4:2:0 stream the recorder
//! asks for has no alpha to carry that in, so they land in `screen.mp4` as
//! black. The editor then draws the picture inside a rounded rectangle of its
//! own, and wherever its radius is smaller than the window's the black wedge
//! shows between the border and the picture. Matching the two needs the
//! window's radius, and nothing on the system will say what it is — `NSWindow`
//! has no public accessor, the window list does not carry it, and it varies by
//! app and by release (a Tahoe window and an Electron one on the same desktop
//! measured 20pt and 15pt).
//!
//! So it is measured. Not from the recording's luma: a dark window is black
//! in the corners too, and half the window recordings on a developer's own
//! machine were unreadable that way. From one BGRA screenshot through the same
//! window filter, where the transparent wedge is exact, taken off the capture
//! thread once the stream is up so the recording starts no later for it.

use std::sync::mpsc;
use std::time::Duration;

use cidre::{cm, cv, ns, sc};

use crate::{Error, Result};

/// How long to wait for the screenshot before giving up on the radius.
///
/// Short: this runs beside a live capture, and a recording stopped a moment
/// after it started joins the thread. The wallpaper capture allows ten seconds
/// because nothing waits on it; here a stall would hold `stop`.
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(2);

/// The widest corner worth believing, in pixels.
///
/// A transparent run longer than this is not a corner — a window with a
/// see-through region against one edge, or one drawn with no opaque content at
/// all — and the honest answer is "could not tell" rather than a radius the
/// size of the title bar. 64pt at 2× is well past any window chrome.
const MAX_RADIUS: usize = 128;

/// Coverage at or above this counts as the window; below it, as the cut.
///
/// Half. The edge is antialiased over a pixel or two, and the row profile is
/// taken as fractional coverage anyway — this only decides where a run of
/// transparent pixels ends.
const OPAQUE: u8 = 128;

/// Takes one frame of `filter` at `width`×`height` and returns the window's
/// corner radius in pixels of that frame.
///
/// `Ok(None)` when it cannot be read — a corner with a transparent run longer
/// than `MAX_RADIUS`, or a frame that came back a different size — which the
/// caller writes as "not recorded" rather than as a guess. `Ok(Some(0.0))` is
/// a window with square corners, which is a real answer.
///
/// The frame is asked for at the recording's own size so the radius is in
/// the recording's pixels, and with the shadow off so the alpha under the
/// corners is the window's and not a soft halo the recorder never captured.
pub fn measure(filter: &sc::ContentFilter, width: u32, height: u32) -> Result<Option<f64>> {
    let mut cfg = sc::StreamCfg::new();
    cfg.set_width(width as usize);
    cfg.set_height(height as usize);
    cfg.set_pixel_format(cv::PixelFormat::_32_BGRA);
    cfg.set_shows_cursor(false);
    cfg.set_scales_to_fit(false);
    cfg.set_preserves_aspect_ratio(true);
    cfg.set_ignore_shadows_single_window(true);

    let sample = capture(filter, &cfg)?;
    let image = sample
        .image_buf()
        .ok_or_else(|| Error::ScreenCaptureKit("the captured frame carried no image".to_owned()))?;

    if image.pixel_format() != cv::PixelFormat::_32_BGRA
        || image.width() != width as usize
        || image.height() != height as usize
    {
        tracing::debug!(
            "window screenshot came back {}×{} {:?}, not {width}×{height} BGRA; not measuring",
            image.width(),
            image.height(),
            image.pixel_format(),
        );
        return Ok(None);
    }

    // Cloned to get a mutable handle: locking is a mutation as far as cidre
    // is concerned, and the clone is a retain on the same buffer.
    let mut locked = image.retained();
    let alpha = unsafe {
        locked
            .lock_base_addr(cv::pixel_buffer::LockFlags::READ_ONLY)
            .result()
            .map_err(|e| Error::ScreenCaptureKit(format!("could not lock the frame: {e:?}")))?;

        let stride = locked.bytes_per_row();
        let base = locked.base_address().cast::<u8>();
        let w = width as usize;
        let h = height as usize;
        let at = |x: usize, y: usize| *base.add(y * stride + x * 4 + 3);

        // No further than halfway across, so two corners of a small window
        // never read past each other — and never past the buffer.
        let reach = MAX_RADIUS.min(w / 2).min(h / 2);

        // The four corners as the same shape: `x` and `y` count inwards from
        // the corner, so one profile reader serves all of them.
        let corners = [
            profile(reach, at),
            profile(reach, |x, y| at(w - 1 - x, y)),
            profile(reach, |x, y| at(x, h - 1 - y)),
            profile(reach, |x, y| at(w - 1 - x, h - 1 - y)),
        ];

        locked
            .unlock_lock_base_addr(cv::pixel_buffer::LockFlags::READ_ONLY)
            .result()
            .map_err(|e| Error::ScreenCaptureKit(format!("could not unlock the frame: {e:?}")))?;
        corners
    };

    let radii: Option<Vec<f64>> = alpha
        .into_iter()
        .map(|profile| profile.map(|p| fit_radius(&p)))
        .collect();

    Ok(radii.map(|radii| {
        tracing::debug!("window corner radii: {radii:?}");
        // The largest, not the mean. What this feeds is the editor's radius,
        // and a corner rounder than that shows black while one squarer is
        // merely clipped by a pixel — so the roundest corner is the one to
        // match. They agree to within a pixel on any ordinary window anyway.
        radii.into_iter().fold(0.0, f64::max)
    }))
}

/// How far the transparent wedge reaches into each row of one corner, as
/// fractional pixels, for as many rows as it reaches at all.
///
/// `None` when a row's run does not end within `reach`: that corner is not a
/// corner, and the caller declines to guess.
///
/// Coverage is summed rather than counted so the antialiased edge contributes
/// its fraction. Counting whole pixels against a threshold reads a 36-pixel
/// circle as 30 rows deep, because the arc meets the edge at a tangent and
/// the last several rows are less than half covered.
fn profile(reach: usize, alpha: impl Fn(usize, usize) -> u8) -> Option<Vec<f64>> {
    let mut rows = Vec::new();
    for y in 0..reach {
        let mut inset = 0.0;
        let mut ended = false;
        for x in 0..reach {
            let a = alpha(x, y);
            inset += f64::from(255 - a) / 255.0;
            if a >= OPAQUE {
                ended = true;
                break;
            }
        }
        if !ended {
            return None;
        }
        // Past the arc: this row and every row after it is the window's
        // straight edge, and the profile is complete.
        if inset < 0.5 {
            break;
        }
        rows.push(inset);
    }
    Some(rows)
}

/// The circle whose corner best matches a profile, in pixels.
///
/// A least-squares search over whole radii rather than a closed form: the
/// profile is a handful of rows and the candidate range is small, and a search
/// is exact for a circular corner while still landing sensibly on the
/// continuous curve newer windows use — which is a little fuller than a circle
/// of the same reach, so the fit errs towards the reach, which is the side
/// that hides the wedge.
fn fit_radius(profile: &[f64]) -> f64 {
    if profile.is_empty() {
        return 0.0;
    }

    let mut best = (f64::INFINITY, 0.0);
    for r in 1..=MAX_RADIUS {
        let r = r as f64;
        let error: f64 = profile
            .iter()
            .enumerate()
            .map(|(y, &inset)| {
                let expected = circle_inset(r, y as f64 + 0.5);
                (expected - inset).powi(2)
            })
            .sum();
        if error < best.0 {
            best = (error, r);
        }
    }
    best.1
}

/// How far a circle of radius `r` leaves a row `y` from the corner uncovered.
///
/// Rows below the arc's reach are fully covered, which is what a profile
/// longer than the circle should be scored against rather than treated as
/// out of range.
fn circle_inset(r: f64, y: f64) -> f64 {
    if y >= r {
        return 0.0;
    }
    let d = r - y;
    r - (r * r - d * d).sqrt()
}

/// Takes one frame, blocking until ScreenCaptureKit hands it over.
///
/// The same bridge the wallpaper capture uses, on the same reasoning: this
/// runs on a thread of its own with nothing else to do, and a runtime to await
/// one callback would be a lot of machinery for it.
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A window `w`×`h` with circular corners of radius `r`, as an alpha
    /// lookup with antialiasing by 4×4 supersampling.
    fn rounded(w: usize, h: usize, r: f64) -> impl Fn(usize, usize) -> u8 {
        move |x, y| {
            let mut inside = 0;
            for sy in 0..4 {
                for sx in 0..4 {
                    let px = x as f64 + (sx as f64 + 0.5) / 4.0;
                    let py = y as f64 + (sy as f64 + 0.5) / 4.0;
                    let cx = px.clamp(r, w as f64 - r);
                    let cy = py.clamp(r, h as f64 - r);
                    if (px - cx).powi(2) + (py - cy).powi(2) <= r * r {
                        inside += 1;
                    }
                }
            }
            (inside * 255 / 16) as u8
        }
    }

    #[test]
    fn a_circular_corner_is_measured_to_the_pixel() {
        for r in [5.0, 13.0, 21.0, 36.0, 52.0] {
            let alpha = rounded(400, 300, r);
            let p = profile(MAX_RADIUS, alpha).expect("a corner");
            let fitted = fit_radius(&p);
            assert!(
                (fitted - r).abs() <= 1.0,
                "radius {r} measured as {fitted} from {p:?}"
            );
        }
    }

    #[test]
    fn a_square_corner_is_zero() {
        let p = profile(MAX_RADIUS, |_, _| 255).expect("a corner");
        assert!(p.is_empty());
        assert_eq!(fit_radius(&p), 0.0);
    }

    #[test]
    fn a_transparent_edge_is_not_a_corner() {
        // A window with nothing opaque along its top: the run never ends, and
        // the answer must be "cannot tell" rather than `MAX_RADIUS`.
        assert!(profile(MAX_RADIUS, |_, y| if y < 3 { 0 } else { 255 }).is_none());
    }

    #[test]
    fn the_profile_stops_at_the_straight_edge() {
        // Rows past the arc are the window's edge and are not part of the
        // shape; a profile that kept reading them would fit a larger circle.
        let alpha = rounded(400, 300, 20.0);
        let p = profile(MAX_RADIUS, alpha).expect("a corner");
        assert!(
            p.len() <= 21,
            "profile ran {} rows for a radius of 20",
            p.len()
        );
    }
}
