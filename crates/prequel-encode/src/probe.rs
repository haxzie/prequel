//! Reads back what was actually written.
//!
//! The manifest describes what the recorder *believed* it wrote. This reports
//! what the files actually contain — dimensions, frame rate, real duration —
//! so the editor lays out against the media rather than against a description
//! of it that nothing has checked.
//!
//! What this deliberately does **not** provide is track synchronisation.
//! `VideoWriter` opens its session at the first sample's presentation time, so
//! that sample becomes the origin and every session file comes out zero-based —
//! measured, not assumed, in `tests/probes_a_late_track.rs`. A track's late
//! start therefore exists only in `session.json`, and anything lining the
//! tracks up must take the offset from there and seek the file from zero.
//! Subtracting [`TrackProbe::start`] as well would double-count it.

use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use cidre::{arc, av, cm, ns};

use crate::{Error, Result};

/// How long to wait for AVFoundation to load a track list.
///
/// Loading is asynchronous even for a local file, and this call is synchronous
/// by design — it runs on a worker thread and its answer is needed before the
/// editor can lay anything out. The timeout only exists so a pathological file
/// cannot wedge that thread forever.
const LOAD_TIMEOUT: Duration = Duration::from_secs(10);

/// What one media file actually contains.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TrackProbe {
    /// Presentation time of the first sample, in nanoseconds on the file's own
    /// timeline.
    ///
    /// Zero for every file this app writes — see the module docs. Reported
    /// anyway so that a file which is *not* zero-based is visible rather than
    /// silently mis-seeked.
    pub start: u64,
    /// Duration of the track, in nanoseconds.
    pub duration: u64,
    /// Natural dimensions, for a video track.
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Nominal frame rate, for a video track.
    pub frame_rate: Option<f32>,
}

/// Both of a file's tracks, either of which may be absent.
///
/// [`probe_file`]'s answer is one track, because a session file holds exactly
/// one. A file from outside the app holds whichever pair it likes, and "does
/// this have sound at all" is a question an import has to answer before it
/// writes a manifest: a `system_audio` segment naming a file with no audio
/// track in it fails the export at `AudioReader`, long after the import looked
/// like it worked.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MediaProbe {
    pub video: Option<TrackProbe>,
    pub audio: Option<TrackProbe>,
}

/// Probes one media file.
///
/// Reads the first video track if there is one, falling back to the first audio
/// track — a session file holds exactly one of the two.
pub fn probe_file(path: &Path) -> Result<TrackProbe> {
    let asset = open(path)?;

    // Video first: a session file holds exactly one of the two, and only the
    // video case has dimensions worth reporting.
    load_probe(&asset, av::MediaType::video(), true)
        .or_else(|| load_probe(&asset, av::MediaType::audio(), false))
        .ok_or_else(|| Error::CreateWriter {
            path: path.display().to_string(),
            reason: "holds no readable video or audio track".to_owned(),
        })
}

/// Probes one media file for both of its tracks.
///
/// Errors only when the file will not open at all. A file that opens and holds
/// neither track reports two `None`s, which the caller has to reject on its own
/// terms — "not a video" is a better message than "could not be opened".
pub fn probe_media(path: &Path) -> Result<MediaProbe> {
    let asset = open(path)?;

    Ok(MediaProbe {
        video: load_probe(&asset, av::MediaType::video(), true),
        audio: load_probe(&asset, av::MediaType::audio(), false),
    })
}

/// Opens a file as an asset, without loading anything off it yet.
fn open(path: &Path) -> Result<arc::R<av::UrlAsset>> {
    let url = ns::Url::with_fs_path_str(
        path.to_str().ok_or_else(|| Error::CreateWriter {
            path: path.display().to_string(),
            reason: "path is not valid UTF-8".to_owned(),
        })?,
        false,
    );

    av::UrlAsset::with_url(&url, None).ok_or_else(|| Error::CreateWriter {
        path: path.display().to_string(),
        reason: "could not be opened as a media file".to_owned(),
    })
}

/// Loads one media type's first track and reads its timing off.
///
/// AVFoundation only exposes track loading asynchronously, so the completion
/// block hands its answer back over a channel. Everything the probe needs is
/// read *inside* the block: the tracks arrive by reference, and copying the few
/// numbers out is simpler than retaining the array to outlive the callback.
fn load_probe(asset: &av::UrlAsset, media_type: &av::MediaType, video: bool) -> Option<TrackProbe> {
    let (tx, rx) = mpsc::channel();

    asset.load_tracks_with_media_type_block(media_type, move |tracks, _error| {
        let probe = tracks.and_then(|tracks| {
            let track = tracks.iter().next()?;
            let range = track.time_range();
            let size = track.natural_size();

            Some(TrackProbe {
                start: nanos(range.start),
                duration: nanos(range.duration),
                width: video.then_some(size.width as u32),
                height: video.then_some(size.height as u32),
                frame_rate: video.then(|| track.nominal_frame_rate()),
            })
        });
        // A failed send means the receiver timed out and moved on; the probe is
        // simply discarded rather than being an error in its own right.
        let _ = tx.send(probe);
    });

    rx.recv_timeout(LOAD_TIMEOUT).ok().flatten()
}

/// A `CMTime` in nanoseconds, clamped at zero.
///
/// An indefinite or negative time is reported as zero rather than wrapping
/// through `u64` — the caller's next step is arithmetic on a timeline, and a
/// nonsense offset there is far worse than a missing one.
fn nanos(time: cm::Time) -> u64 {
    if time.scale <= 0 || time.value < 0 {
        return 0;
    }
    let seconds = time.value as f64 / time.scale as f64;
    if !seconds.is_finite() || seconds <= 0.0 {
        return 0;
    }
    (seconds * 1_000_000_000.0) as u64
}
