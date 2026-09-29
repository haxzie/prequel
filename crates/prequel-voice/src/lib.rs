//! Cleaning the microphone up, once, into a file beside it.
//!
//! A take is recorded raw — whatever the room and the microphone gave. This
//! reads that track back, runs it through Apple's voice isolation unit and
//! writes a second file next to the first. The original is never touched:
//! turning the setting off is pointing at `mic.m4a` again.
//!
//! **A file, not a filter.** The preview plays media elements in a renderer
//! and the export mixes samples in Rust, and the rule those two live under is
//! that neither may compute sound the other cannot — see `prequel-render`'s
//! mixer. A denoiser breaks that rule the moment it exists, because WebAudio
//! cannot run a neural net. So the work happens once, offline, and both sides
//! read the same finished samples. The same shape as the sound plan: decided
//! in Rust, played by whoever is playing.

use std::path::Path;

use prequel_encode::{AudioWriter, AudioWriterConfig};

mod isolation;
mod source;

pub use isolation::{CHUNK, Isolation, Quality, natural_is_available};

/// What the enhanced track is written at.
///
/// The rate the exporter mixes at and the most AAC will take, so nothing
/// downstream resamples. The microphone's own rate is whatever the device
/// offered; the reader converts on the way through.
pub const SAMPLE_RATE: f64 = 48_000.0;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("this machine has no voice isolation audio unit")]
    Unavailable,
    #[error("the voice isolation unit refused: OSStatus {0}")]
    Unit(i32),
    #[error("could not read {path}: {reason}")]
    Read { path: String, reason: String },
    #[error("could not write {path}: {reason}")]
    Write { path: String, reason: String },
}

impl Error {
    fn unit(error: cidre::os::Error) -> Self {
        Self::Unit(error.0.get())
    }
}

/// Whether the audio unit this crate is built around is on this machine.
///
/// Opening it is the only honest test — the component either registers or it
/// does not, and nothing else says so. Cheap: no resources are allocated
/// until `initialize`, which this never reaches.
pub fn is_available() -> bool {
    Isolation::open(SAMPLE_RATE, 1.0, Quality::default()).is_ok()
}

/// How hard to clean, and with which model.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Enhancement {
    /// 0 leaves the track alone; 1 is the unit at full strength.
    pub amount: f32,
    pub quality: Quality,
}

impl Default for Enhancement {
    fn default() -> Self {
        Self {
            amount: 1.0,
            quality: Quality::default(),
        }
    }
}

/// What one pass did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Summary {
    /// Frames written, which is exactly the frames read.
    pub frames: u64,
    /// The model that actually ran, which on macOS 14 is always
    /// [`Quality::Strong`].
    pub quality: Quality,
}

/// Reads `input`, cleans it, writes `output`.
///
/// `output` is replaced if it is already there — the writer refuses an
/// existing URL rather than truncating, so a second pass over the same take
/// would otherwise fail where the first succeeded.
pub fn enhance(input: &Path, output: &Path, enhancement: Enhancement) -> Result<Summary> {
    let quality = enhancement.quality.available();
    let mut isolation = Isolation::open(SAMPLE_RATE, enhancement.amount, quality)?;
    let mut source = source::Mono::open(input, SAMPLE_RATE)?;

    let config = AudioWriterConfig::new(SAMPLE_RATE, 1).offline();
    let mut writer = AudioWriter::create(output, &config).map_err(|e| Error::Write {
        path: output.display().to_string(),
        reason: e.to_string(),
    })?;

    let mut chunk = vec![0.0f32; CHUNK];
    // The unit's lookahead, in frames still to be thrown away before anything
    // is worth writing. Without this the whole track slides late — see
    // `Isolation::open`.
    let mut skip = isolation.latency();
    let mut read = 0u64;
    let mut written = 0u64;
    let mut drained = false;

    loop {
        let got = if drained {
            // Past the end of the file: silence in, so the lookahead already
            // inside the unit comes back out. Without these extra chunks the
            // last `skip` frames of the recording are simply missing.
            chunk.fill(0.0);
            CHUNK
        } else {
            let got = source.read(&mut chunk);
            read += got as u64;
            if got < CHUNK {
                chunk[got..].fill(0.0);
                drained = true;
            }
            CHUNK
        };

        isolation.process(&mut chunk[..got])?;

        // Drop the lookahead, then write only as much as the file actually
        // held: everything past that is the silence fed in above.
        let mut usable = &chunk[..got];
        if skip > 0 {
            let dropped = (skip as usize).min(usable.len());
            usable = &usable[dropped..];
            skip -= dropped as u64;
        }
        let room = read.saturating_sub(written) as usize;
        let usable = &usable[..usable.len().min(room)];

        if !usable.is_empty() {
            writer
                .append_pcm(usable, SAMPLE_RATE)
                .map_err(|e| Error::Write {
                    path: output.display().to_string(),
                    reason: e.to_string(),
                })?;
            written += usable.len() as u64;
        }

        if drained && written >= read {
            break;
        }
    }

    writer.finish().map_err(|e| Error::Write {
        path: output.display().to_string(),
        reason: e.to_string(),
    })?;

    tracing::info!(
        "cleaned {} frames of microphone into {}",
        written,
        output.display()
    );

    Ok(Summary {
        frames: written,
        quality,
    })
}
