//! Node-API bindings over the Prequel capture crates.
//!
//! Everything crossing this boundary is plain data. Objective-C objects and
//! `CMSampleBuffer`s never reach JavaScript — the Electron side only ever sees
//! descriptions of things and commands to act on them.

#![deny(clippy::all)]

use std::sync::Mutex;

use napi::bindgen_prelude::*;
use napi_derive::napi;

use prequel_camera as camera;
use prequel_capture as capture;

mod export;
mod logging;
mod probe;
mod transcribe;

pub use export::{ExportOptions, ExportProgress, ExportSlice, cancel_export, start_export};
pub use logging::set_log_file;
pub use probe::{CaptureWallpaper, ProbeSession, TrackProbe, capture_wallpaper, probe_session};

#[napi(string_enum)]
#[derive(Debug, Clone, Copy)]
pub enum TargetKind {
    Display,
    Window,
}

#[napi(object)]
#[derive(Debug, Clone, Copy)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[napi(object)]
#[derive(Debug)]
pub struct Target {
    pub kind: TargetKind,
    /// `CGDirectDisplayID` for displays, `CGWindowID` for windows.
    ///
    /// This is the same number Electron embeds in
    /// `BrowserWindow.getMediaSourceId()` (`"window:<id>:0"`), which is how the
    /// shell tells us which of its own windows to exclude from a recording.
    pub id: u32,
    pub title: String,
    pub app_name: String,
    /// Path to the owning app's bundle, or empty when unknown. The picker uses
    /// it to read a full-resolution icon, which no icon API will hand over.
    pub app_path: String,
    pub bounds: Bounds,
    pub scale_factor: f64,
}

#[napi(string_enum)]
#[derive(Debug)]
pub enum PermissionStatus {
    Granted,
    Denied,
}

/// Current Screen Recording grant. Does not prompt.
#[napi]
pub fn screen_access_status() -> PermissionStatus {
    capture::screen_access_status().into()
}

/// Triggers the macOS Screen Recording prompt.
///
/// macOS shows this at most once per app. A `Denied` result means the user must
/// grant it in System Settings and restart — retrying will not help.
#[napi]
pub fn request_screen_access() -> PermissionStatus {
    capture::request_screen_access().into()
}

/// Lists displays and on-screen windows that can be recorded.
///
/// Returns a Promise. The work runs on the libuv thread pool because
/// ScreenCaptureKit's snapshot call blocks, and stalling Electron's main thread
/// would freeze every window. Using `Task` rather than an `async fn` keeps a
/// tokio runtime out of the Electron process entirely.
// `AsyncTask` erases its resolved type in the generated .d.ts, so state it here.
#[napi(ts_return_type = "Promise<Target[]>")]
pub fn list_targets() -> AsyncTask<ListTargets> {
    AsyncTask::new(ListTargets)
}

pub struct ListTargets;

impl Task for ListTargets {
    type Output = Vec<capture::Target>;
    type JsValue = Vec<Target>;

    fn compute(&mut self) -> Result<Self::Output> {
        capture::list_targets().map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into_iter().map(Into::into).collect())
    }
}

