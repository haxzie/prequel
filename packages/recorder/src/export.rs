//! Driving an export from JavaScript.
//!
//! A plain `std::thread` rather than napi's `AsyncTask`: an export runs for
//! minutes, and `AsyncTask` would occupy one of libuv's four default threadpool
//! slots for the whole of it — starving `list_targets`, which is also an
//! `AsyncTask`, and which the picker calls every 700 ms.
//!
//! Progress comes back through a threadsafe function, throttled on the Rust
//! side. Completion is a terminal progress event rather than a resolved
//! promise, so there is exactly one channel and no ordering race between "done"
//! and the last progress tick.

use std::sync::Mutex;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

use prequel_keysound::{ClickProfile, KeyProfile};
use prequel_render::sound::SoundPlan;
use prequel_render::{
    AudioMix, CancelFlag, ExportRequest, OutputFormat, RenderPlan, SegmentRef, SliceMedia,
    SliceRender,
};

use crate::sound::SoundCues;

/// Which file a slice plays for one kind, and where that file's zero sits.
///
/// Resolved by the editor: a slice may never span a seam between two takes, so
/// exactly one file per kind covers it, and the segment lookup stays in one
/// place — `editor/segments.ts` — rather than being written a second time here.
#[napi(object)]
#[derive(Debug)]
pub struct SegmentMedia {
    /// A manifest `Segment.file_name`, relative to the session directory.
    pub file: String,
    /// Media time of this file's first sample, in nanoseconds.
    pub offset: f64,
    /// The camera's matte, at the camera's own offset. Only ever on the camera.
    pub matte: Option<String>,
}

/// One kept span of the recording, as the editor describes it.
#[napi(object)]
#[derive(Debug)]
pub struct ExportSlice {
    /// Source-time start, in nanoseconds.
    pub start: f64,
    /// Source-time end, in nanoseconds.
    pub end: f64,
    /// The drawing plan, serialised. Built by `shared/layout.ts`, which owns
    /// the geometry — nothing here recomputes a position.
    pub plan: String,
    /// Playback rate. 1 is unchanged.
    pub speed: f64,
    pub mic_volume: f64,
    pub system_volume: f64,
    /// Which keyboard the typing sounds are of — a `KeyProfile` id, or `"off"`.
    pub key_sound: String,
    pub key_sound_volume: f64,
    /// Which mouse the click sounds are of — a `ClickProfile` id, or `"off"`.
    pub click_sound: String,
    pub click_sound_volume: f64,
    /// Which file this slice plays for each kind. Absent for a kind no take
    /// recorded over this slice, which renders as no picture and silence.
    pub screen: Option<SegmentMedia>,
    pub camera: Option<SegmentMedia>,
    pub mic: Option<SegmentMedia>,
    pub system: Option<SegmentMedia>,
}

#[napi(object)]
#[derive(Debug)]
pub struct ExportOptions {
    pub session_dir: String,
    pub output: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// `"h264"`, `"hevc"` or `"gif"`.
    pub format: String,
    pub slices: Vec<ExportSlice>,
    /// The recording's sound plan, exactly as `sound_cues` handed it to the
    /// editor. Omit for a recording with no presses and no clicks.
    pub sound: Option<SoundCues>,
}

#[napi(object)]
#[derive(Debug)]
pub struct ExportProgress {
    /// `"preparing"`, `"rendering"`, `"finalising"`, `"done"`, `"failed"` or
    /// `"cancelled"`.
    pub stage: String,
    pub frames_done: f64,
    pub frames_total: f64,
    pub output_path: Option<String>,
    pub message: Option<String>,
}

/// The export currently running, if any.
///
/// Process-wide like the recorder, and for the same reason: there is one GPU
/// and one encoder, and two concurrent exports would fight over both.
static EXPORT: Mutex<Option<CancelFlag>> = Mutex::new(None);

