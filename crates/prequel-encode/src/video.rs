use std::path::Path;

use cidre::{arc, av, cf, cm, cv, ns};
use prequel_session::MediaTime;

use crate::audio::{AudioWriterConfig, audio_settings, pcm_sample_buf, retime};
use crate::x264::{self, DEFAULT_CRF, Moved, Nv12, PRESET, X264};
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
    /// Whether the file will be played over a network before it is fully
    /// downloaded.
    ///
    /// Off by default, which is right for a recording: those are read from the
    /// disk they were written to, and the flag costs time at `finish` for
    /// nothing. On for an export, which is the file people share a link to.
    pub streaming: bool,
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
    /// Frames a second the file is written at.
    ///
    /// Read by the CPU encoder's rate control and by nothing else: timestamps
    /// come from the caller either way, and VideoToolbox is never told. So the
    /// default is right for anything that encodes on the media engine, and only
    /// an export has to set it.
    pub fps: u32,
    /// Which encoder puts the picture in the file.
    pub encoding: Encoding,
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
            streaming: false,
            realtime: true,
            fps: 60,
            encoding: Encoding::default(),
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

    pub fn at_fps(mut self, fps: u32) -> Self {
        self.fps = fps;
        self
    }

    /// Encodes on the CPU rather than the media engine.
    ///
    /// For an export and nothing else — see [`Encoding`]. Frames must then
    /// arrive as I420 rather than BGRA, which is what the compositor's
    /// conversion pass exists to produce.
    pub fn on_cpu(mut self) -> Self {
        self.encoding = Encoding::Cpu;
        self
    }

    /// Switches to offline mode: no frame is dropped, appends wait instead.
    pub fn offline(mut self) -> Self {
        self.realtime = false;
        self
    }

    /// Lays the file out so it can be played before it has all arrived.
    ///
    /// Moves the `moov` atom — the index naming where every sample is — from
    /// the end of the file to the front. A player can draw nothing at all until
    /// it has that, so with `moov` last a browser opening a share link has to
    /// find and fetch the tail of the file before the first frame: on a 20 MB
    /// export that is the difference between playing at once and a blank player
    /// for several seconds.
    ///
    /// Not free. `AVAssetWriter` cannot know the index until the samples are
    /// written, so `finish` rewrites the file to put it first — which is why
    /// this is asked for rather than assumed, and why a capture does not ask.
    pub fn for_streaming(mut self) -> Self {
        self.streaming = true;
        self
    }

    /// Rounds dimensions down to even numbers.
    fn even(&self) -> (u32, u32) {
        (self.width & !1, self.height & !1)
    }
}

/// Which encoder a file is written with.
///
/// Not a preference — the two have opposite strengths and the choice follows
/// the deadline, not the quality. A capture has one: ScreenCaptureKit is
/// handing over frames in real time, the picture is already on the GPU, and the
/// CPU is wanted for the app that is being recorded. The media engine is the
/// only right answer there.
///
/// An export has no deadline and the measurement reverses. On an M4 Pro at
/// 1080p, 300 frames of screen content: the media engine takes 4.03ms a frame
/// and writes 2.81MB, libx264 at `veryfast` takes 1.0ms and writes 0.56MB.
/// Four times quicker and five times smaller, because screen content is flat
/// regions and hard edges — where a CPU encoder's decisions win and the
/// hardware's rate control spends bits on stillness. `x264.rs` has the rest.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Encoding {
    /// VideoToolbox, on the media engine.
    #[default]
    Media,
    /// libx264, on the CPU. H.264 only.
    Cpu,
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
    picture: Picture,
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

/// How frames reach the file.
///
/// The hardware path hands a pixel buffer to an adaptor and VideoToolbox does
/// the rest. The CPU path encodes here and appends the bitstream itself, so the
/// writer's input is a passthrough one — it muxes and does not encode.
enum Picture {
    Media(arc::R<av::asset::WriterInputPixelBufAdaptor>),
    Cpu(CpuPipeline),
}

impl std::fmt::Debug for Picture {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Media(_) => f.write_str("Media"),
            Self::Cpu { .. } => f.write_str("Cpu"),
        }
    }
}