/// Writes `session.json` alongside the tracks.
///
/// Without it the session is a folder of files with no stated relationship, and
/// every device's warm-up offset — the camera's few hundred milliseconds, a
/// microphone that opened late — is lost the moment the app forgets it. Merging
/// them afterwards would then be guesswork that looks right and is not.
///
/// Failing to write it does not fail the recording: the media is already on
/// disk and intact, and a missing manifest is recoverable where a discarded
/// recording is not.
fn write_manifest(
    plan: &SessionPlan,
    screen: &capture::RecordingSummary,
    camera: Option<&camera::CameraSummary>,
) {
    use prequel_session::{
        ClickSample, CursorSample, KeySpan, MANIFEST_FILE_NAME, MANIFEST_VERSION, Manifest,
        SourceInfo, TrackKind, TypingSample,
    };

    let mut tracks = vec![track(
        TrackKind::Screen,
        screen.start,
        screen.start + screen.duration,
        Some((screen.width, screen.height)),
        screen.frames,
        screen.video.dropped + screen.dropped_encoder,
    )];

    if let Some(camera) = camera.filter(|c| c.frames > 0) {
        tracks.push(track(
            TrackKind::Camera,
            camera.start,
            camera.start + camera.duration,
            Some((camera.width, camera.height)),
            camera.frames,
            camera.timing.dropped + camera.dropped_encoder + camera.dropped_late,
        ));
    }
    if let Some(audio) = screen.microphone {
        tracks.push(track(
            TrackKind::Microphone,
            audio.first_pts,
            audio.last_pts,
            None,
            audio.samples,
            audio.dropped_not_ready,
        ));
    }
    if let Some(audio) = screen.system_audio {
        tracks.push(track(
            TrackKind::SystemAudio,
            audio.first_pts,
            audio.last_pts,
            None,
            audio.samples,
            audio.dropped_not_ready,
        ));
    }

    let manifest = Manifest {
        version: MANIFEST_VERSION,
        id: plan
            .output
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        started_at: plan.started_at.clone(),
        duration: screen.duration,
        source: SourceInfo {
            kind: plan.source_kind.to_owned(),
            id: plan.source_id,
            title: String::new(),
            app_name: String::new(),
            scale_factor: plan.scale_factor,
        },
        tracks,
        cursor_baked: plan.cursor_baked,
        // Buttons only, never keys — the editor's automatic zooms are built
        // from when and where, not from what.
        clicks: screen
            .clicks
            .iter()
            .map(|click| ClickSample {
                at: click.at,
                x: click.x,
                y: click.y,
            })
            .collect(),
        // When typing was happening, to the nearest tenth of a second and no
        // finer — never a key, and never enough timing to infer one. The editor
        // hides the pointer through these and nothing else reads them.
        keys: screen
            .keys
            .iter()
            .map(|span| KeySpan {
                start: span.start,
                end: span.end,
            })
            .collect(),
        // Bounds of whatever field had keyboard focus, never a keystroke.
        // Empty without the Accessibility grant.
        typing: screen
            .typing
            .iter()
            .map(|sample| TypingSample {
                at: sample.at,
                x: sample.x,
                y: sample.y,
                width: sample.width,
                height: sample.height,
            })
            .collect(),
        // Sampled during capture, because a pointer that was never drawn into
        // the frames leaves no other trace of where it was.
        cursor: screen
            .cursor
            .iter()
            .map(|sample| CursorSample {
                at: sample.at,
                x: sample.x,
                y: sample.y,
                // Empty for the arrow, so the common sample stays three fields.
                kind: if sample.kind.is_arrow() {
                    String::new()
                } else {
                    sample.kind.as_str().to_owned()
                },
            })
            .collect(),
    };

    let path = plan.output.join(MANIFEST_FILE_NAME);
    match manifest.to_json() {
        Ok(json) => {
            if let Err(e) = std::fs::write(&path, json) {
                eprintln!("[prequel] could not write {}: {e}", path.display());
            }
        }
        Err(e) => eprintln!("[prequel] could not build the manifest: {e}"),
    }
}

fn track(
    kind: prequel_session::TrackKind,
    start: u64,
    end: u64,
    size: Option<(u32, u32)>,
    samples: u64,
    dropped: u64,
) -> prequel_session::Track {
    prequel_session::Track {
        kind,
        file_name: kind.file_name().to_owned(),
        start,
        end,
        width: size.map(|(w, _)| w),
        height: size.map(|(_, h)| h),
        samples,
        dropped,
    }
}

/// Camera failures get their own codes so the shell can tell "no such camera"
/// (offer the picker again) from "access denied" (send them to System
/// Settings) without string-matching a localized message.
/// A poisoned lock, as a JS error.
///
/// Only reachable if a panic unwound while the slot was held, which would mean
/// something worse has already happened — this exists so the camera path says
/// so rather than panicking a second time inside `unwrap`.
fn poisoned() -> Error {
    Error::new(
        Status::GenericFailure,
        "CAMERA_UNAVAILABLE: the camera slot was poisoned".to_owned(),
    )
}

