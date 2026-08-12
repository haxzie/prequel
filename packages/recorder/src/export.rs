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

use prequel_encode::VideoCodec;
use prequel_render::{AudioMix, CancelFlag, ExportRequest, RenderPlan, SliceRender};

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
    pub mic_volume: f64,
    pub system_volume: f64,
}

#[napi(object)]
#[derive(Debug)]
pub struct ExportOptions {
    pub session_dir: String,
    pub output: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// `"h264"` or `"hevc"`.
    pub codec: String,
    pub slices: Vec<ExportSlice>,
    /// Per-track offsets from the manifest, in nanoseconds. The only place a
    /// late start is recorded — every session file is written zero-based.
    pub screen_offset: f64,
    pub camera_offset: f64,
    pub mic_offset: f64,
    pub system_offset: f64,
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

        slices.push(SliceRender {
            start: slice.start.max(0.0) as u64,
            end: slice.end.max(0.0) as u64,
            plan,
            audio: AudioMix {
                mic: slice.mic_volume as f32,
                system: slice.system_volume as f32,
            },
        });
    }

    Ok(ExportRequest {
        session_dir: options.session_dir.into(),
        output: options.output.into(),
        width: options.width,
        height: options.height,
        fps: options.fps,
        codec: if options.codec == "hevc" {
            VideoCodec::Hevc
        } else {
            VideoCodec::H264
        },
        slices,
        screen_offset: options.screen_offset.max(0.0) as u64,
        camera_offset: options.camera_offset.max(0.0) as u64,
        mic_offset: options.mic_offset.max(0.0) as u64,
        system_offset: options.system_offset.max(0.0) as u64,
    })
}

fn stage_name(stage: prequel_render::Stage) -> &'static str {
    match stage {
        prequel_render::Stage::Preparing => "preparing",
        prequel_render::Stage::Rendering => "rendering",
        prequel_render::Stage::Finalising => "finalising",
    }
}
