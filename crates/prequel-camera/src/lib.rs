//! Camera capture for Prequel: AVFoundation → timing → encoder → `camera.mp4`.
//!
//! The camera is recorded as its own file rather than composited into the
//! screen capture. That is what makes the webcam bubble movable, resizable and
//! reshapeable after the fact — and it is why this crate exists separately from
//! [`prequel_capture`], which owns ScreenCaptureKit.
//!
//! The two pipelines run on different queues but share one
//! [`prequel_session::SharedClock`], so their timestamps land on a common
//! timeline and pausing one pauses both.

mod devices;
mod recorder;

pub use devices::{CameraDevice, list_cameras};
pub use recorder::{
    CAMERA_FILE, CameraOptions, CameraRecorder, CameraSummary, DEFAULT_FPS, WarmCamera,
};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("no camera matched {0:?}")]
    DeviceNotFound(String),

    #[error("camera {name} could not be opened: {reason}")]
    DeviceUnavailable { name: String, reason: String },

    #[error("the capture session rejected the {what}")]
    SessionRejected { what: &'static str },

    #[error("could not create {path}: {reason}")]
    Output { path: String, reason: String },

    #[error("camera encoding failed: {0}")]
    Encode(String),
}

impl From<prequel_encode::Error> for Error {
    fn from(value: prequel_encode::Error) -> Self {
        Self::Encode(value.to_string())
    }
}
