//! End-to-end encoder test using synthetic frames.
//!
//! Deliberately independent of ScreenCaptureKit: it needs no display and no
//! Screen Recording grant, so it runs anywhere — including hosted CI, where
//! real capture is impossible. What it proves is that the encoder produces a
//! genuinely valid, playable MP4 with the timing it was handed.

use std::path::PathBuf;
use std::process::Command;

use cidre::{arc, cv};
use prequel_encode::{VideoCodec, VideoWriter, VideoWriterConfig};

const WIDTH: u32 = 640;
const HEIGHT: u32 = 480;
const FPS: u64 = 30;
const FRAMES: u64 = 60; // 2 seconds
const NS_PER_FRAME: u64 = 1_000_000_000 / FPS;

/// A BGRA buffer filled with a flat colour that shifts frame to frame, so the
/// encoder has real content to compress rather than an unchanging image it
/// could collapse into almost nothing.
fn frame(index: u64) -> arc::R<cv::PixelBuf> {
    let mut buf = cv::PixelBuf::new(
        WIDTH as usize,
        HEIGHT as usize,
        cv::PixelFormat::_32_BGRA,
        None,
    )
    .expect("allocate pixel buffer");

    // cidre's RAII guard keeps the buffer exclusively borrowed and exposes no
    // accessors, so use the raw lock/unlock pair to reach the pixels.
    unsafe {
        buf.lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
            .result()
            .expect("lock pixel buffer");

        let bytes_per_row = buf.bytes_per_row();
        let base = buf.base_address_mut().cast::<u8>();
        let phase = (index * 4) as u8;

        for y in 0..HEIGHT as usize {
            for x in 0..WIDTH as usize {
                let offset = y * bytes_per_row + x * 4;
                // BGRA
                *base.add(offset) = phase;
                *base.add(offset + 1) = (x as u8).wrapping_add(phase);
                *base.add(offset + 2) = (y as u8).wrapping_sub(phase);
                *base.add(offset + 3) = 255;
            }
        }

        buf.unlock_lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
            .result()
            .expect("unlock pixel buffer");
    }

    buf
}

fn ffprobe(path: &PathBuf, entries: &str) -> String {
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
        .expect("ffprobe must be installed for encoder output verification");

    assert!(
        output.status.success(),
        "ffprobe failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

#[test]
fn writes_an_mp4_ffprobe_can_read() {
    let path = std::env::temp_dir().join("prequel-encoder-h264.mp4");
    let _ = std::fs::remove_file(&path);

    let mut writer = VideoWriter::create(&path, &VideoWriterConfig::new(WIDTH, HEIGHT).offline())
        .expect("create writer");

    for index in 0..FRAMES {
        let buf = frame(index);
        writer
            .append(&buf, index * NS_PER_FRAME)
            .expect("append frame");
    }

    let summary = writer.finish().expect("finish writing");

    assert_eq!(
        summary.frames, FRAMES,
        "every frame should have been written"
    );
    assert_eq!(summary.first_pts, 0);
    assert_eq!(summary.last_pts, (FRAMES - 1) * NS_PER_FRAME);

    let metadata = std::fs::metadata(&path).expect("output file must exist");
    assert!(metadata.len() > 1_000, "file is suspiciously small");

    // Shape assertions: the cheap check that catches "produced garbage".
    let probed = ffprobe(&path, "stream=codec_name,width,height,nb_frames,pix_fmt");
    assert!(probed.contains("codec_name=h264"), "got: {probed}");
    assert!(probed.contains(&format!("width={WIDTH}")), "got: {probed}");
    assert!(
        probed.contains(&format!("height={HEIGHT}")),
        "got: {probed}"
    );
    assert!(
        probed.contains(&format!("nb_frames={FRAMES}")),
        "got: {probed}"
    );

    let duration = ffprobe(&path, "format=duration")
        .trim_start_matches("duration=")
        .parse::<f64>()
        .expect("duration should parse");
    let expected = FRAMES as f64 / FPS as f64;
    assert!(
        (duration - expected).abs() < 0.15,
        "duration {duration}s should be close to {expected}s"
    );

    let _ = std::fs::remove_file(&path);
}

#[test]
fn honours_the_timestamps_it_is_given() {
    // The point of appending with an explicit PTS: a gap in media time — what a
    // pause produces — must show up as a shorter file, not a stalled one.
    let path = std::env::temp_dir().join("prequel-encoder-sparse.mp4");
    let _ = std::fs::remove_file(&path);

    let mut writer = VideoWriter::create(&path, &VideoWriterConfig::new(WIDTH, HEIGHT).offline())
        .expect("create writer");

    // 30 frames at 30 fps, but stamped as if captured at 15 fps.
    let step = NS_PER_FRAME * 2;
    for index in 0..30u64 {
        writer.append(&frame(index), index * step).expect("append");
    }
    let summary = writer.finish().expect("finish");

    assert_eq!(summary.duration(), 29 * step);

    let duration = ffprobe(&path, "format=duration")
        .trim_start_matches("duration=")
        .parse::<f64>()
        .expect("duration should parse");
    assert!(
        (duration - 2.0).abs() < 0.15,
        "30 frames at 15 fps should be ~2s, got {duration}s"
    );

    let _ = std::fs::remove_file(&path);
}

#[test]
fn hevc_is_selectable() {
    let path = std::env::temp_dir().join("prequel-encoder-hevc.mp4");
    let _ = std::fs::remove_file(&path);

    let config = VideoWriterConfig::new(WIDTH, HEIGHT)
        .with_codec(VideoCodec::Hevc)
        .offline();
    let mut writer = VideoWriter::create(&path, &config).expect("create writer");

    for index in 0..10u64 {
        writer
            .append(&frame(index), index * NS_PER_FRAME)
            .expect("append");
    }
    writer.finish().expect("finish");

    let probed = ffprobe(&path, "stream=codec_name");
    assert!(probed.contains("hevc"), "got: {probed}");

    let _ = std::fs::remove_file(&path);
}

#[test]
fn cancelling_leaves_no_output_behind() {
    let path = std::env::temp_dir().join("prequel-encoder-cancelled.mp4");
    let _ = std::fs::remove_file(&path);

    let mut writer = VideoWriter::create(&path, &VideoWriterConfig::new(WIDTH, HEIGHT).offline())
        .expect("create writer");
    writer.append(&frame(0), 0).expect("append");
    writer.cancel();

    assert!(
        !path.exists(),
        "a cancelled recording must not leave a partial file"
    );
}
