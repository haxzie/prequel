//! The matte's timestamps are the camera's timestamps.
//!
//! Both files are read from zero against the camera track's `start`, so a
//! mask written at any other time — its own first frame, say, or a frame the
//! segmenter skipped — lands on a neighbouring picture. The failure is a
//! halo that trails the person by a frame, which looks like a bad model
//! rather than a wrong clock. This runs a fake segmenter through the real
//! worker and writer, so it needs no camera and no grant.

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::process::Command;

use cidre::{arc, cv};
use prequel_camera::{MatteWorker, Segmenter};
use prequel_session::MediaTime;

const FRAME: MediaTime = 33_333_333;

/// A segmenter that answers every frame with the same half-white mask.
struct FakeSegmenter {
    mask: arc::R<cv::PixelBuf>,
}

impl FakeSegmenter {
    fn new() -> Self {
        let (width, height) = (64usize, 36usize);
        let mut mask = cv::PixelBuf::new(width, height, cv::PixelFormat::ONE_COMPONENT_8, None)
            .expect("allocate a mask");
        unsafe {
            mask.lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
                .result()
                .expect("lock");
            let stride = mask.bytes_per_row();
            let base = mask.base_address_mut().cast::<u8>();
            for y in 0..height {
                for x in 0..width {
                    *base.add(y * stride + x) = if x < width / 2 { 255 } else { 0 };
                }
            }
            mask.unlock_lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
                .result()
                .expect("unlock");
        }
        Self { mask }
    }
}

impl Segmenter for FakeSegmenter {
    fn matte(&mut self, _frame: &cv::PixelBuf) -> prequel_camera::Result<arc::R<cv::PixelBuf>> {
        Ok(self.mask.retained())
    }
}

fn camera_frame() -> arc::R<cv::PixelBuf> {
    cv::PixelBuf::new(320, 180, cv::PixelFormat::_420V, None).expect("allocate a frame")
}

fn session_dir(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("prequel-matte-{name}"));
    let _ = std::fs::remove_dir_all(&path);
    std::fs::create_dir_all(&path).expect("create the session directory");
    path
}

/// Presentation times of every frame in the file, in nanoseconds.
fn frame_times(path: &PathBuf) -> Vec<MediaTime> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "frame=pts_time",
            "-of",
            "csv=p=0",
        ])
        .arg(path)
        .output()
        .expect("ffprobe must be installed");
    assert!(
        output.status.success(),
        "ffprobe failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().trim_end_matches(',').parse::<f64>().ok())
        .map(|seconds| (seconds * 1e9).round() as MediaTime)
        .collect()
}

#[test]
fn every_mask_lands_on_a_camera_timestamp_from_the_camera_origin() {
    let dir = session_dir("pts");
    let path = dir.join("camera-matte.mp4");

    let mut worker =
        MatteWorker::spawn(path.clone(), || Box::new(FakeSegmenter::new())).expect("spawn");

    // A camera whose first frame is well after zero, as it always is: the
    // screen anchors the clock and the camera warms up later.
    let origin: MediaTime = 700_000_000;
    let offered: Vec<MediaTime> = (0..30).map(|i| origin + i * FRAME).collect();
    let frame = camera_frame();
    for &pts in &offered {
        assert!(worker.offer(&frame, pts), "the worker gave up");
        // Paced like a camera, so the bounded queue does not skip the lot.
        std::thread::sleep(std::time::Duration::from_millis(5));
    }

    let summary = worker.stop().expect("a matte was written");
    assert!(path.exists(), "no matte file");
    assert_eq!(
        summary.frames + summary.dropped,
        offered.len() as u64,
        "every offered frame is either written or counted as dropped: {summary:?}"
    );
    assert_eq!((summary.width, summary.height), (64, 36));

    // The file's zero is the camera's first pts — the origin both files
    // share — so a frame written at `pts` reads back at `pts - origin`.
    let written: BTreeSet<MediaTime> = frame_times(&path).into_iter().collect();
    let expected: BTreeSet<MediaTime> = offered.iter().map(|pts| pts - origin).collect();
    assert!(!written.is_empty(), "the file has no frames");
    for at in &written {
        // Allow the timescale rounding of the container.
        let near = expected.iter().any(|want| want.abs_diff(*at) < 1_000_000);
        assert!(
            near,
            "frame at {at} ns is not one of the camera's: {expected:?}"
        );
    }
    assert!(
        written.iter().next().is_some_and(|first| *first < FRAME),
        "the first mask should sit at the camera's origin, not its own: {written:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_segmenter_that_refuses_the_first_frame_leaves_no_file() {
    struct Refuses;
    impl Segmenter for Refuses {
        fn matte(&mut self, _: &cv::PixelBuf) -> prequel_camera::Result<arc::R<cv::PixelBuf>> {
            Err(prequel_camera::Error::Matte("no model".to_owned()))
        }
    }

    let dir = session_dir("refused");
    let path = dir.join("camera-matte.mp4");
    let mut worker = MatteWorker::spawn(path.clone(), || Box::new(Refuses)).expect("spawn");
    let frame = camera_frame();
    for i in 0..5 {
        worker.offer(&frame, i * FRAME);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }

    // Giving up is silent from the recorder's side: no summary, no file, and
    // the camera's own track is untouched.
    assert!(worker.stop().is_none());
    assert!(
        !path.exists(),
        "a refused matte must not leave a file behind"
    );

    let _ = std::fs::remove_dir_all(&dir);
}
