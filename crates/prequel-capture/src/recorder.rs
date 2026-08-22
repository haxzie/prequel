//! Live screen recording: ScreenCaptureKit → timing → encoder → MP4.

// cidre's `define_obj_type!` expands to a transmute clippy flags. It is inside
// the macro, not in code written here, and the attribute has to sit at module
// scope to reach the expansion.
#![allow(clippy::useless_transmute)]

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use cidre::sc::stream::Output as _;
use cidre::{arc, cm, cv, define_obj_type, dispatch, ns, objc, sc};
use prequel_encode::{
    AudioWriter, AudioWriterConfig, AudioWriterSummary, VideoCodec, VideoWriter, VideoWriterConfig,
    host_nanos, host_now,
};
use prequel_session::{SampleDecision, SharedClock, TrackStats, TrackTimeline};

use crate::clicks::ClickSample;
use crate::cursor::{CursorSample, CursorTrack, Region};
use crate::error::{Error, Result};
use crate::targets::{Bounds, Target, TargetKind};
use crate::typing::{TypingSample, TypingTrack};

const START_TIMEOUT: Duration = Duration::from_secs(10);

/// Track file names inside a session directory.
///
/// Separate files rather than one muxed output: it is what allows the webcam
/// to be repositioned and the mix to be changed after the recording is over.
pub const SCREEN_FILE: &str = "screen.mp4";
pub const SYSTEM_AUDIO_FILE: &str = "system.m4a";
pub const MICROPHONE_FILE: &str = "mic.m4a";

#[derive(Debug, Clone)]
pub struct RecordOptions {
    /// Display or window to record.
    pub target: Target,
    /// Directory the session's tracks are written into.
    pub output: PathBuf,
    pub fps: u32,
    pub codec: VideoCodec,
    pub show_cursor: bool,
    /// Sub-region of the target to capture, in points relative to the target's
    /// own origin. `None` captures all of it.
    ///
    /// Only meaningful for displays: ScreenCaptureKit crops the source rect out
    /// of the display before scaling, which is how "record an area" works
    /// without capturing the whole screen and throwing most of it away.
    pub crop: Option<Bounds>,
    /// Capture system audio on the same stream.
    ///
    /// Going through ScreenCaptureKit sidesteps Electron's loopback path
    /// entirely, which is currently broken on macOS 15+ (tracks come back
    /// `ended` despite the permission dialog succeeding, electron#47490).
    pub capture_system_audio: bool,
    /// Capture the microphone on the same stream (macOS 15+).
    pub capture_microphone: bool,
    /// `CGWindowID`s to keep out of the recording — the control pill, the
    /// camera bubble, the picker overlays.
    ///
    /// This is the only mechanism that works: `setContentProtection(true)` in
    /// Electron sets `NSWindowSharingNone`, which ScreenCaptureKit ignores on
    /// current macOS. Because we build the filter ourselves, excluding by
    /// window id is ours to get right.
    pub excluded_windows: Vec<u32>,
}

impl RecordOptions {
    pub fn new(target: Target, output: impl Into<PathBuf>) -> Self {
        Self {
            target,
            output: output.into(),
            fps: 60,
            codec: VideoCodec::H264,
            show_cursor: true,
            crop: None,
            capture_system_audio: false,
            capture_microphone: false,
            excluded_windows: Vec::new(),
        }
    }
}

