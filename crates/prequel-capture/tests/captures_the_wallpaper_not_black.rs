//! `capture_wallpaper` has to draw the desktop picture, not stand in front of
//! it — see the comment in `src/wallpaper.rs` for the shape of the bug this
//! pins: excluding every window on the display excludes the window the
//! wallpaper is itself drawn in, and what comes back is a black rectangle with
//! only the cursor on it, since that is composited separately from any window.
//!
//! Needs the Screen Recording grant, so it self-skips when the grant is absent
//! rather than failing — `records_the_screen.rs`'s reasoning applies here too.

use std::path::PathBuf;
use std::process::Command;

use prequel_capture::{PermissionStatus, capture_wallpaper, screen_access_status};

fn cannot_capture() -> bool {
    if std::env::var_os("PREQUEL_NO_LIVE_CAPTURE").is_some() {
        eprintln!("SKIP: PREQUEL_NO_LIVE_CAPTURE is set; this display cannot be captured usefully");
        return true;
    }
    if screen_access_status() != PermissionStatus::Granted {
        eprintln!("SKIP: no Screen Recording grant; live capture cannot be tested here");
        return true;
    }
    false
}

/// The fraction of pixels that read as more than a shade above black.
///
/// A cursor glyph is a few hundred pixels on a multi-megapixel display —
/// nowhere near enough to explain a wallpaper genuinely being mostly this
/// bright, so a threshold well under "most of the picture" still separates a
/// real capture from the bug this file pins.
const MIN_LIT_FRACTION: f64 = 0.05;

fn decode_rgb24(png: &PathBuf) -> Vec<u8> {
    let out = png.with_extension("rgb");
    let _ = std::fs::remove_file(&out);

    let status = Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(png)
        .args(["-f", "rawvideo", "-pix_fmt", "rgb24", "-y"])
        .arg(&out)
        .status()
        .expect("ffmpeg must be installed to verify the captured wallpaper");

    assert!(status.success(), "ffmpeg could not decode {}", png.display());

    let pixels = std::fs::read(&out).expect("read the decoded wallpaper");
    let _ = std::fs::remove_file(&out);
    pixels
}

#[test]
fn draws_the_desktop_picture_rather_than_a_black_rectangle() {
    if cannot_capture() {
        return;
    }

    let path = std::env::temp_dir().join("prequel-live-wallpaper.png");
    let _ = std::fs::remove_file(&path);

    capture_wallpaper(0, &path).expect("capture the wallpaper");

    let pixels = decode_rgb24(&path);
    assert!(!pixels.is_empty(), "decoded wallpaper had no pixels");

    let lit = pixels.chunks_exact(3).filter(|p| p.iter().any(|&c| c > 20)).count();
    let total = pixels.len() / 3;

    assert!(
        (lit as f64 / total as f64) > MIN_LIT_FRACTION,
        "only {lit} of {total} pixels were above a shade of black — \
         this is the desktop's own window being excluded along with every other one, \
         not a genuinely dark wallpaper"
    );

    let _ = std::fs::remove_file(&path);
}
