//! What the studio pass has to be true of, on real files.
//!
//! The stages themselves are pinned by unit tests — the meter against sine
//! waves, the de-esser against a tone. These are the properties of the whole
//! pass that only a file can show: that the track lands on the target
//! loudness, that it does not move or change length while four units are in
//! series, that nothing leaves it above the ceiling, and that the tone
//! shaping actually reached the samples.
//!
//! **Every test here runs the isolation unit dry** — `amount: 0.0`, which the
//! existing `a_dry_pass_leaves_the_track_where_it_was` establishes is a pure
//! pass-through. That is deliberate: the isolation model is a neural net
//! trained on speech, and a synthetic test signal is exactly what it is built
//! to delete. Running it wet here would assert the chain's behaviour on
//! whatever is left of a tone the model tried to remove, which is a test of
//! the model rather than of this crate. The shaping is what these files are
//! about, and it is downstream of the isolation either way.

use std::path::{Path, PathBuf};
use std::process::Command;

use prequel_encode::{AudioWriter, AudioWriterConfig};
use prequel_voice::{CEILING_DB, Enhancement, Meter, Quality, SAMPLE_RATE, TARGET_LUFS, enhance};

const LEAD_SECONDS: f64 = 1.0;
const BODY_SECONDS: f64 = 6.0;
const TAIL_SECONDS: f64 = 1.0;

/// How far the burst may move, in seconds.
///
/// Tighter than the isolation-only test's 10 ms, and it has to be. The three
/// units this pass adds after the isolation report only 352 frames of
/// lookahead between them — the EQ 256 and the limiter 96, against the
/// isolation unit's 2705 — so a tolerance loose enough to be comfortable
/// simply does not notice when their compensation is dropped. Measured: a
/// correct pass moves the burst −1.1 ms, and a pass that compensates for the
/// isolation alone moves it +6.2 ms. 3 ms separates the two.
const ONSET_TOLERANCE: f64 = 0.003;

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
    let length = (BODY_SECONDS * SAMPLE_RATE) as usize;
    let tail = (TAIL_SECONDS * SAMPLE_RATE) as usize;

    let mut samples = vec![0.0f32; lead];
    samples.extend((0..length).map(&body));
    samples.extend(std::iter::repeat_n(0.0f32, tail));

    for chunk in samples.chunks(4096) {
        writer
            .append_pcm(chunk, SAMPLE_RATE)
            .expect("append the samples");
    }
    writer.finish().expect("finish the track");
}

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

/// A stand-in for a voice: a low tone with some top on it, breathed in and out
/// so there is something for the compressor to even.
///
/// Not a voice, and not pretending to be. It has the two things the
/// assertions need — energy at a low frequency and at a high one — and a
/// level that moves, so a pass that did no dynamics work is distinguishable
/// from one that did.
fn voice_like(index: usize) -> f32 {
    let t = index as f64 / SAMPLE_RATE;
    // Four syllables a second, never quite reaching silence.
    let envelope = 0.35 + 0.65 * (0.5 - 0.5 * (t * 4.0 * std::f64::consts::TAU).cos());
    let body = (t * 500.0 * std::f64::consts::TAU).sin() * 0.30;
    let top = (t * 9_000.0 * std::f64::consts::TAU).sin() * 0.03;
    (envelope * (body + top)) as f32
}

/// How much of `samples` is at `hz`, by Goertzel.
///
/// A whole DFT for two bins would be waste, and a biquad would make the
/// measurement depend on a filter this file would then also have to trust.
fn energy_at(samples: &[f32], hz: f64) -> f64 {
    let w = std::f64::consts::TAU * hz / SAMPLE_RATE;
    let coefficient = 2.0 * w.cos();
    let (mut s1, mut s2) = (0.0f64, 0.0f64);

    for sample in samples {
        let s0 = f64::from(*sample) + coefficient * s1 - s2;
        s2 = s1;
        s1 = s0;
    }

    ((s1 * s1 + s2 * s2 - coefficient * s1 * s2).max(0.0)).sqrt() / samples.len() as f64
}

/// The body of the track, away from both edges.
fn body(samples: &[f32]) -> &[f32] {
    let from = ((LEAD_SECONDS + 0.5) * SAMPLE_RATE) as usize;
    let to = ((LEAD_SECONDS + BODY_SECONDS - 0.5) * SAMPLE_RATE) as usize;
    &samples[from..to.min(samples.len())]
}

fn studio() -> Enhancement {
    Enhancement {
        amount: 0.0,
        quality: Quality::Strong,
        studio: true,
    }
}

/// Runs a studio pass over a synthetic take and hands back both tracks.
fn pass(name: &str) -> (Vec<f32>, Vec<f32>) {
    let dir = scratch(name);
    let input = dir.join("mic.m4a");
    let output = dir.join("mic.clean-studio.m4a");

    write_track(&input, voice_like);
    enhance(&input, &output, studio()).expect("finish the track");

    (decode(&input), decode(&output))
}

/// The track has to come out at the target loudness.
///
/// The one assertion the whole feature rests on: "studio quality" that leaves
/// every recording at a different apparent level is not a finish, it is a
/// filter. Measured with the same meter the pass used, which makes this a
/// check that the gain was computed from the shaped track and actually
/// applied — not a check that the meter agrees with itself, because the gain
/// is applied after the measurement and the limiter runs after that.
#[test]
fn a_studio_pass_lands_on_the_target_loudness() {
    let (_, after) = pass("prequel-voice-studio-loudness");

    let mut meter = Meter::new(SAMPLE_RATE);
    meter.push(&after);
    let measured = meter
        .integrated()
        .expect("the finished track is measurable");

    assert!(
        (measured - TARGET_LUFS).abs() < 1.0,
        "the finished track measured {measured:.2} LUFS, not {TARGET_LUFS}"
    );
}

