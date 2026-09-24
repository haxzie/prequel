//! What a look actually did to the pixels.
//!
//! One test carries the whole filter pass. A frame drawn with `aberration` has
//! its red and blue channels sampled from either side of where it is, so a hard
//! black-to-white edge comes out with a coloured fringe — and *only* a coloured
//! fringe, since nothing else in the plan is coloured at all. Nothing but the
//! real pass produces that: the scene texture, the second pipeline, the uniform
//! block, the shader's own arithmetic and the serde mirror all have to be right
//! for the fringe to land, and any one of them being wrong shows as its
//! absence.
//!
//! Shape tests — duration, frame count, dimensions — pass happily on a frame
//! that had no filter run over it at all, which is exactly the failure this
//! file exists to catch.
//!
//! Needs no display and no Screen Recording grant.

use std::path::{Path, PathBuf};
use std::process::Command;

use cidre::{arc, cv};
use prequel_encode::{VideoWriter, VideoWriterConfig};
use prequel_render::{
    AudioMix, CancelFlag, ExportRequest, FilterKind, OutputFormat, PlanFilter, PlanItem, PlanSource,
    Rect, RenderPlan, SegmentRef, Shape, Size, SliceMedia, SliceRender, export,
};
use prequel_session::TrackKind;

const S: u64 = 1_000_000_000;

/// Wider and larger than the other pixel tests use.
///
/// The split grows with the square of the distance from the middle of the
/// frame, and it is measured as a fraction of the picture — so a small frame
/// gets a small split in pixels, and a 4:3 one reaches less far sideways than
/// a wide one. At 960×540 the fringe at a tenth of the way across is about
/// eight pixels, which survives an h.264 round trip with room to spare.
const OUT_W: u32 = 960;
const OUT_H: u32 = 540;
const FPS: u32 = 10;

/// Where the source turns from black to white, as a fraction of the width.
///
/// Well off to one side. In the middle of the frame the split is zero — that is
/// the whole point of the effect — so a boundary down the centre would prove
/// nothing either way.
const EDGE: f64 = 0.1;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(name);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create the scratch directory");
    dir
}

/// A BGRA buffer, black to the left of `EDGE` and white to the right.
///
/// Black and white rather than two colours: the fringe has to be the only
/// colour in the frame, or "is that the filter or the footage" has no answer.
fn edged_frame(width: u32, height: u32) -> arc::R<cv::PixelBuf> {
    let mut buf = cv::PixelBuf::new(
        width as usize,
        height as usize,
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
        let edge = (width as f64 * EDGE) as usize;

        for y in 0..height as usize {
            for x in 0..width as usize {
                let at = y * stride + x * 4;
                let level: u8 = if x < edge { 0 } else { 255 };
                *base.add(at) = level;
                *base.add(at + 1) = level;
                *base.add(at + 2) = level;
                *base.add(at + 3) = 255;
            }
        }

        buf.unlock_lock_base_addr(cv::pixel_buffer::LockFlags::DEFAULT)
            .result()
            .expect("unlock");
    }

    buf
}

fn record(dir: &Path, name: &str, width: u32, height: u32, frame: &arc::R<cv::PixelBuf>) {
    let mut writer = VideoWriter::create(
        &dir.join(name),
        &VideoWriterConfig::new(width, height).offline(),
    )
    .expect("create the source writer");

    for index in 0..FPS as u64 {
        writer
            .append(frame, index * (S / FPS as u64))
            .expect("append a source frame");
    }
    writer.finish().expect("finish the source");
}

struct Frame {
    pixels: Vec<u8>,
    width: u32,
}

impl Frame {
    fn at(&self, x: u32, y: u32) -> (u8, u8, u8) {
        let index = ((y * self.width + x) * 3) as usize;
        (
            self.pixels[index],
            self.pixels[index + 1],
            self.pixels[index + 2],
        )
    }
}

/// Read back through `ffmpeg` rather than by decoding here — the point is to
/// see what a player sees, and a bug in our own reader would otherwise cancel
/// out a bug in our own writer.
fn first_frame(video: &Path) -> Frame {
    let out = video.with_extension("rgb");
    let _ = std::fs::remove_file(&out);

    let status = Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(video)
        .args([
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-y",
        ])
        .arg(&out)
        .status()
        .expect("ffmpeg must be installed to verify exported pixels");

    assert!(
        status.success(),
        "ffmpeg could not decode {}",
        video.display()
    );

    let pixels = std::fs::read(&out).expect("read the decoded frame");
    let _ = std::fs::remove_file(&out);
    assert_eq!(pixels.len(), (OUT_W * OUT_H * 3) as usize);

    Frame {
        pixels,
        width: OUT_W,
    }
}

/// The frame, with the source stretched across all of it and `filter` over the
/// top.
fn plan(filter: Option<PlanFilter>) -> RenderPlan {
    let full = Rect {
        x: 0.0,
        y: 0.0,
        width: OUT_W as f64,
        height: OUT_H as f64,
    };

    RenderPlan {
        frame: Size {
            width: OUT_W as f64,
            height: OUT_H as f64,
        },
        items: vec![PlanItem::Image {
            source: PlanSource::Screen,
            src_rect: Rect {
                x: 0.0,
                y: 0.0,
                width: OUT_W as f64,
                height: OUT_H as f64,
            },
            dst_rect: full,
            shape: Shape {
                radius: 0.0,
                exponent: 2.0,
            },
            mirror: false,
            matte: false,
            motion: Vec::new(),
        }],
        filter,
    }
}

fn aberration() -> PlanFilter {
    PlanFilter {
        id: FilterKind::Aberration,
        variant: String::new(),
        strength: 1.0,
        scale: 0.01,
        // Radial, which is what pulls the channels apart *across* the vertical
        // edge below. A quarter turn would run them along it and split nothing.
        angle: 0.0,
        tint: "#ffffff".to_owned(),
        animated: false,
    }
}

