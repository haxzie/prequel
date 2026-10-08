//! The waveform's peaks, read from a real file.
//!
//! Two things the unit tests on `peaks_from` cannot say: that a burst written
//! at a known second comes back in the right bucket after AVFoundation has
//! decoded and resampled the file, and that the memory held while reading does
//! not grow with the length of the take. The second is the whole reason the
//! pass exists — see `peaks.rs`.

use std::path::{Path, PathBuf};

use prequel_encode::{AudioWriter, AudioWriterConfig};
use prequel_render::peaks::{BUCKETS_PER_SECOND, peaks};

const SAMPLE_RATE: f64 = 48_000.0;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(name);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create scratch directory");
    dir
}

/// A mono AAC track of `seconds`, silent except for a 0.8 full-scale burst
/// over `[burst_at, burst_at + 0.1)` seconds.
fn write_track(path: &Path, seconds: f64, burst_at: f64) {
    let config = AudioWriterConfig::new(SAMPLE_RATE, 1).offline();
    let mut writer = AudioWriter::create(path, &config).expect("create the writer");

    let total = (seconds * SAMPLE_RATE) as usize;
    let from = (burst_at * SAMPLE_RATE) as usize;
    let to = from + (0.1 * SAMPLE_RATE) as usize;

    let mut chunk = vec![0.0f32; 4096];
    let mut at = 0;
    while at < total {
        let run = chunk.len().min(total - at);
        for (index, sample) in chunk[..run].iter_mut().enumerate() {
            let frame = at + index;
            // A square-ish burst rather than a sine: its peak is the same in
            // every bucket it covers, so the assertion is a number and not a
            // tolerance on a phase.
            *sample = if (from..to).contains(&frame) {
                0.8
            } else {
                0.0
            };
        }
        writer
            .append_pcm(&chunk[..run], SAMPLE_RATE)
            .expect("append");
        at += run;
    }
    writer.finish().expect("finish the track");
}

#[test]
fn the_burst_lands_in_its_bucket() {
    let dir = scratch("prequel-peaks-burst");
    let file = dir.join("mic.m4a");
    write_track(&file, 3.0, 1.5);

    let found = peaks(&file).expect("peaks");

    // Three seconds at twenty a second. AAC pads the end with up to one
    // frame, so one extra bucket is allowed; a missing one is not.
    let expected = 3 * BUCKETS_PER_SECOND as usize;
    assert!(
        (expected..=expected + 1).contains(&found.len()),
        "expected about {expected} buckets, got {}",
        found.len()
    );

    // The burst is buckets 30 and 31 (1.5 s to 1.6 s). Everything before
    // bucket 29 and after bucket 32 is silence — AAC's encoder leaks a
    // little pre-echo into the neighbouring bucket on each side.
    let loud: Vec<usize> = found
        .iter()
        .enumerate()
        .filter(|(_, peak)| **peak > 0.4)
        .map(|(index, _)| index)
        .collect();
    assert_eq!(loud, vec![30, 31], "loud buckets: {loud:?}");

    for (index, peak) in found.iter().enumerate() {
        if !(29..=32).contains(&index) {
            assert!(*peak < 0.05, "bucket {index} should be silent, got {peak}");
        }
    }
}

/// How much the process grew while reading an hour of audio.
///
/// Not a benchmark: the number that matters is that it is nowhere near the
/// size of the decoded file. An hour of stereo 48 kHz is 1.4 GB as `f32`, and
/// the renderer-side decode this replaced held more than twice that. The bound
/// here is generous — the point is the order of magnitude.
#[test]
#[ignore = "writes an hour of audio; run by hand with --ignored"]
fn an_hour_does_not_grow_the_heap() {
    let dir = scratch("prequel-peaks-hour");
    let file = dir.join("mic.m4a");
    write_track(&file, 3_600.0, 1_800.0);

    let before = resident_bytes();
    let found = peaks(&file).expect("peaks");
    let after = resident_bytes();

    assert!(found.len() >= 3_600 * BUCKETS_PER_SECOND as usize);
    let grew = after.saturating_sub(before);
    eprintln!(
        "resident grew by {} MB over an hour of audio",
        grew / (1 << 20)
    );
    assert!(grew < 64 << 20, "grew by {} MB", grew / (1 << 20));
}

fn resident_bytes() -> usize {
    let out = std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
        .output()
        .expect("ps");
    String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse::<usize>()
        .unwrap_or(0)
        * 1024
}