/// A quiet take and a loud one have to arrive at the same place.
///
/// The property a user actually notices, and the one a fixed make-up gain
/// would fail while still passing the test above on whichever take it was
/// tuned against.
#[test]
fn a_quiet_take_and_a_loud_one_finish_at_the_same_level() {
    let dir = scratch("prequel-voice-studio-matched");
    let mut measured = Vec::new();

    for (name, scale) in [("quiet", 0.1f32), ("loud", 1.0f32)] {
        let input = dir.join(format!("{name}.m4a"));
        let output = dir.join(format!("{name}.clean-studio.m4a"));

        write_track(&input, |i| voice_like(i) * scale);
        enhance(&input, &output, studio()).expect("finish the track");

        let mut meter = Meter::new(SAMPLE_RATE);
        meter.push(&decode(&output));
        measured.push(meter.integrated().expect("the track is measurable"));
    }

    let (quiet, loud) = (measured[0], measured[1]);
    assert!(
        (quiet - loud).abs() < 1.0,
        "a take 20 dB quieter finished at {quiet:.2} LUFS against {loud:.2} — the pass is not \
         normalising, it is applying a fixed gain"
    );
}

/// Nothing may leave the pass above the ceiling.
#[test]
fn nothing_leaves_the_studio_pass_above_the_ceiling() {
    let (_, after) = pass("prequel-voice-studio-ceiling");

    // The encoder is lossless, so the samples that come back are the samples
    // that went in and the ceiling is testable through the file. A tenth of a
    // decibel of slack for FLAC's 24-bit quantisation.
    let most = 10f32.powf((CEILING_DB + 0.1) / 20.0);
    let worst = after.iter().fold(0.0f32, |peak, s| peak.max(s.abs()));

    assert!(
        worst <= most,
        "the finished track peaks at {:.2} dBFS, past the {CEILING_DB} dBFS ceiling",
        20.0 * worst.log10()
    );
}

/// Four units in series, and the track still may not move.
///
/// Each of them reports its own lookahead and the pass has to drop the sum.
/// Getting this wrong by one stage is how the voice ends up behind the picture
/// — which reads as a bad take rather than as a bug, and only after the file
/// is exported.
#[test]
fn a_studio_pass_leaves_the_track_where_it_was() {
    let (before, after) = pass("prequel-voice-studio-onset");

    // Relative thresholds: the pass normalises, so the finished track is at a
    // different absolute level and a fixed threshold would find its onset in
    // the wrong place for reasons that are not a timing bug.
    let onset = |samples: &[f32]| {
        let peak = samples.iter().fold(0.0f32, |most, s| most.max(s.abs()));
        samples
            .iter()
            .position(|s| s.abs() > peak * 0.1)
            .map(|at| at as f64 / SAMPLE_RATE)
            .expect("the track has a burst in it")
    };

    let was = onset(&before);
    let now = onset(&after);

    assert!(
        (now - was).abs() < ONSET_TOLERANCE,
        "the burst moved from {was:.4}s to {now:.4}s — one of the stages' lookahead is not \
         being compensated for"
    );
}

/// And still may not change length.
#[test]
fn the_finished_track_is_the_length_of_the_original() {
    let (before, after) = pass("prequel-voice-studio-length");

    let drift = (after.len() as f64 - before.len() as f64) / SAMPLE_RATE;
    assert!(
        drift.abs() < ONSET_TOLERANCE,
        "the finished track is {drift:.4}s longer than the original"
    );
}

/// The tone shaping has to have reached the samples.
///
/// The air shelf lifts 9 kHz by 3 dB and the mud cut takes about 1 dB off
/// 500 Hz, so the top has to come back further above the bottom than it went
/// in. Gain-invariant by construction — it is a ratio of two bands in the
/// same track — so the loudness normalisation cannot make it pass or fail.
///
/// This is the test that fails if the EQ's parameters were set before
/// `initialize` and thrown away, which is the mistake the whole `configure`
/// closure in `unit.rs` exists to prevent. The pass would still run, still
/// normalise, still be the right length, and sound untouched.
#[test]
fn the_studio_pass_lifts_the_top_end() {
    let (before, after) = pass("prequel-voice-studio-tone");

    let tilt = |samples: &[f32]| {
        let band = body(samples);
        20.0 * (energy_at(band, 9_000.0) / energy_at(band, 500.0)).log10()
    };

    let was = tilt(&before);
    let now = tilt(&after);

    assert!(
        now > was + 2.0,
        "the top end sat {was:.1} dB below the bottom and came back at {now:.1} dB — the EQ \
         did not reach the samples"
    );
}

/// The level has to be more even coming out than going in.
///
/// Not a claim about how it sounds. The crest factor — peak over RMS — is
/// what a compressor reduces, and a pass whose compressor never engaged
/// leaves it where it was.
#[test]
fn the_studio_pass_evens_the_level_out() {
    let (before, after) = pass("prequel-voice-studio-dynamics");

    let crest = |samples: &[f32]| {
        let band = body(samples);
        let peak = band.iter().fold(0.0f32, |most, s| most.max(s.abs()));
        let sum: f64 = band.iter().map(|s| f64::from(*s) * f64::from(*s)).sum();
        let rms = (sum / band.len() as f64).sqrt() as f32;
        20.0 * (peak / rms).log10()
    };

    let was = crest(&before);
    let now = crest(&after);

    assert!(
        now < was - 1.0,
        "the crest factor went from {was:.1} dB to {now:.1} dB — the compressor is not working"
    );
}