fn render(name: &str, filter: Option<PlanFilter>) -> (PathBuf, Frame) {
    let dir = scratch(name);
    let source = edged_frame(OUT_W, OUT_H);
    record(&dir, "screen.mp4", OUT_W, OUT_H, &source);

    let output = dir.join("export.mp4");
    let request = ExportRequest {
        session_dir: dir.clone(),
        output: output.clone(),
        width: OUT_W,
        height: OUT_H,
        fps: FPS,
        format: OutputFormat::Mp4,
        slices: vec![SliceRender {
            start: 0,
            end: S,
            plan: plan(filter),
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
    };

    export(&request, &CancelFlag::new(), &mut |_| {}).expect("export");
    let frame = first_frame(&output);
    (dir, frame)
}

/// The boundary, at the height where the split is purely horizontal.
///
/// Halfway down, so the vertical component of the offset is exactly zero and
/// the red and blue taps land on opposite sides of the edge rather than
/// diagonally off it.
fn boundary() -> (u32, u32) {
    ((OUT_W as f64 * EDGE) as u32, OUT_H / 2)
}

#[test]
fn a_look_reaches_the_exported_pixels() {
    let (dir, frame) = render("prequel-filter-aberration", Some(aberration()));
    let (x, y) = boundary();
    let (r, _g, b) = frame.at(x, y);

    // Red is sampled further *out* from the middle of the frame — to the left
    // here, which is black — and blue further in, which is white. So the edge
    // reads blue. Nothing else in this plan is coloured at all: the source is
    // greyscale and there is no background, no border and no shadow, so a
    // channel difference this large can only have come from the filter pass.
    assert!(
        b as i16 - r as i16 > 60,
        "expected a blue fringe on the edge, got r={r} b={b}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_same_frame_without_a_look_has_no_fringe() {
    // The control, and it is the half that matters. The assertion above would
    // also pass on a source that was blue to begin with, or on a compositor
    // that had swapped two channels — this is what says the difference came
    // from the look and not from everything else.
    let (dir, frame) = render("prequel-filter-none", None);
    let (x, y) = boundary();
    let (r, _g, b) = frame.at(x, y);

    assert!(
        (b as i16 - r as i16).abs() < 30,
        "expected grey with no look on, got r={r} b={b}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_look_leaves_the_middle_of_the_picture_alone() {
    // The split grows with the square of the distance from the centre, so the
    // centre itself is untouched. A filter that shifted the whole frame — a
    // uniform offset rather than a radial one — would pass the fringe test and
    // fail this one.
    let (dir, frame) = render("prequel-filter-centre", Some(aberration()));
    let (r, g, b) = frame.at(OUT_W / 2, OUT_H / 2);

    assert!(
        r > 200 && g > 200 && b > 200,
        "expected the middle to stay white, got r={r} g={g} b={b}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// Every look in the catalogue, with the variant that exercises the most of it.
///
/// The index is what the shader switches on and the variant is what its own
/// switch does, so a look wired to the wrong arm and a variant that never
/// reaches its branch both show up as "this frame is identical to the
/// unfiltered one".
const EVERY_LOOK: [(FilterKind, &str); 11] = [
    (FilterKind::Aberration, ""),
    (FilterKind::Grade, "teal-orange"),
    (FilterKind::Pixelate, "bayer"),
    (FilterKind::Halftone, "cmyk"),
    (FilterKind::Lcd, "dot-matrix"),
    (FilterKind::Fisheye, "dome"),
    (FilterKind::Crt, "slot"),
    (FilterKind::Vhs, ""),
    (FilterKind::Film, "super8"),
    (FilterKind::Bloom, ""),
    (FilterKind::WindowLight, "leaves"),
];

/// How far apart two frames are, averaged over every channel of every pixel.
fn distance(a: &Frame, b: &Frame) -> f64 {
    let total: i64 = a
        .pixels
        .iter()
        .zip(b.pixels.iter())
        .map(|(x, y)| (*x as i64 - *y as i64).abs())
        .sum();
    total as f64 / a.pixels.len() as f64
}

#[test]
fn every_look_in_the_catalogue_changes_the_frame() {
    // The cheapest guard there is on eleven shaders, and it catches the failure
    // that costs the most to find by eye: a look whose arm of the switch is
    // never reached exports the picture untouched, which in the editor is
    // indistinguishable from "this effect is subtle".
    //
    // It also proves the Metal library compiles with all eleven in it. A
    // `filters.metal` that will not build leaves `filter_pipeline` as `None`
    // and every frame here comes out unfiltered — so this one assertion covers
    // the whole file.
    let (plain_dir, plain) = render("prequel-filter-plain", None);

    for (kind, variant) in EVERY_LOOK {
        let mut filter = aberration();
        filter.id = kind;
        filter.variant = variant.to_owned();
        // A pitch fine enough that a ruled look lands several cells across the
        // frame, and a tint that is not white so the looks that multiply by one
        // actually move.
        filter.scale = 0.02;
        filter.tint = "#ffb478".to_owned();
        // Still, so the frame is the same one every run: the animated parts
        // hash the clock, and a test that changed with the wall clock would be
        // a test nobody trusts.
        filter.animated = false;

        let name = format!("prequel-filter-{}", kind.index());
        let (dir, frame) = render(&name, Some(filter));
        let moved = distance(&frame, &plain);

        assert!(
            moved > 1.0,
            "{kind:?}/{variant} left the frame alone (mean channel distance {moved:.3})"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    let _ = std::fs::remove_dir_all(&plain_dir);
}
