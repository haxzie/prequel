//! Reading a recording for sensitive text, and saying where it is over time.
//!
//! Vision does the reading, [`prequel_sensitive`] decides what the words are
//! and follows them from one sample to the next. This crate is the loop between
//! them, and the loop is where the traps are:
//!
//! **A file is zero-based and the manifest holds its offset.** `VideoWriter`
//! opens its session at the first sample, so that sample is the file's origin
//! and a track's late start exists only in `session.json`. The offset is added
//! once, here, when a finding's time goes onto the session clock. Subtracting a
//! probed file start as well double-counts it.
//!
//! **`frame_at` holds the last frame for ever.** That is correct for a screen
//! recording — it only emits a frame when something changed, so the last frame
//! genuinely is what was on screen — but it means a loop bounded by "the reader
//! gave me something" attributes the final frame's findings to the rest of the
//! timeline. The loop is bounded by the segment's own duration instead.
//!
//! **A sample with no new frame behind it costs nothing.** Where the reader's
//! presentation time has not advanced there is nothing new to read, so the
//! previous reading is offered again rather than asking Vision twice for the
//! same picture. Measured rather than assumed, and the measurement is worth
//! stating: a take out of ScreenCaptureKit carries a frame far more often than
//! once a second, so this fires rarely and the pass costs about one read a
//! sample — 300 ms each on an M-series machine, so a five-minute take is a
//! minute and a half. It is a pause in a variable-rate capture this catches,
//! not the stillness of an ordinary screen.
//!
//! Hashing the pixels instead would catch the ordinary case too, and is the
//! obvious next thing. It needs mutable access to the buffer to lock its base
//! address, which means changing a signature the exporter also reads through —
//! so it is a deliberate next step rather than an oversight.

mod reader;
mod sample;

pub use reader::{Reading, TextReader, VisionTextReader};
pub use sample::{ScanRequest, ScanSegment, ScanSummary, scan, scan_with};

pub use prequel_render::CancelFlag;
pub use prequel_sensitive::{Category, MASK_THRESHOLD, NormRect, track::MaskKey, track::Track};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("could not read the text on a frame: {0}")]
    Read(String),
    #[error("could not open {path}: {reason}")]
    Open { path: String, reason: String },
    #[error("the scan was cancelled")]
    Cancelled,
}
