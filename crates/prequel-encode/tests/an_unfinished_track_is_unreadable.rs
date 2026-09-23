//! What a track that was never closed leaves on disk.
//!
//! `AudioWriter` has no `Drop`. `finish` and `cancel` are the only things that
//! close an `AVAssetWriter`, and dropping one instead leaves a file whose moov
//! atom was never written — not a recording that plays a little short, but one
//! with no readable track at all, and nothing about it says so until something
//! tries to open it.
//!
//! That is the hazard `ScreenRecorder::stop` is written around. It finalises
//! every track before letting any failure out, because a `?` between two
//! `finish` calls dropped the tracks that had not had their turn yet: a screen
//! track that failed to close took a healthy microphone recording with it, and
//! the pair reached the editor as a recording that would not decode and had no
//! thumbnail.

use std::path::PathBuf;

use prequel_encode::{AudioWriter, AudioWriterConfig, probe_file};

const SAMPLE_RATE: f64 = 48_000.0;
const CHANNELS: i32 = 1;
/// A quarter of a second — long enough to be a real AAC track rather than a
/// file the encoder could reasonably answer nothing for.
const SAMPLES: usize = 12_000;
const DURATION_NS: u64 = 250_000_000;

/// A sine tone, so the encoder has genuine content rather than silence.
fn tone() -> Vec<f32> {
    (0..SAMPLES)
        .map(|index| {
            let t = index as f32 / SAMPLE_RATE as f32;
            (t * 440.0 * std::f32::consts::TAU).sin() * 0.25
        })
        .collect()
}

/// A writer with samples in it, left open for the caller to close or not.
fn written(path: &PathBuf) -> AudioWriter {
    let _ = std::fs::remove_file(path);

    let config = AudioWriterConfig::new(SAMPLE_RATE, CHANNELS).offline();
    let mut writer = AudioWriter::create(path, &config).expect("create the writer");
    writer
        .append_pcm(&tone(), SAMPLE_RATE, DURATION_NS)
        .expect("append samples");
    writer
}

#[test]
fn a_finished_track_probes() {
    let path = std::env::temp_dir().join("prequel-audio-finished.m4a");
    written(&path).finish().expect("finish the writer");

    let probe = probe_file(&path).expect("probe the finished file");
    assert!(probe.duration > 0, "a finished track has a duration");
}

#[test]
fn a_track_that_was_never_finished_holds_nothing() {
    let path = std::env::temp_dir().join("prequel-audio-dropped.m4a");
    // The failure in one line: the writer goes out of scope having had neither
    // `finish` nor `cancel` — exactly what an early `?` between two `finish`
    // calls used to do to every track behind it.
    drop(written(&path));

    assert!(
        probe_file(&path).is_err(),
        "a track that was never finished holds no readable audio",
    );
}
