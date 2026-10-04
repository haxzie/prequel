//! Walking a recording's segments and offering what is read to the tracker.

use std::path::PathBuf;

use cidre::cv;
use prequel_render::reader::VideoReader;
use prequel_sensitive::track::{Track, Tracker};
use prequel_sensitive::{Candidate, NormRect, scan_frame};
use prequel_session::MediaTime;

use crate::reader::{Face, FaceReader, TextReader, VisionFaceReader, VisionTextReader};
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

/// How often the whole frame is swept for faces nobody is following yet, in
/// nanoseconds.
///
/// Once a second. A sweep is many requests where following is one, so this is
/// the expensive half and the cadence above is the cheap one — and a face that
/// walks on is not on screen for less than a second before it matters.
pub const DEFAULT_FACE_SWEEP: MediaTime = 1_000_000_000;

/// How wide a sweep's regions are, in pixels of the frame.
///
/// Vision's face detector has a floor on how large a face must be **as a
/// fraction of what it is given**, and a screen recording is the worst case for
/// it: a face inside a video inside a feed is a couple of per cent of a 3024
/// wide frame. Measured on one such frame, the same pixels that yield three
/// faces at 518×354 yield *none* at 3024×1898, and cutting the frame up brings
/// them back — nothing at 1024px regions, two at 768, three at around 500.
///
/// 768 is where that curve turns: fifteen regions over a 3024×1898 frame, about
/// a hundred milliseconds, and the faces anybody would call a face. Smaller
/// regions find a 35-pixel avatar too and cost twice as much to do it, which is
/// a trade to make on evidence rather than by guess.
pub const FACE_REGION: f64 = 768.0;

/// How far one region is stepped from the last, as a fraction of its width.
///
/// Three quarters, so every point of the frame is whole inside some region. At
/// a full step a face lying across a seam is cut in two and found by neither
/// side, and on a page that does not move it would never be found at all.
const FACE_REGION_STEP: f64 = 0.75;

/// How far around a face its own region reaches when it is being followed, as a
/// multiple of its size.
///
/// Five, which is two of itself in every direction. Wide enough for a head
/// turning or a page easing, and tight enough that the face is still a fifth of
/// what Vision is given — which is the whole reason a region is used rather
/// than the frame. Beyond this it stops helping: a flick scroll moves a face
/// further than any box worth asking for, and what answers that is the sweep
/// below rather than a wider guess.
const FACE_FOLLOW: f32 = 5.0;

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
    /// How often a face already being followed is looked for. See
    /// [`DEFAULT_FACE_INTERVAL`].
    pub face_interval: MediaTime,
    /// How often the whole frame is swept for new ones. See
    /// [`DEFAULT_FACE_SWEEP`].
    pub face_sweep: MediaTime,
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
            face_sweep: DEFAULT_FACE_SWEEP,
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

/// The regions one sweep of a frame is made of, in top-left fractions.
///
/// Stepped by [`FACE_REGION_STEP`] so every point of the frame is whole inside
/// one of them, and never past the edge: the last region in a row is pulled
/// back rather than hanging off, which keeps every one the same size and so
/// every face the same fraction of what Vision is given.
fn sweep_regions(width: f64, height: f64) -> Vec<NormRect> {
    // A frame smaller than one region is one region.
    let across = FACE_REGION.min(width).max(1.0);
    let down = FACE_REGION.min(height).max(1.0);
    let step_x = across * FACE_REGION_STEP;
    let step_y = down * FACE_REGION_STEP;

    let cols = ((width - across).max(0.0) / step_x).ceil() as usize + 1;
    let rows = ((height - down).max(0.0) / step_y).ceil() as usize + 1;

    let mut regions = Vec::with_capacity(cols * rows);
    for row in 0..rows {
        for col in 0..cols {
            let x = (col as f64 * step_x).min(width - across).max(0.0);
            let y = (row as f64 * step_y).min(height - down).max(0.0);
            regions.push(NormRect::new(
                (x / width) as f32,
                (y / height) as f32,
                (across / width) as f32,
                (down / height) as f32,
            ));
        }
    }
    regions
}

/// The region a known face is looked for in at the next sample.
///
/// Its own box grown by [`FACE_FOLLOW`] and clamped to the frame. Following in a
/// box rather than sweeping again is what makes the fine cadence affordable: one
/// request per face against fifteen for a sweep.
fn follow_region(face: NormRect) -> NormRect {
    let grow_x = face.w * (FACE_FOLLOW - 1.0) / 2.0;
    let grow_y = face.h * (FACE_FOLLOW - 1.0) / 2.0;
    let x = (face.x - grow_x).clamp(0.0, 1.0);
    let y = (face.y - grow_y).clamp(0.0, 1.0);
    NormRect::new(
        x,
        y,
        (face.w * FACE_FOLLOW).min(1.0 - x),
        (face.h * FACE_FOLLOW).min(1.0 - y),
    )
}

