//! Writes every profile to a WAV so a person can listen.
//!
//! Ignored by default — it writes files and proves nothing on its own. Run
//! it while tuning a table:
//!
//! ```sh
//! PATH="$HOME/.cargo/bin:$PATH" cargo test -p prequel-keysound --test audition -- --ignored
//! ```
//!
//! Each file is the same phrase typed the same way, then two clicks, so the
//! profiles can be compared like for like. The spectral tests in `synth.rs`
//! pin the orderings; this is for the part they cannot check, which is
//! whether it sounds like a keyboard.

use prequel_keysound::{Bank, ClickProfile, CueKind, KeyProfile, SAMPLE_RATE, cues};
use prequel_session::{KeyClass, KeyPress, MediaTime};

const MS: MediaTime = 1_000_000;

/// "the quick brown fox" with the rhythm of a real typist: a little faster
/// inside a word, a pause at each space, Return at the end, then a mistake
/// and two Deletes.
fn phrase() -> Vec<KeyPress> {
    let mut at = 200 * MS;
    let mut presses = Vec::new();
    for word in ["the", "quick", "brown", "fox"] {
        for (i, _) in word.chars().enumerate() {
            presses.push(KeyPress {
                at,
                class: KeyClass::Letter,
            });
            at += (70 + (i * 23 % 40) as MediaTime) * MS;
        }
        presses.push(KeyPress {
            at,
            class: KeyClass::Space,
        });
        at += 160 * MS;
    }
    presses.push(KeyPress {
        at,
        class: KeyClass::Modifier,
    });
    presses.push(KeyPress {
        at: at + 60 * MS,
        class: KeyClass::Letter,
    });
    at += 300 * MS;
    for _ in 0..2 {
        presses.push(KeyPress {
            at,
            class: KeyClass::Backspace,
        });
        at += 140 * MS;
    }
    presses.push(KeyPress {
        at: at + 200 * MS,
        class: KeyClass::Enter,
    });
    presses
}

fn render(keys: &Bank, clicks: &Bank) -> Vec<f32> {
    let planned = cues(&phrase(), &[4_200 * MS, 4_600 * MS], "audition");
    let total = ((5_500 * MS) as f64 / 1e9 * f64::from(SAMPLE_RATE)) as usize;
    let mut out = vec![0.0f32; total * 2];
    for cue in planned {
        let bank = if cue.kind == CueKind::Click {
            clicks
        } else {
            keys
        };
        let Some(voice) = bank.voice(cue.kind, cue.variant) else {
            continue;
        };
        let start = (cue.at as f64 / 1e9 * f64::from(SAMPLE_RATE)) as i64 - bank.onset() as i64;
        let left = ((1.0 - cue.pan) / 2.0).sqrt() * cue.gain;
        let right = ((1.0 + cue.pan) / 2.0).sqrt() * cue.gain;
        for (i, sample) in voice.iter().enumerate() {
            let frame = start + i as i64;
            if frame < 0 || frame as usize >= total {
                continue;
            }
            out[frame as usize * 2] += sample * left;
            out[frame as usize * 2 + 1] += sample * right;
        }
    }
    out
}

fn write_wav(path: &std::path::Path, samples: &[f32]) {
    let data_len = (samples.len() * 4) as u32;
    let mut bytes = Vec::with_capacity(44 + samples.len() * 4);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&3u16.to_le_bytes()); // IEEE float
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    bytes.extend_from_slice(&(SAMPLE_RATE * 8).to_le_bytes());
    bytes.extend_from_slice(&8u16.to_le_bytes());
    bytes.extend_from_slice(&32u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    std::fs::write(path, bytes).unwrap();
}

#[test]
#[ignore = "writes WAV files for a person to listen to"]
fn writes_an_audition_of_every_profile() {
    let dir = std::env::temp_dir().join("prequel-keysound");
    std::fs::create_dir_all(&dir).unwrap();
    let soft = Bank::clicks(ClickProfile::Soft);
    let mechanical = Bank::clicks(ClickProfile::Mechanical);
    for profile in KeyProfile::ALL {
        let keys = Bank::keys(profile);
        let path = dir.join(format!("{}.wav", profile.id()));
        write_wav(&path, &render(&keys, &soft));
        eprintln!("wrote {}", path.display());
    }
    let path = dir.join("clicks-mechanical.wav");
    write_wav(&path, &render(&Bank::keys(KeyProfile::Thock), &mechanical));
    eprintln!("wrote {}", path.display());
}
