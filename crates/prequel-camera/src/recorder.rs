//! Live camera recording: AVFoundation → timing → encoder → `camera.mp4`.

// cidre's `define_obj_type!` expands to a transmute clippy flags. It is inside
// the macro, not in code written here, and the attribute has to sit at module
// scope to reach the expansion.
#![allow(clippy::useless_transmute)]

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

// In scope so the protocol's generated selector constants resolve on the sink.
use cidre::av::capture::VideoDataOutputSampleBufDelegate as _;
use cidre::{arc, av, cm, cv, define_obj_type, dispatch, ns, objc};
use prequel_encode::{VideoCodec, VideoWriter, VideoWriterConfig, host_nanos};
use prequel_session::{SampleDecision, SharedClock, TrackStats, TrackTimeline};

use crate::{Error, Result};

/// The camera track's file name inside a session directory.
pub const CAMERA_FILE: &str = "camera.mp4";

/// The capture rate, in frames per second.
///
/// Named rather than written twice because the cap is applied by
/// [`WarmCamera::open`] and *not* re-applied by [`CameraRecorder::begin`] — the
/// device is already configured by then. Two different numbers would record at
/// a rate nobody asked for, and nothing downstream would say so.
pub const DEFAULT_FPS: u32 = 30;

#[derive(Debug, Clone)]
pub struct CameraOptions {
    /// `uniqueID` or `localizedName` of the camera to record.
    pub device: String,
    /// Directory the session's tracks are written into.
    pub output: PathBuf,
    /// Upper bound on the capture rate.
    ///
    /// 30 by default. A webcam bubble occupies a small corner of the frame and
    /// mostly shows a face, so the extra bitrate of 60 fps buys very little.
    pub fps: u32,
    pub codec: VideoCodec,
}

impl CameraOptions {
    pub fn new(device: impl Into<String>, output: impl Into<PathBuf>) -> Self {
        Self {
            device: device.into(),
            output: output.into(),
            fps: DEFAULT_FPS,
            codec: VideoCodec::H264,
        }
    }

