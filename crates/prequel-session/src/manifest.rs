//! The manifest that makes separately-recorded tracks reassemblable.
//!
//! Tracks are written as independent files so the webcam bubble can be moved,
//! resized and reshaped after the fact. That only works if something records
//! how they line up — this is that something.

use serde::{Deserialize, Serialize};

use crate::clock::MediaTime;

/// Bumped whenever the shape changes incompatibly, so an old recording opened
/// by a newer build fails loudly instead of exporting something wrong.
pub const MANIFEST_VERSION: u32 = 1;

pub const MANIFEST_FILE_NAME: &str = "session.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackKind {
    Screen,
    Camera,
    Microphone,
    SystemAudio,
}

impl TrackKind {
    /// Conventional file name for this track inside a session directory.
    pub fn file_name(self) -> &'static str {
        match self {
            Self::Screen => "screen.mp4",
            Self::Camera => "camera.mp4",
            Self::Microphone => "mic.m4a",
            Self::SystemAudio => "system.m4a",
        }
    }

    pub fn is_video(self) -> bool {
        matches!(self, Self::Screen | Self::Camera)
    }
}

/// File name of the camera's person matte inside a session directory.
///
/// A sidecar of the camera track rather than a `TrackKind` of its own:
/// kinds are enumerated by the timeline's lanes, the audio mixer, the probe
/// and the export offsets, and every one of them would have to learn to skip
/// it. The matte is written at the camera's own timestamps, so it has nothing
/// to say about alignment that the camera track does not already say.
pub const CAMERA_MATTE_FILE: &str = "camera-matte.mp4";

/// The person matte recorded beside a camera track.
///
/// One grayscale frame per camera frame, luma being alpha, at whatever size
/// the segmentation model produces — nothing lays out against `width` and
/// `height`; both rasterisers sample it with the picture's normalised
/// coordinates, so a size mismatch costs nothing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Matte {
    pub file_name: String,
    pub width: u32,
    pub height: u32,
    pub samples: u64,
    /// Frames the camera has that the matte does not: skipped because the
    /// segmenter was still busy, or refused by the encoder. The previous mask
    /// stands in for each, so a small count is invisible.
    pub dropped: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Track {
    pub kind: TrackKind,
    pub file_name: String,
    /// Media time of this track's first sample. Non-zero when a device took
    /// longer to warm up than the one that anchored the clock.
    pub start: MediaTime,
    /// Media time just past this track's last sample.
    pub end: MediaTime,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    pub samples: u64,
    /// Samples the timing guard rejected. A non-zero count is not a failure,
    /// but a large one points at a struggling capture pipeline.
    pub dropped: u64,
    /// Only ever set on the camera track. Defaulted so a manifest written
    /// before the matte existed still parses — as a camera with no matte,
    /// which is what it recorded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matte: Option<Matte>,
}

impl Track {
    pub fn duration(&self) -> MediaTime {
        self.end.saturating_sub(self.start)
    }
}

/// What was on screen, recorded so an editor can reason about the source later.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SourceInfo {
    /// `"display"` or `"window"`.
    pub kind: String,
    pub id: u32,
    pub title: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub app_name: String,
    pub scale_factor: f64,
    /// A recorded window's own corner radius, in pixels of the screen track.
    ///
    /// The capture leaves the window's rounded corners transparent and the
    /// 4:2:0 file turns them black, so the editor needs to round the picture
    /// at least this much or the wedge shows. Measured off the window at
    /// record time — see `prequel-capture`'s `corner.rs` — and absent for a
    /// display, for a window it could not be read from, and on every
    /// recording made before it was measured. Absent means "not known", never
    /// "square": a reader falls back to its default rather than to zero.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub corner_radius: Option<f64>,
}