fn to_camera_error(err: camera::Error) -> Error {
    let code = match err {
        camera::Error::DeviceNotFound(_) => "CAMERA_NOT_FOUND",
        camera::Error::DeviceUnavailable { .. } => "CAMERA_UNAVAILABLE",
        camera::Error::SessionRejected { .. } => "CAMERA_SESSION_REJECTED",
        camera::Error::Output { .. } => "OUTPUT",
        camera::Error::Encode(_) => "ENCODE",
    };
    Error::new(Status::GenericFailure, format!("{code}: {err}"))
}

fn to_napi_error(err: capture::Error) -> Error {
    // Keep the discriminant readable from JS so the shell can branch on the
    // permission case without string-matching a localized message.
    let code = match err {
        capture::Error::ScreenAccessDenied => "SCREEN_ACCESS_DENIED",
        capture::Error::Timeout(_) => "TIMEOUT",
        capture::Error::DisplayNotFound(_) => "DISPLAY_NOT_FOUND",
        capture::Error::DisplayAsleep(_) => "DISPLAY_ASLEEP",
        capture::Error::EmptyRegion { .. } => "EMPTY_REGION",
        capture::Error::Output { .. } => "OUTPUT",
        capture::Error::WindowNotFound(_) => "WINDOW_NOT_FOUND",
        capture::Error::ScreenCaptureKit(_) => "SCREEN_CAPTURE_KIT",
        capture::Error::Encode(_) => "ENCODE",
    };
    Error::new(Status::GenericFailure, format!("{code}: {err}"))
}

impl From<capture::PermissionStatus> for PermissionStatus {
    fn from(value: capture::PermissionStatus) -> Self {
        match value {
            capture::PermissionStatus::Granted => Self::Granted,
            capture::PermissionStatus::Denied => Self::Denied,
        }
    }
}

impl From<capture::TargetKind> for TargetKind {
    fn from(value: capture::TargetKind) -> Self {
        match value {
            capture::TargetKind::Display => Self::Display,
            capture::TargetKind::Window => Self::Window,
        }
    }
}

impl From<capture::Bounds> for Bounds {
    fn from(value: capture::Bounds) -> Self {
        Self {
            x: value.x,
            y: value.y,
            width: value.width,
            height: value.height,
        }
    }
}

impl From<capture::Target> for Target {
    fn from(value: capture::Target) -> Self {
        Self {
            kind: value.kind.into(),
            id: value.id,
            title: value.title,
            app_name: value.app_name,
            app_path: value.app_path,
            bounds: value.bounds.into(),
            scale_factor: value.scale_factor,
        }
    }
}

// ── Cameras ─────────────────────────────────────────────────────────────────

#[napi(object)]
#[derive(Debug)]
pub struct CameraDevice {
    /// `AVCaptureDevice.uniqueID`.
    pub id: String,
    /// `AVCaptureDevice.localizedName`.
    ///
    /// The same string Chromium reports as `MediaDeviceInfo.label`, which is
    /// the only thing the two sides can match on: Chromium's `deviceId` is
    /// salted per origin and means nothing to AVFoundation.
    pub name: String,
}

/// Lists attached cameras. Does not prompt and does not open any device.
/// Opens a camera before there is anything to record with it.
///
/// Called when the countdown appears. An `AVCaptureSession` reports itself
/// running long before the sensor has settled on an exposure, so a camera
/// opened at the instant recording starts writes a dark second or two before it
/// comes good. The countdown is three seconds that were being spent anyway.
///
/// Idempotent per device, and never fatal: the recording opens the camera
/// itself if this was not called, failed, or was called for a different one.
#[napi(ts_return_type = "Promise<void>")]
pub fn prepare_camera(device: String) -> AsyncTask<PrepareCamera> {
    AsyncTask::new(PrepareCamera { device })
}

