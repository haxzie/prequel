//! Driving the sensitive-text scan from JavaScript.
//!
//! Shaped exactly like `transcribe.rs`, and for the same reasons: a plain
//! `std::thread` rather than `AsyncTask`, because reading a long take runs for
//! as long as an export and would otherwise hold one of libuv's four default
//! threadpool slots for the whole of it; progress through a threadsafe
//! function; and completion delivered as a terminal progress event rather than
//! a resolved promise, so there is one channel and no race between "done" and
//! the tick before it.
//!
//! The findings cross as a JSON string, the way the render plan and the
//! transcript's words already do.

use std::sync::Mutex;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

use prequel_ocr::{CancelFlag, ScanRequest, ScanSegment, VisionTextReader};

#[napi(object)]
#[derive(Debug)]
pub struct ScanSegmentOptions {
    /// Absolute path to the file, normally a `screen.mp4`.
    pub path: String,
    /// The manifest's `file_name`, echoed back so the artefact can say which
    /// segments it covered.
    pub name: String,
    /// Session time of this file's first sample, in nanoseconds. The file
    /// itself is zero-based; this is the offset that puts it on the clock.
    pub start: f64,
    /// Session time just past its last sample, in nanoseconds.
    pub end: f64,
}

#[napi(object)]
#[derive(Debug)]
pub struct ScanOptions {
    pub segments: Vec<ScanSegmentOptions>,
    /// How often a frame is read, in milliseconds. Absent takes the default.
    pub interval_ms: Option<u32>,
    /// BCP-47 tags, most preferred first. Empty leaves Vision's own default.
    pub langs: Vec<String>,
    /// Per-recording, so the same card in two recordings does not land in the
    /// same bucket. Crosses as a string because a u64 does not survive JSON.
    pub salt: String,
}

#[napi(object)]
#[derive(Debug)]
pub struct ScanUpdate {
    /// `"preparing"`, `"scanning"`, `"done"`, `"failed"` or `"cancelled"`.
    pub stage: String,
    /// How far through the recording, 0-1, or absent when the stage has no
    /// measure.
    pub progress: Option<f64>,
    /// The findings, as JSON, present only on `done`.
    pub findings: Option<String>,
    /// Which segment names were read all the way through, as JSON.
    pub covered: Option<String>,
    /// Samples taken, and how many of them reached Vision. The gap is what the
    /// unchanged-frame skip saved, and it is the number worth watching.
    pub sampled: Option<u32>,
    pub read: Option<u32>,
    pub code: Option<String>,
    pub message: Option<String>,
}

/// The scan currently running, if any.
///
/// Process-wide, matching the export and the transcription. Two runs over one
/// recording would both write its findings and the loser would overwrite the
/// winner.
static RUNNING: Mutex<Option<CancelFlag>> = Mutex::new(None);

/// Whether this machine can read text at all, and in which languages.
///
/// Cheap, and never puts a permission dialog on screen — Vision's text
/// recognition needs no grant.
#[napi]
pub fn text_recognition_langs() -> Vec<String> {
    VisionTextReader::supported_langs()
}

/// Starts a scan. Returns immediately; everything else is on the callback.
#[napi]
pub fn start_scan(options: ScanOptions, on_progress: ThreadsafeFunction<ScanUpdate, ()>) -> Result<()> {
    let cancel = CancelFlag::new();

    {
        let mut slot = RUNNING
            .lock()
            .map_err(|_| Error::from_reason("SCAN_POISONED: the scan lock is poisoned"))?;
        if slot.is_some() {
            return Err(Error::from_reason("ALREADY_SCANNING: a scan is already running"));
        }
        *slot = Some(cancel.clone());
    }

    std::thread::spawn(move || {
        let emit = |update: ScanUpdate| {
            // Non-blocking: a slow renderer must not stall the reader, and a
            // dropped progress tick costs nothing.
            on_progress.call(Ok(update), ThreadsafeFunctionCallMode::NonBlocking);
        };

        // Before any frame is decoded. Opening the readers and asking Vision
        // which languages it has is quick but has no fraction to divide, so it
        // is a stage rather than a percentage.
        emit(update("preparing", None));

        let salt = options.salt.parse::<u64>().unwrap_or_default();
        let segments: Vec<ScanSegment> = options
            .segments
            .iter()
            .map(|segment| ScanSegment {
                path: segment.path.clone().into(),
                name: segment.name.clone(),
                start: segment.start.max(0.0) as u64,
                end: segment.end.max(0.0) as u64,
            })
            .collect();

        let mut request = ScanRequest::new(segments, salt);
        request.langs = options.langs.clone();
        if let Some(ms) = options.interval_ms {
            request.interval = u64::from(ms) * 1_000_000;
        }

        let result = prequel_ocr::scan(&request, &cancel, &mut |fraction| {
            emit(update("scanning", Some(fraction)))
        });

        emit(match result {
            Ok(summary) => {
                match (
                    serde_json::to_string(&summary.tracks),
                    serde_json::to_string(&summary.covered),
                ) {
                    (Ok(findings), Ok(covered)) => ScanUpdate {
                        stage: "done".to_owned(),
                        progress: Some(1.0),
                        findings: Some(findings),
                        covered: Some(covered),
                        sampled: Some(summary.sampled as u32),
                        read: Some(summary.read as u32),
                        code: None,
                        message: None,
                    },
                    _ => failed("FAILED", "could not encode the findings"),
                }
            }
            Err(prequel_ocr::Error::Cancelled) => update("cancelled", None),
            Err(err) => failed("FAILED", &err.to_string()),
        });

        if let Ok(mut slot) = RUNNING.lock() {
            *slot = None;
        }
    });

    Ok(())
}

/// Asks the running scan to stop. Safe to call when nothing is running.
#[napi]
pub fn cancel_scan() -> Result<()> {
    let slot = RUNNING
        .lock()
        .map_err(|_| Error::from_reason("SCAN_POISONED: the scan lock is poisoned"))?;
    if let Some(cancel) = slot.as_ref() {
        cancel.cancel();
    }
    Ok(())
}

fn update(stage: &str, progress: Option<f32>) -> ScanUpdate {
    ScanUpdate {
        stage: stage.to_owned(),
        progress: progress.map(f64::from),
        findings: None,
        covered: None,
        sampled: None,
        read: None,
        code: None,
        message: None,
    }
}

fn failed(code: &str, message: &str) -> ScanUpdate {
    ScanUpdate {
        stage: "failed".to_owned(),
        progress: None,
        findings: None,
        covered: None,
        sampled: None,
        read: None,
        code: Some(code.to_owned()),
        message: Some(message.to_owned()),
    }
}