/// A cursor position sampled during the recording.
///
/// Captured so a zoom-to-cursor editor is possible later without re-recording.
// Not `Copy` any more: the kind is a string, and one owned string per sample is
// still far cheaper than the enum being repeated in two crates' vocabularies.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CursorSample {
    pub at: MediaTime,
    pub x: f64,
    pub y: f64,
    /// Which pointer the system was showing — `arrow`, `hand`, `text`,
    /// `resize-h` or `resize-v`.
    ///
    /// Skipped when it is the arrow, which keeps a manifest the size it was:
    /// the pointer is an arrow for nearly all of a recording, and writing
    /// `"kind":"arrow"` beside every one of tens of thousands of samples is pure
    /// file size.
    ///
    /// This replaced a `hand` boolean. Recordings made before it still carry
    /// that field and are still read correctly — `shared/layout.ts` falls back
    /// to it where there is no `kind`, which is the only place either is read.
    /// Nothing here has to know that, because nothing in Rust reads a manifest
    /// back: this crate writes them and the editor reads them.
    #[serde(default, skip_serializing_if = "str::is_empty")]
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Manifest {
    pub version: u32,
    pub id: String,
    /// Wall-clock start, ISO 8601. For display only — never for synchronisation.
    pub started_at: String,
    /// Recording length with paused spans already removed.
    pub duration: MediaTime,
    pub source: SourceInfo,
    pub tracks: Vec<Track>,
    /// Whether ScreenCaptureKit drew the pointer into the frames.
    ///
    /// When it did, the pointer is part of the picture and cannot be removed;
    /// when it did not, `cursor` is the only record of where it was and an
    /// editor draws it as a layer. Getting this the wrong way round shows as
    /// two pointers in the export, so it is recorded rather than assumed.
    ///
    /// Defaults to true, which is what every recording written before the
    /// pointer became a layer did. Those recordings also hold `cursor`
    /// positions in raw display points rather than fractions — inert, because
    /// a baked pointer is never drawn from the track.
    #[serde(default = "baked_by_default")]
    pub cursor_baked: bool,
    /// Pointer positions, as fractions of the captured frame.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cursor: Vec<CursorSample>,
    /// Where the pointer was pressed, as fractions of the captured frame.
    ///
    /// Buttons only — never which one beyond left or right, and never a key.
    /// The editor builds its automatic zooms from these: a click says what
    /// mattered and when far more clearly than where the pointer travelled.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub clicks: Vec<ClickSample>,
    /// Where text was being typed, as fractions of the captured frame.
    ///
    /// Empty unless the Accessibility grant was given, and empty for every
    /// recording made before it was asked for. Not keystrokes: only the bounds
    /// of the field that had keyboard focus.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub typing: Vec<TypingSample>,
    /// Stretches of the recording somebody was typing through.
    ///
    /// The one thing here that comes from the keyboard, and it is deliberately
    /// the least that could be useful: when typing started and when it stopped,
    /// rounded to a tenth of a second, with runs of fewer than three presses
    /// left out entirely. No key code, no modifiers, no count, and nothing fine
    /// enough to read the timing between presses back out of — which is itself
    /// enough to narrow down what was typed. The editor hides the pointer
    /// through these, and that is all they are for.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub keys: Vec<KeySpan>,
}

/// A stretch somebody was typing through. See `Manifest::keys`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct KeySpan {
    pub start: MediaTime,
    pub end: MediaTime,
}

/// A press, sampled during the recording.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ClickSample {
    pub at: MediaTime,
    pub x: f64,
    pub y: f64,
}

/// A focused text area, sampled during the recording.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct TypingSample {
    pub at: MediaTime,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn baked_by_default() -> bool {
    true
}

#[derive(Debug, thiserror::Error)]
pub enum ManifestError {
    #[error("manifest is version {found}, this build understands {expected}")]
    UnsupportedVersion { found: u32, expected: u32 },
    #[error("manifest is not valid JSON: {0}")]
    Json(#[from] serde_json::Error),
}

impl Manifest {
    pub fn to_json(&self) -> Result<String, ManifestError> {
        Ok(serde_json::to_string_pretty(self)?)
    }

    pub fn from_json(text: &str) -> Result<Self, ManifestError> {
        let manifest: Self = serde_json::from_str(text)?;
        if manifest.version != MANIFEST_VERSION {
            return Err(ManifestError::UnsupportedVersion {
                found: manifest.version,
                expected: MANIFEST_VERSION,
            });
        }
        Ok(manifest)
    }

