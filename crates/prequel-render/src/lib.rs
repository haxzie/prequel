//! Baking an edit down to one MP4.
//!
//! The recorder writes four separate files so the webcam can be moved and the
//! mix changed afterwards. This is the other end of that bargain: it reads them
//! back, composites them against the settings the editor produced, and writes a
//! single video.
//!
//! Three decisions shape everything here:
//!
//! **The loop is driven by output frames, not input frames.** For each frame of
//! the result it asks what moment of the recording belongs there and pulls each
//! reader forward to it. Cuts, a 60 fps screen against a 30 fps camera, frames
//! dropped during capture and a camera that opened late all fall out for free,
//! and the output is constant-frame-rate — which is what the preview assumes.
//!
//! **Geometry is not recomputed.** The editor sends a [`plan::RenderPlan`] in
//! absolute output pixels and this rasterises it. Two implementations of "where
//! does the camera sit" is how a preview and an export come to disagree.
//!
//! **Audio is mixed by hand.** A per-source multiply on `f32`, which is exactly
//! what WebAudio does in the preview — see [`mixer`].

pub mod mixer;
pub mod plan;
pub mod timeline;

// Private, except to the GPUI spike. The `spike` feature is off by default, so
// the crate's public surface is unchanged for every ordinary build — but the
// spike has to drive the *real* compositor and the *real* reader, because
// proving a reimplementation of them would prove nothing at all.
#[cfg(not(feature = "spike"))]
mod compositor;
#[cfg(feature = "spike")]
pub mod compositor;

mod export;
mod image;

#[cfg(not(feature = "spike"))]
mod reader;
#[cfg(feature = "spike")]
pub mod reader;

pub use export::{CancelFlag, ExportRequest, ExportSummary, OutputFormat, Progress, Stage, export};
pub use plan::{
    CaptionWord, CursorPoint, Paint, PlanItem, PlanSource, Point, Rect, RenderPlan, Shape, Size,
    Span,
};
pub use timeline::{AudioMix, SliceRender, Timeline};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("could not read {path}: {reason}")]
    Read { path: String, reason: String },

    #[error("could not write {path}: {reason}")]
    Write { path: String, reason: String },

    #[error("Metal is unavailable on this machine: {0}")]
    Metal(String),

    #[error("encoder: {0}")]
    Encode(#[from] prequel_encode::Error),

    #[error("the export was cancelled")]
    Cancelled,

    #[error("nothing to export: the edit has no slices")]
    Empty,
}
