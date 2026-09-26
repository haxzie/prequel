//! What a file brought in from outside is allowed to claim.
//!
//! `probe_file` answers with one track because every file this app writes holds
//! exactly one. An imported video holds whichever pair it likes, and the
//! import's manifest is written from this answer — so "does it have sound" has
//! to be the file's answer and not a guess.
//!
//! The failure this pins is invisible until an export: a `system_audio` segment
//! naming a file with no audio track in it edits perfectly, previews perfectly,
//! and fails minutes into a render at `AudioReader`.
//!
//! Needs no display and no Screen Recording grant, so it runs anywhere.

use std::path::PathBuf;

use cidre::{arc, cv};
use prequel_encode::{AudioWriterConfig, VideoWriter, VideoWriterConfig, probe_media};

const WIDTH: u32 = 320;
const HEIGHT: u32 = 240;
const FPS: u64 = 30;
const FRAMES: u64 = 30; // 1 second
const NS_PER_FRAME: u64 = 1_000_000_000 / FPS;
const SAMPLE_RATE: f64 = 48_000.0;

fn frame() -> arc::R<cv::PixelBuf> {
    cv::PixelBuf::new(
        WIDTH as usize,
        HEIGHT as usize,
        cv::PixelFormat::_32_BGRA,
        None,
    )
    .expect("allocate pixel buffer")
}

/// A second of picture, with a second of tone beside it when asked for.
fn write(path: &PathBuf, sound: bool) {
    let _ = std::fs::remove_file(path);

    let mut config = VideoWriterConfig::new(WIDTH, HEIGHT).offline();
    if sound {
        config = config.with_audio(AudioWriterConfig::new(SAMPLE_RATE, 2).offline());
    }

    let mut writer = VideoWriter::create(path, &config).expect("create writer");
    let image = frame();

    for index in 0..FRAMES {
        writer
            .append(&image, index * NS_PER_FRAME)
            .expect("append frame");

        // Interleaved with the frames rather than written at the end: an input
        // that lags stops the other one being ready. See `append_audio`.
        if sound {
            let run = (SAMPLE_RATE / FPS as f64) as usize;
            writer
                .append_audio(&vec![0.0; run * 2], SAMPLE_RATE)
                .expect("append audio");
        }
    }

    writer.finish_audio();
    writer.finish().expect("finish");
}

#[test]
fn reports_the_sound_a_file_has() {
    let path = std::env::temp_dir().join("prequel-probe-both.mp4");
    write(&path, true);

    let probe = probe_media(&path).expect("probe");

    let video = probe.video.expect("a video track");
    assert_eq!(video.width, Some(WIDTH));
    assert_eq!(video.height, Some(HEIGHT));
    assert!(probe.audio.is_some(), "the file was written with sound");

    let _ = std::fs::remove_file(&path);
}

#[test]
fn reports_the_sound_a_file_does_not_have() {
    let path = std::env::temp_dir().join("prequel-probe-silent.mp4");
    write(&path, false);

    let probe = probe_media(&path).expect("probe");

    assert!(probe.video.is_some(), "the file was written with a picture");
    // The whole point. An import that read this as "sound, probably" would
    // write a manifest that only fails at the export.
    assert!(probe.audio.is_none(), "the file was written silent");

    let _ = std::fs::remove_file(&path);
}

#[test]
fn finds_no_tracks_in_a_file_that_is_not_one() {
    let path = std::env::temp_dir().join("prequel-probe-nonsense.mp4");
    std::fs::write(&path, b"not really a video").expect("write");

    // Not an error: `AVUrlAsset` takes a URL without reading it, so anything
    // with a media extension on it "opens". Holding no track is how a file that
    // is not a video says so, which is why the import checks for a picture
    // rather than for a failure.
    let probe = probe_media(&path).expect("an asset, of sorts");

    assert!(probe.video.is_none());
    assert!(probe.audio.is_none());

    let _ = std::fs::remove_file(&path);
}