    pub fn track(&self, kind: TrackKind) -> Option<&Track> {
        self.tracks.iter().find(|t| t.kind == kind)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: MediaTime = 1_000_000_000;

    fn sample_manifest() -> Manifest {
        Manifest {
            version: MANIFEST_VERSION,
            id: "2026-08-10T21-30-00".to_owned(),
            started_at: "2026-08-10T21:30:00Z".to_owned(),
            duration: 10 * S,
            source: SourceInfo {
                kind: "display".to_owned(),
                id: 1,
                title: "Display 3456×2234".to_owned(),
                app_name: String::new(),
                scale_factor: 2.0,
                corner_radius: None,
            },
            tracks: vec![
                Track {
                    kind: TrackKind::Screen,
                    file_name: TrackKind::Screen.file_name().to_owned(),
                    start: 0,
                    end: 10 * S,
                    width: Some(3456),
                    height: Some(2234),
                    samples: 600,
                    dropped: 0,
                    matte: None,
                },
                Track {
                    kind: TrackKind::Camera,
                    file_name: TrackKind::Camera.file_name().to_owned(),
                    start: 200_000_000,
                    end: 10 * S,
                    width: Some(1280),
                    height: Some(720),
                    samples: 294,
                    dropped: 0,
                    matte: Some(Matte {
                        file_name: CAMERA_MATTE_FILE.to_owned(),
                        width: 512,
                        height: 288,
                        samples: 290,
                        dropped: 4,
                    }),
                },
                Track {
                    kind: TrackKind::Microphone,
                    file_name: TrackKind::Microphone.file_name().to_owned(),
                    // The mic took 120 ms longer to open than the screen.
                    start: 120_000_000,
                    end: 10 * S,
                    width: None,
                    height: None,
                    samples: 470,
                    dropped: 2,
                    matte: None,
                },
            ],
            cursor_baked: false,
            clicks: Vec::new(),
            keys: Vec::new(),
            typing: Vec::new(),
            cursor: vec![CursorSample {
                at: 0,
                x: 100.0,
                y: 200.0,
                kind: String::new(),
            }],
        }
    }

    #[test]
    fn round_trips_through_json() {
        let manifest = sample_manifest();
        let parsed = Manifest::from_json(&manifest.to_json().unwrap()).unwrap();
        assert_eq!(parsed, manifest);
    }

    #[test]
    fn preserves_per_track_start_offsets() {
        // The whole point of the manifest: a track that started late must not
        // silently be treated as starting at zero.
        let parsed = Manifest::from_json(&sample_manifest().to_json().unwrap()).unwrap();
        let mic = parsed.track(TrackKind::Microphone).unwrap();

        assert_eq!(mic.start, 120_000_000);
        assert_eq!(mic.duration(), 10 * S - 120_000_000);
    }

    #[test]
    fn rejects_a_manifest_from_an_incompatible_version() {
        let mut manifest = sample_manifest();
        manifest.version = MANIFEST_VERSION + 1;

        let err = Manifest::from_json(&manifest.to_json().unwrap()).unwrap_err();
        assert!(matches!(err, ManifestError::UnsupportedVersion { .. }));
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(matches!(
            Manifest::from_json("{not json").unwrap_err(),
            ManifestError::Json(_)
        ));
    }

    #[test]
    fn omits_empty_optional_fields() {
        let json = sample_manifest().to_json().unwrap();
        // An audio track has no dimensions; they must not serialise as null.
        assert!(!json.contains("\"width\": null"));
        assert!(!json.contains("\"app_name\": \"\""));
        // The matte belongs to the camera alone; the other tracks must not
        // carry a null for it.
        assert_eq!(json.matches("\"matte\"").count(), 1);
    }

    #[test]
    fn a_track_without_a_matte_is_read_as_having_none() {
        // Every recording written before the matte existed has a camera track
        // with no such key. It has to open as a camera with no matte, not
        // fail to open.
        let mut value: serde_json::Value =
            serde_json::from_str(&sample_manifest().to_json().unwrap()).unwrap();
        for track in value["tracks"].as_array_mut().unwrap() {
            track.as_object_mut().unwrap().remove("matte");
        }

        let parsed = Manifest::from_json(&value.to_string()).unwrap();
        assert!(parsed.tracks.iter().all(|track| track.matte.is_none()));
    }

    #[test]
    fn cursor_samples_are_optional_when_reading() {
        let mut manifest = sample_manifest();
        manifest.cursor.clear();

        let json = manifest.to_json().unwrap();
        // The flag still goes out — "no samples" and "the pointer is baked in"
        // are different facts, and only one of them is optional.
        assert!(!json.contains("\"cursor\":"));
        assert!(json.contains("cursor_baked"));
        assert_eq!(Manifest::from_json(&json).unwrap().cursor, vec![]);
    }

    #[test]
    fn a_manifest_without_the_flag_is_read_as_baked() {
        // Every recording written before the pointer became a layer had it
        // drawn into the frames. Defaulting the other way would put a second
        // pointer in the export of every one of them.
        let mut value: serde_json::Value =
            serde_json::from_str(&sample_manifest().to_json().unwrap()).unwrap();
        value.as_object_mut().unwrap().remove("cursor_baked");

        let parsed = Manifest::from_json(&value.to_string()).unwrap();
        assert!(parsed.cursor_baked);
    }

    #[test]
    fn track_file_names_are_distinct() {
        let kinds = [
            TrackKind::Screen,
            TrackKind::Camera,
            TrackKind::Microphone,
            TrackKind::SystemAudio,
        ];
        let mut names: Vec<_> = kinds.iter().map(|k| k.file_name()).collect();
        names.push(CAMERA_MATTE_FILE);
        names.sort_unstable();
        let count = names.len();
        names.dedup();
        assert_eq!(names.len(), count, "track file names must not collide");
    }
}
