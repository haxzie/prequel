//! What the voice isolation pass has to be true of, on real files.
//!
//! Three properties, each one a bug that has a plausible-looking output:
//! the track does not move in time, the track does not change length, and
//! noise with no voice under it actually goes.
//!
//! The signals are synthetic rather than a recording of somebody talking: a
//! test that needs a voice needs a wav in the repo and a listener to say
//! whether it still sounds right. These assert numbers instead — where a burst
//! starts, how many frames came back, how far the noise floor fell.

use std::path::{Path, PathBuf};
use std::process::Command;

use prequel_encode::{AudioWriter, AudioWriterConfig};
use prequel_voice::{Enhancement, Quality, SAMPLE_RATE, enhance};

/// Seconds of silence before the burst, so a track that slid late is visible
/// as the burst arriving at the wrong second.
const LEAD_SECONDS: f64 = 1.0;
const BURST_SECONDS: f64 = 1.0;
const TAIL_SECONDS: f64 = 1.0;

/// How far the burst may move, in seconds.
///
/// The unit's own lookahead is 56 ms, so anything that fails to compensate for
/// it lands five times outside this. The slack is for AAC's priming samples,
/// which are a couple of milliseconds either way depending on who decodes.
const ONSET_TOLERANCE: f64 = 0.010;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(name);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create scratch directory");
    dir
}

/// Silence, then `body`, then silence — written as an `.m4a`, the way a take
/// is.
fn write_track(path: &Path, body: impl Fn(usize) -> f32) {
    let config = AudioWriterConfig::new(SAMPLE_RATE, 1).offline();
    let mut writer = AudioWriter::create(path, &config).expect("create the writer");

    let lead = (LEAD_SECONDS * SAMPLE_RATE) as usize;
    let burst = (BURST_SECONDS * SAMPLE_RATE) as usize;
    let tail = (TAIL_SECONDS * SAMPLE_RATE) as usize;

    let mut samples = vec![0.0f32; lead];
    samples.extend((0..burst).map(&body));
    samples.extend(std::iter::repeat_n(0.0f32, tail));

    // In chunks, the way the pass itself writes: a single append would not
    // exercise the writer's own clock.
    for chunk in samples.chunks(4096) {
        writer
            .append_pcm(chunk, SAMPLE_RATE)
            .expect("append the samples");
    }
    writer.finish().expect("finish the track");
}

/// Decodes a file to mono `f32` at the crate's rate.
fn decode(path: &Path) -> Vec<f32> {
    let raw = path.with_extension("f32");
    let status = Command::new("ffmpeg")
        .args(["-y", "-loglevel", "error", "-i"])
        .arg(path)
        .args(["-f", "f32le", "-ac", "1", "-ar", "48000"])
        .arg(&raw)
        .status()
        .expect("run ffmpeg");
    assert!(
        status.success(),
        "ffmpeg could not decode {}",
        path.display()
    );

    let bytes = std::fs::read(&raw).expect("read the decoded samples");
    bytes
        .chunks_exact(4)
        .map(|four| f32::from_le_bytes([four[0], four[1], four[2], four[3]]))
        .collect()
}

/// The first second at which the signal rises above `threshold`, or none.
fn onset(samples: &[f32], threshold: f32) -> Option<f64> {
    samples
        .iter()
        .position(|sample| sample.abs() > threshold)
        .map(|at| at as f64 / SAMPLE_RATE)
}

/// Root mean square of a span, in decibels below full scale.
fn rms_db(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return f32::NEG_INFINITY;
    }
    let sum: f64 = samples.iter().map(|s| (*s as f64) * (*s as f64)).sum();
    let rms = (sum / samples.len() as f64).sqrt();
    if rms <= 0.0 {
        f32::NEG_INFINITY
    } else {
        20.0 * rms.log10() as f32
    }
}

/// Deterministic broadband noise — a hiss with no voice anywhere in it.
///
/// A plain LCG rather than a dependency: the test needs the same noise every
/// run, and any full-band signal will do.
fn hiss(index: usize) -> f32 {
    let mut state = (index as u64)
        .wrapping_mul(6_364_136_223_846_793_005)
        .wrapping_add(1);
    state ^= state >> 33;
    ((state >> 40) as f32 / 8_388_608.0 - 1.0) * 0.2
}

