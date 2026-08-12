//! Live camera capture: AVFoundation → encoder → playable MP4.
//!
//! Self-skips when there is no camera or no grant, so `cargo test` stays honest
//! on hosted CI while still running for real on a developer machine.

use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use prequel_camera::{CAMERA_FILE, CameraOptions, CameraRecorder, list_cameras};
use prequel_encode::host_now;
use prequel_session::SharedClock;

const RECORD_FOR: Duration = Duration::from_secs(3);

fn session_dir(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("prequel-camera-{name}"));
    let _ = std::fs::remove_dir_all(&path);
    path
}

fn ffprobe(path: &PathBuf, entries: &str) -> String {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            entries,
            "-of",
            "default=noprint_wrappers=1",
        ])
        .arg(path)
        .output()
        .expect("ffprobe must be installed");

    assert!(
        output.status.success(),
        "ffprobe failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

/// A clock already anchored, standing in for the screen track.
///
/// The camera never anchors the clock itself, so without this every frame
/// would be dropped as `DropBeforeStart` — which is exactly the behaviour the
/// screen pipeline relies on.
fn anchored_clock() -> SharedClock {
    let clock = SharedClock::new();
    // `host_now`, not a wall clock: sample timestamps are time since boot, and
    // anchoring with time since the epoch drops every frame in the recording.
    clock.start(host_now());
    clock
}

#[test]
fn records_a_camera_to_a_playable_mp4() {
    let Some(camera) = list_cameras().into_iter().next() else {
        eprintln!("SKIP: no camera attached");
        return;
    };
    println!("recording {:?} ({})", camera.name, camera.id);

    let path = session_dir("basic");
    let options = CameraOptions::new(&camera.id, &path);

    let recorder = match CameraRecorder::start(&options, anchored_clock()) {
        Ok(recorder) => recorder,
        Err(e) => {
            eprintln!("SKIP: could not open the camera ({e}); is access granted?");
            return;
        }
    };
    std::thread::sleep(RECORD_FOR);
    let summary = recorder.stop().expect("stop recording");

    println!(
        "camera: {}x{} · {} frames · start {:.3}s · timing {:?} · late {} · encoder drops {}",
        summary.width,
        summary.height,
        summary.frames,
        summary.start as f64 / 1e9,
        summary.timing,
        summary.dropped_late,
        summary.dropped_encoder,
    );

    // A camera that opens but delivers nothing is the failure worth catching:
    // it produces a file that looks fine until you play it.
    assert!(summary.frames > 10, "too few frames: {summary:?}");
    assert!(summary.width >= 640, "suspiciously small: {summary:?}");

    let file = path.join(CAMERA_FILE);
    assert!(file.exists(), "no camera track was written");

    let probed = ffprobe(&file, "stream=codec_name,width,height");
    assert!(probed.contains("codec_name=h264"), "got: {probed}");
    assert!(
        probed.contains(&format!("width={}", summary.width)),
        "the summary and the file disagree: {probed} vs {summary:?}"
    );

    let duration = ffprobe(&file, "format=duration")
        .trim_start_matches("duration=")
        .parse::<f64>()
        .expect("duration parses");
    let wanted = RECORD_FOR.as_secs_f64();
    assert!(
        (duration - wanted).abs() < 1.0,
        "recorded {duration}s, expected about {wanted}s"
    );

    let _ = std::fs::remove_dir_all(&path);
}

#[test]
fn a_paused_recording_omits_the_paused_span() {
    // The camera shares the screen's clock, so pausing the recording has to
    // shorten the camera track too — otherwise the two drift apart by the
    // length of every pause.
    let Some(camera) = list_cameras().into_iter().next() else {
        eprintln!("SKIP: no camera attached");
        return;
    };

    let path = session_dir("paused");
    let options = CameraOptions::new(&camera.id, &path);
    let clock = anchored_clock();

    let recorder = match CameraRecorder::start(&options, clock.clone()) {
        Ok(recorder) => recorder,
        Err(e) => {
            eprintln!("SKIP: could not open the camera ({e})");
            return;
        }
    };

    std::thread::sleep(Duration::from_secs(1));
    clock.pause(host_now());
    std::thread::sleep(Duration::from_secs(2)); // must not appear
    clock.resume(host_now());
    std::thread::sleep(Duration::from_secs(1));

    let summary = recorder.stop().expect("stop");
    println!(
        "paused camera: {} frames kept, {} dropped as paused",
        summary.frames, summary.timing.paused
    );

    assert!(
        summary.timing.paused > 0,
        "nothing was discarded during the pause: {summary:?}"
    );

    let duration = ffprobe(&path.join(CAMERA_FILE), "format=duration")
        .trim_start_matches("duration=")
        .parse::<f64>()
        .expect("duration parses");

    // ~4 s of wall clock with 2 s paused, so the file must be about 2 s.
    assert!(
        duration < 3.0,
        "paused time leaked into the camera track: {duration}s"
    );
    assert!(
        duration > 0.5,
        "the camera track lost its content: {duration}s"
    );

    let _ = std::fs::remove_dir_all(&path);
}