// No longer `Copy` or `Eq`: the cursor track is a `Vec`, and its samples are
// floating-point positions.
#[derive(Debug, Clone, PartialEq)]
pub struct RecordingSummary {
    pub frames: u64,
    /// Nanoseconds of media, with paused spans already removed.
    pub duration: u64,
    /// Media time of the first frame. Zero by construction — the screen is the
    /// track that anchors the session clock — but carried explicitly so the
    /// manifest never has to assume it.
    pub start: u64,
    pub width: u32,
    pub height: u32,
    pub video: TrackStats,
    /// Frames the encoder was too busy to accept.
    pub dropped_encoder: u64,
    /// Frames discarded because the recording was paused. Intended.
    pub paused_frames: u64,
    /// Frames skipped because the screen had not changed.
    pub idle_frames: u64,
    /// The system-audio track, if one was written.
    ///
    /// Carries the timestamp range rather than only a count, because a device
    /// that opened late starts partway into the recording and anything merging
    /// the tracks afterwards has to know by how much.
    pub system_audio: Option<AudioWriterSummary>,
    /// The microphone track, if one was written.
    pub microphone: Option<AudioWriterSummary>,
    /// Where the pointer was, on the session timeline.
    ///
    /// Sampled during capture because it cannot be recovered afterwards: the
    /// cursor is drawn into the frames, but its position is not something an
    /// editor can read back out of them.
    pub cursor: Vec<CursorSample>,
    /// Where text was being typed. Empty without the Accessibility grant.
    pub typing: Vec<TypingSample>,
    /// Where the pointer was pressed. The strongest signal in the recording
    /// about what mattered and when.
    pub clicks: Vec<ClickSample>,
}

impl RecordingSummary {
    /// System-audio buffers written.
    pub fn system_audio_samples(&self) -> u64 {
        self.system_audio.map_or(0, |a| a.samples)
    }

    /// Microphone buffers written.
    pub fn microphone_samples(&self) -> u64 {
        self.microphone.map_or(0, |a| a.samples)
    }
}

/// One audio track being written.
struct AudioTrack {
    writer: Option<AudioWriter>,
    timeline: TrackTimeline,
    /// Deferred until the first buffer arrives, because the sample rate and
    /// channel count come from the stream rather than from configuration.
    path: PathBuf,
    samples: u64,
}

impl AudioTrack {
    fn new(path: PathBuf) -> Self {
        Self {
            writer: None,
            timeline: TrackTimeline::new(),
            path,
            samples: 0,
        }
    }

    /// Runs one audio buffer through to its file, opening the writer on the
    /// first one so it can match the stream's actual format.
    fn on_sample(&mut self, sample: &cm::SampleBuf, clock: &SharedClock) -> Result<()> {
        let Some(host_ns) = host_nanos(sample.pts()) else {
            return Ok(());
        };
        let SampleDecision::Accept(pts) = self.timeline.accept(clock, host_ns) else {
            return Ok(());
        };

        if self.writer.is_none() {
            let (sample_rate, channels) = audio_format(sample).unwrap_or((48_000.0, 2));
            self.writer = Some(AudioWriter::create(
                &self.path,
                &AudioWriterConfig::new(sample_rate, channels),
            )?);
        }

        if let Some(writer) = self.writer.as_mut() {
            writer.append(sample, pts)?;
            self.samples += 1;
        }
        Ok(())
    }
}

/// Shared between the capture callback and the controlling thread.
struct Inner {
    writer: Option<VideoWriter>,
    system_audio: Option<AudioTrack>,
    microphone: Option<AudioTrack>,
    clock: SharedClock,
    video: TrackTimeline,
    /// Set when the capture callback hits an unrecoverable error, so `stop`
    /// can report it rather than silently returning a truncated file.
    failure: Option<String>,
    /// Frames ScreenCaptureKit sent with no pixel buffer because the screen
    /// had not changed.
    idle_frames: u64,
    /// Pointer positions, sampled on the same timeline as the video.
    cursor: CursorTrack,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AudioKind {
    System,
    Microphone,
}

impl Inner {
    /// Routes one audio buffer to its track, recording the first failure.
    fn on_audio(&mut self, sample: &cm::SampleBuf, kind: AudioKind) {
        if self.failure.is_some() {
            return;
        }
        let clock = self.clock.clone();
        let track = match kind {
            AudioKind::System => self.system_audio.as_mut(),
            AudioKind::Microphone => self.microphone.as_mut(),
        };
        let Some(track) = track else { return };

        if let Err(e) = track.on_sample(sample, &clock) {
            self.failure = Some(e.to_string());
        }
    }

