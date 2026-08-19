//! The export, end to end, against a synthetic recording.
//!
//! Builds a session on disk with the real encoder, exports two slices out of
//! it, and checks the result with `ffprobe`. Needs no display and no Screen
//! Recording grant, so it runs anywhere the encoder does.
//!
//! What it is really proving is that the pieces line up: the reader's time
//! ranges, the timeline's frame mapping, the Metal composite and the offline
//! writer all have to agree for the output to have the right length and the
//! right number of frames.

use std::path::{Path, PathBuf};
use std::process::Command;

use cidre::{arc, cv};
use prequel_encode::{AudioWriter, AudioWriterConfig, VideoWriter, VideoWriterConfig};
use prequel_render::{
    AudioMix, CancelFlag, ExportRequest, OutputFormat, Paint, PlanItem, Rect, RenderPlan, Shape,
    SliceRender, export,
};

const S: u64 = 1_000_000_000;
const SOURCE_W: u32 = 640;
const SOURCE_H: u32 = 360;
const OUT_W: u32 = 480;
const OUT_H: u32 = 270;
const SOURCE_FPS: u64 = 30;
const OUT_FPS: u32 = 30;
/// Four seconds of source, so two one-second slices leave plenty either side.
const SOURCE_FRAMES: u64 = 4 * SOURCE_FPS;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(name);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create the scratch directory");
    dir
}

/// A BGRA frame whose colour shifts, so the encoder has real content.
fn frame(index: u64) -> arc::R<cv::PixelBuf> {
    let mut buf = cv::PixelBuf::new(
        SOURCE_W as usize,
        SOURCE_H as usize,
        cv::PixelFormat::_32_BGRA,
        None,
    )
    .expect("allocate a pixel buffer");

    unsafe {
        buf.lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
            .result()
            .expect("lock");

        let stride = buf.bytes_per_row();
        let base = buf.base_address_mut().cast::<u8>();
        let phase = (index * 6) as u8;

        for y in 0..SOURCE_H as usize {
            for x in 0..SOURCE_W as usize {
                let at = y * stride + x * 4;
                *base.add(at) = phase;
                *base.add(at + 1) = (x as u8).wrapping_add(phase);
                *base.add(at + 2) = (y as u8).wrapping_sub(phase);
                *base.add(at + 3) = 255;
            }
        }

        buf.unlock_lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
            .result()
            .expect("unlock");
    }

    buf
}

/// Writes a four-second `screen.mp4` into `dir`.
fn record(dir: &Path) {
    let mut writer = VideoWriter::create(
        &dir.join("screen.mp4"),
        &VideoWriterConfig::new(SOURCE_W, SOURCE_H).offline(),
    )
    .expect("create the source writer");

    for index in 0..SOURCE_FRAMES {
        writer
            .append(&frame(index), index * (S / SOURCE_FPS))
            .expect("append a source frame");
    }
    writer.finish().expect("finish the source");
}

/// Writes a `system.m4a` beside the screen: four seconds of a quiet tone.
///
/// A tone rather than silence, because AAC encodes silence to almost nothing and
/// a track that is present but empty would pass an "is there audio" check while
/// telling us nothing about whether samples survived the mix.
fn record_audio(dir: &Path) {
    let mut writer = AudioWriter::create(
        &dir.join("system.m4a"),
        &AudioWriterConfig::new(48_000.0, 2).offline(),
    )
    .expect("create the source audio writer");

    let frames = 4 * 48_000;
    let mut samples = Vec::with_capacity(frames * 2);
    for index in 0..frames {
        let value = ((index as f64 / 48_000.0) * 440.0 * std::f64::consts::TAU).sin() as f32 * 0.25;
        samples.push(value);
        samples.push(value);
    }

    writer
        .append_pcm(&samples, 48_000.0, 4 * S)
        .expect("append the source audio");
    writer.finish().expect("finish the source audio");
}

/// A plan that fills the frame and draws the screen inside a margin.
fn plan() -> RenderPlan {
    RenderPlan {
        frame: prequel_render::Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![
            PlanItem::Fill {
                rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: OUT_W as f64,
                    height: OUT_H as f64,
                },
                paint: Paint::Solid {
                    color: "#ff0000".to_owned(),
                },
            },
            PlanItem::Image {
                source: prequel_render::PlanSource::Screen,
                src_rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: SOURCE_W as f64,
                    height: SOURCE_H as f64,
                },
                dst_rect: Rect {
                    x: 20.0,
                    y: 20.0,
                    width: OUT_W as f64 - 40.0,
                    height: OUT_H as f64 - 40.0,
                },
                shape: Shape {
                    radius: 8.0,
                    exponent: 2.0,
                },
                mirror: false,
                motion: Vec::new(),
            },
        ],
    }
}

