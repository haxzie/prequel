//! Pulling decoded frames and samples out of a recorded file.
//!
//! One reader per file per slice. `AVAssetReader` cannot seek backwards and
//! slices can be reordered, so a single long-lived reader is not an option —
//! and `set_time_range` on a fresh one is exactly the cut primitive anyway.

use std::path::Path;

use cidre::{arc, av, cat, cf, cm, cv, ns};

use crate::{Error, Result};

const NS_PER_SECOND: i32 = 1_000_000_000;

/// Reads video frames out of one file, over one time range.
pub struct VideoReader {
    reader: arc::R<av::AssetReader>,
    output: arc::R<av::AssetReaderTrackOutput>,
    /// The most recent frame pulled, held so a frame can be repeated when the
    /// output is running faster than the source.
    current: Option<(u64, arc::R<cv::PixelBuf>)>,
    finished: bool,
}

impl VideoReader {
    /// Opens `path`, restricted to `[start, end)` on the file's own timeline.
    pub fn open(path: &Path, start: u64, end: u64) -> Result<Self> {
        let asset = url_asset(path)?;
        let track = first_track(&asset, av::MediaType::video(), path)?;

        let mut reader = av::AssetReader::with_asset(&asset).map_err(|e| Error::Read {
            path: path.display().to_string(),
            reason: format!("{e:?}"),
        })?;

        // The cut, expressed to AVFoundation rather than applied by discarding
        // frames afterwards — it lets the decoder skip straight to the range.
        // The cut itself. Checked rather than ignored: a failure here would
        // silently export the whole file where a slice was asked for.
        reader
            .set_time_range(cm::TimeRange {
                start: time(start),
                duration: time(end.saturating_sub(start)),
            })
            .map_err(|e| Error::Read {
                path: path.display().to_string(),
                reason: format!("could not restrict the reader to the slice: {e:?}"),
            })?;

        // BGRA out of the decoder: the compositor samples it as a Metal
        // texture, and asking for it here avoids a conversion per frame.
        let settings = cf::DictionaryOf::with_keys_values(
            &[cv::pixel_buffer::keys::pixel_format()],
            &[cf::Number::from_i32(cv::PixelFormat::_32_BGRA.0 as i32).as_ref()],
        );

        let output = av::AssetReaderTrackOutput::with_track(
            &track,
            Some(unsafe {
                std::mem::transmute::<
                    &cf::DictionaryOf<cf::String, cf::Number>,
                    &ns::Dictionary<ns::String, ns::Id>,
                >(settings.as_ref())
            }),
        )
        .map_err(|e| Error::Read {
            path: path.display().to_string(),
            reason: format!("{e:?}"),
        })?;

        reader.add_output(&output).map_err(|e| Error::Read {
            path: path.display().to_string(),
            reason: format!("{e:?}"),
        })?;

        reader.start_reading().map_err(|e| Error::Read {
            path: path.display().to_string(),
            reason: format!("reader refused to start: {e:?}"),
        })?;

        Ok(Self {
            reader,
            output,
            current: None,
            finished: false,
        })
    }

    /// The frame that should be on screen at `at`, in file nanoseconds.
    ///
    /// Pulls forward until the next frame would be in the future, then holds
    /// what it has. Holding is correct rather than a compromise: a screen
    /// recording only emits a frame when something changed, so the last frame
    /// genuinely is what was on screen.
    pub fn frame_at(&mut self, at: u64) -> Option<&cv::PixelBuf> {
        while self.current.as_ref().is_none_or(|(pts, _)| *pts < at) {
            if self.finished {
                break;
            }
            match self.next() {
                Some(frame) => self.current = Some(frame),
                None => {
                    self.finished = true;
                    break;
                }
            }
        }

        self.current.as_ref().map(|(_, buf)| buf.as_ref())
    }

    fn next(&mut self) -> Option<(u64, arc::R<cv::PixelBuf>)> {
        let sample = self.output.next_sample_buf().ok().flatten()?;
        let pts = nanos(sample.pts());
        let image = sample.image_buf()?;
        Some((pts, image.retained()))
    }
}

impl Drop for VideoReader {
    fn drop(&mut self) {
        // Cancelled explicitly: a reader dropped mid-range otherwise keeps its
        // decode session alive until the asset is released, and an export opens
        // one of these per file per slice.
        self.reader.cancel_reading();
    }
}

/// Reads audio out of one file, over one time range, a chunk at a time.
///
/// Streamed rather than decoded whole. This used to hand back one `Vec` for the
/// entire range, on the reasoning that a session's audio is small enough to
/// keep in hand — but interleaved stereo `f32` at 48 kHz is 384 KB for every
/// second of recording, so a ten-minute take is 230 MB and an hour is 1.4 GB,
/// held for the whole export. Nothing ever needed it whole: the writer is fed a
/// second at a time, a second ahead of the picture.
pub struct AudioReader {
    reader: arc::R<av::AssetReader>,
    output: arc::R<av::AssetReaderTrackOutput>,
    /// Pulled from the output and not yet handed on. `AVAssetReader` chooses
    /// its own buffer sizes, so a pull almost never lands on a chunk boundary
    /// and the remainder has to wait for the next call.
    spare: Vec<f32>,
    taken: usize,
    finished: bool,
}

