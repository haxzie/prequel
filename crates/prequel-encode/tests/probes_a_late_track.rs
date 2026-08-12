//! Where a session file's timeline actually begins.
//!
//! This pins down a question that cannot be answered by reading the code, and
//! being wrong about puts the webcam permanently out of sync with no visible
//! symptom until someone watches the export.
//!
//! `VideoWriter::append` opens the writer's session at the first sample's
//! presentation time, so a camera track that started 250 ms late is handed
//! timestamps beginning at 250 ms. The question is what ends up in the file.
//!
//! Measured, not assumed: **the file comes out zero-based.** Because the
//! session origin *is* the first sample, `AVAssetWriter` writes the track
//! starting at zero with no edit list and no leading gap — `ffprobe` reports
//! `start_pts=0`, `start_time=0.000000`, and a first packet at 0.000.
//!
//! The consequence is the reason this file exists: a track's late start is
//! recorded **only** in `session.json`, never in the media file. Anything
//! lining the tracks up must take the offset from the manifest and seek the
//! file from zero. Subtracting a file-timeline start as well would double-count
//! it and push the camera late by exactly the amount it was already corrected.
//!
//! Needs no display and no Screen Recording grant, so it runs anywhere.

use std::path::PathBuf;

use cidre::{arc, cv};
use prequel_encode::{VideoWriter, VideoWriterConfig, probe_file};

const WIDTH: u32 = 320;
const HEIGHT: u32 = 240;
const FPS: u64 = 30;
const FRAMES: u64 = 30; // 1 second
const NS_PER_FRAME: u64 = 1_000_000_000 / FPS;

/// The camera's typical warm-up, and the offset under test.
const LATE_START_NS: u64 = 250_000_000;

fn frame() -> arc::R<cv::PixelBuf> {
    cv::PixelBuf::new(
        WIDTH as usize,
        HEIGHT as usize,
        cv::PixelFormat::_32_BGRA,
        None,
    )
    .expect("allocate pixel buffer")
}

/// Writes a track whose first sample lands at `start`.
fn write(path: &PathBuf, start: u64) {
    let _ = std::fs::remove_file(path);
    let mut writer = VideoWriter::create(path, &VideoWriterConfig::new(WIDTH, HEIGHT).offline())
        .expect("create writer");

    for index in 0..FRAMES {
        writer
            .append(&frame(), start + index * NS_PER_FRAME)
            .expect("append frame");
    }
    writer.finish().expect("finish writing");
}

#[test]
fn a_late_track_is_still_written_zero_based() {
    // The load-bearing assertion. A track handed timestamps starting at 250 ms
    // comes out of the writer starting at zero, because those timestamps opened
    // the session. Should this ever change — a writer configured with an
    // explicit session start, say — the editor would start double-correcting
    // the camera and this test is what says so.
    let path = std::env::temp_dir().join("prequel-probe-late.mp4");
    write(&path, LATE_START_NS);

    let probe = probe_file(&path).expect("probe the written file");

    assert!(
        probe.start < NS_PER_FRAME,
        "session files are zero-based; the late start belongs in session.json, \
         but this file reports a start of {}ns",
        probe.start
    );

    assert_eq!(probe.width, Some(WIDTH));
    assert_eq!(probe.height, Some(HEIGHT));

    let _ = std::fs::remove_file(&path);
}

#[test]
fn a_late_track_holds_its_full_duration() {
    // The corollary: writing zero-based must not have cost the leading frames.
    // A file that started late *and* lost its head would look correct in the
    // start assertion above while being a second short.
    let path = std::env::temp_dir().join("prequel-probe-late-duration.mp4");
    write(&path, LATE_START_NS);

    let probe = probe_file(&path).expect("probe the written file");

    let expected = FRAMES * NS_PER_FRAME;
    let drift = probe.duration.abs_diff(expected);
    assert!(
        drift < 2 * NS_PER_FRAME,
        "expected about {expected}ns of media, got {}ns",
        probe.duration
    );

    let _ = std::fs::remove_file(&path);
}

#[test]
fn reports_the_dimensions_and_duration_of_an_anchoring_track() {
    // The screen anchors the session clock and starts at zero on both
    // timelines. What the probe adds over the manifest here is the file's own
    // account of its dimensions and length.
    let path = std::env::temp_dir().join("prequel-probe-anchor.mp4");
    write(&path, 0);

    let probe = probe_file(&path).expect("probe the written file");

    assert!(probe.start < NS_PER_FRAME, "got {}ns", probe.start);
    assert_eq!(probe.width, Some(WIDTH));
    assert_eq!(probe.height, Some(HEIGHT));

    let expected = FRAMES * NS_PER_FRAME;
    assert!(probe.duration.abs_diff(expected) < 2 * NS_PER_FRAME);

    let _ = std::fs::remove_file(&path);
}

#[test]
fn refuses_a_file_that_is_not_media() {
    let path = std::env::temp_dir().join("prequel-probe-garbage.mp4");
    std::fs::write(&path, b"not an mp4").expect("write the decoy");

    assert!(probe_file(&path).is_err());

    let _ = std::fs::remove_file(&path);
}