/// Starts an export. Returns immediately; progress arrives on the callback.
#[napi]
pub fn start_export(
    options: ExportOptions,
    on_progress: ThreadsafeFunction<ExportProgress, ()>,
) -> Result<()> {
    let cancel = CancelFlag::new();

    {
        let mut slot = EXPORT
            .lock()
            .map_err(|_| Error::from_reason("EXPORT_POISONED: the export lock is poisoned"))?;
        if slot.is_some() {
            return Err(Error::from_reason(
                "ALREADY_EXPORTING: an export is already running",
            ));
        }
        *slot = Some(cancel.clone());
    }

    let request = build_request(options)?;

    std::thread::spawn(move || {
        let emit = |progress: ExportProgress| {
            // Non-blocking: a slow renderer must not stall the export thread,
            // and a dropped progress tick costs nothing.
            on_progress.call(Ok(progress), ThreadsafeFunctionCallMode::NonBlocking);
        };

        let result = prequel_render::export(&request, &cancel, &mut |progress| {
            emit(ExportProgress {
                stage: stage_name(progress.stage).to_owned(),
                frames_done: progress.frames_done as f64,
                frames_total: progress.frames_total as f64,
                output_path: None,
                message: None,
            });
        });

        // Terminal event: exactly one channel, so "done" can never arrive
        // before the progress tick that preceded it.
        emit(match result {
            Ok(summary) => ExportProgress {
                stage: "done".to_owned(),
                frames_done: summary.frames as f64,
                frames_total: summary.frames as f64,
                output_path: Some(summary.output.display().to_string()),
                message: None,
            },
            Err(prequel_render::Error::Cancelled) => ExportProgress {
                stage: "cancelled".to_owned(),
                frames_done: 0.0,
                frames_total: 0.0,
                output_path: None,
                message: None,
            },
            Err(err) => ExportProgress {
                stage: "failed".to_owned(),
                frames_done: 0.0,
                frames_total: 0.0,
                output_path: None,
                message: Some(err.to_string()),
            },
        });

        if let Ok(mut slot) = EXPORT.lock() {
            *slot = None;
        }
    });

    Ok(())
}

/// Asks the running export to stop. Safe to call when nothing is running.
#[napi]
pub fn cancel_export() -> Result<()> {
    let slot = EXPORT
        .lock()
        .map_err(|_| Error::from_reason("EXPORT_POISONED: the export lock is poisoned"))?;
    if let Some(cancel) = slot.as_ref() {
        cancel.cancel();
    }
    Ok(())
}

fn build_request(options: ExportOptions) -> Result<ExportRequest> {
    let mut slices = Vec::with_capacity(options.slices.len());

    for slice in options.slices {
        let plan: RenderPlan = serde_json::from_str(&slice.plan).map_err(|e| {
            Error::from_reason(format!("EXPORT: could not read a render plan: {e}"))
        })?;

        let media = SliceMedia {
            screen: segment_ref(slice.screen)?,
            matte: slice
                .camera
                .as_ref()
                .and_then(|camera| camera.matte.clone())
                .map(relative)
                .transpose()?,
            camera: segment_ref(slice.camera)?,
            mic: segment_ref(slice.mic)?,
            system: segment_ref(slice.system)?,
        };

        slices.push(SliceRender {
            start: slice.start.max(0.0) as u64,
            end: slice.end.max(0.0) as u64,
            plan,
            speed: slice.speed,
            media,
            audio: AudioMix {
                mic: slice.mic_volume as f32,
                system: slice.system_volume as f32,
                keys: slice.key_sound_volume as f32,
                // An id this build does not know is off, not an error: a
                // keyboard is a preference, and refusing to export over one
                // is the wrong failure. `"off"` is simply not a known id.
                key_profile: KeyProfile::from_id(&slice.key_sound),
                clicks: slice.click_sound_volume as f32,
                click_profile: ClickProfile::from_id(&slice.click_sound),
            },
        });
    }

    Ok(ExportRequest {
        session_dir: options.session_dir.into(),
        output: options.output.into(),
        width: options.width,
        height: options.height,
        fps: options.fps,
        // Anything unrecognised falls back to H.264 rather than failing: the
        // format is a preference, and refusing to export because of one is a
        // worse outcome than exporting in the format everything can play.
        format: match options.format.as_str() {
            "hevc" => OutputFormat::Mp4Hevc,
            "gif" => OutputFormat::Gif,
            _ => OutputFormat::Mp4,
        },
        slices,
        sound: options.sound.map(|cues| SoundPlan {
            cues: cues.to_cues(),
        }),
    })
}

fn segment_ref(media: Option<SegmentMedia>) -> Result<Option<SegmentRef>> {
    let Some(media) = media else {
        return Ok(None);
    };

    Ok(Some(SegmentRef {
        file: relative(media.file)?,
        offset: media.offset.max(0.0) as u64,
    }))
}

/// A file name, checked to name something inside the session directory.
///
/// The one renderer-supplied string in an export request that reaches the
/// filesystem, and the renderer is the least-trusted process in the app —
/// without this, `"../../../etc/passwd"` would be joined and opened. Refused
/// rather than sanitised: a name that is not a relative path inside the
/// recording is not a path to be cleaned up, it is not one of ours.
fn relative(file: String) -> Result<std::path::PathBuf> {
    let path = std::path::PathBuf::from(&file);
    let inside = path
        .components()
        .all(|part| matches!(part, std::path::Component::Normal(_)));

    if !inside {
        return Err(Error::from_reason(format!(
            "EXPORT: {file:?} is not a file inside the recording"
        )));
    }

    Ok(path)
}

fn stage_name(stage: prequel_render::Stage) -> &'static str {
    match stage {
        prequel_render::Stage::Preparing => "preparing",
        prequel_render::Stage::Rendering => "rendering",
        prequel_render::Stage::Finalising => "finalising",
    }
}