pub struct PrepareCamera {
    device: String,
}

impl Task for PrepareCamera {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<Self::Output> {
        // Already warm for this camera: opening a second session on the same
        // device would put the first one's frames and this one's in contention
        // for no gain.
        {
            let warm = WARM_CAMERA.lock().map_err(|_| poisoned())?;
            if warm.as_ref().is_some_and(|w| w.is_for(&self.device)) {
                return Ok(());
            }
        }

        // Opened before the lock is taken again so a slow device does not hold
        // the slot shut against a cancel arriving on another thread.
        let opened =
            camera::WarmCamera::open(&self.device, camera::DEFAULT_FPS).map_err(to_camera_error)?;
        *WARM_CAMERA.lock().map_err(|_| poisoned())? = Some(opened);
        Ok(())
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
        Ok(())
    }
}

/// Closes a camera opened by [`prepare_camera`], if one is still open.
///
/// The camera light is on from the moment it is opened, so a countdown that is
/// cancelled has to put it out again — otherwise Escape leaves the light on
/// with nothing recording, which reads as the app spying.
#[napi]
pub fn release_camera() {
    if let Ok(mut warm) = WARM_CAMERA.lock() {
        warm.take();
    }
}

#[napi]
pub fn list_cameras() -> Vec<CameraDevice> {
    camera::list_cameras()
        .into_iter()
        .map(|device| CameraDevice {
            id: device.id,
            name: device.name,
        })
        .collect()
}

// ── Recording ───────────────────────────────────────────────────────────────
//
// Recording is a process-wide singleton: macOS gives one Screen Recording
// grant to the app, and two concurrent captures of the same display would
// fight over the encoder. The handle lives here so JS can drive start/stop
// without holding a native object.

/// The pipelines that make up one recording.
///
/// They run on different queues — ScreenCaptureKit's and AVFoundation's — and
/// write different files, but they share one [`capture::SharedClock`]. That is
/// what puts their timestamps on a common timeline, and what makes pausing the
/// screen pause the camera too.
struct Session {
    screen: capture::ScreenRecorder,
    camera: Option<camera::CameraRecorder>,
    /// What was asked for, kept so the manifest can describe the source once
    /// the recording is over.
    plan: SessionPlan,
}

/// The parts of a recording request the manifest needs but the recorders do not.
struct SessionPlan {
    output: std::path::PathBuf,
    started_at: String,
    source_kind: &'static str,
    source_id: u32,
    scale_factor: f64,
    /// Whether ScreenCaptureKit drew the pointer into the frames.
    ///
    /// Recorded rather than inferred: the editor draws the pointer as a layer
    /// from the sampled track, and doing that on top of a baked one puts two
    /// pointers in the export.
    cursor_baked: bool,
}

static RECORDER: Mutex<Option<Session>> = Mutex::new(None);

/// A camera opened ahead of the recording, waiting to be handed to it.
///
/// Separate from `RECORDER` because it is filled and emptied on a different
/// schedule: the shell opens the camera when the countdown appears and the
/// recording claims it three seconds later, and a cancelled countdown has to be
/// able to close it again with no recording ever existing.
static WARM_CAMERA: Mutex<Option<camera::WarmCamera>> = Mutex::new(None);