impl AudioReader {
    /// Opens `path`, restricted to `[start, end)` on the file's own timeline.
    pub fn open(path: &Path, start: u64, end: u64, sample_rate: f64) -> Result<Self> {
        let asset = url_asset(path)?;
        let track = first_track(&asset, av::MediaType::audio(), path)?;

        let mut reader = av::AssetReader::with_asset(&asset).map_err(|e| Error::Read {
            path: path.display().to_string(),
            reason: format!("{e:?}"),
        })?;

        reader
            .set_time_range(cm::TimeRange {
                start: time(start),
                duration: time(end.saturating_sub(start)),
            })
            .map_err(|e| Error::Read {
                path: path.display().to_string(),
                reason: format!("could not restrict the reader to the slice: {e:?}"),
            })?;

        let settings = pcm_settings(sample_rate);
        let output = av::AssetReaderTrackOutput::with_track(&track, Some(settings.as_ref()))
            .map_err(|e| Error::Read {
                path: path.display().to_string(),
                reason: format!("{e:?}"),
            })?;

        reader.add_output(&output).map_err(|e| Error::Read {
            path: path.display().to_string(),
            reason: format!("{e:?}"),
        })?;

        reader.start_reading().map_err(|e| Error::Read {
            path: path.display().to_string(),
            reason: format!("reader refused to start: {e:?}"),
        })?;

        Ok(Self {
            reader,
            output,
            spare: Vec::new(),
            taken: 0,
            finished: false,
        })
    }

    /// Fills `into` with the samples that come next, and says how many arrived.
    ///
    /// Short only at the end of the range, which is how the caller knows the
    /// track has run out — a source shorter than the slice it is mixed into is
    /// ordinary, and `mixer::mix_into` zips against whatever it is given.
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

    /// Pulls one sample buffer, and says whether anything usable came back.
    ///
    /// A buffer with no block is skipped rather than treated as the end: the
    /// range can legitimately contain one, and stopping there would truncate
    /// the sound at a point that varies with the file.
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

            // Safety: the output was configured for packed 32-bit float PCM, so
            // the block's bytes are exactly a `f32` array.
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

impl Drop for AudioReader {
    fn drop(&mut self) {
        // Cancelled explicitly, for the reason `VideoReader` is: an export
        // opens one of these per source per slice, and a reader dropped
        // mid-range holds its decode session until the asset is released.
        self.reader.cancel_reading();
    }
}

/// Linear PCM, 32-bit float, interleaved stereo — what the mixer speaks.
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
            ns::Number::with_i32(crate::mixer::CHANNELS as i32).as_ref(),
            ns::Number::with_i32(32).as_ref(),
            ns::Number::with_bool(true).as_ref(),
            ns::Number::with_bool(false).as_ref(),
            ns::Number::with_bool(false).as_ref(),
        ],
    )
}

fn url_asset(path: &Path) -> Result<arc::R<av::UrlAsset>> {
    let text = path.to_str().ok_or_else(|| Error::Read {
        path: path.display().to_string(),
        reason: "path is not valid UTF-8".to_owned(),
    })?;

    av::UrlAsset::with_url(&ns::Url::with_fs_path_str(text, false), None).ok_or_else(|| {
        Error::Read {
            path: path.display().to_string(),
            reason: "could not be opened as a media file".to_owned(),
        }
    })
}

/// The first track of a media type, loaded synchronously.
fn first_track(
    asset: &av::UrlAsset,
    media_type: &av::MediaType,
    path: &Path,
) -> Result<arc::R<av::asset::Track>> {
    let (tx, rx) = std::sync::mpsc::channel();

    asset.load_tracks_with_media_type_block(media_type, move |tracks, _error| {
        let _ = tx.send(tracks.and_then(|tracks| tracks.iter().next().map(|t| t.retained())));
    });

    rx.recv_timeout(std::time::Duration::from_secs(10))
        .ok()
        .flatten()
        .ok_or_else(|| Error::Read {
            path: path.display().to_string(),
            reason: "holds no track of the expected type".to_owned(),
        })
}

fn time(ns: u64) -> cm::Time {
    cm::Time::new(ns as i64, NS_PER_SECOND)
}

fn nanos(time: cm::Time) -> u64 {
    if time.scale <= 0 || time.value < 0 {
        return 0;
    }
    ((time.value as f64 / time.scale as f64) * 1_000_000_000.0) as u64
}