    /// Runs one video sample all the way through to the file.
    fn on_video(&mut self, sample: &cm::SampleBuf) {
        if self.failure.is_some() {
            return;
        }

        // ScreenCaptureKit emits idle frames — carrying no pixel buffer —
        // whenever nothing on screen changed since the last one. They are
        // normal, not errors: skipping them simply extends the previous
        // frame's on-screen duration, which is exactly right for a screen
        // recording and keeps the file small when the screen is still.
        //
        // Checked before the timeline sees the sample, so an idle frame does
        // not consume a slot and push real frames into the jitter path.
        let Some(image) = sample.image_buf() else {
            self.idle_frames += 1;
            return;
        };

        let Some(host_ns) = host_nanos(sample.pts()) else {
            return;
        };
        // The first sample to arrive anchors the timeline, so t0 is a real
        // frame time rather than a guess taken before the pipeline warmed up.
        self.clock.start(host_ns);

        let SampleDecision::Accept(pts) = self.video.accept(&self.clock, host_ns) else {
            return;
        };

        // Sampled against the accepted media time, so the track shares the
        // timeline the frames are on — a paused span is excluded from both.
        self.cursor.sample(pts);

        let Some(writer) = self.writer.as_mut() else {
            return;
        };
        if let Err(e) = writer.append(image, pts) {
            self.failure = Some(e.to_string());
        }
    }
}

define_obj_type!(
    FrameSink + sc::stream::OutputImpl,
    Arc<Mutex<Inner>>,
    PREQUEL_FRAME_SINK_CLS
);

impl sc::stream::Output for FrameSink {}

#[objc::add_methods]
impl sc::stream::OutputImpl for FrameSink {
    extern "C" fn impl_stream_did_output_sample_buf(
        &mut self,
        _cmd: Option<&objc::Sel>,
        _stream: &sc::Stream,
        sample: &mut cm::SampleBuf,
        kind: sc::OutputType,
    ) {
        // Encoding happens here, on ScreenCaptureKit's delivery queue, rather
        // than shipping frames to another thread. It avoids retaining and
        // moving CMSampleBuffers across threads, and it is what OBS and Cap do.
        let Ok(mut inner) = self.inner_mut().lock() else {
            return;
        };
        match kind {
            sc::OutputType::Screen => inner.on_video(sample),
            // Audio arrives on the same ScreenCaptureKit stream as video, but
            // goes to its own file: separate tracks are what let the mix be
            // changed after the fact.
            sc::OutputType::Audio => inner.on_audio(sample, AudioKind::System),
            sc::OutputType::Mic => inner.on_audio(sample, AudioKind::Microphone),
        }
    }
}

/// Safe because every field is an Objective-C object with atomic refcounting,
/// and the recorder is only ever driven from one thread at a time. Frame
/// appends already cross threads today — they happen on ScreenCaptureKit's
/// dispatch queue while start/stop run on the caller's — and that is the access
/// pattern AVAssetWriter is built for.
unsafe impl Send for ScreenRecorder {}

pub struct ScreenRecorder {
    stream: arc::R<sc::Stream>,
    sink: arc::R<FrameSink>,
    state: Arc<Mutex<Inner>>,
    queue: arc::R<dispatch::Queue>,
    /// Held here as well as inside `state` so pause and resume do not have to
    /// take the capture lock, which the delivery queue is holding most of the
    /// time at 60 fps.
    clock: SharedClock,
    width: u32,
    height: u32,
    /// Where text was being typed, collected on its own thread.
    ///
    /// Not on the capture callback: asking the Accessibility API where the
    /// focused field is means synchronous IPC into another application, and an
    /// application that does not answer would stall the recording rather than
    /// merely miss a sample.
    typing: Arc<Mutex<TypingTrack>>,
    /// The captured rectangle, kept so the clicks can be put in its terms when
    /// the recording stops.
    sampled: Region,
    /// Stops both sampler threads. One flag rather than two: they start and
    /// stop with the recording and nothing ever wants one without the other.
    samplers_stop: Arc<AtomicBool>,
    typing_thread: Option<std::thread::JoinHandle<()>>,
    /// Whether the system is showing the link cursor, refreshed on its own
    /// thread for the same reason typing is: `NSCursor` is AppKit, and the
    /// capture callback is no place to call into it sixty times a second.
    shape_thread: Option<std::thread::JoinHandle<()>>,
}

impl ScreenRecorder {
    /// Starts capturing. Blocks until ScreenCaptureKit confirms the stream is
    /// running, so a permission failure surfaces here rather than as an empty
    /// file later.
    pub fn start(options: &RecordOptions, clock: SharedClock) -> Result<Self> {
        let content = crate::targets::current_shareable_content()?;
        let filter = build_filter(&content, options)?;

        // The captured rectangle in global points, which is what turns a
        // position on screen into a fraction of the frame. `crop` is relative
        // to the target's own origin, so it has to be added to it rather than
        // used on its own — a cropped recording on a second display is where
        // that difference shows up. Shared by both sampled tracks.
        let sampled = match options.crop {
            Some(crop) => Region {
                x: options.target.bounds.x + crop.x,
                y: options.target.bounds.y + crop.y,
                width: crop.width,
                height: crop.height,
            },
            None => Region {
                x: options.target.bounds.x,
                y: options.target.bounds.y,
                width: options.target.bounds.width,
                height: options.target.bounds.height,
            },
        };

        // Capture at physical resolution: bounds are in points.
        let scale = options.target.scale_factor.max(1.0);
        let region = options.crop.unwrap_or(options.target.bounds);
        let width = ((region.width * scale).round() as u32) & !1;
        let height = ((region.height * scale).round() as u32) & !1;

        if width == 0 || height == 0 {
            return Err(Error::EmptyRegion {
                width: region.width,
                height: region.height,
            });
        }

        let mut cfg = sc::StreamCfg::new();
        cfg.set_width(width as usize);
        cfg.set_height(height as usize);
        cfg.set_minimum_frame_interval(cm::Time::new(1, options.fps.max(1) as i32));
        cfg.set_pixel_format(cv::PixelFormat::_420V);
        cfg.set_shows_cursor(options.show_cursor);
        cfg.set_scales_to_fit(false);
        cfg.set_preserves_aspect_ratio(true);
        // A deeper queue absorbs scheduling hiccups instead of dropping frames.
        cfg.set_queue_depth(8);

        if let Some(crop) = options.crop {
            // `src_rect` is in points relative to the display's own origin, and
            // it must be paired with the output size above or ScreenCaptureKit
            // scales the crop back up to the full display dimensions.
            cfg.set_src_rect(cidre::cg::Rect {
                origin: cidre::cg::Point {
                    x: crop.x,
                    y: crop.y,
                },
                size: cidre::cg::Size {
                    width: crop.width,
                    height: crop.height,
                },
            });
            cfg.set_dst_rect(cidre::cg::Rect {
                origin: cidre::cg::Point { x: 0.0, y: 0.0 },
                size: cidre::cg::Size {
                    width: f64::from(width),
                    height: f64::from(height),
                },
            });
        }

        if options.capture_system_audio {
            cfg.set_captures_audio(true);
            // Without this, Prequel's own UI sounds would be recorded back into
            // the capture.
            cfg.set_excludes_current_process_audio(true);
        }
        if options.capture_microphone {
            cfg.set_capture_mic(true);
        }

        std::fs::create_dir_all(&options.output).map_err(|e| Error::Output {
            path: options.output.display().to_string(),
            reason: e.to_string(),
        })?;

        let writer = VideoWriter::create(
            &options.output.join(SCREEN_FILE),
            &VideoWriterConfig {
                width,
                height,
                codec: options.codec,
                // No audio track here. Capture deliberately writes each
                // source to its own file so the mix can be changed after the
                // fact; only the export muxes them together.
                // Live capture: never block ScreenCaptureKit's delivery queue.
                realtime: true,
                audio: None,
            },
        )?;

        let state = Arc::new(Mutex::new(Inner {
            writer: Some(writer),
            system_audio: options
                .capture_system_audio
                .then(|| AudioTrack::new(options.output.join(SYSTEM_AUDIO_FILE))),
            microphone: options
                .capture_microphone
                .then(|| AudioTrack::new(options.output.join(MICROPHONE_FILE))),
            clock: clock.clone(),
            video: TrackTimeline::new(),
            failure: None,
            idle_frames: 0,
            cursor: CursorTrack::new(sampled),
        }));

        // A tap that cannot be made is logged and the recording carries on
        // without clicks.
        if !crate::clicks::start() {
            tracing::warn!("could not tap mouse events; no clicks will be recorded");
        } else if !crate::accessibility_trusted() {
            // The tap exists and will still deliver nothing worth having. Said
            // here because it is the difference between an automatic pass that
            // found one moment and one that had one moment to find — and from
            // the outside those look identical.
            tracing::warn!(
                "not trusted to observe input; the click tap will see almost nothing and \
                 automatic zooms will be sparse. Grant Prequel Accessibility and Input \
                 Monitoring in System Settings ▸ Privacy & Security."
            );
        }

        let typing = Arc::new(Mutex::new(TypingTrack::new(sampled)));
        let samplers_stop = Arc::new(AtomicBool::new(false));
        let typing_thread = spawn_typing(&typing, &samplers_stop, clock.clone());
        let shape_thread = Some(spawn_pointer_shape(&samplers_stop));

        let sink = FrameSink::with(Arc::clone(&state));
        let queue = dispatch::Queue::serial_with_ar_pool();
        let stream = sc::Stream::new(&filter, &cfg);

        stream
            .add_stream_output(sink.as_ref(), sc::OutputType::Screen, Some(&queue))
            .map_err(|e| Error::ScreenCaptureKit(format!("{e:?}")))?;

        if options.capture_system_audio {
            stream
                .add_stream_output(sink.as_ref(), sc::OutputType::Audio, Some(&queue))
                .map_err(|e| Error::ScreenCaptureKit(format!("system audio: {e:?}")))?;
        }
        if options.capture_microphone {
            stream
                .add_stream_output(sink.as_ref(), sc::OutputType::Mic, Some(&queue))
                .map_err(|e| Error::ScreenCaptureKit(format!("microphone: {e:?}")))?;
        }

        block_on_stream(|ch| stream.start_with_ch(ch))?;

        Ok(Self {
            stream,
            sink,
            state,
            queue,
            clock,
            width,
            height,
            typing,
            samplers_stop,
            typing_thread,
            shape_thread,
            sampled,
        })
    }

