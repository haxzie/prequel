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

/// How often a frame is read *for faces*, in nanoseconds.
///
/// Ten times as often as the text, and the two are separate because their costs
/// are nowhere near each other: an accurate text recognition is about 300 ms a
/// frame, a face rectangles request is about five. Measured over a 1920×1080
/// take, the face pass at this cadence costs a fifth more wall clock than at one
/// a second — which buys ten times the resolution in *time*, and time is the
/// whole of the accuracy here.
///
/// It matters because text and faces move differently. Text sits still except
/// when the page scrolls; a face in a video playing inside the recording moves
/// in every frame, and the cover between two samples is a straight line drawn
/// between where it was and where it went. At one sample a second that line is
/// a second long, and a person who leans or a page that scrolls leaves the
/// cover somewhere they are not — which is a reveal, and the one failure this
/// feature cannot have.
///
/// Not finer still: below about this the cost stops being flat — at 50 ms the
/// same take took nearly twice as long — and the gain is small against the
/// padding every face box already carries.
pub const DEFAULT_FACE_INTERVAL: MediaTime = 100_000_000;

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
    /// How often the text is read. See [`DEFAULT_INTERVAL`].
    pub interval: MediaTime,
    /// How often the faces are looked for. See [`DEFAULT_FACE_INTERVAL`].
    pub face_interval: MediaTime,
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
            face_interval: DEFAULT_FACE_INTERVAL,
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
    ///
    /// At the face cadence when faces were asked for, which is ten times the
    /// text's — so this is no longer one per text reading.
    pub sampled: u64,
    /// Requests actually made of Vision, counting a text reading and a look for
    /// faces separately. The gap between this and the samples each reader was
    /// due at is what the unchanged-frame skip saved.
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
    let face_interval = request.face_interval.max(1);
    // The loop walks at the finer of the two and reads each thing when it is
    // due. One tracker each, rather than one fed both: a tracker sweeps every
    // track it holds at every sample it is offered, so a text track offered
    // nothing at the nine face-only samples between its own would be counted as
    // missed nine times and closed before its next reading arrived.
    let step = if request.faces {
        face_interval.min(interval)
    } else {
        interval
    };
    let mut text_tracker = Tracker::new(interval);
    let mut face_tracker = Tracker::new(face_interval);
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

        // One cache each, keyed on the presentation time the reading came off.
        // Shared, the faces read at a sample where the text was not due would
        // stand in for the text at the next sample that needed it — and the
        // text would quietly stop being covered.
        let mut read_text: Option<(u64, Vec<Candidate>)> = None;
        let mut read_faces: Option<(u64, Vec<Candidate>)> = None;
        let mut at: MediaTime = 0;
        // When the text is next due. Faces are read at every step.
        let mut text_due: MediaTime = 0;

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
            // what is on it. Offered again at this instant rather than skipped,
            // so a track stays unbroken and its cover reaches the moment the
            // picture actually changes.
            if request.faces {
                let found = match &read_faces {
                    Some((seen, candidates)) if *seen == pts => candidates.clone(),
                    _ => {
                        let Some(frame) = frames.frame_at(at) else {
                            break;
                        };
                        let found: Vec<Candidate> = faces
                            .read(frame)?
                            .into_iter()
                            .filter_map(|face| {
                                prequel_sensitive::face(face.rect, face.confidence, request.salt)
                            })
                            .collect();
                        summary.read += 1;
                        found
                    }
                };

                face_tracker.offer(segment.start + at, &found);
                read_faces = Some((pts, found));
            }

            if request.text && at >= text_due {
                let found = match &read_text {
                    Some((seen, candidates)) if *seen == pts => candidates.clone(),
                    _ => {
                        let Some(frame) = frames.frame_at(at) else {
                            break;
                        };
                        let reading = text.read(frame)?;
                        summary.read += 1;
                        scan_frame(&reading.lines, &reading, request.salt)
                    }
                };

                text_tracker.offer(segment.start + at, &found);
                read_text = Some((pts, found));
                text_due = at.saturating_add(interval);
            }

            at = at.saturating_add(step);

            if total > 0 {
                report(((done + at.min(duration)) as f64 / total as f64) as f32);
            }
        }

        done += duration;
        summary.covered.push(segment.name.clone());
    }

    // Both, in one list sorted by when each was first seen — which is the order
    // `Tracker::finish` already puts its own in, and the order the panel reads.
    summary.tracks = text_tracker.finish();
    summary.tracks.extend(face_tracker.finish());
    summary.tracks.sort_by_key(Track::start);
    report(1.0);

    Ok(summary)
}