fn slice(start: u64, end: u64) -> SliceRender {
    SliceRender {
        start,
        end,
        plan: plan(),
        audio: AudioMix {
            mic: 1.0,
            system: 1.0,
        },
    }
}

fn ffprobe(path: &Path, entries: &str) -> String {
    probe_stream(path, "v:0", entries)
}

fn probe_stream(path: &Path, stream: &str, entries: &str) -> String {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            stream,
            "-show_entries",
            entries,
            "-of",
            "default=noprint_wrappers=1",
        ])
        .arg(path)
        .output()
        .expect("ffprobe must be installed to verify export output");

    assert!(
        output.status.success(),
        "ffprobe failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

#[test]
fn exports_only_the_slices_that_were_kept() {
    let dir = scratch("prequel-export-slices");
    record(&dir);

    let output = dir.join("export.mp4");
    // 0–1s and 2–3s kept: two seconds of output from four of source.
    let request = ExportRequest {
        session_dir: dir.clone(),
        output: output.clone(),
        width: OUT_W,
        height: OUT_H,
        fps: OUT_FPS,
        format: OutputFormat::Mp4,
        slices: vec![slice(0, S), slice(2 * S, 3 * S)],
        screen_offset: 0,
        camera_offset: 0,
        mic_offset: 0,
        system_offset: 0,
    };

    let summary = export(&request, &CancelFlag::new(), &mut |_| {}).expect("export");

    assert_eq!(summary.duration, 2 * S, "the edit is two seconds long");
    assert_eq!(
        summary.frames,
        2 * OUT_FPS as u64,
        "every frame of the edit should have been written"
    );

    let probed = ffprobe(&output, "stream=width,height,nb_frames,codec_name");
    assert!(probed.contains(&format!("width={OUT_W}")), "got: {probed}");
    assert!(probed.contains(&format!("height={OUT_H}")), "got: {probed}");
    assert!(probed.contains("codec_name=h264"), "got: {probed}");
    assert!(
        probed.contains(&format!("nb_frames={}", 2 * OUT_FPS)),
        "got: {probed}"
    );

    let duration = ffprobe(&output, "format=duration")
        .trim_start_matches("duration=")
        .parse::<f64>()
        .expect("duration should parse");
    assert!(
        (duration - 2.0).abs() < 0.15,
        "expected about 2s of output, got {duration}s"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_whole_take_exports_at_its_full_length() {
    let dir = scratch("prequel-export-whole");
    record(&dir);

    let output = dir.join("export.mp4");
    let request = ExportRequest {
        session_dir: dir.clone(),
        output: output.clone(),
        width: OUT_W,
        height: OUT_H,
        fps: OUT_FPS,
        format: OutputFormat::Mp4,
        slices: vec![slice(0, 4 * S)],
        screen_offset: 0,
        camera_offset: 0,
        mic_offset: 0,
        system_offset: 0,
    };

    let summary = export(&request, &CancelFlag::new(), &mut |_| {}).expect("export");

    assert_eq!(summary.frames, SOURCE_FRAMES);
    // The final frame has a duration rather than being a zero-length blip, so
    // the file is a full four seconds rather than one frame short.
    let duration = ffprobe(&output, "format=duration")
        .trim_start_matches("duration=")
        .parse::<f64>()
        .expect("duration should parse");
    assert!(
        (duration - 4.0).abs() < 0.15,
        "expected about 4s of output, got {duration}s"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn reports_progress_as_it_goes() {
    let dir = scratch("prequel-export-progress");
    record(&dir);

    let request = ExportRequest {
        session_dir: dir.clone(),
        output: dir.join("export.mp4"),
        width: OUT_W,
        height: OUT_H,
        fps: OUT_FPS,
        format: OutputFormat::Mp4,
        slices: vec![slice(0, S)],
        screen_offset: 0,
        camera_offset: 0,
        mic_offset: 0,
        system_offset: 0,
    };

    let mut stages = Vec::new();
    export(&request, &CancelFlag::new(), &mut |progress| {
        stages.push(progress.stage);
        assert!(progress.frames_done <= progress.frames_total);
    })
    .expect("export");

    assert!(stages.contains(&prequel_render::Stage::Preparing));
    assert!(stages.contains(&prequel_render::Stage::Rendering));
    assert!(stages.contains(&prequel_render::Stage::Finalising));

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn cancelling_leaves_no_output_behind() {
    let dir = scratch("prequel-export-cancel");
    record(&dir);

    let output = dir.join("export.mp4");
    let request = ExportRequest {
        session_dir: dir.clone(),
        output: output.clone(),
        width: OUT_W,
        height: OUT_H,
        fps: OUT_FPS,
        format: OutputFormat::Mp4,
        slices: vec![slice(0, 4 * S)],
        screen_offset: 0,
        camera_offset: 0,
        mic_offset: 0,
        system_offset: 0,
    };

    // Cancelled before a single frame is rendered.
    let cancel = CancelFlag::new();
    cancel.cancel();

    let result = export(&request, &cancel, &mut |_| {});

    assert!(matches!(result, Err(prequel_render::Error::Cancelled)));
    // A partial file left on disk would look like a finished export.
    assert!(
        !output.exists(),
        "a cancelled export must clean up after itself"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn refuses_an_edit_with_nothing_in_it() {
    let dir = scratch("prequel-export-empty");

    let request = ExportRequest {
        session_dir: dir.clone(),
        output: dir.join("export.mp4"),
        width: OUT_W,
        height: OUT_H,
        fps: OUT_FPS,
        format: OutputFormat::Mp4,
        slices: vec![],
        screen_offset: 0,
        camera_offset: 0,
        mic_offset: 0,
        system_offset: 0,
    };

    assert!(matches!(
        export(&request, &CancelFlag::new(), &mut |_| {}),
        Err(prequel_render::Error::Empty)
    ));

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn re_exporting_replaces_the_previous_file() {
    // The failure this covers, verbatim from a user's log:
    //
    //   AVAssetWriter failed while writing: Error Domain=AVFoundationErrorDomain
    //   Code=-11823 "Cannot Save" … The requested file name is already in use.
    //
    // `AVAssetWriter` refuses an existing URL rather than truncating it, so
    // every export after the first one failed. Nothing about the first export
    // looks wrong, which is why only a second one catches it.
    let dir = scratch("prequel-export-twice");
    record(&dir);

    let output = dir.join("export.mp4");
    let request = ExportRequest {
        session_dir: dir.clone(),
        output: output.clone(),
        width: OUT_W,
        height: OUT_H,
        fps: OUT_FPS,
        format: OutputFormat::Mp4,
        slices: vec![slice(0, 2 * S)],
        screen_offset: 0,
        camera_offset: 0,
        mic_offset: 0,
        system_offset: 0,
    };

    export(&request, &CancelFlag::new(), &mut |_| {}).expect("first export");
    let first = std::fs::metadata(&output)
        .expect("first export exists")
        .len();

    export(&request, &CancelFlag::new(), &mut |_| {}).expect("second export over the first");
    let second = std::fs::metadata(&output)
        .expect("second export exists")
        .len();

    // Replaced, not appended to: a writer that somehow wrote alongside the old
    // bytes would leave a file roughly twice the size.
    assert!(
        second.abs_diff(first) < first / 4,
        "expected a replacement of about {first} bytes, got {second}",
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_failed_export_leaves_nothing_behind() {
    // A partial file is what turns one bad export into a permanently broken
    // one, because the next attempt cannot write over it.
    let dir = scratch("prequel-export-failure");
    record(&dir);

    let output = dir.join("export.mp4");
    let request = ExportRequest {
        session_dir: dir.clone(),
        output: output.clone(),
        // Zero-sized, which the encoder refuses — a failure that happens after
        // the output path has been decided.
        width: 0,
        height: 0,
        fps: OUT_FPS,
        format: OutputFormat::Mp4,
        slices: vec![slice(0, S)],
        screen_offset: 0,
        camera_offset: 0,
        mic_offset: 0,
        system_offset: 0,
    };

    assert!(export(&request, &CancelFlag::new(), &mut |_| {}).is_err());
    assert!(
        !output.exists(),
        "a failed export must not leave a file behind"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn exports_the_sound_inside_the_video_file() {
    // The bug this pins: the mix was written to an `.m4a` *beside* the video and
    // never muxed in, so every export was a silent MP4 with an audio file next to
    // it that no player would pick up. Muxing needs the audio input added before
    // the writer starts, which is why the mix now runs before the first frame.
    let dir = scratch("prequel-export-audio");
    record(&dir);
    record_audio(&dir);

    let output = dir.join("export.mp4");
    let request = ExportRequest {
        session_dir: dir.clone(),
        output: output.clone(),
        width: OUT_W,
        height: OUT_H,
        fps: OUT_FPS,
        format: OutputFormat::Mp4,
        slices: vec![slice(0, 2 * S)],
        screen_offset: 0,
        camera_offset: 0,
        mic_offset: 0,
        system_offset: 0,
    };

    export(&request, &CancelFlag::new(), &mut |_| {}).expect("export with audio");

    let audio = probe_stream(&output, "a:0", "stream=codec_type,channels");
    assert!(
        audio.contains("codec_type=audio"),
        "the exported video must carry its own audio track, got: {audio:?}"
    );
    assert!(
        audio.contains("channels=2"),
        "the mix is stereo, got: {audio:?}"
    );

    // Long enough to be the edit rather than a stub. The audio is retimed to the
    // session's start, and a buffer stamped before the session opened is dropped
    // silently — leaving a track that exists and is empty.
    let heard = probe_stream(&output, "a:0", "stream=duration")
        .trim_start_matches("duration=")
        .parse::<f64>()
        .expect("the audio duration should parse");
    assert!(
        (heard - 2.0).abs() < 0.15,
        "expected about 2s of sound to match the edit, got {heard}s"
    );

    // The picture is still there beside it, and all of it. Muxing is where a
    // video quietly loses frames: `AVAssetWriter` stops declaring one input ready
    // while another lags, so audio written in one lump at the end starves the
    // video input until it times out and starts dropping. That leaves perfect
    // sound over a picture a fraction of the right length, which every other
    // assertion here would happily pass.
    let picture = ffprobe(&output, "stream=codec_type,nb_frames,duration");
    assert!(
        picture.contains("codec_type=video"),
        "the video track must survive muxing the audio in, got: {picture:?}"
    );
    assert!(
        picture.contains(&format!("nb_frames={}", 2 * OUT_FPS)),
        "every frame of the edit must survive, got: {picture:?}"
    );

    // And no sidecar is left behind for the user to wonder about.
    assert!(
        !dir.join("export.m4a").exists(),
        "the sound belongs in the video file, not in a second file beside it"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn exports_a_gif_that_loops_and_carries_no_audio() {
    // GIF is the one format not written by an Apple encoder, so nothing about
    // it is covered by the MP4 path: the quantiser, the centisecond delay, the
    // loop flag and the absence of a sidecar are all specific to it.
    let dir = scratch("prequel-export-gif");
    record(&dir);

    let output = dir.join("export.gif");
    let request = ExportRequest {
        session_dir: dir.clone(),
        output: output.clone(),
        width: OUT_W,
        height: OUT_H,
        fps: 10,
        format: OutputFormat::Gif,
        slices: vec![slice(0, S)],
        screen_offset: 0,
        camera_offset: 0,
        mic_offset: 0,
        system_offset: 0,
    };

    let summary = export(&request, &CancelFlag::new(), &mut |_| {}).expect("export");
    assert_eq!(summary.frames, 10, "a second at 10 fps is ten frames");

    let probed = ffprobe(&output, "stream=width,height,nb_frames,codec_name");
    assert!(probed.contains("codec_name=gif"), "got: {probed}");
    assert!(probed.contains(&format!("width={OUT_W}")), "got: {probed}");
    assert!(probed.contains(&format!("height={OUT_H}")), "got: {probed}");

    // The delay is the part that is easy to get wrong and impossible to see in
    // a still: written per frame in centiseconds, so 10 fps must come back as
    // a second of playback rather than a tenth or ten.
    let duration = ffprobe(&output, "format=duration")
        .trim_start_matches("duration=")
        .parse::<f64>()
        .expect("duration should parse");
    assert!(
        (duration - 1.0).abs() < 0.15,
        "a second of GIF should play for about a second, got {duration}"
    );

    assert!(
        !dir.join("export.m4a").exists(),
        "a GIF carries no sound, so no audio track should be written beside it"
    );

    let _ = std::fs::remove_dir_all(&dir);
}