/// A tone, which the dry pass has to hand back exactly where it found it.
fn tone(index: usize) -> f32 {
    let t = index as f64 / SAMPLE_RATE;
    (0.5 * (t * 440.0 * std::f64::consts::TAU).sin()) as f32
}

/// Nothing may move in time.
///
/// At zero the unit is pure dry — whatever went in comes back — so anything
/// that shifts here is the lookahead, not the model. Which makes this the test
/// that pins the latency compensation, and it is the one that matters: a
/// microphone 56 ms behind the picture reads as a bad take, and by the time
/// anybody notices the file has been exported.
#[test]
fn a_dry_pass_leaves_the_track_where_it_was() {
    let dir = scratch("prequel-voice-dry");
    let input = dir.join("mic.m4a");
    let output = dir.join("mic.clean.m4a");

    write_track(&input, tone);
    enhance(
        &input,
        &output,
        Enhancement {
            amount: 0.0,
            quality: Quality::Strong,
        },
    )
    .expect("enhance the track");

    let before = decode(&input);
    let after = decode(&output);

    let was = onset(&before, 0.05).expect("the source has a burst in it");
    let now = onset(&after, 0.05).expect("the cleaned track still has a burst in it");

    assert!(
        (now - was).abs() < ONSET_TOLERANCE,
        "the burst moved from {was:.4}s to {now:.4}s — the unit's lookahead is not being \
         compensated for"
    );
}

/// The track has to come back the length it went in.
///
/// The pass feeds silence past the end of the file to push the unit's
/// lookahead back out. Too little and the last 56 ms of the recording are
/// missing; too much and the track grows a tail of silence every time it is
/// cleaned.
#[test]
fn the_cleaned_track_is_the_length_of_the_original() {
    let dir = scratch("prequel-voice-length");
    let input = dir.join("mic.m4a");
    let output = dir.join("mic.clean.m4a");

    write_track(&input, tone);
    let summary = enhance(&input, &output, Enhancement::default()).expect("enhance the track");

    let before = decode(&input);
    let after = decode(&output);

    let expected = (LEAD_SECONDS + BURST_SECONDS + TAIL_SECONDS) * SAMPLE_RATE;
    assert!(
        (summary.frames as f64 - expected).abs() < SAMPLE_RATE * ONSET_TOLERANCE,
        "wrote {} frames where the source held about {expected}",
        summary.frames
    );

    let drift = (after.len() as f64 - before.len() as f64) / SAMPLE_RATE;
    assert!(
        drift.abs() < ONSET_TOLERANCE,
        "the cleaned track is {drift:.4}s longer than the original"
    );
}

/// Noise with nothing under it has to go.
///
/// Not a claim about how a voice survives — that needs ears — but the other
/// half is measurable: a hiss the model finds no speech in should come back
/// far quieter than it went. A pass that silently did nothing, or one whose
/// parameters never reached the unit because they were set before
/// `initialize`, fails here.
#[test]
fn hiss_with_no_voice_in_it_is_removed() {
    let dir = scratch("prequel-voice-hiss");
    let input = dir.join("mic.m4a");
    let output = dir.join("mic.clean.m4a");

    write_track(&input, hiss);
    enhance(&input, &output, Enhancement::default()).expect("enhance the track");

    let before = decode(&input);
    let after = decode(&output);

    // The middle of the burst, away from both edges: the model takes a moment
    // to settle, and the ends are where the silence meets the noise.
    let from = ((LEAD_SECONDS + 0.25) * SAMPLE_RATE) as usize;
    let to = ((LEAD_SECONDS + BURST_SECONDS - 0.25) * SAMPLE_RATE) as usize;

    let was = rms_db(&before[from..to.min(before.len())]);
    let now = rms_db(&after[from..to.min(after.len())]);

    assert!(
        now < was - 20.0,
        "the hiss went from {was:.1} dB to {now:.1} dB — fewer than the 20 dB a working pass \
         takes off noise with no voice in it"
    );
}
