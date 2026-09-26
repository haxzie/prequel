//! The manifest that makes separately-recorded tracks reassemblable.
//!
//! Tracks are written as independent files so the webcam bubble can be moved,
//! resized and reshaped after the fact. That only works if something records
//! how they line up — this is that something.

use serde::{Deserialize, Serialize};

use crate::clock::MediaTime;

/// Bumped whenever the shape changes incompatibly, so an old recording opened
/// by a newer build fails loudly instead of exporting something wrong.
///
/// 2 turned a track into a list of segments laid end to end on one session
/// clock, because a recording can be extended with a second take. A v1
/// manifest still opens — `manifest_v1` reads it and its single file becomes a
/// one-segment list.
pub const MANIFEST_VERSION: u32 = 2;

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

/// One take's worth of one track: a file, and where it sits on the session
/// clock.
///
/// The per-file `start` is what keeps a late device honest across takes — take
/// two's camera opens a couple of hundred milliseconds after take two's
/// screen, exactly as take one's did, and both facts live here rather than
/// being inferred from the take's own start. The file itself is always
/// zero-based; see `prequel-encode`'s `probe.rs`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Segment {
    /// Relative to the session directory: `"screen.mp4"` for the first take,
    /// `"2/screen.mp4"` for the second. A path rather than a bare name because
    /// each take is captured into its own subdirectory, under the fixed names
    /// the capture crates write.
    pub file_name: String,
    /// Media time of this file's first sample, on the session clock.
    pub start: MediaTime,
    /// Media time just past this file's last sample.
    pub end: MediaTime,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    pub samples: u64,
    /// Samples the timing guard rejected. A non-zero count is not a failure,
    /// but a large one points at a struggling capture pipeline.
    pub dropped: u64,
    /// Only ever set on a camera segment. Defaulted so a manifest written
    /// before the matte existed still parses — as a camera with no matte,
    /// which is what it recorded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matte: Option<Matte>,
}

