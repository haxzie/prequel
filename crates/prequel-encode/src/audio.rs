use std::path::Path;

use cidre::{arc, av, cat, cm, ns, os};
use prequel_session::MediaTime;

use crate::{Error, Result};

/// Nanoseconds, matching [`prequel_session::MediaTime`].
const TIMESCALE: i32 = 1_000_000_000;

/// AAC tops out here; anything above is resampled by the encoder anyway, and
/// asking for more just wastes bits.
const MAX_SAMPLE_RATE: f64 = 48_000.0;
const MIN_SAMPLE_RATE: f64 = 8_000.0;

const DEFAULT_BIT_RATE: i32 = 128_000;

/// How long an offline append waits for the encoder before giving up.
const READY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
const READY_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(2);

#[derive(Debug, Clone)]
pub struct AudioWriterConfig {
    pub sample_rate: f64,
    pub channels: i32,
    pub bit_rate: i32,
    /// Whether buffers arrive at capture rate.
    ///
    /// Live capture (`true`) must never block: the delivery queue is shared
    /// with video, and stalling it to wait for the audio encoder would cost
    /// frames. Dropping a buffer there is the cheaper failure.
    ///
    /// Offline work such as export (`false`) has no such deadline, and dropping
    /// a buffer would be a silent gap in the exported audio — so the writer
    /// waits instead. This is the counterpart to
    /// [`crate::VideoWriterConfig::offline`], and export needs both.
    pub realtime: bool,
}

impl AudioWriterConfig {
    pub fn new(sample_rate: f64, channels: i32) -> Self {
        Self {
            // ScreenCaptureKit hands back 48 kHz by default, but a mic can be
            // higher; clamp rather than let the encoder reject the settings.
            sample_rate: sample_rate.clamp(MIN_SAMPLE_RATE, MAX_SAMPLE_RATE),
            channels: channels.clamp(1, 2),
            bit_rate: DEFAULT_BIT_RATE,
            realtime: true,
        }
    }

    /// Switches to offline mode: no buffer is dropped, appends wait instead.
    pub fn offline(mut self) -> Self {
        self.realtime = false;
        self
    }
}

/// Writes AAC audio to an `.m4a`.
///
/// Audio cannot go through the pixel-buffer adaptor the video writer uses, so
/// each sample buffer is copied with corrected timing before being appended —
/// which is what carries pause spans and the shared session origin into the
/// file. Without it the audio would keep ScreenCaptureKit's host-clock
/// timestamps and drift out of step with the video.
#[derive(Debug)]
pub struct AudioWriter {
    writer: arc::R<av::AssetWriter>,
    input: arc::R<av::asset::WriterInput>,
    session_open: bool,
    samples: u64,
    first_pts: Option<MediaTime>,
    last_pts: Option<MediaTime>,
    dropped_not_ready: u64,
    realtime: bool,
    /// Kept so `append_pcm` can describe the buffers it builds.
    channels: i32,
}

impl AudioWriter {
    pub fn create(path: &Path, config: &AudioWriterConfig) -> Result<Self> {
        // `AVAssetWriter` refuses a URL that already exists — error -11823,
        // "the requested file name is already in use" — rather than truncating.
        // Without this, re-exporting a recording fails every time after the
        // first, which reads as a broken export rather than a stale file.
        if path.exists() {
            std::fs::remove_file(path).map_err(|e| Error::CreateWriter {
                path: path.display().to_string(),
                reason: format!("could not replace the existing file: {e}"),
            })?;
        }

        let url = ns::Url::with_fs_path_str(&path.to_string_lossy(), false);
        let mut writer = av::AssetWriter::with_url_and_file_type(&url, av::FileType::m4a())
            .map_err(|e| Error::CreateWriter {
                path: path.display().to_string(),
                reason: format!("{e:?}"),
            })?;

        let settings = audio_settings(config);
        let mut input = av::asset::WriterInput::with_media_type_and_output_settings(
            av::MediaType::audio(),
            Some(settings.as_ref()),
        )
        .map_err(|e| Error::Configuration(format!("{e:?}")))?;

        input.set_expects_media_data_in_real_time(config.realtime);

        writer
            .add_input(&input)
            .map_err(|e| Error::Configuration(format!("{e:?}")))?;

        if !writer.start_writing() {
            return Err(Error::Write(describe(&writer)));
        }

        Ok(Self {
            writer,
            input,
            session_open: false,
            samples: 0,
            first_pts: None,
            last_pts: None,
            dropped_not_ready: 0,
            realtime: config.realtime,
            channels: config.channels,
        })
    }

    /// Blocks until the encoder will take another buffer. Offline only.
    ///
    /// Timing out is reported rather than silently skipped: offline, a dropped
    /// buffer is a gap in the exported audio, and a caller that knows the
    /// encoder stalled can at least say so.
    fn wait_until_ready(&self) -> Result<()> {
        let deadline = std::time::Instant::now() + READY_TIMEOUT;
        while !self.input.is_ready_for_more_media_data() {
            if std::time::Instant::now() >= deadline {
                return Err(Error::NotReady);
            }
            std::thread::sleep(READY_POLL_INTERVAL);
        }
        Ok(())
    }

