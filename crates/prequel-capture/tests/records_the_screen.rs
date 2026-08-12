//! Live end-to-end capture: ScreenCaptureKit → encoder → playable MP4.
//!
//! Needs the Screen Recording grant, so it self-skips when the grant is absent
//! rather than failing. That keeps `cargo test` honest on hosted CI (where TCC
//! can never be granted) while still running for real on a developer machine or
//! a self-hosted mac runner.

use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

use prequel_capture::{
    MICROPHONE_FILE, PermissionStatus, RecordOptions, SCREEN_FILE, SYSTEM_AUDIO_FILE,
    ScreenRecorder, SharedClock, TargetKind, list_targets, main_display_asleep,
    screen_access_status,
};

const RECORD_FOR: Duration = Duration::from_secs(3);
const FPS: u32 = 30;

/// Whether live capture can run here at all.
///
/// Two things make it impossible, and neither is worth failing the suite over:
/// no Screen Recording grant (hosted CI can never have one), and a sleeping
/// display (ScreenCaptureKit omits those entirely, and a developer machine will
/// doze off mid-run).
fn cannot_capture() -> bool {
    if screen_access_status() != PermissionStatus::Granted {
        eprintln!("SKIP: no Screen Recording grant; live capture cannot be tested here");
        return true;
    }
    if main_display_asleep() {
        eprintln!("SKIP: the display is asleep, so ScreenCaptureKit will not offer it");
        return true;
    }
    false
}

/// A clean session directory to record into.
fn session_dir(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("prequel-live-{name}"));
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

#[test]
fn records_a_display_to_a_playable_mp4() {
    if cannot_capture() {
        return;
    }

    let targets = list_targets().expect("list targets");
    let display = targets
        .into_iter()
        .find(|t| t.kind == TargetKind::Display)
        .expect("a Mac always has a display");

    let expected_width = ((display.bounds.width * display.scale_factor).round() as u32) & !1;
    let expected_height = ((display.bounds.height * display.scale_factor).round() as u32) & !1;

    let path = session_dir("display");
    let _ = std::fs::remove_dir_all(&path);

    let mut options = RecordOptions::new(display, &path);
    options.fps = FPS;

    let recorder = ScreenRecorder::start(&options, SharedClock::new()).expect("start recording");
    std::thread::sleep(RECORD_FOR);
    let summary = recorder.stop().expect("stop recording");

    // Capture must actually be producing frames, not just opening a file.
    let min_frames = (FPS as u64 * RECORD_FOR.as_secs()) / 3;
    assert!(
        summary.frames >= min_frames,
        "expected at least {min_frames} frames in {RECORD_FOR:?}, got {summary:?}"
    );
    assert_eq!(summary.width, expected_width);
    assert_eq!(summary.height, expected_height);

    // Capture at physical pixels, not points — the bug that a naive
    // scale-factor calculation hides.
    assert!(
        expected_width >= 1920,
        "a Retina display should capture at physical resolution, got {expected_width}px"
    );

    let probed = ffprobe(&path.join(SCREEN_FILE), "stream=codec_name,width,height");
    assert!(probed.contains("codec_name=h264"), "got: {probed}");
    assert!(
        probed.contains(&format!("width={expected_width}")),
        "got: {probed}"
    );
    assert!(
        probed.contains(&format!("height={expected_height}")),
        "got: {probed}"
    );

    let duration = ffprobe(&path.join(SCREEN_FILE), "format=duration")
        .trim_start_matches("duration=")
        .parse::<f64>()
        .expect("duration parses");
    let wanted = RECORD_FOR.as_secs_f64();
    assert!(
        (duration - wanted).abs() < 1.0,
        "recorded {duration}s, expected about {wanted}s"
    );

    println!(
        "recorded {}x{} · {} frames · {:.2}s · timing {:?} · encoder drops {}",
        summary.width,
        summary.height,
        summary.frames,
        duration,
        summary.video,
        summary.dropped_encoder
    );

    let _ = std::fs::remove_dir_all(&path);
}

#[test]
fn a_pause_shortens_the_recording() {
    if cannot_capture() {
        return;
    }

    let targets = list_targets().expect("list targets");
    let display = targets
        .into_iter()
        .find(|t| t.kind == TargetKind::Display)
        .expect("a display");

    let path = session_dir("paused");
    let _ = std::fs::remove_dir_all(&path);

    let mut options = RecordOptions::new(display, &path);
    options.fps = FPS;

    let started = Instant::now();
    let recorder = ScreenRecorder::start(&options, SharedClock::new()).expect("start");

    std::thread::sleep(Duration::from_secs(1));
    recorder.pause();
    assert!(recorder.is_paused());
    std::thread::sleep(Duration::from_secs(2)); // paused: must not appear
    recorder.resume();
    assert!(!recorder.is_paused());
    std::thread::sleep(Duration::from_secs(1));

    let _summary = recorder.stop().expect("stop");
    let wall_clock = started.elapsed().as_secs_f64();

    let duration = ffprobe(&path.join(SCREEN_FILE), "format=duration")
        .trim_start_matches("duration=")
        .parse::<f64>()
        .expect("duration parses");

    // ~4s of wall clock, 2s of it paused, so the file must be ~2s.
    assert!(
        wall_clock > 3.5,
        "test should have taken about 4s of wall clock, took {wall_clock}s"
    );
    assert!(
        duration < 3.0,
        "paused time leaked into the output: {duration}s of media from {wall_clock}s of wall clock"
    );
    assert!(
        duration > 1.0,
        "recording lost its unpaused content too: only {duration}s"
    );

    println!("paused recording: {duration:.2}s of media from {wall_clock:.2}s wall clock");

    let _ = std::fs::remove_dir_all(&path);
}

