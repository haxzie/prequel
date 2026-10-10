//! What a writer that was never given a sample reports.
//!
//! `AVAssetWriter` answers `finishWriting` on an empty file with
//! `AVFoundationErrorDomain` -11800, "The operation could not be completed",
//! over an underlying `NSOSStatusErrorDomain` -12142 with no description at
//! all. Nothing in that names the track or says it is empty, and it reached a
//! crash report as "encoder: AVAssetWriter failed while writing" — which sends
//! the reader to the encoder for a stream that never delivered a frame.
//!
//! So both writers answer for themselves instead. These tests pin the error
//! rather than the message: a stop that fails here decides whether a take keeps
//! its other tracks, and `ScreenRecorder::stop` reads the variant to decide.

use std::path::PathBuf;

use prequel_encode::{AudioWriter, AudioWriterConfig, Error, VideoWriter, VideoWriterConfig};

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join("prequel-empty-track");
    std::fs::create_dir_all(&dir).expect("could not make a scratch directory");
    dir.join(name)
}

#[test]
fn a_video_writer_with_no_frames_says_so() {
    let path = scratch("screen.mp4");
    let writer =
        VideoWriter::create(&path, &VideoWriterConfig::new(1280, 720)).expect("could not create");

    assert!(matches!(writer.finish(), Err(Error::NoSamples)));

    // Cancelled, not finished: a container holding no samples probes as a video
    // track that will not decode, which is one more thing for the editor to
    // fail on for a file that was never a recording.
    assert!(!path.exists(), "an empty writer left a file behind");
}

#[test]
fn an_audio_writer_with_no_samples_says_so() {
    let path = scratch("mic.m4a");
    let writer =
        AudioWriter::create(&path, &AudioWriterConfig::new(48_000.0, 2)).expect("could not create");

    assert!(matches!(writer.finish(), Err(Error::NoSamples)));
    assert!(!path.exists(), "an empty writer left a file behind");
}
