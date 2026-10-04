//! Walking a recording's segments and offering what is read to the tracker.

use std::path::PathBuf;

use prequel_render::reader::VideoReader;
use prequel_sensitive::track::{Track, Tracker};
use prequel_sensitive::{Candidate, scan_frame};
use prequel_session::MediaTime;

use crate::reader::{FaceReader, TextReader, VisionFaceReader, VisionTextReader};
use crate::{CancelFlag, Error, Result};

/// How often a frame is read, in nanoseconds.
///
/// A second, and it is the budget for the whole pass rather than a sampling
/// theorem: a read costs a few hundred milliseconds, so this number times the
/// length of the take is roughly how long a scan runs for. Finer would find
/// text that flashed past, at a cost paid on every recording; coarser starts to
/// miss a scroll.
pub const DEFAULT_INTERVAL: MediaTime = 1_000_000_000;

/// One file to read, and where it sits on the session clock.
#[derive(Debug, Clone)]
pub struct ScanSegment {
    pub path: PathBuf,
    /// The manifest's `file_name`, carried through so the artefact can record
    /// which segments were covered and a later scan can skip them.
    pub name: String,
    /// Session time of this file's first sample. The file itself starts at zero.
    pub start: MediaTime,
    /// Session time just past this file's last sample.
    pub end: MediaTime,
}

impl ScanSegment {
    fn duration(&self) -> MediaTime {
        self.end.saturating_sub(self.start)
    }
}

#[derive(Debug, Clone)]
pub struct ScanRequest {
    pub segments: Vec<ScanSegment>,
    pub interval: MediaTime,
    /// BCP-47 tags, most preferred first. Empty leaves Vision's own default.
    pub langs: Vec<String>,
    /// Per-recording, so the same card in two recordings does not produce the
    /// same bucket. See `prequel_sensitive::bucket`.
    pub salt: u64,
    /// Whether to read the text at all.
    ///
    /// A recording of somebody talking over a slide has nothing to read and a
    /// face in every frame; turning this off is the difference between a scan
    /// that costs a read per sample and one that costs a tenth of that.
    pub text: bool,
    /// Whether to look for faces.
    pub faces: bool,
}

impl ScanRequest {
    pub fn new(segments: Vec<ScanSegment>, salt: u64) -> Self {
        Self {
            segments,
            interval: DEFAULT_INTERVAL,
            langs: Vec::new(),
            salt,
            text: true,
            faces: false,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ScanSummary {
    pub tracks: Vec<Track>,
    /// Samples taken, including the ones that reused an unchanged frame.
    pub sampled: u64,
    /// Frames actually handed to Vision. The gap between this and `sampled` is
    /// what the unchanged-frame skip saved.
    pub read: u64,
    /// Segment names that were read all the way through. A segment that failed
    /// is left out so the next scan retries it rather than treating an empty
    /// result as "nothing sensitive here".
    pub covered: Vec<String>,
}

/// Scans a recording with Apple's Vision.
pub fn scan(
    request: &ScanRequest,
    cancel: &CancelFlag,
    report: &mut impl FnMut(f32),
) -> Result<ScanSummary> {
    let mut text = VisionTextReader::new(&request.langs);
    let mut faces = VisionFaceReader::new();
    scan_with(request, &mut text, &mut faces, cancel, report)
}

/// The same, against any [`TextReader`] — which is how the loop is tested
/// without decoding a video or calling a framework.
pub fn scan_with(
    request: &ScanRequest,
    text: &mut impl TextReader,
    faces: &mut impl FaceReader,
    cancel: &CancelFlag,
    report: &mut impl FnMut(f32),
) -> Result<ScanSummary> {
    let interval = request.interval.max(1);
    let mut tracker = Tracker::new(interval);
    let mut summary = ScanSummary::default();

    // Progress is weighted by how much of the recording each segment is, the
    // way `startTranscribe` weights its own: a short tail segment must not
    // advance the bar as far as a long first one.
    let total: MediaTime = request.segments.iter().map(ScanSegment::duration).sum();
    let mut done: MediaTime = 0;

    for segment in &request.segments {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }

        let duration = segment.duration();
        // The reader is opened over the *file's* timeline, which starts at
        // zero. `segment.start` is where that zero sits on the session clock
        // and is added below, once.
        let mut frames =
            VideoReader::open(&segment.path, 0, duration).map_err(|e| Error::Open {
                path: segment.path.display().to_string(),
                reason: format!("{e:?}"),
            })?;

        let mut previous: Option<(u64, Vec<Candidate>)> = None;
        let mut at: MediaTime = 0;

        // Bounded by the segment's duration, not by whether a frame came back.
        // `frame_at` repeats the last frame for ever, so the other bound never
        // ends — and every sample past the end would put that frame's findings
        // somewhere nothing was on screen.
        while at < duration {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }

            // Advanced first, then asked what it is holding. Two calls rather
            // than one because `frame_at` hands back a borrow of the reader
            // that cannot be held across the `current_pts` ask — and it is
            // idempotent at the same instant, so the second call below only
            // re-borrows what this one already decoded.
            if frames.frame_at(at).is_none() {
                break;
            }
            let pts = frames.current_pts().unwrap_or(at);
            summary.sampled += 1;

            // The picture has not changed since the last sample, so neither has
            // its text. Offered again at this instant rather than skipped, so a
            // track stays unbroken and its cover reaches the moment the picture
            // actually changes.
            let unchanged = match &previous {
                Some((seen, candidates)) if *seen == pts => Some(candidates.clone()),
                _ => None,
            };

            let candidates = match unchanged {
                Some(candidates) => candidates,
                None => {
                    let Some(frame) = frames.frame_at(at) else {
                        break;
                    };

                    let mut found = Vec::new();

                    if request.text {
                        let reading = text.read(frame)?;
                        found.extend(scan_frame(&reading.lines, &reading, request.salt));
                    }

                    if request.faces {
                        // After the text, so a face box that happens to overlap
                        // a line does not take the line's place in the list.
                        // Both are kept: they are covering different things and
                        // a reader dismissing one should not lose the other.
                        found.extend(faces.read(frame)?.into_iter().filter_map(|face| {
                            prequel_sensitive::face(face.rect, face.confidence, request.salt)
                        }));
                    }

                    summary.read += 1;
                    found
                }
            };

            tracker.offer(segment.start + at, &candidates);
            previous = Some((pts, candidates));

            at = at.saturating_add(interval);

            if total > 0 {
                report(((done + at.min(duration)) as f64 / total as f64) as f32);
            }
        }

        done += duration;
        summary.covered.push(segment.name.clone());
    }

    summary.tracks = tracker.finish();
    report(1.0);

    Ok(summary)
}
