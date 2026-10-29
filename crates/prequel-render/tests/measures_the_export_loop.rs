//! What a 1080p60 export costs per frame, end to end, against a synthetic
//! recording.
//!
//! Ignored by default: a measurement rather than an assertion. Run it beside
//! `prequel-encode`'s `measures_the_encoder_ceiling` — the pair is what says
//! whether the loop or the encoder is the wall, and the answer moves with the
//! machine, the resolution and the codec.
//!
//! ```text
//! cargo test -p prequel-render --release --test measures_the_export_loop \
//!     -- --ignored --nocapture --test-threads=1
//! ```
//!
//! `--test-threads=1` is not a nicety: two of these in parallel contend for the
//! one media engine and both come out three to four times slower, which reads
//! as a regression in whichever one you were looking at.
//!
//! The stage split is not printed here — `StageTimes` in `export.rs` logs it at
//! `info`, so a real export in `~/Library/Logs/Prequel/main.log` carries it.

use std::path::{Path, PathBuf};

use cidre::{arc, cv};
use prequel_encode::{VideoWriter, VideoWriterConfig};
use prequel_render::{
    AudioMix, CancelFlag, ExportRequest, OutputFormat, Paint, PlanItem, Rect, RenderPlan,
    SegmentRef, Shape, SliceMedia, SliceRender, export,
};
use prequel_session::TrackKind;

const S: u64 = 1_000_000_000;
const FPS: u64 = 60;
const SECONDS: u64 = 5;
const FRAMES: u64 = SECONDS * FPS;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(name);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create the scratch directory");
    dir
}

/// Content modelled on a screen recording, which is almost all of what the
/// encoder's cost is.
///
/// A still frame flatters it and a frame that changes everywhere punishes it,
/// and the two are a factor of three apart — an earlier version of this moved
/// every panel on every frame, which made libx264 the wall and put the figures
/// below out by nearly double. A real recording is a static desktop with a
/// pointer crossing it and a few characters appearing: mostly unchanged
/// between frames, with hard edges and flat regions where they do change.
fn frame(width: u32, height: u32, index: u64) -> arc::R<cv::PixelBuf> {
    let mut buf = cv::PixelBuf::new(
        width as usize,
        height as usize,
        cv::PixelFormat::_32_BGRA,
        None,
    )
    .expect("allocate a pixel buffer");

    let w = width as usize;
    let h = height as usize;
    // The pointer, a few pixels a frame.
    let cursor_x = (index as usize * 7) % w.saturating_sub(24).max(1);
    let cursor_y = (index as usize * 3) % h.saturating_sub(24).max(1);
    // A line of text growing a character at a time, as typing does.
    let typed = (index as usize / 6) % 60;

    unsafe {
        buf.lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
            .result()
            .expect("lock");
        let stride = buf.bytes_per_row();
        let base = buf.base_address_mut().cast::<u8>();
        for row in 0..h {
            let line = base.add(row * stride);
            for col in 0..w {
                // Static: a sidebar, a toolbar and a content area.
                let panel = if col < w / 5 {
                    32u8
                } else if row < h / 12 {
                    44
                } else {
                    58
                };
                // Static text, the bulk of a window's detail.
                let body = row > h / 6 && row % 21 < 9 && col > w / 4 && (col / 3) % 5 < 2;
                let mut value = if body { 196 } else { panel };

                // The two things that move.
                if row >= h / 2 && row < h / 2 + 14 && col > w / 4 && (col - w / 4) / 9 < typed {
                    value = 210;
                }
                if row >= cursor_y && row < cursor_y + 18 && col >= cursor_x && col < cursor_x + 12
                {
                    value = 240;
                }

                let at = col * 4;
                *line.add(at) = value;
                *line.add(at + 1) = value.wrapping_add(4);
                *line.add(at + 2) = value.wrapping_add(9);
                *line.add(at + 3) = 255;
            }
        }
        buf.unlock_lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
            .result()
            .expect("unlock");
    }
    buf
}

fn record(dir: &Path, width: u32, height: u32) {
    let mut writer = VideoWriter::create(
        &dir.join("screen.mp4"),
        &VideoWriterConfig::new(width, height).offline(),
    )
    .expect("create the source writer");
    for index in 0..FRAMES {
        writer
            .append(&frame(width, height, index), index * (S / FPS))
            .expect("append a source frame");
    }
    writer.finish().expect("finish the source");
}

/// A background and the recording inset on it, rounded and rimmed. The shape of
/// the plan the automatic pass produces, which is what almost every export is.
fn plan(width: u32, height: u32) -> RenderPlan {
    let full = Rect {
        x: 0.0,
        y: 0.0,
        width: width as f64,
        height: height as f64,
    };
    RenderPlan {
        frame: prequel_render::Size {
            width: width as f64,
            height: height as f64,
        },
        items: vec![
            PlanItem::Fill {
                rect: full,
                paint: Paint::Solid {
                    color: "#101014".to_owned(),
                },
            },
            PlanItem::Image {
                source: prequel_render::PlanSource::Screen,
                src_rect: full,
                dst_rect: Rect {
                    x: width as f64 * 0.05,
                    y: height as f64 * 0.05,
                    width: width as f64 * 0.9,
                    height: height as f64 * 0.9,
                },
                shape: Shape {
                    radius: 18.0,
                    exponent: 4.0,
                },
                mirror: false,
                matte: false,
                blobs: Vec::new(),
                motion: Vec::new(),
                grade: None,
                rim: 0.6,
                fringe: 0.0,
            },
        ],
        filter: None,
    }
}

fn measure(label: &str, width: u32, height: u32) {
    let dir = scratch(&format!("prequel-export-cost-{label}"));
    record(&dir, width, height);

    let request = ExportRequest {
        session_dir: dir.clone(),
        library_dir: None,
        output: dir.join("export.mp4"),
        width,
        height,
        fps: FPS as u32,
        format: OutputFormat::Mp4,
        slices: vec![SliceRender {
            start: 0,
            end: SECONDS * S,
            plan: plan(width, height),
            audio: AudioMix::tracks(1.0, 1.0),
            speed: 1.0,
            media: SliceMedia {
                screen: Some(SegmentRef {
                    file: TrackKind::Screen.file_name().into(),
                    offset: 0,
                }),
                camera: None,
                matte: None,
                mic: None,
                system: None,
            },
        }],
        sound: None,
        music: vec![],
    };

    // Three runs, best reported: the first pays for shader compilation and a
    // cold buffer pool, which is real but is not what a long export spends its
    // time on.
    let mut best = f64::MAX;
    for _ in 0..3 {
        let began = std::time::Instant::now();
        let summary = export(&request, &CancelFlag::new(), &mut |_| {}).expect("export");
        let per_frame = began.elapsed().as_secs_f64() * 1e3 / summary.frames as f64;
        best = best.min(per_frame);
    }

    eprintln!(
        "{label:>8}: {best:5.2} ms/frame  — a 35s clip would take {:4.1}s",
        best * 35.0 * FPS as f64 / 1e3,
    );
}

#[test]
#[ignore]
fn an_export_costs_about_what_the_encoder_costs() {
    measure("720p", 1280, 720);
    measure("1080p", 1920, 1080);
    measure("2160p", 3840, 2160);
}
