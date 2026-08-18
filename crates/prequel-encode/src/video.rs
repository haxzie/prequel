use std::path::Path;

use cidre::{arc, av, cm, cv, ns};
use prequel_session::MediaTime;

use crate::audio::{AudioWriterConfig, audio_settings, pcm_sample_buf, retime};
use crate::{Error, Result};

/// Timescale for presentation timestamps. Nanoseconds, matching
/// [`prequel_session::MediaTime`], so no rounding happens at this boundary.
const TIMESCALE: i32 = 1_000_000_000;

/// How long an offline append waits for the encoder before giving up.
const READY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
const READY_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(2);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum VideoCodec {
    #[default]
    H264,
    /// Smaller files at the same quality, but slower to decode in browsers and
    /// older editors.
    Hevc,
}

#[derive(Debug, Clone)]
pub struct VideoWriterConfig {
    /// Physical pixels, not points. Both must be even — H.264 chroma
    /// subsampling requires it and encoders round silently otherwise.
    pub width: u32,
    pub height: u32,
    pub codec: VideoCodec,
    /// Whether frames arrive at capture rate.
    ///
    /// Live capture (`true`) must never block: if the encoder falls behind,
    /// dropping a frame keeps the recording going, whereas waiting would stall
    /// ScreenCaptureKit's delivery queue and lose more than it saves.
    ///
    /// Offline work such as export (`false`) has no such deadline — frames come
    /// from a file, so the writer waits for the encoder instead of dropping
    /// them, and every frame reaches the output.
    pub realtime: bool,
    /// An audio track in the same file, when the output has sound.
    ///
    /// It has to be declared here rather than added once the picture is done:
    /// `AVAssetWriter` takes every input before `startWriting`, and refuses one
    /// afterwards. Writing the sound to a sidecar instead is how an export comes
    /// to be a silent video with an `.m4a` next to it that nothing plays.
    pub audio: Option<AudioWriterConfig>,
}

impl VideoWriterConfig {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            codec: VideoCodec::default(),
            realtime: true,
            audio: None,
        }
    }

    /// Adds an audio track to the file.
    pub fn with_audio(mut self, audio: AudioWriterConfig) -> Self {
        self.audio = Some(audio);
        self
    }

    pub fn with_codec(mut self, codec: VideoCodec) -> Self {
        self.codec = codec;
        self
    }

    /// Switches to offline mode: no frame is dropped, appends wait instead.
    pub fn offline(mut self) -> Self {
        self.realtime = false;
        self
    }

    /// Rounds dimensions down to even numbers.
    fn even(&self) -> (u32, u32) {
        (self.width & !1, self.height & !1)
    }
}

/// Writes CoreVideo pixel buffers to an MP4 with hardware encoding.
///
/// Frames are appended through an `AVAssetWriterInputPixelBufferAdaptor` with
/// an explicit presentation time. That matters: it means we hand the writer the
/// timestamp computed by [`prequel_session`] rather than whatever
/// ScreenCaptureKit stamped on the sample, so pause spans and jitter correction
/// actually reach the file — without having to copy and retime every
/// `CMSampleBuffer`.
#[derive(Debug)]
pub struct VideoWriter {
    writer: arc::R<av::AssetWriter>,
    adaptor: arc::R<av::asset::WriterInputPixelBufAdaptor>,
    input: arc::R<av::asset::WriterInput>,
    /// The audio input, when this file carries sound.
    audio: Option<AudioInput>,
    realtime: bool,
    session_open: bool,
    frames: u64,
    first_pts: Option<MediaTime>,
    last_pts: Option<MediaTime>,
    dropped_not_ready: u64,
}

impl VideoWriter {
    pub fn create(path: &Path, config: &VideoWriterConfig) -> Result<Self> {
        let (width, height) = config.even();
        if width == 0 || height == 0 {
            return Err(Error::EmptyDimensions {
                width: config.width,
                height: config.height,
            });
        }

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
        let mut writer = av::AssetWriter::with_url_and_file_type(&url, av::FileType::mp4())
            .map_err(|e| Error::CreateWriter {
                path: path.display().to_string(),
                reason: format!("{e:?}"),
            })?;

        let settings = video_settings(width, height, config.codec);
        let mut input = av::asset::WriterInput::with_media_type_and_output_settings(
            av::MediaType::video(),
            Some(settings.as_ref()),
        )
        .map_err(|e| Error::Configuration(format!("{e:?}")))?;

        // Tells the encoder whether frames arrive at capture rate rather than
        // as fast as the disk allows.
        input.set_expects_media_data_in_real_time(config.realtime);

        let adaptor = av::asset::WriterInputPixelBufAdaptor::with_input_writer(&input, None)
            .map_err(|e| Error::Configuration(format!("{e:?}")))?;

        writer
            .add_input(&input)
            .map_err(|e| Error::Configuration(format!("{e:?}")))?;

        // Before `start_writing`, which is the whole reason the audio format has
        // to be known this early.
        let audio = match &config.audio {
            Some(settings) => {
                let mut track = av::asset::WriterInput::with_media_type_and_output_settings(
                    av::MediaType::audio(),
                    Some(audio_settings(settings).as_ref()),
                )
                .map_err(|e| Error::Configuration(format!("{e:?}")))?;
                track.set_expects_media_data_in_real_time(config.realtime);

                writer
                    .add_input(&track)
                    .map_err(|e| Error::Configuration(format!("{e:?}")))?;

                Some(AudioInput {
                    input: track,
                    channels: settings.channels,
                })
            }
            None => None,
        };

        if !writer.start_writing() {
            return Err(Error::Write(describe_writer_error(&writer)));
        }

        Ok(Self {
            writer,
            adaptor,
            input,
            audio,
            realtime: config.realtime,
            session_open: false,
            frames: 0,
            first_pts: None,
            last_pts: None,
            dropped_not_ready: 0,
        })
    }

