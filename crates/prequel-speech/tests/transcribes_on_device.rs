//! Proves the Apple engines actually run, on a clip whose words are known.
//!
//! `#[ignore]` by default. It needs an on-device speech model, which is a
//! machine-local asset CI does not have, and — on the `SFSpeechRecognizer`
//! path — a Speech authorisation that only a signed app bundle can hold. The
//! same posture the ffmpeg-dependent media tests already take.
//!
//! Run it with:
//!   PATH="$HOME/.cargo/bin:$PATH" cargo test -p prequel-speech -- --ignored --nocapture
//!
//! The fixture is synthesised rather than committed: `say` is on every Mac, the
//! words are then known exactly, and a checked-in clip of a real voice is a
//! recording of somebody in the repository forever.
use std::{path::PathBuf, process::Command};

use prequel_speech::{Cancel, availability, transcribe};

/// Written into the target directory, so a stale one is cleaned with the build.
fn fixture() -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR"));
    let aiff = dir.join("speech-fixture.aiff");
    let m4a = dir.join("speech-fixture.m4a");

    if m4a.exists() {
        return m4a;
    }

    let said = Command::new("say")
        .arg("-o")
        .arg(&aiff)
        .arg(SPOKEN)
        .status()
        .expect("`say` ships with macOS");
    assert!(said.success(), "could not synthesise the fixture");

    // Encoded to AAC in an m4a, because that is exactly what `mic.m4a` is —
    // testing against a WAV would not exercise the container the app writes.
    let converted = Command::new("afconvert")
        .args(["-f", "m4af", "-d", "aac"])
        .arg(&aiff)
        .arg(&m4a)
        .status()
        .expect("`afconvert` ships with macOS");
    assert!(converted.success(), "could not encode the fixture");

    m4a
}

const SPOKEN: &str = "This is a test of on device speech recognition. \
     It should produce words with timings.";

#[test]
#[ignore = "needs an on-device speech model this machine may not have"]
fn hears_a_known_clip_without_the_network() {
    let available = availability("en-US");
    assert!(
        available.any(),
        "no on-device engine here: {available:?} — add the language in System Settings"
    );

    let path = fixture();
    let cancel = Cancel::new();
    let mut seen: Vec<f64> = Vec::new();

    let result = transcribe(&path, "en-US", &cancel, &mut |fraction| seen.push(fraction))
        .expect("transcription failed");

    eprintln!("{} via {}", result.language, result.model);

    // The engine measures each word rather than interpolating from a segment,
    // which is what lets the editor light one.
    assert_eq!(result.timings, "native");
    assert!(!result.words.is_empty(), "no words came back");

    let heard = result
        .words
        .iter()
        .map(|word| word.text.to_lowercase())
        .collect::<Vec<_>>()
        .join(" ");
    eprintln!("heard: {heard}");

    // Stems, not the whole sentence: recognition is allowed to mishear, and a
    // test that demands a perfect transcript fails on a model update rather
    // than on a bug — this engine already hears "timing" for "timings". These
    // four carry the meaning.
    for word in ["test", "speech", "recognition", "timing"] {
        assert!(heard.contains(word), "did not hear {word:?} in {heard:?}");
    }

    // Times are on the file's own clock, zero-based. The manifest's microphone
    // offset is applied once, in the editor, and a second application here is
    // the mistake that puts every caption a few hundred milliseconds out.
    let first = &result.words[0];
    assert!(first.at >= 0.0, "first word starts before the file does");
    assert!(first.at < 2.0, "first word is oddly late: {}", first.at);

    // Monotonic and drawable, which is what the caption clock needs.
    for pair in result.words.windows(2) {
        assert!(pair[0].at <= pair[1].at, "words came back out of order");
        assert!(pair[0].end > pair[0].at, "a word with no duration");
    }

    let last = result.words.last().unwrap();
    assert!(
        last.end <= 12.0,
        "words run past the clip: {} seconds",
        last.end
    );

    assert!(
        seen.iter().any(|fraction| *fraction > 0.0),
        "progress was never reported"
    );
}

#[test]
#[ignore = "needs an on-device speech model this machine may not have"]
fn says_what_it_can_do_without_asking_permission() {
    // A probe must never put a TCC dialog on screen: it runs when the editor
    // opens, and a permission prompt nobody asked for is worse than a disabled
    // button.
    let available = availability("en-US");
    eprintln!("{available:?}");

    assert_eq!(available.locale, "en-US");
}