#[napi(string_enum)]
#[derive(Debug)]
pub enum RecordingState {
    Idle,
    Recording,
    Paused,
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct RecordRequest {
    pub target_kind: TargetKind,
    /// `CGDirectDisplayID` for a display, `CGWindowID` for a window.
    pub target_id: u32,
    /// Target geometry in points, as the shell already measured it.
    ///
    /// Passed explicitly rather than re-derived here: re-listing targets
    /// between choosing one and recording it opens a window where the target
    /// can vanish — a window closes, or ScreenCaptureKit briefly stops
    /// reporting a display — and the recording fails for no good reason.
    pub bounds: Bounds,
    pub scale_factor: f64,
    pub output_path: String,
    /// Defaults to 60.
    pub fps: Option<u32>,
    /// `"h264"` (default) or `"hevc"`.
    pub codec: Option<String>,
    /// Defaults to true.
    /// Bake the system pointer into the frames.
    ///
    /// Defaults to false: the pointer is sampled instead and composited by the
    /// editor, which is what makes it possible to hide, resize or zoom to it
    /// after the recording is over. Baking it is irreversible.
    pub show_cursor: Option<bool>,
    /// Sub-region to capture, in points relative to the target's origin.
    /// Omit to capture the whole target.
    pub crop: Option<Bounds>,
    pub system_audio: Option<bool>,
    pub microphone: Option<bool>,
    /// Camera to record as a fourth track, as a `uniqueID` or the exact
    /// `localizedName` — which is what `MediaDeviceInfo.label` reports, and the
    /// only handle the renderer's device picker actually has.
    ///
    /// Omit to record no camera. The bubble on screen is a preview; this is
    /// what puts the camera in the output.
    pub camera: Option<String>,
    /// Wall-clock start as an ISO 8601 string, for the manifest.
    ///
    /// Passed in rather than read here so the native side needs no date
    /// formatting at all. It is for display only — every actual timing question
    /// is answered by the per-track offsets, which are on the session clock.
    pub started_at: Option<String>,
    /// `CGWindowID`s to keep out of the recording — the control pill, camera
    /// bubble and picker overlays.
    ///
    /// Electron's `setContentProtection(true)` does *not* hide a window from
    /// ScreenCaptureKit on current macOS, so passing ids here is the only thing
    /// that works. Read them from `BrowserWindow.getMediaSourceId()`, which
    /// returns `"window:<id>:0"`.
    pub excluded_window_ids: Option<Vec<u32>>,
}

#[napi(object)]
#[derive(Debug)]
pub struct RecordingResult {
    pub frames: i64,
    /// Media duration in milliseconds, with paused spans already removed.
    pub duration_ms: f64,
    pub width: u32,
    pub height: u32,
    /// Frames skipped because the screen had not changed. Expected, not a fault.
    pub idle_frames: i64,
    /// Frames genuinely lost — encoder saturation or stale timestamps. Should
    /// be 0 on healthy runs.
    pub dropped_frames: i64,
    /// Frames discarded because the recording was paused. Intended, not a fault.
    pub paused_frames: i64,
    pub system_audio_samples: i64,
    pub microphone_samples: i64,
    /// Camera frames written. 0 when no camera was requested.
    pub camera_frames: i64,
    /// Where the camera track begins on the session timeline, in milliseconds.
    ///
    /// Expected to be non-zero: an `AVCaptureSession` takes a few hundred
    /// milliseconds to warm up while the screen is already recording. Anything
    /// merging the tracks later has to shift the camera by this much.
    pub camera_start_ms: f64,
    pub camera_width: u32,
    pub camera_height: u32,
    /// Why the camera track failed, if it did.
    ///
    /// Reported rather than thrown: the screen recording is already on disk and
    /// finalised by this point, and discarding it because the webcam file could
    /// not be closed would be a much worse outcome than a missing bubble.
    pub camera_error: Option<String>,
}

/// Begins recording. Rejects if a recording is already running.
#[napi(ts_return_type = "Promise<void>")]
pub fn start_recording(request: RecordRequest) -> AsyncTask<StartRecording> {
    AsyncTask::new(StartRecording(request))
}

pub struct StartRecording(RecordRequest);

impl Task for StartRecording {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<Self::Output> {
        let mut slot = lock_recorder()?;
        if slot.is_some() {
            return Err(Error::new(
                Status::GenericFailure,
                "ALREADY_RECORDING: a recording is already in progress".to_owned(),
            ));
        }

