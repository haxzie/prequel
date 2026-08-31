//! Recording session logic: timing, lifecycle, and the output manifest.
//!
//! This crate holds the parts of recording that are easy to get subtly wrong
//! and hard to notice — timestamp normalisation, pause accounting, state
//! transitions. It deliberately depends on no Apple frameworks so all of it can
//! be tested with synthetic input on any machine, with no display and no TCC
//! grant.

mod clock;
mod manifest;
mod state;

pub use clock::{
    HostTime, MediaTime, SampleDecision, SessionClock, SharedClock, TrackStats, TrackTimeline,
};
pub use manifest::{
    ClickSample, CursorSample, KeySpan, MANIFEST_FILE_NAME, MANIFEST_VERSION, Manifest,
    ManifestError, SourceInfo, Track, TrackKind, TypingSample,
};
pub use state::{Command, InvalidTransition, RecordingState};