    /// Appends the whole audio track.
    ///
    /// Called once, after the frames, because the mix is built in one pass over
    /// the timeline. `AVAssetWriter` interleaves what it is given when it
    /// finalises, so one large buffer is written correctly — it is only
    /// *efficiency* that wants roughly interleaved appends, and an export has no
    /// deadline.
    ///
    /// Must come before `finish_at`, and after at least one frame: the session
    /// opens at the first frame's timestamp, and opening it here instead would
    /// pad the file with empty leading time.
    pub fn append_audio(
        &mut self,
        samples: &[f32],
        sample_rate: f64,
        duration: MediaTime,
    ) -> Result<()> {
        let Some(channels) = self.audio.as_ref().map(|audio| audio.channels) else {
            return Err(Error::Configuration(
                "this writer was created without an audio track".to_owned(),
            ));
        };
        if samples.is_empty() {
            return Ok(());
        }
        if !self.session_open {
            return Err(Error::NotReady);
        }

        let sample = pcm_sample_buf(samples, sample_rate, channels)?;

        // Retimed to where the picture starts. The session opened at the first
        // frame's timestamp, so a buffer left at zero would be stamped before the
        // session began and the sound would land early.
        let start = cm::Time::new(self.first_pts.unwrap_or(0) as i64, TIMESCALE);
        let retimed = retime(&sample, start)?;

        let realtime = self.realtime;
        let audio = self.audio.as_mut().expect("checked above");
        if !wait_until_ready(&audio.input, realtime) {
            return Err(Error::NotReady);
        }

        let appended = audio
            .input
            .append_sample_buf(&retimed)
            .map_err(|e| Error::Write(format!("{e:?}")))?;

        if !appended {
            return Err(Error::Write(describe_writer_error(&self.writer)));
        }

        // Past the last sample rather than exactly on it, which would clip the
        // tail off the sound.
        self.last_pts = Some(self.last_pts.unwrap_or(0).max(duration));
        Ok(())
    }

    /// Appends a frame at an explicit media time.
    ///
    /// Returns `Ok(false)` when the encoder is saturated and the frame was
    /// skipped. That is a normal outcome under load, not an error: dropping a
    /// frame keeps the recording live, whereas blocking would stall capture and
    /// lose more.
    pub fn append(&mut self, image: &cv::PixelBuf, pts: MediaTime) -> Result<bool> {
        let time = cm::Time::new(pts as i64, TIMESCALE);

        // The session must open at the first frame's timestamp, not zero —
        // otherwise the file is padded with empty leading time.
        if !self.session_open {
            self.writer.start_session_at_src_time(time);
            self.session_open = true;
            self.first_pts = Some(pts);
        }

        if !self.wait_until_ready() {
            self.dropped_not_ready += 1;
            return Ok(false);
        }

        let appended = self
            .adaptor
            .append_pixel_buf_with_pts(image, time)
            .map_err(|e| Error::Write(format!("{e:?}")))?;

        if !appended {
            return Err(Error::Write(describe_writer_error(&self.writer)));
        }

        self.frames += 1;
        self.last_pts = Some(pts);
        Ok(true)
    }

    /// Waits for the encoder to accept more data.
    ///
    /// In realtime mode this is a single non-blocking check — a saturated
    /// encoder means drop the frame and move on. Offline, it spins with a short
    /// sleep until the encoder drains, so no frame is lost.
    fn wait_until_ready(&self) -> bool {
        wait_until_ready(&self.input, self.realtime)
    }

    /// Convenience for appending straight from a capture sample buffer.
    pub fn append_sample(&mut self, sample: &cm::SampleBuf, pts: MediaTime) -> Result<bool> {
        let image = sample.image_buf().ok_or(Error::NoImageBuffer)?;
        self.append(image, pts)
    }

    /// Closes the file. Blocks until the writer has flushed.
    pub fn finish(self) -> Result<VideoWriterSummary> {
        let last = self.last_pts;
        self.finish_inner(last)
    }

    /// Closes the file with an explicit end time.
    ///
    /// Ending exactly at the last frame's timestamp gives that frame zero
    /// duration, so a player shows every frame but the last. For a live
    /// recording that is a single frame nobody notices; for an export it means
    /// the final frame of the video is missing, so the caller passes one frame
    /// past the end.
    pub fn finish_at(self, end: MediaTime) -> Result<VideoWriterSummary> {
        self.finish_inner(Some(end))
    }