        let request = &self.0;
        let kind = match request.target_kind {
            TargetKind::Display => capture::TargetKind::Display,
            TargetKind::Window => capture::TargetKind::Window,
        };
        let target = capture::Target {
            kind,
            id: request.target_id,
            title: String::new(),
            app_name: String::new(),
            app_path: String::new(),
            bounds: capture::Bounds {
                x: request.bounds.x,
                y: request.bounds.y,
                width: request.bounds.width,
                height: request.bounds.height,
            },
            scale_factor: request.scale_factor,
        };

        let mut options = capture::RecordOptions::new(target, &request.output_path);
        if let Some(fps) = request.fps {
            options.fps = fps;
        }
        if let Some(codec) = request.codec.as_deref() {
            options.codec = match codec.to_ascii_lowercase().as_str() {
                "hevc" => capture::VideoCodec::Hevc,
                "h264" => capture::VideoCodec::H264,
                other => {
                    return Err(Error::new(
                        Status::InvalidArg,
                        format!("UNKNOWN_CODEC: {other:?}, expected \"h264\" or \"hevc\""),
                    ));
                }
            };
        }
        options.show_cursor = request.show_cursor.unwrap_or(false);
        options.crop = request.crop.map(|c| capture::Bounds {
            x: c.x,
            y: c.y,
            width: c.width,
            height: c.height,
        });
        options.capture_system_audio = request.system_audio.unwrap_or(false);
        options.capture_microphone = request.microphone.unwrap_or(false);
        options.excluded_windows = request.excluded_window_ids.clone().unwrap_or_default();

        // One clock, handed to both pipelines. Two clocks would produce two
        // files that cannot be lined up, which is the entire failure mode
        // separate tracks exist to avoid.
        let clock = capture::SharedClock::new();

        // The camera opens first because it is the slower of the two — an
        // `AVCaptureSession` takes a few hundred milliseconds to warm up, and
        // starting it after the screen would waste all of that as head with no
        // camera in it. It still does not anchor the clock; the screen does.
        // Whatever is in the slot goes, matching or not: a warm camera for a
        // device this recording is not using is a light left on.
        let warm = WARM_CAMERA.lock().ok().and_then(|mut slot| slot.take());

        let camera = match request.camera.as_deref() {
            None => None,
            Some(device) => {
                let mut camera_options = camera::CameraOptions::new(device, &request.output_path);
                camera_options.codec = options.codec;
                Some(
                    match warm.filter(|w| w.is_for(device)) {
                        // The common path: opened when the countdown appeared,
                        // settled by now, and it only has to start writing.
                        Some(warm) => {
                            camera::CameraRecorder::begin(warm, &camera_options, clock.clone())
                        }
                        // No warm camera, or one for a device the user changed
                        // their mind about. Opening cold costs the dark head
                        // this exists to avoid, which still beats no camera.
                        None => camera::CameraRecorder::start(&camera_options, clock.clone()),
                    }
                    .map_err(to_camera_error)?,
                )
            }
        };

        let screen = match capture::ScreenRecorder::start(&options, clock) {
            Ok(screen) => screen,
            Err(e) => {
                // The camera is already running and holding the device. Stop it
                // rather than leaving the light on with nothing recording.
                if let Some(camera) = camera {
                    let _ = camera.stop();
                }
                return Err(to_napi_error(e));
            }
        };

