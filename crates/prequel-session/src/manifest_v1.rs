//! Reading manifests written before a session could hold a second take.
//!
//! Frozen: the only reason this file exists is to open recordings written by a
//! build where a track was one file rather than a list of segments, so nothing
//! here follows a change to `manifest.rs`. Copied rather than shared because a
//! shared struct would mean every future field had to be optional in both
//! shapes at once, and the version gate exists precisely so it does not.

use serde::Deserialize;

use crate::clock::MediaTime;
use crate::manifest::{
    ClickSample, CursorSample, KeyPress, KeySpan, ManifestError, Matte, Segment, SourceInfo, Take,
    TrackKind, TypingSample,
};

#[derive(Debug, Deserialize)]
pub struct Track {
    pub kind: TrackKind,
    pub file_name: String,
    pub start: MediaTime,
    pub end: MediaTime,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    pub samples: u64,
    pub dropped: u64,
    #[serde(default)]
    pub matte: Option<Matte>,
}

#[derive(Debug, Deserialize)]
pub struct Manifest {
    pub id: String,
    pub started_at: String,
    pub duration: MediaTime,
    pub source: SourceInfo,
    pub tracks: Vec<Track>,
    #[serde(default = "baked_by_default")]
    pub cursor_baked: bool,
    #[serde(default)]
    pub cursor: Vec<CursorSample>,
    #[serde(default)]
    pub clicks: Vec<ClickSample>,
    #[serde(default)]
    pub typing: Vec<TypingSample>,
    #[serde(default)]
    pub keys: Vec<KeySpan>,
    #[serde(default)]
    pub key_presses: Vec<KeyPress>,
}

fn baked_by_default() -> bool {
    true
}

impl Manifest {
    pub fn from_json(text: &str) -> Result<Self, ManifestError> {
        Ok(serde_json::from_str(text)?)
    }

    /// The same recording, in the current shape.
    ///
    /// Held in memory and never written back: a build that rewrote a v1
    /// recording as v2 for having looked at it would make that recording
    /// unopenable by the build the user is about to roll back to, for no reason
    /// at all.
    pub fn upgrade(self) -> crate::manifest::Manifest {
        let duration = self.duration;
        crate::manifest::Manifest {
            version: crate::manifest::MANIFEST_VERSION,
            id: self.id,
            started_at: self.started_at,
            duration,
            source: self.source,
            tracks: self
                .tracks
                .into_iter()
                .map(|track| crate::manifest::Track {
                    kind: track.kind,
                    segments: vec![Segment {
                        file_name: track.file_name,
                        start: track.start,
                        end: track.end,
                        width: track.width,
                        height: track.height,
                        samples: track.samples,
                        dropped: track.dropped,
                        matte: track.matte,
                    }],
                })
                .collect(),
            // One take, spanning the whole recording, with its files at the
            // session root — which is where a v1 recording keeps them.
            takes: vec![Take {
                dir: String::new(),
                start: 0,
                end: duration,
            }],
            cursor_baked: self.cursor_baked,
            cursor: self.cursor,
            clicks: self.clicks,
            typing: self.typing,
            keys: self.keys,
            key_presses: self.key_presses,
        }
    }
}
