//! Reading a recorded track back as plain mono samples.
//!
//! `AVAssetReader` does the decode, the resample and the downmix in one go:
//! the output settings ask for mono 32-bit float at the rate the rest of this
//! crate speaks, and a 44.1 kHz stereo interface arrives the same way the
//! built-in microphone does.

use std::path::Path;

use cidre::{arc, av, cat, ns};

use crate::{Error, Result};

/// One file, from its start to its end, as mono `f32`.
pub struct Mono {
    reader: arc::R<av::AssetReader>,
    output: arc::R<av::AssetReaderTrackOutput>,
    /// Decoded and not yet handed on. The reader picks its own buffer sizes,
    /// so a read almost never lands on one of its boundaries.
    spare: Vec<f32>,
    taken: usize,
    finished: bool,
}

impl Mono {
    pub fn open(path: &Path, sample_rate: f64) -> Result<Self> {
        let read = |reason: String| Error::Read {
            path: path.display().to_string(),
            reason,
        };

        let text = path.to_str().ok_or_else(|| Error::Read {
            path: path.display().to_string(),
            reason: "path is not valid UTF-8".to_owned(),
        })?;
        let asset = av::UrlAsset::with_url(&ns::Url::with_fs_path_str(text, false), None)
            .ok_or_else(|| read("could not be opened as a media file".to_owned()))?;

        let track = first_audio_track(&asset).ok_or_else(|| read("holds no audio".to_owned()))?;

        let mut reader = av::AssetReader::with_asset(&asset).map_err(|e| read(format!("{e:?}")))?;

        let output = av::AssetReaderTrackOutput::with_track(
            &track,
            Some(pcm_settings(sample_rate).as_ref()),
        )
        .map_err(|e| read(format!("{e:?}")))?;

        reader
            .add_output(&output)
            .map_err(|e| read(format!("{e:?}")))?;
        reader
            .start_reading()
            .map_err(|e| read(format!("reader refused to start: {e:?}")))?;

        Ok(Self {
            reader,
            output,
            spare: Vec::new(),
            taken: 0,
            finished: false,
        })
    }

    /// Fills `into` and says how many samples arrived.
    ///
    /// Short only at the end of the file, which is how the caller knows it has
    /// run out.
    pub fn read(&mut self, into: &mut [f32]) -> usize {
        let mut filled = 0;

        while filled < into.len() {
            if self.taken == self.spare.len() && !self.refill() {
                break;
            }
            let run = (into.len() - filled).min(self.spare.len() - self.taken);
            into[filled..filled + run].copy_from_slice(&self.spare[self.taken..self.taken + run]);
            self.taken += run;
            filled += run;
        }

        filled
    }

    /// Pulls one buffer, and says whether anything usable came back.
    ///
    /// A buffer with no block is skipped rather than treated as the end: a
    /// file can legitimately contain one, and stopping there would cut the
    /// sound off at a point that moves with the file.
    fn refill(&mut self) -> bool {
        while !self.finished {
            let Ok(Some(sample)) = self.output.next_sample_buf() else {
                self.finished = true;
                return false;
            };
            let Some(block) = sample.data_buf() else {
                continue;
            };
            let Ok(bytes) = block.as_slice() else {
                continue;
            };

            // Safety: the output was configured for packed 32-bit float PCM,
            // so the block's bytes are exactly an `f32` array.
            let floats = unsafe {
                std::slice::from_raw_parts(bytes.as_ptr().cast::<f32>(), bytes.len() / 4)
            };

            self.spare.clear();
            self.spare.extend_from_slice(floats);
            self.taken = 0;

            if !self.spare.is_empty() {
                return true;
            }
        }

        false
    }
}

impl Drop for Mono {
    fn drop(&mut self) {
        // A reader dropped part way holds its decode session until the asset
        // goes with it; cancelling says so now.
        self.reader.cancel_reading();
    }
}

/// Linear PCM, 32-bit float, one channel.
fn pcm_settings(sample_rate: f64) -> arc::R<ns::Dictionary<ns::String, ns::Id>> {
    ns::Dictionary::with_keys_values(
        &[
            av::audio::settings::all_formats_keys::id(),
            av::audio::settings::all_formats_keys::sample_rate(),
            av::audio::settings::all_formats_keys::number_of_channels(),
            av::audio::settings::linear_pcm_keys::bit_depth(),
            av::audio::settings::linear_pcm_keys::is_float(),
            av::audio::settings::linear_pcm_keys::is_big_endian(),
            av::audio::settings::linear_pcm_keys::is_non_interleaved(),
        ],
        &[
            ns::Number::with_u32(cat::AudioFormat::LINEAR_PCM.0).as_ref(),
            ns::Number::with_f64(sample_rate).as_ref(),
            ns::Number::with_i32(1).as_ref(),
            ns::Number::with_i32(32).as_ref(),
            ns::Number::with_bool(true).as_ref(),
            ns::Number::with_bool(false).as_ref(),
            ns::Number::with_bool(false).as_ref(),
        ],
    )
}

/// The first audio track, loaded synchronously.
fn first_audio_track(asset: &av::UrlAsset) -> Option<arc::R<av::asset::Track>> {
    let (tx, rx) = std::sync::mpsc::channel();

    asset.load_tracks_with_media_type_block(av::MediaType::audio(), move |tracks, _error| {
        let _ = tx.send(tracks.and_then(|tracks| tracks.iter().next().map(|t| t.retained())));
    });

    rx.recv_timeout(std::time::Duration::from_secs(10))
        .ok()
        .flatten()
}
