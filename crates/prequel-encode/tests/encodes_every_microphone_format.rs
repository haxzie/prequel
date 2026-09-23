//! Every format a real microphone can hand capture encodes, and the sound
//! survives the trip.
//!
//! The failure this pins, verbatim from a user's log:
//!
//!   AVAssetWriter failed while writing: Error Domain=AVFoundationErrorDomain
//!   Code=-11861 "Cannot Encode Media" … The encoding parameters are not
//!   supported. NSUnderlyingError … Code=-12651
//!
//! A flat 128 kbps is only a valid AAC rate near 44.1/48 kHz. A Bluetooth
//! headset in hands-free mode records at 16 kHz mono, where the ceiling is 48
//! kbps. Nothing about that is visible at configuration time — the writer
//! starts, takes the settings, and rejects the first buffer — and capture only
//! reports the failure when the take is stopped, by which point the whole
//! recording is discarded.
//!
//! So configuring is not what these assert. The first proves every format the
//! encoder is offered produces a file with a track in it; the second proves the
//! samples come back out, because a track that encodes to silence would pass
//! the first and lose the user their voice.

use std::path::PathBuf;
use std::process::Command;

use prequel_encode::{AudioWriter, AudioWriterConfig};

/// Rates a capture device actually reports: Bluetooth hands-free at the bottom,
/// the usual suspects above it.
const RATES: [f64; 9] = [
    8_000.0, 11_025.0, 12_000.0, 16_000.0, 22_050.0, 24_000.0, 32_000.0, 44_100.0, 48_000.0,
];

/// What a headset in hands-free mode gives you, and what was failing.
const HEADSET_RATE: f64 = 16_000.0;

const TONE_HZ: f64 = 440.0;
const TONE_SECONDS: f64 = 0.5;
/// Loud enough that no codec could mistake it for silence, quiet enough to
/// leave headroom.
const TONE_AMPLITUDE: f32 = 0.5;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(name);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create scratch directory");
    dir
}

/// Writes half a second of a sine tone, in tenth-of-a-second buffers — more
/// than the single append that would fail on its own.
fn write_tone(path: &PathBuf, rate: f64, channels: i32) -> Result<(), String> {
    let config = AudioWriterConfig::new(rate, channels).offline();
    let mut writer = AudioWriter::create(path, &config).map_err(|e| e.to_string())?;

    let per_buffer = (rate / 10.0) as usize;
    let buffers = (TONE_SECONDS * 10.0) as u64;

    for i in 0..buffers {
        let mut samples = Vec::with_capacity(per_buffer * channels as usize);
        for frame in 0..per_buffer {
            let t = (i as usize * per_buffer + frame) as f64 / rate;
            let value = (TONE_AMPLITUDE as f64 * (t * TONE_HZ * std::f64::consts::TAU).sin()) as f32;
            for _ in 0..channels {
                samples.push(value);
            }
        }
        writer
            .append_pcm(&samples, rate, (i + 1) * 100_000_000)
            .map_err(|e| e.to_string())?;
    }

    writer.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// The audio codec ffprobe finds, or an empty string when there is no audio
/// track at all — which is what a rejected format leaves behind.
fn codec(path: &PathBuf) -> String {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_name",
            "-of",
            "csv=p=0",
        ])
        .arg(path)
        .output()
        .expect("run ffprobe");

    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

/// Decodes the track back to mono `f32` samples.
fn decode(path: &PathBuf) -> Vec<f32> {
    let output = Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(path)
        .args(["-ac", "1", "-f", "f32le", "-"])
        .output()
        .expect("run ffmpeg");

    assert!(
        output.status.success(),
        "ffmpeg could not decode {}: {}",
        path.display(),
        String::from_utf8_lossy(&output.stderr)
    );

    output
        .stdout
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect()
}

fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f64 = samples.iter().map(|s| f64::from(*s) * f64::from(*s)).sum();
    (sum / samples.len() as f64).sqrt() as f32
}

#[test]
fn every_capture_rate_and_channel_count_encodes() {
    let dir = scratch("prequel-mic-formats");

    for rate in RATES {
        for channels in [1, 2] {
            let path = dir.join(format!("{rate}-{channels}.m4a"));
            write_tone(&path, rate, channels)
                .unwrap_or_else(|e| panic!("{rate} Hz / {channels} ch: {e}"));

            assert_eq!(
                codec(&path),
                "aac",
                "{rate} Hz / {channels} ch produced no readable audio track",
            );
        }
    }

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_headset_records_sound_rather_than_silence() {
    let dir = scratch("prequel-mic-headset");
    let path = dir.join("mic.m4a");

    write_tone(&path, HEADSET_RATE, 1).expect("write the tone");
    let decoded = decode(&path);

    // Roughly half a second of it. AAC pads the head and tail by a frame or so,
    // hence the tolerance — the point is that the whole take is there, not a
    // handful of samples.
    let seconds = decoded.len() as f64 / HEADSET_RATE;
    assert!(
        (seconds - TONE_SECONDS).abs() < 0.1,
        "expected about {TONE_SECONDS}s of audio, got {seconds}s",
    );

    // A sine at this amplitude sits at amplitude/√2. Silence — which is what a
    // track written at a rejected bit rate would hold — is nowhere near it.
    let level = rms(&decoded);
    let expected = TONE_AMPLITUDE / std::f32::consts::SQRT_2;
    assert!(
        (level - expected).abs() < 0.05,
        "expected a tone at about {expected}, got {level}",
    );

    let _ = std::fs::remove_dir_all(&dir);
}