impl Segment {
    pub fn duration(&self) -> MediaTime {
        self.end.saturating_sub(self.start)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Track {
    pub kind: TrackKind,
    /// In session-clock order, never empty, never overlapping. One entry per
    /// take that recorded this kind — a take with the microphone switched off
    /// simply contributes none.
    pub segments: Vec<Segment>,
}

impl Track {
    /// Media time of the track's first sample, across every take.
    pub fn start(&self) -> MediaTime {
        self.segments.first().map_or(0, |segment| segment.start)
    }

    /// Media time just past the track's last sample, across every take.
    pub fn end(&self) -> MediaTime {
        self.segments.last().map_or(0, |segment| segment.end)
    }

    pub fn duration(&self) -> MediaTime {
        self.end().saturating_sub(self.start())
    }

    /// The segment covering a moment on the session clock, if any.
    ///
    /// Half-open, so a seam belongs to the later take — which is what makes
    /// the join land on a frame rather than between two takes.
    pub fn segment_at(&self, at: MediaTime) -> Option<&Segment> {
        self.segments
            .iter()
            .find(|segment| at >= segment.start && at < segment.end)
    }
}

/// One recording session inside this project. The seam list, and nothing else.
///
/// Explicit rather than derived from a track's segment boundaries, because
/// those disagree per track by however long each device took to open: take
/// two's camera starts later than take two's screen. A slice may not span a
/// seam, and if "where is the seam" has two answers the per-slice segment
/// lookup silently reads the wrong take's file for the first frames of a clip.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Take {
    /// Subdirectory the take's files are in, relative to the session
    /// directory. Empty for the first take, whose files sit at the root.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub dir: String,
    pub start: MediaTime,
    pub end: MediaTime,
    /// A video brought in from outside rather than recorded here.
    ///
    /// Never written by a capture — the import writes it, in TypeScript, and
    /// the merge carries it across. Mirrored here so a manifest that survives a
    /// round trip through this struct keeps it: dropped, an imported take's
    /// sound would silently stop being transcribed.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub imported: bool,
}

impl Take {
    pub fn duration(&self) -> MediaTime {
        self.end.saturating_sub(self.start)
    }
}

/// A rectangle in the display's own points. See `SourceInfo::crop`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Region {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
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
    /// The region an area capture was cropped to, in the display's points.
    ///
    /// Recorded so a second take of the same area can reproduce the framing.
    /// Before this the crop was applied at capture and never written down,
    /// which made "record more of the same region" impossible to offer.
    /// Absent for a display, for a window, and for every recording made
    /// before it was written.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crop: Option<Region>,
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
    /// The first take's. Nothing reads it per moment — the editor turns it
    /// into project defaults once, when the project is created — and a second
    /// take of a different display would describe itself differently.
    pub source: SourceInfo,
    pub tracks: Vec<Track>,
    /// Every recording that went into this session, in clock order. Never
    /// empty. Laid end to end, so a take begins exactly where the last ended.
    #[serde(default)]
    pub takes: Vec<Take>,
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
    /// The coarse record of the keyboard, and the one that is always kept: when
    /// typing started and when it stopped, rounded to a tenth of a second, with
    /// runs of fewer than three presses left out entirely. No key code, no
    /// modifiers, no count. The editor hides the pointer through these, and
    /// they are still what it uses for that even when `key_presses` is there,
    /// so a recording made with presses switched off behaves the same.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub keys: Vec<KeySpan>,
    /// The moment of each key press, and roughly what kind of key it was.
    ///
    /// What the editor's typing sounds are made from: a sound has to land on
    /// the press it belongs to, and a span rounded to a tenth of a second
    /// cannot place one. Each entry is a time and one of five classes — see
    /// `KeyClass` — and nothing else. Never a key code, never a character, and
    /// never the release: how long a key was held is as personal as a
    /// signature, and no sound needs it.
    ///
    /// Empty when the switch in Settings is off, and for every recording made
    /// before it existed. Absent means "not recorded", not "nobody typed".
    /// Passwords are absent regardless: macOS withholds keyboard events from
    /// every event tap while a secure text field has focus.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub key_presses: Vec<KeyPress>,
}

/// A stretch somebody was typing through. See `Manifest::keys`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct KeySpan {
    pub start: MediaTime,
    pub end: MediaTime,
}

/// The kind of key a press was, as coarsely as a sound needs.
///
/// Five classes and no more, chosen by what sounds different on a real board:
/// the space bar, Return and Delete sit on stabilisers and sound bigger than a
/// letter; a modifier is pressed softer and held. Tab, arrows, digits and
/// punctuation are all `Letter` — telling them apart would say more about what
/// was typed than any sound could use.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KeyClass {
    Letter,
    Space,
    Enter,
    Backspace,
    Modifier,
}

impl KeyClass {
    pub const ALL: [KeyClass; 5] = [
        KeyClass::Letter,
        KeyClass::Space,
        KeyClass::Enter,
        KeyClass::Backspace,
        KeyClass::Modifier,
    ];

    /// The manifest spelling — what `serde` writes, and what the editor reads.
    pub fn as_str(self) -> &'static str {
        match self {
            KeyClass::Letter => "letter",
            KeyClass::Space => "space",
            KeyClass::Enter => "enter",
            KeyClass::Backspace => "backspace",
            KeyClass::Modifier => "modifier",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|class| class.as_str() == value)
    }
}

