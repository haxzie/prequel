//! The CPU encoder, end to end: NV12 in, a playable MP4 out.
//!
//! Checked with `ffprobe` and `ffmpeg` rather than AVFoundation, so a bug
//! shared between our writer and our reader cannot hide. What it is really
//! proving is that the three pieces agree — libx264's parameter sets describe
//! the stream the muxer is handed, the sample timing survives the passthrough
//! input, and the frames held in the encoder's lookahead come back out at
//! `finish` rather than being lost off the end.

use std::path::Path;
use std::process::Command;

use cidre::{arc, cf, cv, ns};
use prequel_encode::{CPU_PIXEL_FORMAT, VideoWriter, VideoWriterConfig};

const W: u32 = 640;
const H: u32 = 360;
const FPS: u64 = 60;
const FRAMES: u64 = 150;
const S: u64 = 1_000_000_000;

fn pool() -> arc::R<cv::PixelBufPool> {
    let attrs = cf::DictionaryOf::with_keys_values(
        &[
            cv::pixel_buffer::keys::width(),
            cv::pixel_buffer::keys::height(),
            cv::pixel_buffer::keys::pixel_format(),
        ],
        &[
            ns::Number::with_u32(W).as_ref(),
            ns::Number::with_u32(H).as_ref(),
            ns::Number::with_u32(CPU_PIXEL_FORMAT.0).as_ref(),
        ],
    );
    cv::PixelBufPool::new(None, Some(attrs.as_ref())).expect("create an NV12 pool")
}

/// A bar that marches across the frame, so a decoded frame can be told from
/// its neighbours and a dropped or reordered one shows up.
fn frame(pool: &cv::PixelBufPool, index: u64) -> arc::R<cv::PixelBuf> {
    let mut buf = pool.pixel_buf().expect("take a buffer");
    unsafe {
        buf.lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
            .result()
            .expect("lock");

        let y_stride = buf.plane_bytes_per_row(0);
        let y = buf.plane_base_address(0) as *mut u8;
        let bar = (index * 4 % W as u64) as usize;
        for row in 0..H as usize {
            for col in 0..W as usize {
                let near = col >= bar && col < bar + 40;
                *y.add(row * y_stride + col) = if near { 235 } else { 16 };
            }
        }
        // Grey chroma: the test is about luma and timing, and a neutral frame
        // keeps a colour conversion out of the comparison below.
        let stride = buf.plane_bytes_per_row(1);
        let rows = buf.plane_height(1);
        let base = buf.plane_base_address(1) as *mut u8;
        for at in 0..stride * rows {
            *base.add(at) = 128;
        }

        buf.unlock_lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
            .result()
            .expect("unlock");
    }
    buf
}

fn probe(path: &Path, entries: &str) -> String {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            entries,
            "-of",
            "default=noprint_wrappers=1",
        ])
        .arg(path)
        .output()
        .expect("ffprobe must be installed");
    assert!(
        output.status.success(),
        "ffprobe failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

fn write(path: &Path) {
    write_frames(path, FRAMES)
}

fn write_frames(path: &Path, frames: u64) {
    let pool = pool();
    let mut writer = VideoWriter::create(
        path,
        &VideoWriterConfig::new(W, H)
            .offline()
            .at_fps(FPS as u32)
            .on_cpu(),
    )
    .expect("create the writer");

    for index in 0..frames {
        writer
            .append(&frame(&pool, index), index * (S / FPS))
            .expect("append a frame");
    }
    let summary = writer.finish_at(frames * (S / FPS)).expect("finish the file");
    assert_eq!(summary.frames, frames);
}

/// How many frames the file actually holds, counted rather than read off the
/// header: the header is written last and would agree with whatever was muxed,
/// however little that was.
fn counted(path: &Path) -> u64 {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-count_frames",
            "-show_entries",
            "stream=nb_read_frames",
            "-of",
            "csv=p=0",
        ])
        .arg(path)
        .output()
        .expect("ffprobe must be installed");
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse()
        .unwrap_or(0)
}

#[test]
fn every_frame_reaches_the_file() {
    let path = std::env::temp_dir().join("prequel-cpu-encode.mp4");
    write(&path);

    assert_eq!(probe(&path, "stream=codec_name"), "codec_name=h264");
    assert_eq!(
        probe(&path, "stream=width,height"),
        format!("width={W}\nheight={H}")
    );

    assert_eq!(counted(&path), FRAMES, "every frame fed in must come back out");
}

/// An export shorter than libx264's lookahead.
///
/// The one that broke. libx264 holds its first frames and answers an early
/// flush call with nothing *while still holding them* — so a flush that stops
/// at the first empty answer writes a file with no samples in it at all. Under
/// 28 frames, every single one was lost, and almost nothing said so: the
/// summary counted them all, and `AVAssetWriter` only failed at `finish`
/// because an export also asks it to optimise for network use. Without that
/// flag it wrote a container with an undecodable video track and returned
/// success.
///
/// One frame as well as a handful, because a single-frame export is a real
/// thing — a title card, or a clip trimmed to almost nothing.
#[test]
fn a_short_export_keeps_every_frame() {
    for frames in [1u64, 2, 10, 27] {
        let path = std::env::temp_dir().join(format!("prequel-cpu-short-{frames}.mp4"));
        write_frames(&path, frames);
        assert_eq!(
            counted(&path),
            frames,
            "a {frames}-frame export must hold {frames} frames"
        );
    }
}

#[test]
fn the_file_seeks_to_its_keyframes() {
    let path = std::env::temp_dir().join("prequel-cpu-keyframes.mp4");
    write(&path);

    // Not every sample may be started from. Without the `NotSync` attachment
    // every one of them claims it may, and a player seeking lands on a P-frame
    // and shows a smear until the next real keyframe.
    let flags = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "frame=key_frame",
            "-of",
            "csv=p=0",
        ])
        .arg(&path)
        .output()
        .expect("ffprobe");
    let text = String::from_utf8_lossy(&flags.stdout);
    let keys: Vec<&str> = text.trim().lines().map(|line| line.trim()).collect();

    assert_eq!(keys.len(), FRAMES as usize);
    assert_eq!(keys[0], "1", "the first frame must be a keyframe");
    let count = keys.iter().filter(|flag| **flag == "1").count();
    assert!(
        count > 0 && count < FRAMES as usize,
        "expected some keyframes and some not, got {count} of {FRAMES}"
    );
}

/// The picture, not just the shape. A frame count and a duration both pass
/// happily on output that decodes to nothing.
#[test]
fn the_bar_is_where_it_was_put() {
    let path = std::env::temp_dir().join("prequel-cpu-pixels.mp4");
    write(&path);

    // Frame 100: the bar starts at (100 * 4) % 640 = 400.
    let raw = Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(&path)
        .args([
            "-vf",
            "select=eq(n\\,100)",
            "-vframes",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "gray",
            "-",
        ])
        .output()
        .expect("ffmpeg must be installed");
    assert!(raw.status.success());
    let pixels = raw.stdout;
    assert_eq!(pixels.len(), (W * H) as usize);

    let row = (H / 2) as usize * W as usize;
    let inside = pixels[row + 420];
    let outside = pixels[row + 100];
    assert!(
        inside > 180,
        "inside the bar should be bright, was {inside}"
    );
    assert!(
        outside < 60,
        "outside the bar should be dark, was {outside}"
    );
}
