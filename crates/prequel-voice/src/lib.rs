//! Cleaning the microphone up, once, into a file beside it.
//!
//! A take is recorded raw — whatever the room and the microphone gave. This
//! reads that track back, runs it through Apple's voice isolation unit and
//! writes a second file next to the first. The original is never touched:
//! turning the setting off is pointing at `mic.m4a` again.
//!
//! At the `studio` setting the cleaned voice then goes through the shaping
//! chain in `chain.rs` and is normalised to a broadcast loudness — the
//! difference between a recording with the room taken out of it and one that
//! sounds like it was meant to be listened to.
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

mod chain;
mod deess;
mod isolation;
mod loudness;
mod source;
mod unit;

pub use chain::CEILING_DB;
pub use isolation::{Isolation, Quality, natural_is_available};
pub use loudness::{Meter, TARGET_LUFS};
pub use unit::CHUNK;

use chain::{Limiter, Studio};

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

/// How hard to clean, with which model, and whether to finish the voice.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Enhancement {
    /// 0 leaves the track alone; 1 is the unit at full strength.
    pub amount: f32,
    pub quality: Quality,
    /// Whether the cleaned voice is then shaped and levelled.
    ///
    /// Isolation on its own makes a take quiet, not finished. This is the
    /// tone correction, the de-esser, the compressor and the loudness — see
    /// `chain.rs`.
    pub studio: bool,
}

impl Default for Enhancement {
    fn default() -> Self {
        Self {
            amount: 1.0,
            quality: Quality::default(),
            studio: false,
        }
    }
}

/// What one pass did.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Summary {
    /// Frames written, which is exactly the frames read.
    pub frames: u64,
    /// The model that actually ran, which on macOS 14 is always
    /// [`Quality::Strong`].
    pub quality: Quality,
    /// What the shaped track measured before it was normalised, in LUFS.
    ///
    /// `None` when the shaping did not run, or when there was nothing in the
    /// track loud enough to measure.
    pub measured_lufs: Option<f64>,
}

/// Reads `input`, cleans it, writes `output`.
///
/// `output` is replaced if it is already there — the writer refuses an
/// existing URL rather than truncating, so a second pass over the same take
/// would otherwise fail where the first succeeded.
pub fn enhance(input: &Path, output: &Path, enhancement: Enhancement) -> Result<Summary> {
    let quality = enhancement.quality.available();

    // **Two passes over the source, not one.**
    //
    // Loudness is a property of the whole track, so the gain that lands it on
    // the target cannot be known until the last sample has been shaped — and
    // a gain that followed the signal instead would pump, which is the sound
    // of a recording having been processed. The alternatives are holding the
    // shaped track in memory, which a forty-minute take makes 460 MB of, or
    // writing it to a temporary file and reading it back. Running the chain
    // twice costs CPU that is already ninety times faster than real time and
    // keeps the memory flat and the disk clean.
    //
    // This rests on the chain being deterministic: fresh units, the same
    // samples in, the same samples out. It holds because nothing here is
    // real time — no unit is ever asked to drop a buffer or catch up — so
    // the second pass measures the same track the first one did.
    let (gain, measured) = if enhancement.studio {
        let mut stages = Stages::open(enhancement, quality, false)?;
        let mut meter = Meter::new(SAMPLE_RATE);
        drive(input, &mut stages, |samples| {
            meter.push(samples);
            Ok(())
        })?;
        (meter.gain_to(TARGET_LUFS), meter.integrated())
    } else {
        (1.0, None)
    };

    let mut stages = Stages::open(enhancement, quality, enhancement.studio)?;
    stages.gain = gain;

    // Lossless, and for the studio pass it is the difference between the claim
    // and the truth. The source take is already one generation of AAC; a
    // shaped track written as a second, then mixed into an export as a third,
    // has been through 128 kbps twice before anybody hears it. FLAC in the
    // same `.m4a` — not ALAC, which Chromium cannot decode and the editor
    // previews this file in an `<audio>` element.
    let config = AudioWriterConfig::new(SAMPLE_RATE, 1).lossless().offline();
    let mut writer = AudioWriter::create(output, &config).map_err(|e| Error::Write {
        path: output.display().to_string(),
        reason: e.to_string(),
    })?;

    let written = drive(input, &mut stages, |samples| {
        writer.append_pcm(samples, SAMPLE_RATE).map_err(|e| {
            Error::Write {
                path: output.display().to_string(),
                reason: e.to_string(),
            }
        })
    })?;

    writer.finish().map_err(|e| Error::Write {
        path: output.display().to_string(),
        reason: e.to_string(),
    })?;

    if enhancement.studio {
        tracing::info!(
            "shaped {} frames of microphone into {}: measured {} LUFS, {:+.1} dB to reach \
             {TARGET_LUFS}, de-esser pulled {:.1} dB at its hardest",
            written,
            output.display(),
            measured.map_or_else(|| "nothing".to_owned(), |l| format!("{l:.1}")),
            20.0 * gain.log10(),
            stages.hardest_deess_db(),
        );
    } else {
        tracing::info!(
            "cleaned {} frames of microphone into {}",
            written,
            output.display()
        );
    }

    Ok(Summary {
        frames: written,
        quality,
        measured_lufs: measured,
    })
}