    fn finish_inner(mut self, end: Option<MediaTime>) -> Result<VideoWriterSummary> {
        self.input.mark_as_finished();
        if let Some(audio) = &mut self.audio {
            // Every input has to be marked finished, not just the picture:
            // `finishWriting` waits on an input that was never closed.
            audio.input.mark_as_finished();
        }

        if let Some(last) = end {
            // Declaring the end time keeps the final frame's duration sane
            // rather than letting it run to an arbitrary value.
            let _ = self
                .writer
                .end_session_at_src_time(cm::Time::new(last as i64, TIMESCALE));
        }

        self.writer.finish_writing();

        if self.writer.status() == av::AssetWriterStatus::Failed {
            return Err(Error::Write(describe_writer_error(&self.writer)));
        }

        Ok(VideoWriterSummary {
            frames: self.frames,
            first_pts: self.first_pts.unwrap_or(0),
            last_pts: self.last_pts.unwrap_or(0),
            dropped_not_ready: self.dropped_not_ready,
        })
    }

    /// Abandons the recording and deletes the partial file.
    pub fn cancel(mut self) {
        self.writer.cancel_writing();
    }

    pub fn frames(&self) -> u64 {
        self.frames
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VideoWriterSummary {
    pub frames: u64,
    pub first_pts: MediaTime,
    pub last_pts: MediaTime,
    /// Frames skipped because the encoder was saturated.
    pub dropped_not_ready: u64,
}

impl VideoWriterSummary {
    pub fn duration(&self) -> MediaTime {
        self.last_pts.saturating_sub(self.first_pts)
    }
}

/// The audio side of an MP4 that carries both streams.
#[derive(Debug)]
struct AudioInput {
    input: arc::R<av::asset::WriterInput>,
    /// Kept so `append_audio` can describe the buffers it builds.
    channels: i32,
}

/// Blocks until an input will take another buffer. Offline only — a realtime
/// input that is busy is answered "no" so the caller can drop rather than stall.
fn wait_until_ready(input: &av::asset::WriterInput, realtime: bool) -> bool {
    if input.is_ready_for_more_media_data() {
        return true;
    }
    if realtime {
        return false;
    }

    let deadline = std::time::Instant::now() + READY_TIMEOUT;
    while std::time::Instant::now() < deadline {
        std::thread::sleep(READY_POLL_INTERVAL);
        if input.is_ready_for_more_media_data() {
            return true;
        }
    }
    false
}

fn video_settings(
    width: u32,
    height: u32,
    codec: VideoCodec,
) -> arc::R<ns::Dictionary<ns::String, ns::Id>> {
    let codec_value: &av::VideoCodec = match codec {
        VideoCodec::H264 => av::VideoCodec::h264(),
        VideoCodec::Hevc => av::VideoCodec::hevc(),
    };

    ns::Dictionary::with_keys_values(
        &[
            av::video_settings_keys::codec(),
            av::video_settings_keys::width(),
            av::video_settings_keys::height(),
        ],
        &[
            codec_value.as_ref(),
            ns::Number::with_u32(width).as_ref(),
            ns::Number::with_u32(height).as_ref(),
        ],
    )
}

fn describe_writer_error(writer: &av::AssetWriter) -> String {
    writer
        .error()
        .map(|e| format!("{e:?}"))
        .unwrap_or_else(|| format!("status {:?}, no error attached", writer.status()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn odd_dimensions_are_rounded_down_to_even() {
        // H.264 chroma subsampling needs even dimensions; encoders round
        // silently, which shows up later as an off-by-one crop.
        let config = VideoWriterConfig::new(1921, 1081);
        assert_eq!(config.even(), (1920, 1080));
    }

    #[test]
    fn even_dimensions_are_left_alone() {
        assert_eq!(VideoWriterConfig::new(3024, 1964).even(), (3024, 1964));
    }

    #[test]
    fn zero_dimensions_are_rejected() {
        let err = VideoWriter::create(
            Path::new("/tmp/prequel-should-not-exist.mp4"),
            &VideoWriterConfig::new(0, 1080),
        )
        .unwrap_err();

        assert!(matches!(err, Error::EmptyDimensions { .. }));
    }

    #[test]
    fn dimensions_that_round_to_zero_are_rejected() {
        let err = VideoWriter::create(
            Path::new("/tmp/prequel-should-not-exist.mp4"),
            &VideoWriterConfig::new(1, 1080),
        )
        .unwrap_err();

        assert!(matches!(err, Error::EmptyDimensions { .. }));
    }

    #[test]
    fn summary_duration_spans_first_to_last() {
        let summary = VideoWriterSummary {
            frames: 60,
            first_pts: 500_000_000,
            last_pts: 1_500_000_000,
            dropped_not_ready: 0,
        };
        assert_eq!(summary.duration(), 1_000_000_000);
    }

    #[test]
    fn summary_duration_never_underflows() {
        let summary = VideoWriterSummary {
            frames: 0,
            first_pts: 0,
            last_pts: 0,
            dropped_not_ready: 0,
        };
        assert_eq!(summary.duration(), 0);
    }
}
