//! What lossless capture is for: the samples the exporter reads back are the
//! samples that were recorded.
//!
//! The reason this is asserted on samples rather than on shapes is the reason
//! `renders_the_right_pixels.rs` exists. A codec change passes every shape
//! assertion there is — the duration, the channel count and the sample rate are
//! identical either way — and the only thing that tells the two apart is what
//! comes back out.

use prequel_encode::{AudioWriter, AudioWriterConfig};
use prequel_render::reader::AudioReader;

const SAMPLE_RATE: f64 = 48_000.0;
const CHANNELS: i32 = 2;

/// One step of the 24-bit depth AVFoundation writes FLAC at, and so the most a
/// lossless round trip may move a sample.
const QUANTISATION_STEP: f32 = 1.0 / 16_777_216.0;

/// A second of signal with something in every band for a codec to lose:
/// a tone, a harmonic above it, and an edge that no sine sum would produce.
fn signal() -> Vec<f32> {
    let frames = SAMPLE_RATE as usize;
    let mut samples = Vec::with_capacity(frames * CHANNELS as usize);
    for frame in 0..frames {
        let t = frame as f64 / SAMPLE_RATE;
        let tone = (t * 440.0 * std::f64::consts::TAU).sin() * 0.4;
        let harmonic = (t * 11_000.0 * std::f64::consts::TAU).sin() * 0.2;
        let edge = if frame % 4_800 < 2_400 { 0.1 } else { -0.1 };
        samples.push((tone + harmonic + edge) as f32);
        samples.push((tone - harmonic + edge) as f32);
    }
    samples
}

fn write(path: &std::path::Path, config: AudioWriterConfig, samples: &[f32]) {
    let mut writer = AudioWriter::create(path, &config).expect("create the writer");
    // In chunks, as capture and export both do, rather than as one buffer:
    // a format that only works for a single append is not one this codebase
    // can use.
    for chunk in samples.chunks(4_800 * CHANNELS as usize) {
        writer.append_pcm(chunk, SAMPLE_RATE).expect("append");
    }
    writer.finish().expect("finish");
}

fn read_back(path: &std::path::Path) -> Vec<f32> {
    let mut reader = AudioReader::open_whole(path, SAMPLE_RATE).expect("open for reading");
    let mut out = Vec::new();
    let mut buf = vec![0.0f32; 4_096];
    loop {
        let read = reader.read(&mut buf);
        if read == 0 {
            break;
        }
        out.extend_from_slice(&buf[..read]);
    }
    out
}

/// The worst single sample disagreement, over the frames both tracks have.
fn worst_error(original: &[f32], decoded: &[f32]) -> f32 {
    original
        .iter()
        .zip(decoded)
        .map(|(a, b)| (a - b).abs())
        .fold(0.0f32, f32::max)
}

#[test]
fn flac_comes_back_exactly_and_aac_does_not() {
    let dir = std::env::temp_dir().join("prequel-lossless-round-trip");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("scratch directory");

    let samples = signal();

    let flac = dir.join("lossless.m4a");
    write(
        &flac,
        AudioWriterConfig::new(SAMPLE_RATE, CHANNELS)
            .offline()
            .lossless(),
        &samples,
    );
    let lossless = read_back(&flac);

    let aac = dir.join("lossy.m4a");
    write(
        &aac,
        AudioWriterConfig::new(SAMPLE_RATE, CHANNELS).offline(),
        &samples,
    );
    let lossy = read_back(&aac);

    // Both have to come back at all. A reader that returns nothing would make
    // the comparison below pass by having nothing to compare.
    assert!(
        lossless.len() >= samples.len(),
        "the lossless track decoded short: {} of {}",
        lossless.len(),
        samples.len()
    );
    assert!(!lossy.is_empty(), "the AAC track decoded to nothing");

    let lossless_error = worst_error(&samples, &lossless);
    let lossy_error = worst_error(&samples, &lossy);
    println!("worst sample error — flac {lossless_error:.9}, aac {lossy_error:.9}");

    // One 24-bit step, and not a hair more. AVFoundation writes 24-bit FLAC,
    // so a sample that arrived as `f32` is quantised once on the way in and
    // never touched again — "lossless" here means lossless at 24 bits, not
    // bit-identical to a float. That distinction is worth keeping in a test
    // rather than in a sentence, because 24 bits is the number the editor's
    // preview and the exporter both have to agree on.
    assert!(
        lossless_error <= QUANTISATION_STEP,
        "FLAC lost more than the 24-bit step it quantises to: {lossless_error} > {QUANTISATION_STEP}"
    );

    // The counterpart, and the reason the setting exists. Asserted rather than
    // assumed: if AAC ever came back clean, this test would be measuring
    // nothing and would keep passing. In practice it is off by a thousand
    // quantisation steps or more, which is the gap the setting buys.
    assert!(
        lossy_error > QUANTISATION_STEP * 1_000.0,
        "AAC came back within {lossy_error} of the original, so this test \
         no longer demonstrates anything"
    );

    let _ = std::fs::remove_dir_all(&dir);
}