    /// Appends a sample buffer at an explicit media time.
    ///
    /// Returns `Ok(false)` when the encoder is saturated and the buffer was
    /// skipped — normal under load, not an error.
    pub fn append(&mut self, sample: &cm::SampleBuf, pts: MediaTime) -> Result<bool> {
        let time = cm::Time::new(pts as i64, TIMESCALE);

        if !self.session_open {
            // Open at the first buffer's timestamp, not zero, or the track is
            // padded with silence up to that point.
            self.writer.start_session_at_src_time(time);
            self.session_open = true;
            self.first_pts = Some(pts);
        }

        if self.realtime {
            if !self.input.is_ready_for_more_media_data() {
                self.dropped_not_ready += 1;
                return Ok(false);
            }
        } else {
            // Offline: wait rather than drop. Every buffer has to reach the
            // output, or the exported audio has a hole in it that nothing
            // downstream can detect.
            self.wait_until_ready()?;
        }

        let retimed = retime(sample, time)?;
        let appended = self
            .input
            .append_sample_buf(&retimed)
            .map_err(|e| Error::Write(format!("{e:?}")))?;

        if !appended {
            return Err(Error::Write(describe(&self.writer)));
        }

        self.samples += 1;
        self.last_pts = Some(pts);
        Ok(true)
    }

    /// Appends raw interleaved `f32` PCM as one buffer.
    ///
    /// The export path: the mixer works on plain sample slices, so the encoder
    /// has to be handed one rather than a `CMSampleBuffer` that came from a
    /// capture. Building the buffer by hand is the price of mixing in Rust —
    /// and mixing in Rust is what keeps the exported sound identical to the
    /// preview, which multiplies the same numbers in WebAudio.
    pub fn append_pcm(
        &mut self,
        samples: &[f32],
        sample_rate: f64,
        duration: MediaTime,
    ) -> Result<()> {
        if samples.is_empty() {
            return Ok(());
        }

        let sample = pcm_sample_buf(samples, sample_rate, self.channels)?;
        self.append(&sample, 0)?;
        // Recorded so `finish` can end the session past the last sample rather
        // than exactly on it, which would clip the tail.
        self.last_pts = Some(duration);
        Ok(())
    }

    pub fn finish(mut self) -> Result<AudioWriterSummary> {
        self.input.mark_as_finished();

        if let Some(last) = self.last_pts {
            let _ = self
                .writer
                .end_session_at_src_time(cm::Time::new(last as i64, TIMESCALE));
        }
        self.writer.finish_writing();

        if self.writer.status() == av::AssetWriterStatus::Failed {
            return Err(Error::Write(describe(&self.writer)));
        }

        Ok(AudioWriterSummary {
            samples: self.samples,
            first_pts: self.first_pts.unwrap_or(0),
            last_pts: self.last_pts.unwrap_or(0),
            dropped_not_ready: self.dropped_not_ready,
        })
    }

