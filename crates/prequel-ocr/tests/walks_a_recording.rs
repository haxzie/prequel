//! The sampling loop, against a reader with no Vision behind it.
//!
//! Every trap in the loop is here, and none of them needs a framework: the
//! manifest offset applied exactly once, the end of a file not running on for
//! ever, an unchanged picture not being read twice, and a cancellation landing
//! between samples. The reading itself is Vision's and is not what goes wrong.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};

use cidre::cv;
use prequel_ocr::{
    CancelFlag, Face, FaceReader, Reading, ScanRequest, ScanSegment, TextReader, scan_with,
};
use prequel_sensitive::{Line, NormRect};

const SECOND: u64 = 1_000_000_000;

/// A reader that answers the same line every time, and counts how often it is
/// asked.
///
/// The count is the point of several of these tests: it is the difference
/// between a pass that reads a still screen once and one that reads it once a
/// second for the length of the take.
struct Fake {
    reads: AtomicUsize,
    text: String,
}

impl Fake {
    fn new(text: &str) -> Self {
        Self {
            reads: AtomicUsize::new(0),
            text: text.to_owned(),
        }
    }
}

impl TextReader for Fake {
    fn read(&mut self, _frame: &cv::PixelBuf) -> prequel_ocr::Result<Reading> {
        self.reads.fetch_add(1, Ordering::Relaxed);
        Ok(Reading::unnarrowed(vec![Line {
            text: self.text.clone(),
            rect: NormRect::new(0.1, 0.1, 0.4, 0.05),
            confidence: 1.0,
        }]))
    }
}

/// A plain white video, `seconds` long, with `rate` frames a second.
///
/// The rate matters. At ten frames a second every one-second sample lands on a
/// different decoded frame, however identical they look — the encoder wrote
/// them all. Below one frame a second there is genuinely nothing new to decode
/// between samples, which is the case the reader's `current_pts` detects.
fn video(dir: &Path, seconds: u64, rate: &str) -> PathBuf {
    let path = dir.join("screen.mp4");
    let status = Command::new("ffmpeg")
        .args(["-y", "-loglevel", "error", "-f", "lavfi", "-i"])
        .arg(format!("color=c=white:s=640x360:r={rate}:d={seconds}"))
        .args(["-pix_fmt", "yuv420p", "-c:v", "libx264"])
        .arg(&path)
        .status()
        .expect("ffmpeg is on PATH — media tests here shell out to it");
    assert!(status.success(), "ffmpeg could not write the fixture");
    path
}

/// The ordinary case: a frame for every sample.
fn still(dir: &Path, seconds: u64) -> PathBuf {
    video(dir, seconds, "10")
}

/// A reader that finds no faces.
///
/// Every test here is about the loop rather than about what is on the frame,
/// and `ScanRequest` leaves faces off by default — so this is never asked.
/// Present because the signature wants one, which is the signature saying out
/// loud that a scan has two readers in it now.
struct NoFaces;

impl FaceReader for NoFaces {
    fn read(&mut self, _frame: &cv::PixelBuf) -> prequel_ocr::Result<Vec<Face>> {
        Ok(Vec::new())
    }
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("prequel-ocr-{name}"));
    std::fs::create_dir_all(&dir).expect("a scratch directory");
    dir
}

fn request(path: PathBuf, start: u64, end: u64) -> ScanRequest {
    ScanRequest::new(
        vec![ScanSegment {
            path,
            name: "screen.mp4".to_owned(),
            start,
            end,
        }],
        7,
    )
}