/// Whether this machine has the units this crate is built around.
///
/// Opening one is the only honest test — the component either registers or it
/// does not, and nothing else says so. Cheap: no resources are allocated
/// until `initialize`, which this never reaches.
pub fn is_available() -> bool {
    Isolation::open(SAMPLE_RATE, 1.0, Quality::default()).is_ok()
}

/// Everything one pass puts the samples through, in order.
struct Stages {
    isolation: Isolation,
    studio: Option<Studio>,
    /// Applied between the shaping and the limiter: the limiter's whole job is
    /// to catch what this pushed too far, so it cannot come first.
    gain: f32,
    limiter: Option<Limiter>,
}

impl Stages {
    /// `finishing` is false on the measuring pass, which has no gain to catch
    /// and so needs no limiter.
    fn open(enhancement: Enhancement, quality: Quality, finishing: bool) -> Result<Self> {
        Ok(Self {
            isolation: Isolation::open(SAMPLE_RATE, enhancement.amount, quality)?,
            studio: if enhancement.studio {
                Some(Studio::open(SAMPLE_RATE)?)
            } else {
                None
            },
            gain: 1.0,
            limiter: if finishing {
                Some(Limiter::open(SAMPLE_RATE)?)
            } else {
                None
            },
        })
    }

    /// Frames of lookahead every stage adds between them, which the driver has
    /// to drop off the front of the track.
    fn latency(&self) -> u64 {
        self.isolation.latency()
            + self.studio.as_ref().map_or(0, Studio::latency)
            + self.limiter.as_ref().map_or(0, Limiter::latency)
    }

    fn process(&mut self, samples: &mut [f32]) -> Result<()> {
        self.isolation.process(samples)?;
        if let Some(studio) = &mut self.studio {
            studio.process(samples)?;
        }
        if self.gain != 1.0 {
            for sample in samples.iter_mut() {
                *sample *= self.gain;
            }
        }
        if let Some(limiter) = &mut self.limiter {
            limiter.process(samples)?;
        }
        Ok(())
    }

    fn hardest_deess_db(&self) -> f32 {
        self.studio.as_ref().map_or(0.0, Studio::hardest_deess_db)
    }
}

/// Runs the whole of `input` through `stages`, handing each usable slice on.
///
/// Returns the frames handed over, which is exactly the frames the source
/// held. Everything awkward about the shape of this loop is one of two
/// things: the lookahead that has to come off the front, and the silence that
/// has to be fed in at the end to push the last of the track out of it.
fn drive(
    input: &Path,
    stages: &mut Stages,
    mut sink: impl FnMut(&[f32]) -> Result<()>,
) -> Result<u64> {
    let mut source = source::Mono::open(input, SAMPLE_RATE)?;

    let mut chunk = vec![0.0f32; CHUNK];
    // The stages' lookahead, in frames still to be thrown away before anything
    // is worth keeping. Without this the whole track slides late — see
    // `Effect::open`.
    let mut skip = stages.latency();
    let mut read = 0u64;
    let mut handed = 0u64;
    let mut drained = false;

    loop {
        let got = if drained {
            // Past the end of the file: silence in, so the lookahead already
            // inside the units comes back out. Without these extra chunks the
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

        stages.process(&mut chunk[..got])?;

        // Drop the lookahead, then hand over only as much as the file actually
        // held: everything past that is the silence fed in above.
        let mut usable = &chunk[..got];
        if skip > 0 {
            let dropped = (skip as usize).min(usable.len());
            usable = &usable[dropped..];
            skip -= dropped as u64;
        }
        let room = read.saturating_sub(handed) as usize;
        let usable = &usable[..usable.len().min(room)];

        if !usable.is_empty() {
            sink(usable)?;
            handed += usable.len() as u64;
        }

        if drained && handed >= read {
            break;
        }
    }

    Ok(handed)
}