/// One key press: when, and which class of key. See `Manifest::key_presses`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct KeyPress {
    pub at: MediaTime,
    pub class: KeyClass,
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
        #[derive(Deserialize)]
        struct VersionOnly {
            version: u32,
        }

        match serde_json::from_str::<VersionOnly>(text)?.version {
            MANIFEST_VERSION => Ok(serde_json::from_str(text)?),
            // Every recording made before a session could hold a second take.
            // Its one file per track is one segment, which is exactly what v2
            // reduces to for a single take — so this is a shape change and
            // never a reinterpretation of what was recorded.
            1 => Ok(crate::manifest_v1::Manifest::from_json(text)?.upgrade()),
            found => Err(ManifestError::UnsupportedVersion {
                found,
                expected: MANIFEST_VERSION,
            }),
        }
    }

    pub fn track(&self, kind: TrackKind) -> Option<&Track> {
        self.tracks.iter().find(|t| t.kind == kind)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: MediaTime = 1_000_000_000;

    fn segment(
        kind: TrackKind,
        start: MediaTime,
        end: MediaTime,
        size: Option<(u32, u32)>,
        samples: u64,
    ) -> Segment {
        Segment {
            file_name: kind.file_name().to_owned(),
            start,
            end,
            width: size.map(|(w, _)| w),
            height: size.map(|(_, h)| h),
            samples,
            dropped: 0,
            matte: None,
        }
    }

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
                crop: None,
            },
            tracks: vec![
                Track {
                    kind: TrackKind::Screen,
                    segments: vec![segment(TrackKind::Screen, 0, 10 * S, Some((3456, 2234)), 600)],
                },
                Track {
                    kind: TrackKind::Camera,
                    segments: vec![Segment {
                        matte: Some(Matte {
                            file_name: CAMERA_MATTE_FILE.to_owned(),
                            width: 512,
                            height: 288,
                            samples: 290,
                            dropped: 4,
                        }),
                        ..segment(TrackKind::Camera, 200_000_000, 10 * S, Some((1280, 720)), 294)
                    }],
                },
                Track {
                    kind: TrackKind::Microphone,
                    segments: vec![Segment {
                        dropped: 2,
                        // The mic took 120 ms longer to open than the screen.
                        ..segment(TrackKind::Microphone, 120_000_000, 10 * S, None, 470)
                    }],
                },
            ],
            takes: vec![Take {
                dir: String::new(),
                start: 0,
                end: 10 * S,
                imported: false,
            }],
            cursor_baked: false,
            clicks: Vec::new(),
            keys: Vec::new(),
            key_presses: Vec::new(),
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

        assert_eq!(mic.start(), 120_000_000);
        assert_eq!(mic.duration(), 10 * S - 120_000_000);
    }

    #[test]
    fn rejects_a_manifest_from_an_incompatible_version() {
        for version in [0, MANIFEST_VERSION + 1] {
            let mut manifest = sample_manifest();
            manifest.version = version;

            let err = Manifest::from_json(&manifest.to_json().unwrap()).unwrap_err();
            assert!(matches!(err, ManifestError::UnsupportedVersion { .. }));
        }
    }

    #[test]
    fn reads_a_version_one_manifest_as_one_segment_per_track() {
        // Every recording in anybody's library. Its one file per track becomes
        // a one-segment list, and the whole of it becomes one take — so a v2
        // reader needs no special case for a recording made before takes
        // existed.
        let v1 = serde_json::json!({
            "version": 1,
            "id": "Prequel 2026-08-10",
            "started_at": "2026-08-10T21:30:00Z",
            "duration": 10 * S,
            "source": { "kind": "display", "id": 1, "title": "Display", "scale_factor": 2.0 },
            "tracks": [
                {
                    "kind": "screen",
                    "file_name": "screen.mp4",
                    "start": 0,
                    "end": 10 * S,
                    "width": 3456,
                    "height": 2234,
                    "samples": 600,
                    "dropped": 0
                },
                {
                    "kind": "microphone",
                    "file_name": "mic.m4a",
                    "start": 120_000_000,
                    "end": 10 * S,
                    "samples": 470,
                    "dropped": 2
                }
            ],
            "cursor": [{ "at": 0, "x": 0.5, "y": 0.5 }],
        });

        let parsed = Manifest::from_json(&v1.to_string()).unwrap();

        assert_eq!(parsed.version, MANIFEST_VERSION);
        assert_eq!(
            parsed.takes,
            vec![Take {
                dir: String::new(),
                start: 0,
                end: 10 * S,
                imported: false,
            }]
        );
        let screen = parsed.track(TrackKind::Screen).unwrap();
        assert_eq!(screen.segments.len(), 1);
        assert_eq!(screen.segments[0].file_name, "screen.mp4");
        assert_eq!(screen.segments[0].width, Some(3456));
        // The late mic survives the upgrade; losing it would slide every word
        // of the recording 120 ms early.
        assert_eq!(parsed.track(TrackKind::Microphone).unwrap().start(), 120_000_000);
        assert_eq!(parsed.cursor.len(), 1);
        // No flag in a v1 manifest means the pointer was drawn into the frames.
        assert!(parsed.cursor_baked);
    }

    #[test]
    fn a_track_reports_the_span_of_its_segments() {
        // Take two's camera opens later than take two's screen, exactly as
        // take one's did. The track's span is the first segment's start to the
        // last segment's end, never the take's.
        let track = Track {
            kind: TrackKind::Camera,
            segments: vec![
                segment(TrackKind::Camera, 200_000_000, 10 * S, Some((1280, 720)), 294),
                Segment {
                    file_name: "2/camera.mp4".to_owned(),
                    ..segment(
                        TrackKind::Camera,
                        10 * S + 180_000_000,
                        16 * S,
                        Some((1920, 1080)),
                        340,
                    )
                },
            ],
        };

        assert_eq!(track.start(), 200_000_000);
        assert_eq!(track.end(), 16 * S);
        assert_eq!(track.duration(), 16 * S - 200_000_000);
    }

    #[test]
    fn segment_at_a_seam_belongs_to_the_later_take() {
        // Half-open, so the join lands on a frame. Were the seam to belong to
        // the earlier take, the first frame of the new footage would come from
        // the old file.
        let track = Track {
            kind: TrackKind::Screen,
            segments: vec![
                segment(TrackKind::Screen, 0, 10 * S, Some((1920, 1080)), 600),
                Segment {
                    file_name: "2/screen.mp4".to_owned(),
                    ..segment(TrackKind::Screen, 10 * S, 16 * S, Some((1280, 720)), 360)
                },
            ],
        };

        assert_eq!(track.segment_at(10 * S - 1).unwrap().file_name, "screen.mp4");
        assert_eq!(track.segment_at(10 * S).unwrap().file_name, "2/screen.mp4");
        assert_eq!(track.segment_at(16 * S), None);
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
        // Nothing typed, nothing recorded: an empty list would read as "the
        // switch was on and nobody typed", which is not what happened.
        assert!(!json.contains("key_presses"));
    }

    #[test]
    fn a_key_press_carries_a_moment_and_a_class_and_nothing_else() {
        let press = KeyPress {
            at: 1_500_000_000,
            class: KeyClass::Space,
        };
        let json = serde_json::to_string(&press).unwrap();
        assert_eq!(json, r#"{"at":1500000000,"class":"space"}"#);
        assert_eq!(serde_json::from_str::<KeyPress>(&json).unwrap(), press);
        for class in KeyClass::ALL {
            assert_eq!(KeyClass::parse(class.as_str()), Some(class));
        }
        assert_eq!(KeyClass::parse("keycode"), None);
    }

    #[test]
    fn a_track_without_a_matte_is_read_as_having_none() {
        // Every recording written before the matte existed has a camera track
        // with no such key. It has to open as a camera with no matte, not
        // fail to open.
        let mut value: serde_json::Value =
            serde_json::from_str(&sample_manifest().to_json().unwrap()).unwrap();
        for track in value["tracks"].as_array_mut().unwrap() {
            for segment in track["segments"].as_array_mut().unwrap() {
                segment.as_object_mut().unwrap().remove("matte");
            }
        }

        let parsed = Manifest::from_json(&value.to_string()).unwrap();
        assert!(
            parsed
                .tracks
                .iter()
                .flat_map(|track| &track.segments)
                .all(|segment| segment.matte.is_none())
        );
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