/// Whether two sightings are the same face.
///
/// The regions overlap, and a face near a seam is inside two of them — so the
/// same face comes back twice and would be offered to the tracker as two.
/// Centres within a quarter of the smaller box: close enough that two different
/// people are never merged, far enough that one person found twice is not two.
fn same_face(a: NormRect, b: NormRect) -> bool {
    let reach = a.w.min(b.w).max(a.h.min(b.h)) / 4.0;
    let (ax, ay) = a.centre();
    let (bx, by) = b.centre();
    (ax - bx).abs() <= reach && (ay - by).abs() <= reach
}

/// Every face on one frame: the ones already being followed, and — when a sweep
/// is due — whatever else is there.
///
/// The followed ones first, so that where the same face is found twice the one
/// kept is the one from the tighter region, which is the better measurement.
fn faces_on<R: FaceReader>(
    reader: &mut R,
    frame: &cv::PixelBuf,
    following: &[NormRect],
    sweep: Option<&[NormRect]>,
    reads: &mut u64,
) -> Result<Vec<Face>> {
    let mut found: Vec<Face> = Vec::new();

    let regions = following.iter().copied().map(Some);
    let sweeping = sweep.unwrap_or(&[]).iter().copied().map(Some);

    for region in regions.chain(sweeping) {
        *reads += 1;
        for face in reader.read(frame, region)? {
            if !found.iter().any(|seen| same_face(seen.rect, face.rect)) {
                found.push(face);
            }
        }
    }

    Ok(found)
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
        let mut read_faces: Option<(u64, Vec<Candidate>, Vec<NormRect>)> = None;
        let mut at: MediaTime = 0;
        // When the text is next due. Faces are read at every step.
        let mut text_due: MediaTime = 0;
        // And when the frame is next swept for faces nobody is following.
        let mut sweep_due: MediaTime = 0;
        // The regions of one sweep, worked out once the first frame has said
        // how large the picture is.
        let mut sweep: Vec<NormRect> = Vec::new();

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
                // The picture has not changed, so neither have the faces on it
                // — and neither has where to look for them next.
                let (found, seen) = match &read_faces {
                    Some((pts_before, candidates, boxes)) if *pts_before == pts => {
                        (candidates.clone(), boxes.clone())
                    }
                    _ => {
                        let Some(frame) = frames.frame_at(at) else {
                            break;
                        };

                        if sweep.is_empty() {
                            sweep = sweep_regions(frame.width() as f64, frame.height() as f64);
                        }

                        // Where the faces were at the last sample, grown. A
                        // face moves very little in a tenth of a second, and a
                        // region of its own is both the cheapest and the surest
                        // place to find it again.
                        let following: Vec<NormRect> = read_faces
                            .as_ref()
                            .map(|(_, _, boxes)| boxes.clone())
                            .unwrap_or_default()
                            .into_iter()
                            .map(follow_region)
                            .collect();

                        let due = at >= sweep_due;
                        let mut faces_now = faces_on(
                            faces,
                            frame,
                            &following,
                            due.then_some(sweep.as_slice()),
                            &mut summary.read,
                        )?;

                        // Something that was there a moment ago is not where it
                        // was. Sweep now rather than at the next due time: a
                        // page flicks further in a tenth of a second than any
                        // region worth asking for reaches, and the alternative
                        // is a cover that blinks out until the next sweep and
                        // comes back as a *different* cover — which is what the
                        // recording this was written against did, twice.
                        //
                        // It costs a sweep exactly when one is warranted, and
                        // nothing on the samples where everybody is where they
                        // were.
                        if !due && faces_now.len() < following.len() {
                            faces_now = faces_on(
                                faces,
                                frame,
                                &[],
                                Some(sweep.as_slice()),
                                &mut summary.read,
                            )?;
                        }

                        if due {
                            sweep_due = at.saturating_add(request.face_sweep.max(1));
                        }

                        let boxes: Vec<NormRect> = faces_now.iter().map(|face| face.rect).collect();
                        let found: Vec<Candidate> = faces_now
                            .into_iter()
                            .filter_map(|face| {
                                prequel_sensitive::face(face.rect, face.confidence, request.salt)
                            })
                            .collect();
                        (found, boxes)
                    }
                };

                face_tracker.offer(segment.start + at, &found);
                read_faces = Some((pts, found, seen));
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