    pub fn pause(&self) {
        self.clock.pause(host_now());
    }

    pub fn resume(&self) {
        self.clock.resume(host_now());
    }

    pub fn is_paused(&self) -> bool {
        self.clock.is_paused()
    }

    /// The session clock, for handing to another pipeline that has to line up
    /// with this one — the camera, in practice.
    pub fn clock(&self) -> SharedClock {
        self.clock.clone()
    }

    /// Stops capture and closes the file.
    pub fn stop(mut self) -> Result<RecordingSummary> {
        // Stopped before the stream, so the last thing it can do is take a
        // sample of a recording that is still running.
        self.samplers_stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.typing_thread.take() {
            let _ = thread.join();
        }
        if let Some(thread) = self.shape_thread.take() {
            let _ = thread.join();
        }

        block_on_stream(|ch| self.stream.stop_with_ch(ch))?;

        // Detach the output before finalising so no in-flight callback can
        // touch a writer that is being torn down.
        let _ = self
            .stream
            .remove_stream_output(self.sink.as_ref(), sc::OutputType::Screen);

        let mut inner = self
            .state
            .lock()
            .map_err(|_| Error::ScreenCaptureKit("recorder state was poisoned".to_owned()))?;

        let system_audio = inner.system_audio.take();
        let microphone = inner.microphone.take();

        // A failure anywhere means the session is not trustworthy: throw away
        // every track rather than leave a half-written set that looks complete.
        if let Some(failure) = inner.failure.take() {
            if let Some(writer) = inner.writer.take() {
                writer.cancel();
            }
            for track in [system_audio, microphone].into_iter().flatten() {
                if let Some(writer) = track.writer {
                    writer.cancel();
                }
            }
            return Err(Error::ScreenCaptureKit(failure));
        }

        let writer = inner
            .writer
            .take()
            .ok_or_else(|| Error::ScreenCaptureKit("recorder already stopped".to_owned()))?;

        let summary = writer.finish()?;

        let system_audio = finish_audio(system_audio)?;
        let microphone = finish_audio(microphone)?;
        drop(self.queue);

        Ok(RecordingSummary {
            frames: summary.frames,
            duration: summary.duration(),
            start: summary.first_pts,
            width: self.width,
            height: self.height,
            video: inner.video.stats(),
            dropped_encoder: summary.dropped_not_ready,
            paused_frames: inner.video.stats().paused,
            idle_frames: inner.idle_frames,
            system_audio,
            microphone,
            cursor: {
                // Logged because an empty track is indistinguishable from
                // "cursor capture is broken" once the recording is on disk.
                tracing::debug!("captured {} cursor samples", inner.cursor.len());
                inner.cursor.take_samples()
            },
            clicks: crate::clicks::stop(self.sampled, |host| self.clock.media_time(host).ok()),
            typing: self
                .typing
                .lock()
                .map(|mut track| {
                    tracing::debug!("captured {} typing samples", track.len());
                    track.take_samples()
                })
                .unwrap_or_default(),
        })
    }
}

/// How often the focused field is looked up.
///
/// Five times a second. A field does not move while it is being typed into, so
/// this only has to notice focus *changing* — and every sample is a round trip
/// into another application, which is not something to do at frame rate.
const TYPING_INTERVAL: Duration = Duration::from_millis(200);

/// How often the system cursor's shape is looked at.
///
/// Five times faster than typing's: a link is often only under the pointer in
/// passing, and a shape sampled five times a second turns a quick hover into no
/// hover at all. One look costs about 50µs, so this is a rounding error on one
/// core.
const SHAPE_INTERVAL: Duration = Duration::from_millis(40);

/// Starts sampling where text is being typed, if the app is allowed to look.
///
/// Returns None without the Accessibility grant rather than spawning a thread
/// that can only fail: every call would return an error, and a track of nothing
/// is indistinguishable from a recording where nobody typed.
fn spawn_typing(
    track: &Arc<Mutex<TypingTrack>>,
    stop: &Arc<AtomicBool>,
    clock: SharedClock,
) -> Option<std::thread::JoinHandle<()>> {
    if !crate::typing::is_trusted() {
        tracing::info!("no Accessibility grant; not sampling typing");
        return None;
    }

    let track = Arc::clone(track);
    let stop = Arc::clone(stop);

    Some(std::thread::spawn(move || {
        while !stop.load(Ordering::Relaxed) {
            std::thread::sleep(TYPING_INTERVAL);

            // Stamped on the session clock, the same one the frames are on. A
            // sample before the first frame has no media time to belong to and
            // is dropped rather than guessed at.
            let Ok(at) = clock.media_time(host_now()) else {
                continue;
            };
            // Held only for the push: the lookup itself is done outside the
            // lock, so a slow application cannot block `stop`.
            if let Ok(mut track) = track.lock() {
                track.sample(at);
            }
        }
    }))
}

/// Watches what shape the system cursor is, so the editor can follow it.
///
/// Its own thread, like typing and for a related reason: the answer comes from
/// `NSCursor`, which is AppKit, and the frame callback is ScreenCaptureKit's —
/// calling into a framework with no promise of thread safety from the thread
/// that has to keep up with sixty frames a second is how a recorder comes to
/// drop frames for a cosmetic detail. The callback reads the cached answer with
/// an atomic load instead.
///
/// Faster than typing's interval because this is what the pointer *looks* like:
/// a link is often only under the pointer in passing, and a shape sampled five
/// times a second turns a quick hover into no hover at all.
fn spawn_pointer_shape(stop: &Arc<AtomicBool>) -> std::thread::JoinHandle<()> {
    // The static outlives a recording, so a hand left over from the last take
    // does not open this one.
    crate::cursor::reset_pointer_shape();

    let stop = Arc::clone(stop);

    std::thread::spawn(move || {
        while !stop.load(Ordering::Relaxed) {
            crate::cursor::refresh_pointer_shape();
            std::thread::sleep(SHAPE_INTERVAL);
        }
    })
}

/// Closes an audio track, returning its summary if a file was written.
fn finish_audio(track: Option<AudioTrack>) -> Result<Option<AudioWriterSummary>> {
    let Some(track) = track else { return Ok(None) };
    match track.writer {
        // The track was requested but never produced a buffer — an empty file
        // would be worse than none at all.
        None => Ok(None),
        Some(writer) => Ok(Some(writer.finish()?)),
    }
}

fn build_filter(
    content: &sc::ShareableContent,
    options: &RecordOptions,
) -> Result<arc::R<sc::ContentFilter>> {
    match options.target.kind {
        TargetKind::Display => {
            let display = content
                .displays()
                .iter()
                .find(|d| d.display_id().0 == options.target.id)
                // A sleeping display is missing from the snapshot rather than
                // marked unavailable, so distinguish the two — the fix for one
                // is "wake the screen", for the other it is a real bug.
                .ok_or_else(|| {
                    if crate::targets::is_display_asleep(options.target.id) {
                        Error::DisplayAsleep(options.target.id)
                    } else {
                        Error::DisplayNotFound(options.target.id)
                    }
                })?
                .retained();

            let excluded: Vec<_> = content
                .windows()
                .iter()
                .filter(|w| options.excluded_windows.contains(&w.id()))
                .map(|w| w.retained())
                .collect();

            Ok(sc::ContentFilter::with_display_excluding_windows(
                &display,
                &ns::Array::from_slice_retained(&excluded),
            ))
        }
        TargetKind::Window => {
            let window = content
                .windows()
                .iter()
                .find(|w| w.id() == options.target.id)
                .ok_or(Error::WindowNotFound(options.target.id))?
                .retained();

            Ok(sc::ContentFilter::with_desktop_independent_window(&window))
        }
    }
}

/// Bridges one of ScreenCaptureKit's completion-handler calls to a blocking one.
fn block_on_stream(call: impl FnOnce(Box<dyn FnMut(Option<&ns::Error>)>)) -> Result<()> {
    let (tx, rx) = mpsc::channel();
    let mut sent = false;

    call(Box::new(move |err| {
        if sent {
            return;
        }
        sent = true;
        let _ = tx.send(err.map(|e| format!("{e:?}")));
    }));

    match rx.recv_timeout(START_TIMEOUT) {
        Ok(None) => Ok(()),
        Ok(Some(err)) => Err(Error::from_ns_error(&err)),
        Err(_) => Err(Error::Timeout(START_TIMEOUT)),
    }
}

/// Sample rate and channel count of an audio buffer.
///
/// Read from the buffer rather than assumed: system audio comes back at the
/// device's rate, and a USB microphone can differ from both.
fn audio_format(sample: &cm::SampleBuf) -> Option<(f64, i32)> {
    // `cm::AudioFormatDesc` is an alias for `cm::FormatDesc`; the accessor
    // returns None for a non-audio description, which is the check we want.
    let asbd = sample.format_desc()?.stream_basic_desc()?;
    Some((asbd.sample_rate, asbd.channels_per_frame as i32))
}

impl From<prequel_encode::Error> for Error {
    fn from(value: prequel_encode::Error) -> Self {
        Error::Encode(value.to_string())
    }
}