    /// Where the camera track is written.
    pub fn path(&self) -> PathBuf {
        self.output.join(CAMERA_FILE)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CameraSummary {
    pub frames: u64,
    /// Nanoseconds of media, with paused spans already removed.
    pub duration: u64,
    /// Media time of the first frame.
    ///
    /// Non-zero, and expected to be: an `AVCaptureSession` takes a few hundred
    /// milliseconds to warm up, and the screen has usually anchored the clock
    /// before the first camera frame arrives. Recording it is what lets the two
    /// tracks be lined up again later.
    pub start: u64,
    pub width: u32,
    pub height: u32,
    pub timing: TrackStats,
    /// Frames the encoder was too busy to accept.
    pub dropped_encoder: u64,
    /// Frames AVFoundation discarded before we ever saw them, because the
    /// delegate queue was still busy with the previous one.
    pub dropped_late: u64,
}

/// Shared between the capture callback and the controlling thread.
struct Inner {
    writer: Option<VideoWriter>,
    /// Deferred until the first frame: the session preset is a request, and the
    /// device is free to hand back a different size.
    path: PathBuf,
    codec: VideoCodec,
    clock: SharedClock,
    timeline: TrackTimeline,
    /// Set when the callback hits an unrecoverable error, so `stop` can report
    /// it rather than silently returning a truncated file.
    failure: Option<String>,
    width: u32,
    height: u32,
    dropped_late: u64,
}

impl Inner {
    /// Runs one camera frame all the way through to the file.
    fn on_frame(&mut self, sample: &cm::SampleBuf) {
        if self.failure.is_some() {
            return;
        }

        let Some(image) = sample.image_buf() else {
            return;
        };
        let Some(host_ns) = host_nanos(sample.pts()) else {
            return;
        };

        // Note what this does *not* do: anchor the clock. The screen owns the
        // origin, so camera frames delivered before the first screen frame are
        // dropped here as `DropBeforeStart`. That costs a few frames of head
        // which had no screen content to sit alongside anyway, and it keeps the
        // screen track starting at zero.
        let SampleDecision::Accept(pts) = self.timeline.accept(&self.clock, host_ns) else {
            return;
        };

        if self.writer.is_none() && !self.open_writer(image) {
            return;
        }

        if let Some(writer) = self.writer.as_mut()
            && let Err(e) = writer.append(image, pts)
        {
            self.failure = Some(e.to_string());
        }
    }

    /// Opens the file once the first frame has revealed its dimensions.
    /// Returns whether the writer is ready.
    fn open_writer(&mut self, image: &cv::PixelBuf) -> bool {
        let config = VideoWriterConfig {
            width: image.width() as u32,
            height: image.height() as u32,
            codec: self.codec,
            // No audio track here. Capture deliberately writes each
            // source to its own file so the mix can be changed after the
            // fact; only the export muxes them together.
            // Live capture: never block AVFoundation's delegate queue.
            realtime: true,
            audio: None,
        };

        match VideoWriter::create(&self.path, &config) {
            Ok(writer) => {
                // The writer rounds to even dimensions, so report what was
                // actually encoded rather than what the camera offered.
                self.width = config.width & !1;
                self.height = config.height & !1;
                self.writer = Some(writer);
                true
            }
            Err(e) => {
                self.failure = Some(e.to_string());
                false
            }
        }
    }
}

define_obj_type!(
    FrameSink + av::capture::VideoDataOutputSampleBufDelegateImpl,
    Arc<Mutex<Inner>>,
    PREQUEL_CAMERA_SINK_CLS
);

impl av::capture::VideoDataOutputSampleBufDelegate for FrameSink {}

#[objc::add_methods]
impl av::capture::VideoDataOutputSampleBufDelegateImpl for FrameSink {
    extern "C" fn impl_capture_output_did_output_sample_buf_from_connection(
        &mut self,
        _cmd: Option<&objc::Sel>,
        _output: &av::CaptureOutput,
        sample_buf: &cm::SampleBuf,
        _connection: &av::CaptureConnection,
    ) {
        // Encoding happens here, on the delegate queue, rather than shipping
        // frames to another thread — the same choice the screen pipeline makes,
        // and for the same reason: it avoids moving CMSampleBuffers across
        // threads at 30 frames a second.
        if let Ok(mut inner) = self.inner_mut().lock() {
            inner.on_frame(sample_buf);
        }
    }

    extern "C" fn impl_capture_output_did_drop_sample_buf_from_connection(
        &mut self,
        _cmd: Option<&objc::Sel>,
        _output: &av::CaptureOutput,
        _sample_buf: &cm::SampleBuf,
        _connection: &av::CaptureConnection,
    ) {
        // `always_discard_late_video_frames` is on, so AVFoundation drops a
        // frame rather than queueing it when this queue is still busy. Counted
        // so a struggling machine is visible in the summary instead of silent.
        if let Ok(mut inner) = self.inner_mut().lock() {
            inner.dropped_late += 1;
        }
    }
}

/// Safe for the same reason [`prequel_capture::ScreenRecorder`] is: every field
/// is an Objective-C object with atomic refcounting, frames are already appended
/// from AVFoundation's queue while start/stop run on the caller's, and that is
/// the access pattern `AVAssetWriter` is built for.
unsafe impl Send for CameraRecorder {}

pub struct CameraRecorder {
    session: arc::R<av::CaptureSession>,
    output: arc::R<av::capture::VideoDataOutput>,
    sink: arc::R<FrameSink>,
    state: Arc<Mutex<Inner>>,
    queue: arc::R<dispatch::Queue>,
    /// Kept only so the device outlives the session that is reading from it.
    _device: arc::R<av::CaptureDevice>,
}

/// A camera that is open, running and settled, but not yet recording.
///
/// The reason this is a separate phase at all: an `AVCaptureSession` reports
/// itself running the moment the pipeline is live, which is well before the
/// sensor has converged on an exposure. Frames from that window are dark, and
/// attaching the writer immediately is what put a dark second or two at the
/// head of every camera track. Opening the device while the countdown is on
/// screen spends time that was being spent anyway.
pub struct WarmCamera {
    session: arc::R<av::CaptureSession>,
    output: arc::R<av::capture::VideoDataOutput>,
    /// Held so `begin` can cap the frame rate, which needs the device itself.
    device: arc::R<av::CaptureDevice>,
    /// What this was opened for, so a request for a different camera falls back
    /// to opening that one rather than silently recording this one.
    requested: String,
}

/// Safe for the same reason [`CameraRecorder`] is: every field is an
/// Objective-C object with atomic refcounting, and nothing here is touched
/// concurrently — the warm camera is moved from the thread that opened it to
/// the one that starts recording, never shared between them.
unsafe impl Send for WarmCamera {}

impl WarmCamera {
    /// Opens the device and leaves the session running, writing nothing.
    ///
    /// No delegate is attached, so AVFoundation discards the warm-up frames
    /// rather than handing them to us — which is the whole point. Blocks until
    /// the session is running, so a missing camera or a refused permission
    /// surfaces here rather than as an empty file later.
    pub fn open(requested: &str, fps: u32) -> Result<Self> {
        let mut device = crate::devices::find(requested).ok_or_else(|| match camera_access() {
            // A denied grant makes every camera invisible, which otherwise
            // looks identical to "you unplugged it".
            Some(status) if status != av::AuthorizationStatus::Authorized => {
                Error::DeviceUnavailable {
                    name: requested.to_owned(),
                    reason: format!("camera access is {status:?}"),
                }
            }
            _ => Error::DeviceNotFound(requested.to_owned()),
        })?;
        let name = device.localized_name().to_string();

        let input =
            av::CaptureDeviceInput::with_device(&device).map_err(|e| Error::DeviceUnavailable {
                name: name.clone(),
                reason: format!("{e:?}"),
            })?;

        let mut session = av::CaptureSession::new();
        session.begin_cfg();

        // 720p is the sweet spot for a bubble that ends up a few hundred pixels
        // across. `high` is the fallback because a camera that cannot do 720p
        // exactly can still do *something*.
        let preferred = av::CaptureSessionPreset::_1280x720();
        let preset = if session.can_set_session_preset(preferred) {
            preferred
        } else {
            av::CaptureSessionPreset::high()
        };
        let _ = session.set_session_preset(preset);

        if !session.can_add_input(&input) {
            return Err(Error::SessionRejected { what: "camera" });
        }
        session.add_input(&input);

        let mut output = av::capture::VideoDataOutput::new();
        // Dropping a late frame keeps capture live; queueing it would push the
        // whole track behind and eventually exhaust memory.
        output.set_always_discard_late_video_frames(true);
        let _ = output.set_video_settings(Some(&pixel_format_settings()));

        if !session.can_add_output(&output) {
            return Err(Error::SessionRejected {
                what: "video output",
            });
        }
        session.add_output(&output);

        session.commit_cfg();

        cap_frame_rate(&mut device, fps);

        // Blocks until the session is running or has failed.
        session.start_running();
        if !session.is_running() {
            return Err(Error::DeviceUnavailable {
                name,
                reason: "the capture session would not start".to_owned(),
            });
        }

        Ok(Self {
            session,
            output,
            device,
            requested: requested.to_owned(),
        })
    }

    /// Whether this was opened for `device`.
    pub fn is_for(&self, device: &str) -> bool {
        self.requested == device
    }
}

impl CameraRecorder {
    /// Opens the camera and starts writing `camera.mp4`.
    ///
    /// `clock` must be the same clock the screen recorder was given — that is
    /// the whole point, and passing a fresh one produces two files that cannot
    /// be lined up.
    ///
    /// Opens the device cold, so the first frames written are the sensor's
    /// warm-up frames. Prefer [`WarmCamera::open`] followed by [`Self::begin`]
    /// wherever there is any time to spend beforehand.
    pub fn start(options: &CameraOptions, clock: SharedClock) -> Result<Self> {
        Self::begin(
            WarmCamera::open(&options.device, options.fps)?,
            options,
            clock,
        )
    }

    /// Starts writing `camera.mp4` from an already-open camera.
    ///
    /// Attaching the delegate is what begins recording: until this runs, the
    /// session has been dropping its own frames on the floor.
    pub fn begin(warm: WarmCamera, options: &CameraOptions, clock: SharedClock) -> Result<Self> {
        let WarmCamera {
            session,
            mut output,
            device,
            ..
        } = warm;

        std::fs::create_dir_all(&options.output).map_err(|e| Error::Output {
            path: options.output.display().to_string(),
            reason: e.to_string(),
        })?;

        let state = Arc::new(Mutex::new(Inner {
            writer: None,
            path: options.path(),
            codec: options.codec,
            clock,
            timeline: TrackTimeline::new(),
            failure: None,
            width: 0,
            height: 0,
            dropped_late: 0,
        }));

        let sink = FrameSink::with(Arc::clone(&state));
        let queue = dispatch::Queue::serial_with_ar_pool();
        output.set_sample_buf_delegate(Some(sink.as_ref()), Some(&queue));

        Ok(Self {
            session,
            output,
            sink,
            state,
            queue,
            _device: device,
        })
    }

    /// Stops capture and closes the file.
    pub fn stop(mut self) -> Result<CameraSummary> {
        self.session.stop_running();

        // Detach the delegate before finalising so no in-flight callback can
        // touch a writer that is being torn down.
        self.output
            .set_sample_buf_delegate(None::<&FrameSink>, None);

        let mut inner = self
            .state
            .lock()
            .map_err(|_| Error::Encode("camera state was poisoned".to_owned()))?;

        if let Some(failure) = inner.failure.take() {
            if let Some(writer) = inner.writer.take() {
                writer.cancel();
            }
            return Err(Error::Encode(failure));
        }

        // No frames at all is not an error — the recording may simply have been
        // shorter than the camera's warm-up. It does mean there is no file.
        let Some(writer) = inner.writer.take() else {
            return Ok(CameraSummary {
                frames: 0,
                duration: 0,
                start: 0,
                width: 0,
                height: 0,
                timing: inner.timeline.stats(),
                dropped_encoder: 0,
                dropped_late: inner.dropped_late,
            });
        };

        let summary = writer.finish()?;
        let _ = &self.sink;
        drop(self.queue);

        Ok(CameraSummary {
            frames: summary.frames,
            duration: summary.duration(),
            start: summary.first_pts,
            width: inner.width,
            height: inner.height,
            timing: inner.timeline.stats(),
            dropped_encoder: summary.dropped_not_ready,
            dropped_late: inner.dropped_late,
        })
    }
}

/// Current camera authorization, or `None` if AVFoundation refused the query.
fn camera_access() -> Option<av::AuthorizationStatus> {
    av::CaptureDevice::authorization_status_for_media_type(av::MediaType::video()).ok()
}

/// Asks the device not to deliver faster than `fps`.
///
/// Best-effort on purpose: a camera that will not take the frame duration still
/// records perfectly well at its own rate, and failing the whole recording over
/// a frame-rate preference would be a poor trade.
fn cap_frame_rate(device: &mut av::CaptureDevice, fps: u32) {
    let Ok(mut guard) = device.config_lock() else {
        return;
    };
    let _ = guard.set_active_video_min_frame_duration(cm::Time::new(1, fps.max(1) as i32));
}

/// Asks for the same pixel format the screen pipeline uses, so both tracks hand
/// VideoToolbox something it encodes natively rather than converting first.
fn pixel_format_settings() -> arc::R<ns::Dictionary<ns::String, ns::Id>> {
    ns::Dictionary::with_keys_values(
        &[cv::pixel_buffer_keys::pixel_format().as_ns()],
        &[ns::Number::with_u32(cv::PixelFormat::_420V.0).as_ref()],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_track_lands_inside_the_session_directory() {
        let options = CameraOptions::new("Some Camera", "/tmp/prequel-session");
        assert_eq!(
            options.path(),
            PathBuf::from("/tmp/prequel-session").join(CAMERA_FILE)
        );
    }

    #[test]
    fn defaults_are_a_sane_webcam_configuration() {
        let options = CameraOptions::new("Some Camera", "/tmp/x");
        assert_eq!(options.fps, 30);
        assert_eq!(options.codec, VideoCodec::H264);
    }

    #[test]
    fn starting_an_unknown_camera_fails_rather_than_recording_nothing() {
        let options = CameraOptions::new("no-such-camera-4a1f", "/tmp/prequel-camera-missing");
        let Err(err) = CameraRecorder::start(&options, SharedClock::new()) else {
            panic!("starting a camera that does not exist must fail");
        };

        assert!(
            matches!(
                err,
                Error::DeviceNotFound(_) | Error::DeviceUnavailable { .. }
            ),
            "got {err:?}"
        );
        // A failed start must not leave an empty session directory behind.
        assert!(!std::path::Path::new("/tmp/prequel-camera-missing").exists());
    }
}