/// What the CPU encoder is handed. Bi-planar 4:2:0, video range, which is what
/// `vui.b_fullrange = 0` in the shim promises the decoder.
///
/// Bi-planar rather than the three-plane `y420`, and the reason is on the GPU
/// side: `CVMetalTextureCache` will wrap each plane of this as a texture for
/// the conversion kernel to write, and does not list a three-plane buffer at
/// all.
pub const CPU_PIXEL_FORMAT: cv::PixelFormat = cv::PixelFormat::_420V;

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

        // Before any input is added and long before writing starts:
        // `AVAssetWriter` reads this when it begins, and setting it afterwards
        // is ignored without complaint — the file comes out with `moov` at the
        // end and nothing anywhere says why.
        writer.set_should_optimize_for_network_use(config.streaming);

        // The CPU encoder is H.264 only, and silently writing HEVC on the
        // media engine instead would be a file that is three times slower to
        // produce than the caller asked for with nothing saying so.
        if config.encoding == Encoding::Cpu && config.codec != VideoCodec::H264 {
            return Err(Error::Configuration(format!(
                "the CPU encoder writes H.264 only, not {:?}",
                config.codec
            )));
        }

        let (mut input, picture) = match config.encoding {
            Encoding::Media => {
                let settings = video_settings(width, height, config.codec);
                let input = av::asset::WriterInput::with_media_type_and_output_settings(
                    av::MediaType::video(),
                    Some(settings.as_ref()),
                )
                .map_err(|e| Error::Configuration(format!("{e:?}")))?;

                let adaptor =
                    av::asset::WriterInputPixelBufAdaptor::with_input_writer(&input, None)
                        .map_err(|e| Error::Configuration(format!("{e:?}")))?;

                (input, Picture::Media(adaptor))
            }
            Encoding::Cpu => {
                let fps = config.fps.max(1);
                let mut encoder = X264::open(width, height, fps, 1, PRESET, DEFAULT_CRF, x264::threads())?;

                // Read before the first frame and not after: the parameter sets
                // describe the stream, the muxer needs them before it will take
                // a sample, and libx264 invalidates the pointers on the first
                // `encode` call.
                let (sps, pps) = encoder.parameter_sets()?;
                let format = cm::VideoFormatDesc::with_h264_param_sets(
                    &[sps.as_ptr(), pps.as_ptr()],
                    &[sps.len(), pps.len()],
                    // Four, matching `b_annexb = 0`: the length in front of
                    // each NAL is what `avcC` records and what the decoder
                    // reads to walk the sample. Three here and every frame
                    // after the first is garbage.
                    4,
                )
                .map_err(|e| {
                    Error::Configuration(format!("could not describe the H.264 stream: {e:?}"))
                })?;

                // No output settings: a passthrough input muxes what it is
                // given rather than encoding it again.
                let input =
                    av::asset::WriterInput::with_media_type_output_settings_source_format_hint(
                        av::MediaType::video(),
                        None,
                        Some(&format),
                    )
                    .map_err(|e| Error::Configuration(format!("{e:?}")))?;

                let pipeline = CpuPipeline::spawn(
                    encoder,
                    format,
                    1_000_000_000 / fps as MediaTime,
                );

                (input, Picture::Cpu(pipeline))
            }
        };

        // Tells the encoder whether frames arrive at capture rate rather than
        // as fast as the disk allows.
        input.set_expects_media_data_in_real_time(config.realtime);

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
                    frames: 0,
                    finished: false,
                })
            }
            None => None,
        };

        if !writer.start_writing() {
            return Err(Error::Write(describe_writer_error(&writer)));
        }

        Ok(Self {
            writer,
            picture,
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

    /// Appends the next run of audio.
    ///
    /// Fed alongside the frames rather than in one go at the end, and that is not
    /// a preference. `AVAssetWriter` stops declaring an input ready while another
    /// input lags behind, so writing every frame and only then the sound leaves
    /// the *video* input refusing data — each append then waits out
    /// `READY_TIMEOUT` and the frame is dropped. The symptom is a file whose
    /// sound is perfect and whose picture is a fraction of its length.
    ///
    /// Where a run lands is counted here rather than passed in. Runs are
    /// contiguous by definition, and a caller computing each timestamp in
    /// nanoseconds would round every one of them — leaving a sliver of overlap
    /// between consecutive buffers that the writer has to reconcile thirty times
    /// a second. Counting frames and stamping in the sample rate's own timescale
    /// is exact.
    ///
    /// Must come after at least one frame: the session opens at the first frame's
    /// timestamp, and opening it here would pad the file with empty leading time.
    pub fn append_audio(&mut self, samples: &[f32], sample_rate: f64) -> Result<()> {
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

        // Offset by the session's start as well: it opened at the first frame's
        // timestamp, and a buffer stamped before that is discarded in silence.
        let opened = (self.first_pts.unwrap_or(0) as f64 / 1e9 * sample_rate).round() as i64;

        let realtime = self.realtime;
        let audio = self.audio.as_mut().expect("checked above");

        let start = cm::Time::new(opened + audio.frames as i64, sample_rate as i32);
        let retimed = retime(&sample, start)?;

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

        audio.frames += (samples.len() / channels as usize) as u64;
        let heard = (audio.frames as f64 / sample_rate * 1e9) as MediaTime;

        // Past the last sample rather than exactly on it, which would clip the
        // tail off the sound.
        self.last_pts = Some(self.last_pts.unwrap_or(0).max(heard));
        Ok(())
    }

    /// Says no more audio is coming.
    ///
    /// Needed as soon as the last run is in, not left to `finish`: while an input
    /// is open the writer keeps pacing the others against it, and a *complete*
    /// audio track that was never closed holds the video input not-ready
    /// indefinitely. Idempotent, so `finish` can call it again.
    pub fn finish_audio(&mut self) {
        if let Some(audio) = &mut self.audio
            && !audio.finished
        {
            audio.input.mark_as_finished();
            audio.finished = true;
        }
    }

    /// Appends a frame at an explicit media time.
    ///
    /// Returns `Ok(false)` when the encoder is saturated and the frame was
    /// skipped. That is a normal outcome under load, not an error: dropping a
    /// frame keeps the recording live, whereas blocking would stall capture and
    /// lose more.
    /// Opens the session at `pts` before any frame has been appended.
    ///
    /// For a file that has to share another file's origin. The camera's matte
    /// may miss the first few camera frames while the segmenter warms up, and
    /// a session opened at its own first frame would then start late: lined up
    /// from zero against the camera, every mask would land early by exactly
    /// that much. A no-op once the session is open.
    pub fn start_session_at(&mut self, pts: MediaTime) {
        if self.session_open {
            return;
        }
        self.writer
            .start_session_at_src_time(cm::Time::new(pts as i64, TIMESCALE));
        self.session_open = true;
        self.first_pts = Some(pts);
    }

    pub fn append(&mut self, image: &cv::PixelBuf, pts: MediaTime) -> Result<bool> {
        let time = cm::Time::new(pts as i64, TIMESCALE);

        // The session must open at the first frame's timestamp, not zero —
        // otherwise the file is padded with empty leading time.
        if !self.session_open {
            self.writer.start_session_at_src_time(time);
            self.session_open = true;
            self.first_pts = Some(pts);
        }

        // Asked of the muxer only where something is about to be given to it.
        // The CPU path hands this frame to libx264 and appends whatever came
        // back from the *previous* one, so its readiness check belongs with
        // that append — see `append_encoded`. Checking here instead reported a
        // momentarily busy muxer as a dropped frame, which the export loop is
        // right to treat as a failure.
        match &mut self.picture {
            Picture::Media(_) => {
                if !self.ready()? {
                    self.dropped_not_ready += 1;
                    return Ok(false);
                }
                let Picture::Media(adaptor) = &mut self.picture else {
                    unreachable!("matched a moment ago")
                };
                let appended = adaptor
                    .append_pixel_buf_with_pts(image, time)
                    .map_err(|e| Error::Write(format!("{e:?}")))?;

                if !appended {
                    return Err(Error::Write(describe_writer_error(&self.writer)));
                }
            }
            Picture::Cpu(pipeline) => {
                // Handed over rather than encoded here: the frame is finished —
                // the GPU wait in the compositor is what makes that true — so
                // the encoder can work through it while the next frame is being
                // composed. That overlap is the point, and it is most of the
                // gain: measured at 1080p, a frame costs 1.3ms with the encoder
                // alongside and 1.8ms with it in line.
                pipeline.submit(image.retained(), pts)?;
            }
        }

        // Outside the match, so a sample finished by the worker is appended on
        // this thread and in order. `AVAssetWriter` is fed from one thread
        // throughout; only libx264 runs on the other.
        if let Picture::Cpu(pipeline) = &mut self.picture
            && let Some(ready) = pipeline.take_if_deep()?
        {
            self.append_encoded(&ready)?;
        }

        self.frames += 1;
        self.last_pts = Some(pts);
        Ok(true)
    }

    /// Pushes out whatever the CPU encoder is still holding.
    ///
    /// libx264 runs several frames behind on purpose — that lookahead is where
    /// most of its speed comes from — and the worker thread holds one or two
    /// more. Without this the export is short by exactly that many frames at
    /// the end, which reads as a video that stops early rather than as a
    /// missing flush. For anything shorter than the lookahead it is every
    /// frame: see `pq_x264_flush`.
    fn drain(&mut self) -> Result<()> {
        let Picture::Cpu(pipeline) = &mut self.picture else {
            return Ok(());
        };

        for ready in pipeline.finish()? {
            self.append_encoded(&ready)?;
        }
        Ok(())
    }

    /// Whether the muxer will take another sample.
    ///
    /// In realtime mode the underlying check is a single non-blocking one — a
    /// saturated encoder means drop the frame and move on. Offline it spins
    /// with a short sleep until the encoder drains, so no frame is lost.
    ///
    /// A writer that has already failed never reports itself ready again, so
    /// every later append looks like a busy encoder. Reporting "the encoder was
    /// slow" for what is actually a rejected sample buffer sends the reader
    /// looking in entirely the wrong place.
    fn ready(&self) -> Result<bool> {
        if wait_until_ready(&self.input, self.realtime) {
            return Ok(true);
        }
        if self.writer.status() == av::AssetWriterStatus::Failed {
            return Err(Error::Write(describe_writer_error(&self.writer)));
        }
        Ok(false)
    }

    /// Appends one already-encoded sample, waiting for the muxer if it is busy.
    ///
    /// Never drops it. The frame has been encoded and there is no second copy:
    /// an encoded sample the muxer would not take is an error, where a *source*
    /// frame a live encoder will not take is a frame skipped on purpose.
    fn append_encoded(&mut self, sample: &cm::SampleBuf) -> Result<()> {
        if !self.ready()? {
            return Err(Error::Write(
                "the muxer would not take an encoded frame".to_owned(),
            ));
        }
        let appended = self
            .input
            .append_sample_buf(sample)
            .map_err(|e| Error::Write(format!("{e:?}")))?;
        if !appended {
            return Err(Error::Write(describe_writer_error(&self.writer)));
        }
        Ok(())
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
        // No frame ever reached the encoder, so there is no file to close.
        // Cancelled rather than finished: `finishWriting` on an empty writer
        // fails with -11800 over -12142 and leaves a container holding no
        // samples, which probes as a video track that will not decode — and the
        // error that comes back blames the encoder for a recording it was never
        // handed. Audio cannot be ahead of this: `append_audio` refuses to run
        // before the session opens, which only the first frame does.
        if self.frames == 0 {
            self.writer.cancel_writing();
            return Err(Error::NoSamples);
        }

        self.drain()?;

        self.input.mark_as_finished();
        // Every input has to be closed, not just the picture: `finishWriting`
        // waits on one that was left open.
        self.finish_audio();

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
    /// Audio frames written so far, which is where the next run starts.
    frames: u64,
    /// Whether the input has been closed, so it is closed exactly once.
    finished: bool,
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

/// A locked NV12 buffer, unlocked again when it goes out of scope.
///
/// `CVPixelBufferLockBaseAddress` has to be paired, and an early return between
/// the lock and the unlock leaves the buffer locked for good — the pool then
/// hands out nothing and the next frame waits on a buffer that is never coming
/// back, with no error anywhere to say so.
struct Planes {
    /// Retained to get a mutable handle: locking counts as a mutation as far as
    /// cidre is concerned, and the retain is on the same buffer rather than a
    /// copy of the pixels. Same reason `GifWriter::append` does it.
    buffer: arc::R<cv::PixelBuf>,
}

impl Planes {
    fn lock(image: &cv::PixelBuf) -> Result<Self> {
        if image.pixel_format() != CPU_PIXEL_FORMAT {
            return Err(Error::Configuration(format!(
                "the CPU encoder takes bi-planar 4:2:0 ('420v'), not {:?}",
                image.pixel_format()
            )));
        }

        let mut buffer = image.retained();
        // Read-only, so the lock does not dirty the IOSurface the GPU has just
        // written and have its pages copied back.
        unsafe { buffer.lock_base_addr(cv::pixel_buffer::LockFlags::READ_ONLY) }
            .result()
            .map_err(|e| Error::Write(format!("could not lock the frame to encode it: {e:?}")))?;

        Ok(Self { buffer })
    }

    fn frame(&self) -> Nv12<'_> {
        let plane = |index: usize| -> &[u8] {
            let stride = self.buffer.plane_bytes_per_row(index);
            let rows = self.buffer.plane_height(index);
            unsafe {
                std::slice::from_raw_parts(self.buffer.plane_base_address(index), stride * rows)
            }
        };

        Nv12 {
            y: plane(0),
            y_stride: self.buffer.plane_bytes_per_row(0),
            uv: plane(1),
            uv_stride: self.buffer.plane_bytes_per_row(1),
        }
    }
}

impl Drop for Planes {
    fn drop(&mut self) {
        let _ = unsafe {
            self.buffer
                .unlock_lock_base_addr(cv::pixel_buffer::LockFlags::READ_ONLY)
        };
    }
}

/// Wraps one encoded access unit as a sample the muxer will take.
///
/// The payload is copied rather than referenced: libx264 owns it and the next
/// `encode` call overwrites it, while `AVAssetWriter` keeps the sample for as
/// long as it likes. Pointing a `CMBlockBuffer` at the encoder's memory writes
/// whichever frame happened to be encoded next.
fn sample_buf(
    sample: &crate::x264::Sample<'_>,
    format: &cm::VideoFormatDesc,
    frame_duration: MediaTime,
) -> Result<arc::R<cm::SampleBuf>> {
    let mut block = cm::BlockBuf::with_mem_block(sample.payload.len())
        .map_err(|e| Error::Write(format!("could not allocate a sample block: {e:?}")))?;
    block
        .as_mut_slice()
        .map_err(|e| Error::Write(format!("could not fill a sample block: {e:?}")))?
        .copy_from_slice(sample.payload);

    let timing = cm::SampleTimingInfo {
        duration: cm::Time::new(frame_duration as i64, TIMESCALE),
        pts: cm::Time::new(sample.pts, TIMESCALE),
        dts: cm::Time::new(sample.dts, TIMESCALE),
    };
    let size = sample.payload.len();

    let buffer = unsafe {
        let mut out = None;
        cm::SampleBuf::create_in(
            None,
            Some(&block),
            true,
            None,
            std::ptr::null(),
            Some(format),
            1,
            1,
            &timing,
            1,
            &size,
            &mut out,
        )
        .map_err(|e| Error::Write(format!("could not build a sample buffer: {e:?}")))?;
        out.expect("a successful create fills the out parameter")
    };

    // Not every frame may be started from, and a file whose samples all claim
    // they may seeks to a P-frame and shows a smear until the next keyframe.
    if !sample.keyframe {
        let mut buffer = buffer;
        if let Some(attachments) = buffer.attaches_mut(true)
            && !attachments.is_empty()
        {
            attachments[0].insert(
                cm::sample_buffer::attach_keys::not_sync(),
                // Through the Plist newtype, which is what a CoreFoundation
                // attachment dictionary holds.
                unsafe {
                    std::mem::transmute::<&cf::Boolean, &cf::Plist>(cf::Boolean::value_true())
                },
            );
        }
        return Ok(buffer);
    }

    Ok(buffer)
}

/// libx264 on a thread of its own, one frame behind the compositor.
///
/// The depth is one frame and deliberately not more. The point is to overlap
/// the encode with the next frame's composite, which one frame achieves in
/// full: at 1080p the composite is around 1.8ms and the encode 0.6ms, so the
/// encoder is idle either way and a deeper queue would only hold more pixel
/// buffers. Each 1080p NV12 frame is 3MB and a 4K one 12MB, so a queue sized
/// for comfort is tens of megabytes of wired IOSurface memory bought for
/// nothing.
///
/// Bounded, so backpressure works in the other direction too: if the encoder
/// ever is the slower of the two, `submit` blocks and the loop runs at the
/// encoder's rate rather than queueing the whole export in memory first.
const DEPTH: usize = 1;

struct CpuPipeline {
    frames: std::sync::mpsc::SyncSender<Moved<Job>>,
    encoded: std::sync::mpsc::Receiver<Moved<Result<Vec<arc::R<cm::SampleBuf>>>>>,
    worker: Option<std::thread::JoinHandle<()>>,
    /// Frames handed over and not yet collected.
    in_flight: usize,
}

enum Job {
    Frame(arc::R<cv::PixelBuf>, MediaTime),
    /// Drain the lookahead and stop.
    Finish,
}

impl CpuPipeline {
    fn spawn(
        mut encoder: X264,
        format: arc::R<cm::VideoFormatDesc>,
        frame_duration: MediaTime,
    ) -> Self {
        let (frames, jobs) = std::sync::mpsc::sync_channel::<Moved<Job>>(1);
        let (results, encoded) = std::sync::mpsc::sync_channel(2);

        let moved_format = Moved(format);
        let worker = std::thread::Builder::new()
            .name("prequel-x264".to_owned())
            .spawn(move || {
                let Moved(format) = moved_format;
                while let Ok(Moved(job)) = jobs.recv() {
                    // `Finish` is the last job there will ever be, and this
                    // thread has to *stop* on it rather than wait for another:
                    // the main thread joins straight after collecting the
                    // flush, and a worker back in `recv` is an export that
                    // finishes encoding and then hangs for good.
                    let last = matches!(job, Job::Finish);
                    let outcome = match job {
                        Job::Frame(buffer, pts) => {
                            encode_one(&mut encoder, &buffer, pts, &format, frame_duration)
                        }
                        Job::Finish => flush_all(&mut encoder, &format, frame_duration),
                    };
                    let failed = outcome.is_err();
                    // Sent before stopping even on the last job, so the error
                    // or the final samples reach the main thread.
                    if results.send(Moved(outcome)).is_err() || last || failed {
                        break;
                    }
                }
            })
            .expect("a thread for the encoder");

        Self {
            frames,
            encoded,
            worker: Some(worker),
            in_flight: 0,
        }
    }

    fn submit(&mut self, buffer: arc::R<cv::PixelBuf>, pts: MediaTime) -> Result<()> {
        self.frames
            .send(Moved(Job::Frame(buffer, pts)))
            .map_err(|_| Error::Write("the encoder thread stopped".to_owned()))?;
        self.in_flight += 1;
        Ok(())
    }

    /// Collects the oldest result once more than one frame is outstanding, so
    /// the encode of the last frame overlaps the composite of this one.
    fn take_if_deep(&mut self) -> Result<Option<arc::R<cm::SampleBuf>>> {
        if self.in_flight <= DEPTH {
            return Ok(None);
        }
        let samples = self.receive()?;
        // One frame in, at most one sample out — libx264 reorders nothing here,
        // because the shim turns B-frames off.
        Ok(samples.into_iter().next())
    }

    /// Everything still outstanding, in order, and then the lookahead.
    fn finish(&mut self) -> Result<Vec<arc::R<cm::SampleBuf>>> {
        let mut out = Vec::new();
        while self.in_flight > 0 {
            out.extend(self.receive()?);
        }

        self.frames
            .send(Moved(Job::Finish))
            .map_err(|_| Error::Write("the encoder thread stopped".to_owned()))?;
        self.in_flight += 1;
        out.extend(self.receive()?);

        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        Ok(out)
    }

    fn receive(&mut self) -> Result<Vec<arc::R<cm::SampleBuf>>> {
        let Moved(result) = self
            .encoded
            .recv()
            .map_err(|_| Error::Write("the encoder thread stopped".to_owned()))?;
        self.in_flight -= 1;
        result
    }
}

impl Drop for CpuPipeline {
    fn drop(&mut self) {
        // Dropping the sender is what ends the worker's loop. Joining after
        // that rather than before: joining first would wait on a thread still
        // blocked on `recv`, which is a cancelled export hanging rather than
        // stopping.
        if let Some(worker) = self.worker.take() {
            let (dead, _) = std::sync::mpsc::sync_channel(1);
            let _ = std::mem::replace(&mut self.frames, dead);
            // Drained first. The worker cannot see a dropped sender while it is
            // blocked handing back a result, and the queue only has to be two
            // deep for that to be possible — a cancelled export would then
            // join a thread that is waiting on this one.
            while self.encoded.try_recv().is_ok() {}
            let _ = worker.join();
        }
    }
}

fn encode_one(
    encoder: &mut X264,
    buffer: &cv::PixelBuf,
    pts: MediaTime,
    format: &cm::VideoFormatDesc,
    frame_duration: MediaTime,
) -> Result<Vec<arc::R<cm::SampleBuf>>> {
    let planes = Planes::lock(buffer)?;
    match encoder.encode(planes.frame(), pts as i64)? {
        // `None` is the encoder still filling its lookahead, which the first
        // frames of every export do. The frame is not lost — `finish` drains
        // what is held.
        None => Ok(Vec::new()),
        Some(sample) => Ok(vec![sample_buf(&sample, format, frame_duration)?]),
    }
}

fn flush_all(
    encoder: &mut X264,
    format: &cm::VideoFormatDesc,
    frame_duration: MediaTime,
) -> Result<Vec<arc::R<cm::SampleBuf>>> {
    let mut out = Vec::new();
    while let Some(sample) = encoder.flush()? {
        out.push(sample_buf(&sample, format, frame_duration)?);
    }
    Ok(out)
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