    pub fn cancel(mut self) {
        self.writer.cancel_writing();
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioWriterSummary {
    pub samples: u64,
    pub first_pts: MediaTime,
    pub last_pts: MediaTime,
    pub dropped_not_ready: u64,
}

impl AudioWriterSummary {
    pub fn duration(&self) -> MediaTime {
        self.last_pts.saturating_sub(self.first_pts)
    }
}

/// Copies a sample buffer with a new presentation timestamp.
///
/// `CMSampleBufferCreateCopyWithNewTiming` copies the timing metadata only —
/// the sample data itself is shared, not duplicated, so this is cheap enough to
/// run on every audio buffer.
pub(crate) fn retime(sample: &cm::SampleBuf, pts: cm::Time) -> Result<arc::R<cm::SampleBuf>> {
    let timing = cm::SampleTimingInfo {
        // Invalid duration tells CoreMedia to keep the original.
        duration: cm::Time::invalid(),
        pts,
        dts: cm::Time::invalid(),
    };

    let mut copy: Option<arc::R<cm::SampleBuf>> = None;
    let status =
        unsafe { CMSampleBufferCreateCopyWithNewTiming(None, sample, 1, &timing, &mut copy) };

    if status.is_err() {
        return Err(Error::Write(format!(
            "could not retime audio sample: OSStatus {}",
            status.0
        )));
    }
    copy.ok_or_else(|| Error::Write("retiming returned no sample buffer".to_owned()))
}

/// A packed interleaved 32-bit float PCM description.
///
/// Describes the buffers `append_pcm` builds, so the encoder knows how to read
/// what the mixer produced.
/// Wraps interleaved `f32` PCM as one `CMSampleBuffer`.
///
/// Shared with [`crate::video::VideoWriter`], which needs exactly the same
/// buffer for the audio track it muxes alongside the picture. Two copies of this
/// would be two chances to describe the same samples differently, and a wrong
/// `bytes_per_frame` here does not fail — it writes noise.
pub(crate) fn pcm_sample_buf(
    samples: &[f32],
    sample_rate: f64,
    channels: i32,
) -> Result<arc::R<cm::SampleBuf>> {
    let frames = samples.len() / channels as usize;
    let bytes = std::mem::size_of_val(samples);

    let mut block =
        cm::BlockBuf::with_mem_block(bytes).map_err(|e| Error::Write(format!("{e:?}")))?;
    {
        let target = block
            .as_mut_slice()
            .map_err(|e| Error::Write(format!("{e:?}")))?;
        // Safety: `samples` is a packed `f32` slice, and `target` was allocated
        // at exactly its byte length.
        target.copy_from_slice(unsafe {
            std::slice::from_raw_parts(samples.as_ptr().cast::<u8>(), bytes)
        });
    }

    let asbd = pcm_asbd(sample_rate, channels);
    let format = cm::FormatDesc::with_asbd(&asbd).map_err(|e| Error::Write(format!("{e:?}")))?;

    // Built through `create_in` rather than the convenience constructor: the
    // encoder needs the sample count, the per-sample duration and the per-sample
    // size, and only this entry point carries them. One timing entry and one size
    // entry describe all of them, because PCM samples are uniform.
    let timing = cm::SampleTimingInfo {
        duration: cm::Time::new(1, sample_rate as i32),
        pts: cm::Time::new(0, TIMESCALE),
        dts: cm::Time::invalid(),
    };
    let size = 4 * channels as usize;

    let mut created = None;
    // Safety: every pointer is either null or borrowed for the duration of the
    // call, and `create_in` writes the new buffer into `created`.
    let status = unsafe {
        cm::SampleBuf::create_in(
            None,
            Some(&block),
            true,
            None,
            std::ptr::null(),
            Some(&format),
            frames as cm::ItemCount,
            1,
            &timing,
            1,
            &size,
            &mut created,
        )
    };
    status.map_err(|e| Error::Write(format!("{e:?}")))?;

    created.ok_or_else(|| Error::Write("CMSampleBufferCreate returned nothing".to_owned()))
}

pub(crate) fn pcm_asbd(sample_rate: f64, channels: i32) -> cat::audio::StreamBasicDesc {
    let bytes_per_frame = 4 * channels as u32;

    cat::audio::StreamBasicDesc {
        sample_rate,
        format: cat::AudioFormat::LINEAR_PCM,
        format_flags: cat::audio::FormatFlags::IS_FLOAT | cat::audio::FormatFlags::IS_PACKED,
        bytes_per_packet: bytes_per_frame,
        frames_per_packet: 1,
        bytes_per_frame,
        channels_per_frame: channels as u32,
        bits_per_channel: 32,
        reserved: 0,
    }
}

pub(crate) fn audio_settings(
    config: &AudioWriterConfig,
) -> arc::R<ns::Dictionary<ns::String, ns::Id>> {
    ns::Dictionary::with_keys_values(
        &[
            av::audio::settings::all_formats_keys::id(),
            av::audio::settings::all_formats_keys::sample_rate(),
            av::audio::settings::all_formats_keys::number_of_channels(),
            av::audio::settings::encoder_propery_keys::bit_rate(),
        ],
        &[
            ns::Number::with_u32(cat::AudioFormat::MPEG4_AAC.0).as_ref(),
            ns::Number::with_f64(config.sample_rate).as_ref(),
            ns::Number::with_i32(config.channels).as_ref(),
            ns::Number::with_i32(config.bit_rate).as_ref(),
        ],
    )
}

fn describe(writer: &av::AssetWriter) -> String {
    writer
        .error()
        .map(|e| format!("{e:?}"))
        .unwrap_or_else(|| format!("status {:?}, no error attached", writer.status()))
}

unsafe extern "C" {
    fn CMSampleBufferCreateCopyWithNewTiming(
        allocator: Option<&cidre::cf::Allocator>,
        original: &cm::SampleBuf,
        num_timing_entries: cidre::cf::Index,
        timing_array: *const cm::SampleTimingInfo,
        out: *mut Option<arc::R<cm::SampleBuf>>,
    ) -> os::Status;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_rates_are_clamped_to_what_aac_accepts() {
        // A 96 kHz mic would otherwise be handed to the encoder unchanged and
        // rejected at configuration time.
        assert_eq!(AudioWriterConfig::new(96_000.0, 2).sample_rate, 48_000.0);
        assert_eq!(AudioWriterConfig::new(44_100.0, 2).sample_rate, 44_100.0);
        assert_eq!(AudioWriterConfig::new(0.0, 2).sample_rate, 8_000.0);
    }

    #[test]
    fn channel_counts_are_clamped_to_stereo() {
        assert_eq!(AudioWriterConfig::new(48_000.0, 8).channels, 2);
        assert_eq!(AudioWriterConfig::new(48_000.0, 0).channels, 1);
    }

    #[test]
    fn summary_duration_never_underflows() {
        let summary = AudioWriterSummary {
            samples: 0,
            first_pts: 0,
            last_pts: 0,
            dropped_not_ready: 0,
        };
        assert_eq!(summary.duration(), 0);
    }
}