#[test]
fn system_audio_and_microphone_arrive_on_the_same_stream() {
    // Plan risk #4: system audio is the flakiest surface on macOS, and this is
    // the path that replaces Electron's broken loopback. Prove buffers actually
    // arrive before M4 builds tracks on top of it.
    if cannot_capture() {
        return;
    }

    let display = list_targets()
        .expect("list targets")
        .into_iter()
        .find(|t| t.kind == TargetKind::Display)
        .expect("a display");

    let path = session_dir("audio");
    let _ = std::fs::remove_dir_all(&path);

    let mut options = RecordOptions::new(display, &path);
    options.fps = FPS;
    options.capture_system_audio = true;
    let _ = MICROPHONE_FILE; // exercised once mic TCC is granted

    let recorder = ScreenRecorder::start(&options, SharedClock::new()).expect("start with audio");
    std::thread::sleep(Duration::from_secs(2));
    let summary = recorder.stop().expect("stop");

    println!(
        "system audio buffers: {} · mic buffers: {} · video frames: {}",
        summary.system_audio_samples(),
        summary.microphone_samples(),
        summary.frames
    );

    // ScreenCaptureKit delivers audio continuously once enabled, silence
    // included — so buffers must arrive even with nothing playing.
    assert!(
        summary.system_audio_samples() > 0,
        "no system audio buffers arrived; the loopback path is not working"
    );
    assert!(
        summary.frames > 0,
        "video should still work alongside audio"
    );

    // The point of the milestone: audio becomes its own track on disk rather
    // than a counter that gets thrown away.
    let audio = path.join(SYSTEM_AUDIO_FILE);
    assert!(audio.exists(), "system audio track was not written");
    assert!(
        std::fs::metadata(&audio).unwrap().len() > 1_000,
        "system audio track is suspiciously small"
    );

    let probed = probe_audio(&audio, "stream=codec_name,channels,sample_rate");
    assert!(probed.contains("codec_name=aac"), "got: {probed}");

    let audio_duration = probe_audio(&audio, "format=duration")
        .trim_start_matches("duration=")
        .parse::<f64>()
        .expect("audio duration parses");

    // Audio and video share a session origin, so they must line up — drift here
    // is exactly what makes separately-recorded tracks unusable later.
    let video_duration = ffprobe(&path.join(SCREEN_FILE), "format=duration")
        .trim_start_matches("duration=")
        .parse::<f64>()
        .expect("video duration parses");

    println!("audio track: {probed} duration={audio_duration:.2}s (video {video_duration:.2}s)");
    assert!(
        (audio_duration - video_duration).abs() < 0.6,
        "audio ({audio_duration}s) and video ({video_duration}s) drifted apart"
    );

    let _ = std::fs::remove_dir_all(&path);
}

/// `ffprobe`, reading the first audio stream rather than the first video one.
fn probe_audio(path: &PathBuf, entries: &str) -> String {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "a:0",
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

#[test]
fn an_area_recording_is_cropped_to_the_requested_region() {
    if cannot_capture() {
        return;
    }

    let display = list_targets()
        .expect("list targets")
        .into_iter()
        .find(|t| t.kind == TargetKind::Display)
        .expect("a display");

    // A region well inside the display, with deliberately odd numbers so any
    // silent rounding to the full display size would be obvious.
    let crop = prequel_capture::Bounds {
        x: 100.0,
        y: 60.0,
        width: 641.0,
        height: 383.0,
    };
    let scale = display.scale_factor;
    let expected_width = ((crop.width * scale).round() as u32) & !1;
    let expected_height = ((crop.height * scale).round() as u32) & !1;

    let path = session_dir("area");
    let _ = std::fs::remove_dir_all(&path);

    let mut options = RecordOptions::new(display, &path);
    options.fps = FPS;
    options.crop = Some(crop);

    let recorder =
        ScreenRecorder::start(&options, SharedClock::new()).expect("start area recording");
    std::thread::sleep(Duration::from_secs(2));
    let summary = recorder.stop().expect("stop");

    assert_eq!(summary.width, expected_width);
    assert_eq!(summary.height, expected_height);
    assert!(summary.frames > 0, "area capture produced no frames");

    let probed = ffprobe(&path.join(SCREEN_FILE), "stream=width,height");
    assert!(
        probed.contains(&format!("width={expected_width}")),
        "got: {probed}"
    );
    assert!(
        probed.contains(&format!("height={expected_height}")),
        "got: {probed}"
    );

    println!("area recording: {expected_width}x{expected_height} from a {crop:?} region");

    let _ = std::fs::remove_dir_all(&path);
}