        *slot = Some(Session {
            screen,
            camera,
            plan: SessionPlan {
                output: std::path::PathBuf::from(&request.output_path),
                started_at: request.started_at.clone().unwrap_or_default(),
                source_kind: match request.target_kind {
                    // An area is a display capture with a crop on it, and
                    // nothing else in the manifest can tell the two apart —
                    // the crop is applied here and never written down. The
                    // editor wants them framed oppositely: a whole screen
                    // should fill the frame, a region wants to sit on a
                    // background like a window does, so recording only
                    // "display" for both left every area grab opening
                    // edge-to-edge.
                    TargetKind::Display if request.crop.is_some() => "area",
                    TargetKind::Display => "display",
                    TargetKind::Window => "window",
                },
                source_id: request.target_id,
                scale_factor: request.scale_factor,
                cursor_baked: options.show_cursor,
            },
        });
        Ok(())
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
        Ok(())
    }
}

/// Stops the recording and closes the file.
#[napi(ts_return_type = "Promise<RecordingResult>")]
pub fn stop_recording() -> AsyncTask<StopRecording> {
    AsyncTask::new(StopRecording)
}

pub struct StopRecording;

/// Both pipelines' results, or the camera's failure.
pub struct StopOutput {
    screen: capture::RecordingSummary,
    camera: std::result::Result<Option<camera::CameraSummary>, String>,
}

impl Task for StopRecording {
    type Output = StopOutput;
    type JsValue = RecordingResult;

    fn compute(&mut self) -> Result<Self::Output> {
        let session = lock_recorder()?.take().ok_or_else(|| {
            Error::new(
                Status::GenericFailure,
                "NOT_RECORDING: nothing is being recorded".to_owned(),
            )
        })?;

        // The screen is finalised first and its error is fatal — without it
        // there is no recording. The camera is finalised second and its error
        // is only reported, because by then the screen track is closed on disk
        // and throwing it away over the webcam would be the worse trade.
        let screen = session.screen.stop().map_err(to_napi_error)?;
        let camera = match session.camera {
            None => Ok(None),
            Some(camera) => camera.stop().map(Some).map_err(|e| e.to_string()),
        };

        write_manifest(
            &session.plan,
            &screen,
            camera.as_ref().ok().and_then(|c| c.as_ref()),
        );

        Ok(StopOutput { screen, camera })
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        let summary = output.screen;
        let camera = output.camera.as_ref().ok().and_then(|c| c.as_ref());

        Ok(RecordingResult {
            frames: summary.frames as i64,
            duration_ms: summary.duration as f64 / 1_000_000.0,
            width: summary.width,
            height: summary.height,
            idle_frames: summary.idle_frames as i64,
            dropped_frames: (summary.video.dropped + summary.dropped_encoder) as i64,
            paused_frames: summary.paused_frames as i64,
            system_audio_samples: summary.system_audio_samples() as i64,
            microphone_samples: summary.microphone_samples() as i64,
            camera_frames: camera.map_or(0, |c| c.frames as i64),
            camera_start_ms: camera.map_or(0.0, |c| c.start as f64 / 1_000_000.0),
            camera_width: camera.map_or(0, |c| c.width),
            camera_height: camera.map_or(0, |c| c.height),
            camera_error: output.camera.err(),
        })
    }
}

/// Pauses recording. Paused time is removed from the output entirely.
#[napi]
pub fn pause_recording() -> Result<()> {
    with_recorder(|recorder| recorder.pause())
}

#[napi]
pub fn resume_recording() -> Result<()> {
    with_recorder(|recorder| recorder.resume())
}

#[napi]
pub fn recording_state() -> RecordingState {
    match lock_recorder()
        .ok()
        .and_then(|slot| slot.as_ref().map(|session| session.screen.is_paused()))
    {
        None => RecordingState::Idle,
        Some(true) => RecordingState::Paused,
        Some(false) => RecordingState::Recording,
    }
}

fn lock_recorder() -> Result<std::sync::MutexGuard<'static, Option<Session>>> {
    RECORDER.lock().map_err(|_| {
        Error::new(
            Status::GenericFailure,
            "RECORDER_POISONED: the recorder panicked; restart the app".to_owned(),
        )
    })
}

fn with_recorder(f: impl FnOnce(&capture::ScreenRecorder)) -> Result<()> {
    let slot = lock_recorder()?;
    let recorder = slot
        .as_ref()
        .map(|session| &session.screen)
        .ok_or_else(|| {
            Error::new(
                Status::GenericFailure,
                "NOT_RECORDING: nothing is being recorded".to_owned(),
            )
        })?;
    f(recorder);
    Ok(())
}