#[test]
fn puts_findings_on_the_session_clock() {
    // A file is zero-based: `VideoWriter` opens its session at the first sample,
    // so that sample is the origin and the track's late start lives only in
    // `session.json`. The offset is added once, here — and subtracting a probed
    // file start as well, or adding it twice, moves every cover to a moment
    // nothing was on screen.
    let dir = scratch("clock");
    let path = still(&dir, 4);
    let offset = 30 * SECOND;

    let summary = scan_with(
        &request(path, offset, offset + 4 * SECOND),
        &mut Fake::new("Email accounts@example.com for a copy"),
        &mut NoFaces,
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("the scan");

    let track = summary.tracks.first().expect("one finding");
    assert_eq!(
        track.start(),
        offset,
        "the first key sits at the file's zero"
    );
    assert!(
        track.end() < offset + 4 * SECOND,
        "and the last stays inside the segment: {}",
        track.end()
    );
}

#[test]
fn stops_at_the_end_of_the_file() {
    // `frame_at` holds the last frame for ever, which is right for a screen
    // recording and lethal for a loop bounded by "did I get a frame". Bounded
    // by the segment's own duration instead — otherwise the final frame's
    // findings are attributed to the whole remaining timeline, and a cover
    // appears at the end of the video over nothing.
    let dir = scratch("end");
    let path = still(&dir, 3);

    let summary = scan_with(
        &request(path, 0, 3 * SECOND),
        &mut Fake::new("Email accounts@example.com for a copy"),
        &mut NoFaces,
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("the scan");

    // Three seconds at one sample a second, and not one more.
    assert_eq!(summary.sampled, 3, "sampled past the end of the file");
    let track = summary.tracks.first().expect("one finding");
    assert!(track.end() < 3 * SECOND, "{}", track.end());
}

#[test]
fn does_not_read_a_frame_it_has_already_read() {
    // A read costs a few hundred milliseconds, so a sample with no new frame
    // behind it should cost nothing. One frame every five seconds over ten
    // seconds is two frames and ten samples.
    //
    // Worth being plain about how much this saves in practice: a screen
    // recording out of ScreenCaptureKit carries a frame far more often than
    // once a second, so on a real take this fires rarely and the pass costs a
    // read per sample. It is the pause in a variable-rate capture that it
    // catches, not the stillness of an ordinary screen.
    let dir = scratch("sparse");
    let path = video(&dir, 10, "1/5");
    let fake = &mut Fake::new("Email accounts@example.com for a copy");

    let summary = scan_with(
        &request(path, 0, 10 * SECOND),
        fake,
        &mut NoFaces,
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("the scan");

    assert_eq!(summary.sampled, 10, "ten samples");
    assert!(
        summary.read < summary.sampled,
        "a sample with no new frame behind it was read again: {} of {}",
        summary.read,
        summary.sampled
    );
    assert_eq!(summary.read as usize, fake.reads.load(Ordering::Relaxed));

    // And the cover still reaches every sample: skipping the read must not skip
    // the finding, or a mask would blink out over a screen that never changed.
    let track = summary.tracks.first().expect("one finding");
    assert_eq!(track.keys.len(), 10);
    assert!(track.keys.iter().all(|key| !key.lost));
}

#[test]
fn cancels_between_samples() {
    // Checked before the read rather than after, so Cancel does not wait on a
    // request already in flight.
    let dir = scratch("cancel");
    let path = still(&dir, 6);
    let cancel = CancelFlag::new();
    cancel.cancel();

    let result = scan_with(
        &request(path, 0, 6 * SECOND),
        &mut Fake::new("Email accounts@example.com for a copy"),
        &mut NoFaces,
        &cancel,
        &mut |_| {},
    );

    assert!(
        matches!(result, Err(prequel_ocr::Error::Cancelled)),
        "{result:?}"
    );
}

#[test]
fn reports_progress_that_only_goes_forward() {
    let dir = scratch("progress");
    let path = still(&dir, 4);
    let mut seen: Vec<f32> = Vec::new();

    scan_with(
        &request(path, 0, 4 * SECOND),
        &mut Fake::new("nothing sensitive here"),
        &mut NoFaces,
        &CancelFlag::new(),
        &mut |fraction| seen.push(fraction),
    )
    .expect("the scan");

    assert!(!seen.is_empty());
    assert!(
        seen.windows(2).all(|pair| pair[1] >= pair[0]),
        "progress went backwards: {seen:?}"
    );
    assert!(seen.iter().all(|f| (0.0..=1.0).contains(f)), "{seen:?}");
    assert_eq!(seen.last().copied(), Some(1.0), "and it finishes at one");
}

#[test]
fn covers_the_segments_it_read() {
    // `covered` is what lets a later scan skip what this one did. A segment
    // left out is read again, which is the right way round: an empty result
    // must never be mistaken for "nothing sensitive in there".
    let dir = scratch("covered");
    let path = still(&dir, 2);

    let summary = scan_with(
        &request(path, 0, 2 * SECOND),
        &mut Fake::new("nothing sensitive here"),
        &mut NoFaces,
        &CancelFlag::new(),
        &mut |_| {},
    )
    .expect("the scan");

    assert_eq!(summary.covered, vec!["screen.mp4".to_owned()]);
}
