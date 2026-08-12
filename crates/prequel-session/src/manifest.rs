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
}

/// A cursor position sampled during the recording.
///
/// Captured so a zoom-to-cursor editor is possible later without re-recording.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CursorSample {
    pub at: MediaTime,
    pub x: f64,
    pub y: f64,
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
                },
            ],
            cursor_baked: false,
            clicks: Vec::new(),
            typing: Vec::new(),
            cursor: vec![CursorSample {
                at: 0,
                x: 100.0,
                y: 200.0,
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
        names.sort_unstable();
        let count = names.len();
        names.dedup();
        assert_eq!(names.len(), count, "track file names must not collide");
    }
}
