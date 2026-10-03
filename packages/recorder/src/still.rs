//! Taking one frame of a display, a window or a region.
//!
//! The screenshot half of the recorder. Mirrors `start_recording`'s request
//! shape where the two overlap — the same target, bounds, scale and crop the
//! shell already measured — because the panel hands the same selection to
//! either and two request shapes would be two chances to describe it
//! differently.
//!
//! Nothing is held between calls. A still is one frame and a file, so there is
//! no session to start, pause or stop, and `RECORDER`'s whole reason to exist
//! does not apply.

use napi::bindgen_prelude::{AsyncTask, Env, Error, Result, Task};
use napi_derive::napi;
use prequel_capture as capture;

use crate::{Bounds, TargetKind};

#[napi(object)]
#[derive(Debug, Clone)]
pub struct StillRequest {
    pub target_kind: TargetKind,
    /// `CGDirectDisplayID` for a display, `CGWindowID` for a window.
    pub target_id: u32,
    /// Target geometry in points, as the shell already measured it.
    ///
    /// Passed explicitly rather than re-derived here, for the reason
    /// `RecordRequest::bounds` is: re-listing targets between choosing one and
    /// shooting it opens a window where the target can vanish.
    pub bounds: Bounds,
    pub scale_factor: f64,
    /// Where the PNG is written. Parent directories are created.
    pub output_path: String,
    /// Sub-region to capture, in points relative to the target's origin.
    /// Omit to capture the whole target.
    pub crop: Option<Bounds>,
    /// Bake the system pointer into the shot. Defaults to false.
    ///
    /// The opposite default from a recording, and not for want of a pointer
    /// layer: a recording is of something happening and the arrow is what is
    /// doing it, where a still is of something on screen and a parked arrow is
    /// in the way of it.
    pub show_cursor: Option<bool>,
    /// `CGWindowID`s to keep out of the shot — the panel, the camera bubble,
    /// the picker overlays. The same mechanism and the same necessity as
    /// `RecordRequest::excluded_window_ids`.
    pub excluded_window_ids: Option<Vec<u32>>,
}

#[napi(object)]
#[derive(Debug)]
pub struct StillResult {
    pub width: u32,
    pub height: u32,
}

/// Writes one frame of the chosen target to `output_path`, as a PNG.
#[napi(ts_return_type = "Promise<StillResult>")]
pub fn capture_still(request: StillRequest) -> AsyncTask<CaptureStill> {
    AsyncTask::new(CaptureStill(request))
}

pub struct CaptureStill(StillRequest);

impl Task for CaptureStill {
    type Output = capture::StillSize;
    type JsValue = StillResult;

    fn compute(&mut self) -> Result<Self::Output> {
        let request = &self.0;
        let kind = match request.target_kind {
            TargetKind::Display => capture::TargetKind::Display,
            TargetKind::Window => capture::TargetKind::Window,
        };

        let target = capture::Target {
            kind,
            id: request.target_id,
            // Three strings the capture never reads: the filter is built from
            // the kind and the id, and the title is the panel's business.
            title: String::new(),
            app_name: String::new(),
            app_path: String::new(),
            bounds: bounds_of(request.bounds),
            scale_factor: request.scale_factor,
        };

        let options = capture::StillOptions {
            target,
            crop: request.crop.map(bounds_of),
            show_cursor: request.show_cursor.unwrap_or(false),
            excluded_windows: request.excluded_window_ids.clone().unwrap_or_default(),
        };

        capture::capture_still(&options, std::path::Path::new(&request.output_path))
            // Prefixed the way every other failure out of this addon is, so the
            // shell can tell a screenshot that failed from a recording that did.
            .map_err(|err| Error::from_reason(format!("STILL: {err}")))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(StillResult {
            width: output.width,
            height: output.height,
        })
    }
}

fn bounds_of(bounds: Bounds) -> capture::Bounds {
    capture::Bounds {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
    }
}
